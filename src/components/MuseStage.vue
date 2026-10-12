<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMuse } from '../composables/useMuse'
import { useAuthStore } from '../stores/useAuthStore'
import { useUiStore } from '../stores/useUiStore'

/* 舞台与气泡的外观在全局 style.css（#museButler / .art-muse-* / #oml2d-*），这里只管行为 */

/* 路由离场动画进行中：由 App 传入，转场期间停掉渲染 */
const props = defineProps({
  routePaused: { type: Boolean, default: false },
})

const route = useRoute()
const isHome = computed(() => route.path === '/')
const muse = useMuse()
const uiStore = useUiStore()
const authStore = useAuthStore()

/* 点看板娘开合气泡。模型层是 pointer-events: none，用 document 级点击 + 命中区判断 */
function toggleMuseBubbleOnModelClick(event) {
  if (isHome.value) return
  const target = event.target
  if (target && target.closest) {
    const interactive = target.closest(
      'a, button, input, select, textarea, label, [role="button"], .cyan-navbar, .art-admin-menu, .art-modal',
    )
    if (interactive) return
  }
  if (!isOnMuseModel(event.clientX, event.clientY)) return
  muse.toggleMuseBubble()
}

/* 角色只占画布中间一竖条，可点击区收窄到轮廓附近 */
const MUSE_HIT = { x0: 0.26, x1: 0.74, y0: 0.05, y1: 1 }

function isOnMuseModel(x, y) {
  const stage = museStageEl()
  if (!stage) return false
  const r = stage.getBoundingClientRect()
  if (!r.width) return false
  return (
    x >= r.left + r.width * MUSE_HIT.x0 &&
    x <= r.left + r.width * MUSE_HIT.x1 &&
    y >= r.top + r.height * MUSE_HIT.y0 &&
    y <= r.top + r.height * MUSE_HIT.y1
  )
}

/* 气泡贴着看板助手：右侧放得下就贴头部右侧，放不下就贴头顶上方 */
function positionMuseBubble() {
  const stage = museStageEl()
  const butler = document.getElementById('museButler')
  const bubble = document.getElementById('museBubble')
  if (!stage || !butler) return
  /* 兜底成静态头像时，气泡交给 CSS 锚点 */
  if (museFallback.value) return
  const r = stage.getBoundingClientRect()
  /* 手机端 oml2d 会建一个 0 高的空舞台，跳过让 CSS 头像定位生效 */
  if (r.width < 40 || r.height < 60) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const charLeft = r.left + r.width * MUSE_HIT.x0
  const charRight = r.left + r.width * MUSE_HIT.x1
  const charTop = r.top + r.height * MUSE_HIT.y0
  const bw = bubble ? bubble.getBoundingClientRect().width : 220
  const bh = bubble ? bubble.getBoundingClientRect().height : 110
  let left
  let bottom
  if (vw - charRight >= bw + 18) {
    /* 压在角色右缘 */
    left = charRight - 24
    /* 与头部垂直居中，再上抬 10px */
    bottom = vh - (charTop + r.height * 0.16) - bh / 2 + 10
  } else {
    left = Math.min(Math.max(charLeft, 8), Math.max(8, vw - bw - 8))
    bottom = vh - charTop + 8
  }
  butler.style.setProperty('--muse-anchor-left', Math.round(left) + 'px')
  butler.style.setProperty('--muse-anchor-bottom', Math.round(bottom) + 'px')
}

function museStageEl() {
  return document.getElementById('oml2d-stage')
}

let oml2dInstance = null

/* ---------------- 桌面端模型兜底 ---------------- */
const museFallback = ref(false)
let museHealthTimer = null
let museBadTicks = 0
let museGoodTicks = 0
/* 全屏层（沉浸写作）打开期间主动收起模型 */
let museSuppressed = false

function setMuseFallback(on) {
  if (museFallback.value === on) return
  museFallback.value = on
  const butler = document.getElementById('museButler')
  if (butler) {
    /* 清掉内联锚点，交回 CSS 头像定位 */
    if (on) {
      butler.style.removeProperty('--muse-anchor-left')
      butler.style.removeProperty('--muse-anchor-bottom')
    }
  }
  applyMuseStageVisibility()
  if (!on) positionMuseBubble()
}

/* 舞台显隐：兜底用 display，全屏层收起用 visibility */
function applyMuseStageVisibility() {
  const stage = museStageEl()
  if (!stage) return
  stage.style.display = museFallback.value ? 'none' : ''
  /* 不能用 display:none：画布尺寸归零后模型会丢部件 */
  stage.style.visibility = museSuppressed ? 'hidden' : ''
}

/* v0.19.x 的公开方法只隐藏舞台、不停渲染；隔离访问内部 PIXI 实例。
   同时暂停画布和模型更新，不停止全局共享 ticker，不销毁已加载的模型。 */
function syncMuseRendering(forcePause = false) {
  const paused = forcePause || museSuppressed || isHome.value || props.routePaused
  const app = oml2dInstance?.pixiApp?.app
  const model = oml2dInstance?.models?.model
  if (model && model.autoUpdate !== !paused) model.autoUpdate = !paused
  if (paused) app?.stop()
  else app?.start()
}

/* 收起 / 恢复模型 */
function setMuseSuppressed(on) {
  if (museSuppressed === on) return
  museSuppressed = on
  syncMuseRendering()
  applyMuseStageVisibility()
  if (on) {
    /* 收起期间不做健康判定 */
    museBadTicks = 0
    museGoodTicks = 0
  } else {
    positionMuseBubble()
    checkMuseHealth()
  }
}

function checkMuseHealth() {
  /* 收起期间不做健康判定 */
  if (museSuppressed) return
  /* 手机端本就是头像模式 */
  if (!window.matchMedia('(min-width: 1024px)').matches) {
    museBadTicks = 0
    museGoodTicks = 0
    return
  }
  const canvas = document.getElementById('oml2d-canvas')
  const rect = canvas ? canvas.getBoundingClientRect() : null
  const healthy = !!(
    canvas &&
    rect &&
    rect.width > 40 &&
    rect.height > 40 &&
    getComputedStyle(canvas).display !== 'none' &&
    /* 上下文丢了画布尺寸还是好的，但模型已经画不出来 */
    !museContextLost
  )
  if (healthy) {
    museBadTicks = 0
    museGoodTicks++
  } else {
    museGoodTicks = 0
    museBadTicks++
  }
  /* 连续两次异常兜底，连续三次正常恢复 */
  if (!museFallback.value && museBadTicks >= 2) setMuseFallback(true)
  else if (museFallback.value && museGoodTicks >= 3) setMuseFallback(false)
  /* 兜底时画布被藏起来，尺寸判定永远不成立，只能定期重建把模型救回来。
     上下文没还回来时重建也没用，那种情况交给 webglcontextrestored */
  else if (museFallback.value && !museContextLost && performance.now() - museLastRebuildAt > MUSE_REBUILD_RETRY)
    rebuildMuse()
}

/* ---------------- WebGL 上下文自愈 ----------------
   把窗口拖到别的屏幕时浏览器可能丢掉画布上下文。pixi 会把上下文要回来，
   但 Live2D 自己那套贴图/裁剪遮罩/着色器是另一批 GL 对象，恢复后依旧是旧的，
   画面就会花掉，而且不会自己好——只有重建模型（等于刷新一次看板娘）能修。 */
let museContextLost = false
let museRebuildTask = null
let museLastRebuildAt = performance.now()
/* 兜底期间每隔一段时间重试一次重建，不让用户只能靠刷新 */
const MUSE_REBUILD_RETRY = 30000

function bindMuseContextEvents() {
  const canvas = document.getElementById('oml2d-canvas')
  if (!canvas || canvas.dataset.museContextBound) return
  canvas.dataset.museContextBound = '1'
  canvas.addEventListener('webglcontextlost', () => {
    museContextLost = true
  })
  canvas.addEventListener('webglcontextrestored', () => {
    museContextLost = false
    /* 上下文刚回来，模型那套 GL 资源已经作废，整只重建 */
    rebuildMuse()
  })
}

function rebuildMuse() {
  if (museRebuildTask || !oml2dInstance) return
  museLastRebuildAt = performance.now()
  museRebuildTask = (async () => {
    try {
      /* 兜底头像占着舞台时先让位，重建完才看得见模型 */
      setMuseFallback(false)
      await oml2dInstance.reloadModel()
      museBadTicks = 0
      museGoodTicks = 0
    } catch (e) {
      /* 重建失败：继续用静态头像兜底 */
      museBadTicks = 2
      setMuseFallback(true)
    } finally {
      museRebuildTask = null
      syncMuseRendering()
    }
  })()
}

/* ---------------- 手机端看板头像：长按拖动 ---------------- */
const MUSE_HOLD_MS = 200
const MUSE_MOVE_TOLERANCE = 8
let museHoldTimer = null
let museDrag = null
let museSuppressClickUntil = 0

function isMobileMuse() {
  return window.matchMedia('(max-width: 1023px)').matches
}

/* 点头像开合气泡，刚拖完不触发 */
function onMuseAvatarClick() {
  if (performance.now() < museSuppressClickUntil) return
  muse.toggleMuseBubble()
}

function onMuseAvatarPointerDown(event) {
  if (!isMobileMuse()) return
  museDrag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false, armed: false }
  if (museHoldTimer) clearTimeout(museHoldTimer)
  museHoldTimer = setTimeout(() => {
    museHoldTimer = null
    if (museDrag) museDrag.armed = true
  }, MUSE_HOLD_MS)
}

function beginMuseDrag() {
  const butler = document.getElementById('museButler')
  if (!butler || !museDrag) return
  const rect = butler.getBoundingClientRect()
  museDrag.originLeft = rect.left
  museDrag.originTop = rect.top
  museDrag.dragging = true
  butler.style.transition = 'none'
  butler.style.left = rect.left + 'px'
  butler.style.top = rect.top + 'px'
  butler.style.bottom = 'auto'
  document.body.style.cursor = 'grabbing'
}

function onMuseAvatarPointerMove(event) {
  if (!museDrag || event.pointerId !== museDrag.id) return
  const butler = document.getElementById('museButler')
  if (!butler) return
  const dx = event.clientX - museDrag.startX
  const dy = event.clientY - museDrag.startY

  if (!museDrag.dragging) {
    /* 长按未成立也未移动：按点击处理 */
    if (!museDrag.armed && Math.hypot(dx, dy) <= MUSE_MOVE_TOLERANCE) return
    beginMuseDrag()
  }

  const maxLeft = Math.max(4, window.innerWidth - butler.offsetWidth - 4)
  const maxTop = Math.max(4, window.innerHeight - butler.offsetHeight - 4)
  butler.style.left = Math.min(Math.max(museDrag.originLeft + dx, 4), maxLeft) + 'px'
  butler.style.top = Math.min(Math.max(museDrag.originTop + dy, 4), maxTop) + 'px'
}

function onMuseAvatarPointerUp() {
  if (museHoldTimer) {
    clearTimeout(museHoldTimer)
    museHoldTimer = null
  }
  const butler = document.getElementById('museButler')
  if (museDrag && museDrag.dragging) {
    if (butler) butler.style.transition = ''
    document.body.style.cursor = ''
    museSuppressClickUntil = performance.now() + 400
  }
  museDrag = null
}

function generateMuseFallbackAvatar() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#123b46"/>
        <stop offset="1" stop-color="#060d16"/>
      </linearGradient>
      <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1d5360"/>
        <stop offset="1" stop-color="#0c2530"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#bg)"/>
    <circle cx="50" cy="50" r="43" fill="none" stroke="#67e8f9" stroke-opacity=".14"/>
    <path d="M50 15v10" stroke="#67e8f9" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="14" r="4" fill="#67e8f9"/>
    <rect x="17" y="32" width="66" height="49" rx="17" fill="url(#face)" stroke="#67e8f9" stroke-opacity=".62" stroke-width="2.5"/>
    <rect x="27" y="40" width="46" height="25" rx="12" fill="#07151d" stroke="#22d3ee" stroke-opacity=".32" stroke-width="1.5"/>
    <circle cx="39" cy="52.5" r="4.5" fill="#67e8f9"/>
    <circle cx="61" cy="52.5" r="4.5" fill="#67e8f9"/>
    <path d="M42 69q8 6 16 0" fill="none" stroke="#a5f3fc" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="9" y="47" width="8" height="16" rx="4" fill="#0e2c36" stroke="#67e8f9" stroke-opacity=".5"/>
    <rect x="83" y="47" width="8" height="16" rx="4" fill="#0e2c36" stroke="#67e8f9" stroke-opacity=".5"/>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function handleMuseAvatarError(event) {
  const img = event.target
  if (img.classList.contains('is-fallback-avatar')) return
  img.classList.add('is-fallback-avatar')
  img.src = generateMuseFallbackAvatar()
}

/* 路由与状态联动一律在 setup 顶层创建：绑定组件的 effect scope，卸载时自动停止。
   不能放进 onMounted —— 钩子里的 await 之后当前 effect scope 已经退出，
   那时创建的 watcher 不会被组件收集，卸载也不会停止。 */
let museBooted = false
watch(
  isHome,
  (home) => {
    /* 首页看不到看板娘（容器被 v-show 藏了），开场就唤醒等于把气泡演给空气看，
       十秒后自动收起，等切到别的页面时早就没了。所以改成「第一次离开首页」才唤醒。 */
    if (home || museBooted) return
    museBooted = true
    muse.awakeMuse()
  },
  { immediate: true },
)

/* 气泡展开时重新贴一次 */
watch(
  () => muse.bubbleVisible.value,
  (visible) => {
    if (visible) nextTick(positionMuseBubble)
  },
)

/* 沉浸写作时收起模型，避免遮挡写作区（初值在 onMounted 里应用） */
watch(
  () => uiStore.immersiveWriting || isHome.value,
  (hidden) => setMuseSuppressed(hidden),
)

/* 身份切换后重新请求对应身份的说辞；要等新 token 就位，/ai/summary 需要登录态 */
watch(
  () => [authStore.isGlobalAdmin, authStore.token],
  ([isAdmin, token], [prevIsAdmin, prevToken]) => {
    if (prevIsAdmin === undefined) return
    if (isAdmin === prevIsAdmin && token === prevToken) return
    /* token 未签发前先不动 */
    if (!token) return
    muse.refreshSummary()
  },
)

/* 路由离场视图在场时暂停模型渲染 */
watch(
  () => props.routePaused,
  () => syncMuseRendering(),
)

onMounted(async () => {
  /* 先挂健康巡检，模型初始化抛错也能兜底 */
  museHealthTimer = setInterval(checkMuseHealth, 3000)
  setTimeout(checkMuseHealth, 2500)

  /* 左下角看板娘：只负责形象展示，气泡仍走 muse 的逻辑 */
  try {
    const { loadOml2d } = await import('oh-my-live2d')
    oml2dInstance = loadOml2d({
      models: [
        {
          /* 女仆风 Live2D 模型 rem：自带动作与物理，鼠标可追踪 */
          path: 'https://cdn.jsdelivr.net/npm/live2d-widget-model-rem@1.0.1/assets/rem.model.json',
          scale: 0.11,
          position: [0, 0],
          mobileScale: 0.065,
          mobilePosition: [0, 0],
        },
      ],
      /* 手机端改用静态头像，不渲染模型 */
      mobileDisplay: false,
      menus: { disable: true },
      /* tips 没有 disable 开关，桌面与移动端各有一套样式，都关掉 */
      tips: { style: { display: 'none' }, mobileStyle: { display: 'none' } },
      /* 关掉启动时的蓝色状态条 */
      statusBar: { disable: true },
    })
  } catch (e) {
    /* 初始化失败：兜底静态头像 */
    museBadTicks = 2
    setMuseFallback(true)
  }
  /* 画布此时已由库创建：盯住 WebGL 上下文丢失/恢复，跨屏后自愈 */
  bindMuseContextEvents()
  /* 点模型开合气泡（v0.19.3 没有 onStageClick） */
  document.addEventListener('click', toggleMuseBubbleOnModelClick)
  /* 拖拽的 move/up 挂 window，指针移出头像也能继续拖 */
  window.addEventListener('pointermove', onMuseAvatarPointerMove)
  window.addEventListener('pointerup', onMuseAvatarPointerUp)
  window.addEventListener('pointercancel', onMuseAvatarPointerUp)
  /* 加载完成后校准气泡位置 */
  oml2dInstance?.onLoad?.((status) => {
    if (status === 'fail') {
      /* 加载失败：兜底静态头像 */
      museBadTicks = 2
      setMuseFallback(true)
      return
    }
    if (status !== 'success') return
    syncMuseRendering()
    /* 入场动画期间舞台还在滑动，位置多算几次 */
    positionMuseBubble()
    requestAnimationFrame(positionMuseBubble)
    setTimeout(positionMuseBubble, 500)
    setTimeout(positionMuseBubble, 1300)
  })
  /* 沉浸写作 / 首页：挂载时按当前状态应用一次（原先由 immediate watcher 在同一位置完成） */
  setMuseSuppressed(uiStore.immersiveWriting || isHome.value)
  window.addEventListener('resize', positionMuseBubble)
})

onUnmounted(() => {
  syncMuseRendering(true)
  document.removeEventListener('click', toggleMuseBubbleOnModelClick)
  window.removeEventListener('pointermove', onMuseAvatarPointerMove)
  window.removeEventListener('pointerup', onMuseAvatarPointerUp)
  window.removeEventListener('pointercancel', onMuseAvatarPointerUp)
  if (museHoldTimer) clearTimeout(museHoldTimer)
  document.body.style.cursor = ''
  window.removeEventListener('resize', positionMuseBubble)
  if (museHealthTimer) clearInterval(museHealthTimer)
})
</script>

<template>
  <!-- 看板助手：PC 端是 oh-my-live2d 模型，手机端是静态头像 -->
  <div v-show="!isHome" id="museButler" class="flex items-end gap-3 pointer-events-none transition-all duration-700 transform"
      :class="[muse.awake.value ? '' : 'translate-y-20 opacity-0', museFallback ? 'is-fallback' : '']">
      <div class="art-muse-avatar pointer-events-auto" :class="muse.bubbleVisible.value ? 'is-tilted' : ''"
          @click="onMuseAvatarClick" @pointerdown="onMuseAvatarPointerDown">
          <img src="https://media.cyanspace.work/robot/robot_avatar.png" @error="handleMuseAvatarError" alt="Assistant">
          <span class="art-muse-dot absolute flex h-2.5 w-2.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
          </span>
      </div>
      <div id="museBubble" class="art-muse-bubble pointer-events-auto"
          :class="muse.bubbleVisible.value ? '' : 'is-hidden'">
          <div class="art-muse-bubble-head">
              <div class="art-muse-bubble-title">
                  <span class="art-muse-bubble-name">Assistant</span>
              </div>
              <i class="ph-bold ph-x art-muse-bubble-close" @click="muse.toggleMuseBubble()"></i>
          </div>
          <p id="museContent" class="art-muse-content"><template
                  v-if="muse.loading.value"><i
                      class="ph-bold ph-spinner-gap animate-spin text-zinc-500 inline-block mr-1"></i> <span
                      class="text-zinc-500">看板助手正在悄悄准备想对你说的话...</span></template><template
                  v-else>{{ muse.content.value }}</template></p>
      </div>
  </div>
</template>

<style scoped>
/* Muse 助手 */
.art-muse-bubble {
    position: absolute;
    /* 挂到看板娘右侧 */
    left: 100%;
    /* 相对容器再抬高 10px */
    bottom: 20px;
    width: max-content;
    /* 保证不越过屏幕右边缘 */
    max-width: min(188px, calc(100vw - var(--muse-anchor-left, 120px) - 16px));
    padding: 9px 11px;
    border-radius: 16px 16px 16px 6px;
    border: 1px solid var(--art-line-2);
    background: rgba(4, 8, 10, .8);
    box-shadow: 0 20px 50px rgba(0, 0, 0, .8), 0 0 20px rgba(0, 255, 255, .1);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    transform-origin: 0 100%;
    opacity: 1;
    visibility: visible;
    transition: opacity .4s ease, transform .5s var(--art-ease), visibility 0s linear
}

/* 收起：先淡出再撤掉可见性，避免整块瞬间消失 */
.art-muse-bubble.is-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(8px) scale(.94);
    transition: opacity .32s ease, transform .38s ease, visibility 0s linear .38s
}

@media (min-width:768px) {
    .art-muse-bubble {
        max-width: 210px
    }}

.art-muse-bubble-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px
}

.art-muse-bubble-title {
    display: flex;
    align-items: center;
    gap: 8px
}

.art-muse-bubble-name {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: .12em;
    text-transform: none;
    color: var(--art-accent)
}

.art-muse-bubble-close {
    font-size: 11px;
    color: var(--art-ink-4);
    cursor: pointer;
    transition: color .35s ease
}
@media (hover: hover) and (pointer: fine){.art-muse-bubble-close:hover{
    color: #fff
}}

.art-muse-content {
    font-size: 10px;
    line-height: 1.65;
    color: #c8c8ce;
    min-height: 26px
}

/* 看板助手容器：PC 端是模型（气泡位置由 JS 计算），手机端是静态头像 */
#museButler {
    position: fixed;
    /* 手机端：头像贴左下角，气泡挂在右侧 */
    --muse-anchor-left: 16px;
    --muse-anchor-bottom: calc(112px + env(safe-area-inset-bottom, 0px));
    left: var(--muse-anchor-left);
    bottom: var(--muse-anchor-bottom);
    z-index: 90;
    /* 透明容器不能拦鼠标 */
    pointer-events: none
}

/* PC：气泡悬停在看板娘头部右侧偏上 */
@media (min-width:768px) {
    #museButler {
        --muse-anchor-left: 210px;
        --muse-anchor-bottom: 200px
    }
}

/* 静态头像：只在手机端出现 */
.art-muse-avatar {
    display: none;
    position: relative;
    width: 48px;
    height: 48px;
    flex: 0 0 auto;
    /* 背景圆环四周的内缩量：容器 48px，环直径 = 48 - 2×2.4 = 43.2px
       偏头抵消缩放时的轴心也由它换算，所以改这一个值即可整体缩放圆环 */
    --muse-ring-inset: 2.4px;
    cursor: pointer;
    /* 长按拖拽时不要触发页面滚动/下拉刷新 */
    touch-action: none;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
    /* 偏头以脖子为轴心 */
    transform-origin: 50% 76%;
    /* 圆环单独成层压在图片下方，负 z 索引才不会沉到页面背景后面 */
    isolation: isolate;
    transition: transform .65s ease-out
}

/* 背景圆环：比角色轮廓大一圈，脑袋落在环心 */
.art-muse-avatar::before {
    content: "";
    position: absolute;
    inset: var(--muse-ring-inset);
    z-index: -1;
    border-radius: 50%;
    border: 1px solid var(--art-line-2);
    background: rgba(255, 255, 255, .03);
    transition: transform .65s ease-out, border-color .6s ease
}

.art-muse-avatar img {
    /* 78%：角色图片仍按容器居中，再整体上移 2px，让脑袋（不含丸子）落在环心 */
    width: 78%;
    height: 78%;
    object-fit: contain;
    position: relative;
    top: -2px;
    /* 光环挂在角色轮廓上：drop-shadow 跟着 alpha 走，圆环自己不发光 */
    filter: drop-shadow(0 0 5px rgba(0, 255, 255, .3));
    transition: filter .6s ease;
    /* 不裁图片：这张 PNG 四角本来就是透明的，圆形裁切会切掉头顶两个丸子 */
    -webkit-user-drag: none;
    -webkit-user-select: none;
    user-select: none
}

/* 默认头像本身是满幅圆，按圆环内径居中放大即可正好嵌入 */
.art-muse-avatar img.is-fallback-avatar {
    width: 84%;
    height: 84%;
    top: 0
}

/* 在线点跟住圆环右下缘 */
.art-muse-dot {
    right: 10%;
    bottom: 10%
}

/* 气泡弹出来时逆时针偏头并放大，气泡收起后回正 */
.art-muse-avatar.is-tilted {
    transform: rotate(-12deg) scale(1.05)
}

/* 偏头时亮起来的是角色轮廓，不是圆环 */
.art-muse-avatar.is-tilted img {
    filter: drop-shadow(0 0 4px rgba(0, 255, 255, .75)) drop-shadow(0 0 11px rgba(0, 255, 255, .4))
}

/* 偏头时圆环跟着一起转，但只让角色变大：用 1/1.05 抵消父级的 1.05 缩放
   轴心是脖子（容器 50% 76% = 24px / 36.48px），换算到圆环自身坐标系要减去内缩量 */
.art-muse-avatar.is-tilted::before {
    transform-origin: calc(24px - var(--muse-ring-inset)) calc(36.48px - var(--muse-ring-inset));
    transform: scale(.952381);
    border-color: rgba(0, 255, 255, .5)
}

@media (max-width:1023px) {
    .art-muse-avatar {
        display: flex
    }

    /* 手机端不用 Live2D 模型，直接隐藏空舞台 */
    :global(#oml2d-stage),
    :global(#oml2d-canvas) {
        display: none !important
    }}

/* 桌面端模型异常时兜底成静态头像 */
#museButler.is-fallback {
    --muse-anchor-left: 16px;
    --muse-anchor-bottom: calc(112px + env(safe-area-inset-bottom, 0px))
}

#museButler.is-fallback .art-muse-avatar {
    display: flex
}

/* 画布被紧裁到小腿，贴底摆放 */
:global(#oml2d-stage) {
    /* 只做水平左移：内容区左缘 = max(4vw,(100vw-1360px)/2)；
       角色实际右缘按 MUSE_HIT.x1(0.74)×275≈204px 计，再留 10px 间隙，恰好不压住卡片 */
    left: min(10px, calc(max(4vw, (100vw - 1360px) / 2) - 214px)) !important;
    bottom: 0 !important;
    /* 关掉入场滑入动画，避免模型重载时新旧帧叠加 */
    animation: none !important;
    transform: none !important;
    /* 站在最上层，左侧导航不遮挡模型 */
    z-index: 9997 !important
}

/* 模型层不吃鼠标事件；oml2d 的追踪挂在 document 上，不受影响 */
:global(#oml2d-stage),
:global(#oml2d-canvas) {
    pointer-events: none !important
}

/* 关掉 oml2d 自带的蓝色提示牌 */
:global(#oml2d-tips),
:global(#oml2d-tips-content) {
    display: none !important
}

#museBubble {
    pointer-events: auto
}

/* 收起状态下不拦鼠标 */
#museBubble.is-hidden {
    pointer-events: none
}
</style>
