<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { copyText } from './utils/clipboard'

import SettingDialog from './components/SettingDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

/* 详情浮层是重依赖（md-editor 等）：异步加载，不拖累首页首屏 */
const DetailView = defineAsyncComponent(() => import('./views/DetailView.vue'))

import { useMuse } from './composables/useMuse'
import { useAuthStore } from './stores/useAuthStore'
import { useCategoryStore } from './stores/useCategoryStore'
import { useUiStore } from './stores/useUiStore'

const authStore = useAuthStore()
const uiStore = useUiStore()
const categoryStore = useCategoryStore()
const muse = useMuse()

const route = useRoute()
const isDetail = computed(() => route.path.startsWith('/post/'))
const isHome = computed(() => route.path === '/')
const navScrolled = ref(false)
const menuOpen = ref(false)
const navbarFrosted = computed(() => !isHome.value || navScrolled.value || menuOpen.value)
const mainView = ref(null)
/* ---------------- 点按 / 悬停反馈：统一用 data-fx 属性驱动 ----------------
   桌面：鼠标进入加、离开去；触屏：按下加，短暂停留后自动去掉。
   用 data-fx 而不是 class —— 这些按钮多是 RouterLink，路由一变 Vue 会重写 class 属性，
   手加的类会被抹掉、动效演到一半就断（表现就是"闪一下"）。 */
const FX_TARGET = '.cyan-brand, .cyan-nav-links a, .cyan-nav-icon, .cyan-account, .home-avatar-frame, .home-stat'
const FX_HOLD_MS = 420
let fxEl = null
let fxTimer = 0

function clearFx() {
  if (fxTimer) {
    clearTimeout(fxTimer)
    fxTimer = 0
  }
  if (fxEl) {
    fxEl.removeAttribute('data-fx')
    fxEl = null
  }
}

function setFx(el, holdMs) {
  clearFx()
  if (!el) return
  el.setAttribute('data-fx', '')
  fxEl = el
  if (holdMs) fxTimer = setTimeout(clearFx, holdMs)
}

function fxTarget(event) {
  const el = event.target
  return el && el.closest ? el.closest(FX_TARGET) : null
}

function onFxOver(event) {
  if (event.pointerType !== 'mouse') return
  setFx(fxTarget(event), 0)
}

function onFxOut(event) {
  if (event.pointerType === 'mouse') clearFx()
}

function onFxDown(event) {
  if (event.pointerType === 'mouse') return
  const el = fxTarget(event)
  if (el) setFx(el, FX_HOLD_MS)
}

// 满格后由页面外壳接住底部青线，等入场结束再淡出，不随首页卸载突然消失。
const journalEntryHandoff = ref(false)
function finishPageEntry(el) {
  releaseView(el)
  journalEntryHandoff.value = false
}
const leavingRects = new WeakMap()
const leavingViews = new Set()
watch(() => route.path, () => {
  menuOpen.value = false
  if (route.path !== '/blog') journalEntryHandoff.value = false
  // pre watcher 在布局更新前取尺寸；before-leave 时首页容器已变成内容区。
  const el = mainView.value?.firstElementChild
  if (el) leavingRects.set(el, el.getBoundingClientRect())
})

/* 离场视图固定在原位，滚动复位时不跳 */
function freezeLeavingView(el) {
  const rect = leavingRects.get(el) || el.getBoundingClientRect()
  el.style.position = 'fixed'
  el.style.top = `${Math.round(rect.top)}px`
  el.style.left = `${Math.round(rect.left)}px`
  el.style.width = `${Math.round(rect.width)}px`
  el.style.height = `${Math.round(rect.height)}px`
  /* 盖住页脚，避免塌陷那一帧露边 */
  el.style.zIndex = '2'
  leavingViews.add(el)
  syncMuseRendering()
}

function releaseView(el) {
  leavingRects.delete(el)
  el.style.position = ''
  el.style.top = ''
  el.style.left = ''
  el.style.width = ''
  el.style.height = ''
  el.style.zIndex = ''
  if (leavingViews.delete(el)) syncMuseRendering()
}

/* 详情页是浮层：列表保持挂载，文档高度与滚动位置不变 */
const heldView = shallowRef({ component: null, key: '' })
watch(
  () => [route.path, route.matched.length],
  () => {
    if (isDetail.value) return
    const record = route.matched[route.matched.length - 1]
    const component = record && record.components && record.components.default
    if (component) heldView.value = { component, key: route.path }
  },
  { immediate: true },
)

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
  const paused = forcePause || museSuppressed || isHome.value || leavingViews.size > 0
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

const showBackToTop = ref(false)

function handleGlobalScroll() {
  showBackToTop.value = window.scrollY > 400
  navScrolled.value = window.scrollY > 16
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------------- 网易云音乐播放器（APlayer + MetingJS，脚本走 index.html 的 CDN） ---------------- */
/* 歌单通过 Meting API 拉取。MetingJS 自带默认就是这个地址，这里显式写出来，
   以后要换成自建 Meting 服务只改这一行；属性里用 :api="METING_API" 绑定。 */
const METING_API = 'https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r'
const musicWrapEl = ref(null)
const musicOpen = ref(false)
/* 首次点开才创建 <meting-js>：首屏零额外请求、零二次实例开销，点过一次后保持挂载（切歌不重新拉歌单） */
const musicMounted = ref(false)
const musicPlaying = ref(false)
const musicReady = ref(false)
const musicVolume = ref(0.1)
/* 播放模式：顺序 → 随机 → 单曲循环（APlayer 的 order 管顺序/随机，loop 管列表循环/单曲） */
const MUSIC_MODES = [
  { key: 'list', icon: 'ph-list-numbers', label: '顺序播放' },
  { key: 'random', icon: 'ph-shuffle', label: '随机播放' },
  { key: 'one', icon: 'ph-repeat-once', label: '单曲循环' },
]
const musicMode = ref('list')
const musicModeMeta = computed(() => MUSIC_MODES.find(m => m.key === musicMode.value) || MUSIC_MODES[0])
const musicTracks = ref([])
const musicIndex = ref(0)
const musicProgress = ref(0)   // 0-1000，映射播放进度百分比
const musicListOpen = ref(false)
let musicBindTimer = 0

/* 当前曲目与封面：界面自绘，数据都从 APlayer 实例里读 */
const musicTrack = computed(() => musicTracks.value[musicIndex.value] || { name: '', artist: '' })
const musicCover = computed(() => musicTracks.value[musicIndex.value]?.cover || '')
const volumeIcon = computed(() => {
  if (musicVolume.value <= 0) return 'ph-speaker-slash'
  return musicVolume.value < 0.5 ? 'ph-speaker-low' : 'ph-speaker-high'
})
let musicLastVolume = 0.1

function toggleMusic() {
  musicOpen.value = !musicOpen.value
  if (musicOpen.value) {
    musicMounted.value = true
    nextTick(bindMusicEvents)
  }
}

/* meting-js 是"先拉歌单、再 new APlayer"，实例不是同步就位的，
   所以轮询等 el.aplayer 出现后再挂 play/pause 事件（约 15s 拿不到就放弃，例如 CDN 被墙）。 */
function bindMusicEvents() {
  if (musicBindTimer) return
  let tries = 0
  const probe = () => {
    const el = musicWrapEl.value && musicWrapEl.value.querySelector('meting-js')
    const player = el && el.aplayer
    if (player) {
      musicBindTimer = 0
      musicReady.value = true
      const sync = () => { musicPlaying.value = !player.audio.paused }
      const readList = () => {
        musicTracks.value = (player.list.audios || []).map(a => ({
          name: a.name || '未知曲目',
          artist: a.artist || '',
          cover: a.cover || '',
        }))
        musicIndex.value = player.list.index || 0
      }
      player.on('play', () => { musicPlaying.value = true })
      player.on('pause', sync)
      player.on('ended', sync)
      player.on('volumechange', () => { musicVolume.value = Number(player.audio.volume) })
      /* 注意：APlayer 是先触发 listswitch、再更新 list.index，
         所以必须用事件里的 index，不能读 player.list.index */
      player.on('listswitch', (data) => {
        musicIndex.value = data && typeof data.index === 'number' ? data.index : (player.list.index || 0)
      })
      sync()
      readList()
      musicVolume.value = Number(player.audio.volume)
      musicMode.value = player.options.loop === 'one'
        ? 'one'
        : (player.options.order === 'random' ? 'random' : 'list')
      /* 进度直接听原生媒体事件，比 APlayer 自己的定时器更省事也更准 */
      const syncProgress = () => {
        const duration = player.duration || 0
        musicProgress.value = duration ? Math.round((player.audio.currentTime / duration) * 1000) : 0
      }
      player.audio.addEventListener('timeupdate', syncProgress)
      player.audio.addEventListener('loadedmetadata', syncProgress)
      player.audio.addEventListener('durationchange', syncProgress)
      return
    }
    if (++tries > 75) {
      musicBindTimer = 0
      return
    }
    musicBindTimer = window.setTimeout(probe, 200)
  }
  probe()
}

function musicPlayer() {
  const el = musicWrapEl.value && musicWrapEl.value.querySelector('meting-js')
  return el && el.aplayer
}

/* APlayer 普通模式自带上一首/下一首的 API，但没画按钮（只有 fixed 模式才有），所以这里自己加 */
function musicPrev() {
  const player = musicPlayer()
  if (player) player.skipBack()
}

function musicNext() {
  const player = musicPlayer()
  if (player) player.skipForward()
}

function musicToggle() {
  const player = musicPlayer()
  if (player) player.toggle()
}

function onVolumeInput(event) {
  const value = Number(event.target.value)
  musicVolume.value = value
  if (value > 0) musicLastVolume = value
  const player = musicPlayer()
  if (player) player.volume(value)
}

/* 喇叭图标：点一下静音，再点恢复 */
function musicToggleMute() {
  const player = musicPlayer()
  if (!player) return
  if (musicVolume.value > 0) {
    musicLastVolume = musicVolume.value
    musicVolume.value = 0
    player.volume(0)
  } else {
    const back = musicLastVolume || 0.1
    musicVolume.value = back
    player.volume(back)
  }
}

/* 播放模式：顺序 → 随机 → 单曲循环。APlayer 内部读取的就是 options.order / options.loop */
function musicCycleMode() {
  const player = musicPlayer()
  if (!player) return
  const i = MUSIC_MODES.findIndex(m => m.key === musicMode.value)
  const next = MUSIC_MODES[(i + 1) % MUSIC_MODES.length].key
  musicMode.value = next
  player.options.order = next === 'random' ? 'random' : 'list'
  player.options.loop = next === 'one' ? 'one' : 'all'
}

/* 进度条拖动：APlayer 的 seek 接收的是秒 */
function onSeekInput(event) {
  const value = Number(event.target.value)
  musicProgress.value = value
  const player = musicPlayer()
  if (player && player.duration) player.seek((player.duration * value) / 1000)
}

function playTrack(index) {
  const player = musicPlayer()
  if (!player) return
  player.list.switch(index)
  player.play()
}

/* 点空白处收起播放器（按钮在同一个包裹容器里，点按钮不会触发关闭） */
function onGlobalClickForMusic(event) {
  if (!musicOpen.value) return
  const wrap = musicWrapEl.value
  if (wrap && event.target instanceof Node && wrap.contains(event.target)) return
  musicOpen.value = false
}

onMounted(async () => {
  authStore.ensureAuth()
  categoryStore.loadCategories()
  document.addEventListener('pointerover', onFxOver)
  document.addEventListener('pointerout', onFxOut)
  document.addEventListener('pointerdown', onFxDown)
  document.addEventListener('pointercancel', clearFx)
  /* 首页看不到看板娘（容器被 v-show 藏了），开场就唤醒等于把气泡演给空气看，
     十秒后自动收起，等切到别的页面时早就没了。所以改成「第一次离开首页」才唤醒。 */
  let museBooted = false
  watch(
    isHome,
    (home) => {
      if (home || museBooted) return
      museBooted = true
      muse.awakeMuse()
    },
    { immediate: true },
  )
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
  /* 气泡展开时重新贴一次 */
  watch(
    () => muse.bubbleVisible.value,
    (visible) => {
      if (visible) nextTick(positionMuseBubble)
    },
  )
  /* 沉浸写作时收起模型，避免遮挡写作区 */
  watch(
    () => uiStore.immersiveWriting || isHome.value,
    (hidden) => setMuseSuppressed(hidden),
    { immediate: true },
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
  window.addEventListener('resize', positionMuseBubble)
  window.addEventListener('scroll', handleGlobalScroll, { passive: true })
  document.addEventListener('click', onGlobalClickForMusic)
  handleGlobalScroll()
})

onUnmounted(() => {
  syncMuseRendering(true)
  document.removeEventListener('pointerover', onFxOver)
  document.removeEventListener('pointerout', onFxOut)
  document.removeEventListener('pointerdown', onFxDown)
  document.removeEventListener('pointercancel', clearFx)
  clearFx()
  document.removeEventListener('click', toggleMuseBubbleOnModelClick)
  window.removeEventListener('pointermove', onMuseAvatarPointerMove)
  window.removeEventListener('pointerup', onMuseAvatarPointerUp)
  window.removeEventListener('pointercancel', onMuseAvatarPointerUp)
  if (museHoldTimer) clearTimeout(museHoldTimer)
  document.body.style.cursor = ''
  window.removeEventListener('resize', positionMuseBubble)
  window.removeEventListener('scroll', handleGlobalScroll)
  document.removeEventListener('click', onGlobalClickForMusic)
  if (musicBindTimer) clearTimeout(musicBindTimer)
  if (museHealthTimer) clearInterval(museHealthTimer)
})

function handleAvatarError(event) {
  event.target.src = authStore.fallbackAvatar
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

async function copyFooterInfo(text, okMsg = '已复制') {
  try {
    await copyText(text)
    uiStore.showToast(okMsg)
  } catch {
    uiStore.showToast('复制失败，请手动选择复制', false)
  }
}
</script>

<template>
  <Transition name="journal-handoff">
    <div v-if="journalEntryHandoff" class="journal-entry-handoff" aria-hidden="true"></div>
  </Transition>
  <TransitionGroup id="toastContainer" tag="div"
      enter-from-class="toast-enter" enter-active-class="toast-enter-active" leave-active-class="toast-exit-active" move-class="toast-move"
      class="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none">
      <div v-for="toast in uiStore.toasts" :key="toast.id" class="art-toast"
          :class="toast.isSuccess ? 'art-toast-ok' : 'art-toast-err'">
          <i class="ph-fill art-toast-icon" :class="toast.isSuccess ? 'ph-check-circle' : 'ph-warning-circle'"></i>
          <span class="text-sm font-medium tracking-wide">{{ toast.msg }}</span>
      </div>
  </TransitionGroup>

  <div v-show="!isHome" class="art-glow" aria-hidden="true"></div>

  <!-- 背景漂浮的青色光团：缓慢漂移，营造一点意识流的感觉 -->
  <div v-show="!isHome" class="art-ambient" aria-hidden="true">
      <span class="art-blob art-blob-a"></span>
      <span class="art-blob art-blob-b"></span>
      <span class="art-blob art-blob-c"></span>
  </div>

  <div class="art-shell cyan-shell" :class="{ 'art-shell--detail': isDetail, 'cyan-shell--home': isHome }">
    <header class="cyan-navbar" :class="{ 'is-frosted': navbarFrosted, 'is-home': isHome }"
        @keydown.esc="menuOpen = false">
      <div class="cyan-navbar-inner">
        <RouterLink to="/" class="cyan-brand" aria-label="Cyan · 主页" @click="scrollToTop">Cyan<span>.</span></RouterLink>
        <nav id="primary-navigation" class="cyan-nav-links" :class="{ 'is-open': menuOpen }" aria-label="主导航"
            @click="menuOpen = false">
          <RouterLink to="/" exact-active-class="is-active">主页</RouterLink>
          <RouterLink to="/blog" :class="{ 'is-active': isDetail }" exact-active-class="is-active">随笔</RouterLink>
          <RouterLink to="/board" exact-active-class="is-active">留言板</RouterLink>
          <RouterLink to="/playground" exact-active-class="is-active">杂物柜</RouterLink>
          <RouterLink v-if="authStore.isGlobalAdmin" to="/admin" exact-active-class="is-active">控制台</RouterLink>
        </nav>
        <div class="cyan-nav-actions">
          <!-- 音乐入口：点开在按钮下方弹出播放器（点空白处自动收起） -->
          <div ref="musicWrapEl" class="cyan-music">
            <button type="button" class="cyan-nav-icon cyan-music-toggle" :class="{ 'is-playing': musicPlaying }"
                :aria-expanded="musicOpen" aria-haspopup="dialog" aria-controls="cyMusicPanel"
                :aria-label="musicOpen ? '收起音乐播放器' : '打开音乐播放器'"
                :title="musicOpen ? '收起播放器' : '播放音乐'" @click="toggleMusic">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.2 17.4V6.3l9.3-1.8v11" />
                <circle cx="6.7" cy="17.7" r="2.5" />
                <circle cx="16" cy="15.8" r="2.5" />
              </svg>
            </button>
            <Transition name="music-pop">
              <div v-show="musicOpen" id="cyMusicPanel" class="cyan-music-pop" role="dialog"
                  aria-label="网易云音乐播放器">
                <!-- APlayer 只当引擎：默认 UI 全部藏起来，界面下面自绘（音频照常播放） -->
                <meting-js v-if="musicMounted" server="netease" type="playlist" id="6642044848"
                    :api="METING_API" autoplay="false" order="list" list-folded="true"
                    volume="0.1" storage-name="cyMusic-v3" theme="#00ffff"></meting-js>
                <!-- ① 圆形小封面 · 歌名/作者 · 音量 -->
                <div class="cy-m-top">
                  <span class="cy-m-cover" :style="{ backgroundImage: musicCover ? `url(${musicCover})` : '' }"
                      aria-hidden="true"></span>
                  <span class="cy-m-meta">
                    <b class="cy-m-title" :title="musicTrack.name">{{ musicTrack.name }}</b>
                    <i class="cy-m-author" :title="musicTrack.artist">{{ musicTrack.artist }}</i>
                  </span>
                  <button type="button" class="cy-m-volicon" :aria-label="musicVolume > 0 ? '静音' : '恢复音量'"
                      :title="musicVolume > 0 ? '静音' : '恢复音量'" @click="musicToggleMute">
                    <i class="ph-bold" :class="volumeIcon"></i>
                  </button>
                  <input class="cy-m-vol" type="range" min="0" max="1" step="0.01" aria-label="音量"
                      :value="musicVolume" :style="{ '--vol': Math.round(musicVolume * 100) + '%' }"
                      @input="onVolumeInput">
                </div>
                <!-- ② 进度条整行（可拖动） -->
                <input class="cy-m-bar" type="range" min="0" max="1000" step="1" aria-label="播放进度"
                    :value="musicProgress" :style="{ '--played': (musicProgress / 10) + '%' }"
                    @input="onSeekInput" @change="onSeekInput">
                <!-- ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单 -->
                <div class="cy-m-ctrl">
                  <button type="button" class="cy-m-btn cy-m-mode" :disabled="!musicReady"
                      :aria-label="musicModeMeta.label + '，点击切换播放模式'"
                      :title="musicModeMeta.label" @click="musicCycleMode">
                    <i class="ph-bold" :class="musicModeMeta.icon"></i>
                  </button>
                  <button type="button" class="cy-m-btn" :disabled="!musicReady" aria-label="上一首" title="上一首"
                      @click="musicPrev"><i class="ph-fill ph-skip-back"></i></button>
                  <button type="button" class="cy-m-btn cy-m-play" :disabled="!musicReady"
                      :aria-label="musicPlaying ? '暂停' : '播放'" :title="musicPlaying ? '暂停' : '播放'"
                      @click="musicToggle"><i class="ph-fill" :class="musicPlaying ? 'ph-pause' : 'ph-play'"></i></button>
                  <button type="button" class="cy-m-btn" :disabled="!musicReady" aria-label="下一首" title="下一首"
                      @click="musicNext"><i class="ph-fill ph-skip-forward"></i></button>
                  <button type="button" class="cy-m-btn cy-m-menu" :aria-expanded="musicListOpen"
                      :aria-label="musicListOpen ? '收起歌单' : '展开歌单'" :title="musicListOpen ? '收起歌单' : '展开歌单'"
                      @click="musicListOpen = !musicListOpen"><i class="ph-bold ph-playlist"></i></button>
                </div>
                <!-- ④ 歌单：最多同时 5 首，其余滚动；展开/收起走高度动画 -->
                <Transition name="cy-m-list">
                  <div v-show="musicListOpen" class="cy-m-list-reveal">
                    <ul class="cy-m-list">
                      <li v-for="(track, index) in musicTracks" :key="index"
                          :class="{ 'is-current': index === musicIndex }" @click="playTrack(index)">
                        <span class="cy-m-idx">{{ String(index + 1).padStart(2, '0') }}</span>
                        <span class="cy-m-name">{{ track.name }}</span>
                        <span class="cy-m-by">{{ track.artist }}</span>
                      </li>
                    </ul>
                  </div>
                </Transition>
              </div>
            </Transition>
          </div>
          <button type="button" class="cyan-nav-icon" :aria-label="uiStore.isLightMode ? '切换深色主题' : '切换浅色主题'"
              :title="uiStore.isLightMode ? '切换深色主题' : '切换浅色主题'" @click="uiStore.toggleLightMode($event.currentTarget)">
            <svg v-if="uiStore.isLightMode" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
          </button>
          <button type="button" class="cyan-account" aria-label="账户设置" @click="uiStore.openDialog('setting')">
            <img :src="authStore.avatar" @error="handleAvatarError" alt="" width="30" height="30">
          </button>
          <button type="button" class="cyan-nav-icon cyan-menu-toggle" :aria-expanded="menuOpen" aria-controls="primary-navigation"
              :aria-label="menuOpen ? '关闭导航' : '展开导航'" @click="menuOpen = !menuOpen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'" /></svg>
            <span class="cyan-menu-label">{{ menuOpen ? '关闭' : '菜单' }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- 手机端菜单蒙层：点空白处也能收起，不必再去找那个按钮 -->
    <Transition name="nav-scrim">
      <div v-if="menuOpen" class="cyan-nav-scrim" aria-hidden="true" @click="menuOpen = false"></div>
    </Transition>

    <main ref="mainView" class="art-main">
        <router-view v-slot="{ Component, route }">
            <!-- 详情打开时列表原地保留，滚动位置不动 -->
            <Transition name="page-fade"
                @before-enter="releaseView" @before-leave="freezeLeavingView" @after-leave="releaseView"
                @after-enter="finishPageEntry" @enter-cancelled="finishPageEntry" @leave-cancelled="releaseView">
                <!-- 列表页缓存，返回时高度立刻可用 -->
                <KeepAlive :include="['BlogView']">
                    <component :is="isDetail ? heldView.component : Component" :key="isDetail ? heldView.key : route.path"
                        @journal-entry="journalEntryHandoff = true" @journal-entry-cancel="journalEntryHandoff = false" />
                </KeepAlive>
            </Transition>
        </router-view>

        <!-- 详情浮层 -->
        <Transition name="fade-slide">
            <DetailView v-if="isDetail" />
        </Transition>
    </main>

    <footer v-if="!isHome" class="art-footer">
        <div class="art-footer-inner">
            <div class="art-footer-links">
                <!-- ICP备案号 -->
                <a href="https://beian.miit.gov.cn/" target="_blank">
                    <i class="ph-fill ph-shield-check"></i> 蜀ICP备2026046684号
                </a>

                <span class="art-footer-sep">|</span>

                <!-- 公安联网备案号 -->
                <a href="https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=51072302110085"
                    target="_blank">
                    <img src="https://www.beian.gov.cn/file/ghs.png" class="art-footer-icon" alt="备案图标"> 川公网安备
                    51072302110085号
                </a>
            </div>

            <!-- 联系入口 -->
            <div class="art-footer-aside">
                <div class="art-footer-links">
                    <button type="button" @click="copyFooterInfo('2982420177@qq.com', '邮箱已复制')"
                        title="点击复制邮箱 2982420177@qq.com">
                        <i class="ph ph-envelope-simple"></i> Email
                    </button>

                    <button type="button" @click="copyFooterInfo('q2982420177', '微信号已复制')"
                        title="点击复制微信号 q2982420177">
                        <i class="ph ph-wechat-logo"></i> WeChat
                    </button>

                    <a href="https://github.com/CLASHMI" target="_blank" rel="noopener">
                        <i class="ph ph-github-logo"></i> GitHub
                    </a>

                    <a href="https://gitee.com/huang-zhijie377" target="_blank" rel="noopener">
                        <i class="ph ph-git-branch"></i> Gitee
                    </a>

                    <a href="https://blog.csdn.net/2301_80038984" target="_blank" rel="noopener">
                        <i class="ph ph-article"></i> CSDN
                    </a>

                    <a href="https://b23.tv/0RGElcJ" target="_blank" rel="noopener">
                        <i class="ph ph-television-simple"></i> Bilibili
                    </a>
                </div>

                <p class="art-footer-copy">Cyan's Blog © 2026</p>
            </div>
        </div>
    </footer>
  </div><!-- /art-shell -->

  <SettingDialog />
  <ConfirmDialog />

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

  <!-- 全局回到顶部：下滑超过 400px 才浮出 -->
  <Transition name="fade">
      <!-- 详情页是浮层，全局回顶按钮会被压在下面点不到，这里只在非详情页显示 -->
      <button v-if="showBackToTop && !isDetail && !isHome" type="button" @click="scrollToTop()" title="回到顶部"
          aria-label="回到顶部"
          class="art-icon-btn art-icon-btn-lg art-back-to-top fixed right-4 z-[90]">
          <i class="ph-bold ph-arrow-up"></i>
      </button>
  </Transition>
</template>

<style scoped>
/* 进出场重叠淡化；不对根视图做 transform，避免改变内部 fixed / sticky 的定位。 */
.page-fade-enter-active {
  transition: opacity .46s cubic-bezier(.22, 1, .36, 1) .06s;
  will-change: opacity;
}
.page-fade-leave-active {
  transition: opacity .32s cubic-bezier(.4, 0, .6, 1);
  will-change: opacity;
  pointer-events: none;
}
.page-fade-enter-from, .page-fade-leave-to { opacity: 0; }
.journal-entry-handoff {
  position: fixed; inset: auto 0 0; height: 7px; z-index: 100; pointer-events: none;
  background: #00FFFF;
  box-shadow: 0 0 20px rgba(0, 255, 255, .9), 0 -3px 14px rgba(0, 255, 255, .35);
}
.journal-handoff-leave-active { transition: opacity .28s ease-out; }
.journal-handoff-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active, .page-fade-leave-active, .journal-handoff-leave-active { transition: none; }
  .journal-entry-handoff { box-shadow: none; }
}

/* 独立顶栏不复用旧侧栏主题，避免首页透明态被全局浅色规则覆盖。 */
.cyan-navbar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 110;
  color: var(--art-ink-2);
  border-bottom: 1px solid transparent;
  background: transparent;
  /* 回到首页时顶栏要在"毛玻璃"和"透明"之间切换：
     color 与 backdrop-filter 也得一起过渡，否则那一帧会硬闪一下 */
  transition: background-color .45s ease, border-color .45s ease, box-shadow .45s ease, color .45s ease,
    -webkit-backdrop-filter .45s ease, backdrop-filter .45s ease;
}
.cyan-navbar.is-home { color: #b8e1e5; }
:global(body.theme-light .cyan-navbar.is-home) { color: #25565c; }
.cyan-navbar.is-frosted {
  /* 吸顶栏每帧都要对下方像素重做一次高斯模糊，是全站最贵的滚动开销之一。
     把背景调实一点（.78 → .9）、模糊半径减半（22px → 12px）并去掉 saturate 的额外色彩通道，
     观感几乎不变，但每帧的模糊开销明显下降 */
  background: rgba(7, 18, 21, .9);
  border-color: rgba(169, 222, 222, .1);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 30px rgba(0, 25, 30, .035);
}
:global(body.theme-light .cyan-navbar.is-frosted) {
  background: rgba(241, 250, 248, .9);
  border-color: rgba(47, 102, 105, .1);
}
.cyan-navbar-inner {
  height: 74px;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 clamp(22px, 4.5vw, 76px);
  display: flex;
  align-items: center;
  gap: clamp(24px, 4vw, 60px);
}
.cyan-brand {
  margin-right: auto;
  position: relative;
  transition: transform .4s ease, text-shadow .4s ease;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 32px;
  line-height: 1;
  letter-spacing: -.055em;
}
.cyan-brand span { display: inline-block; color: #00ffff; transition: transform .4s ease, text-shadow .4s ease; }
.cyan-brand::after { content: ''; position: absolute; left: 0; right: 0; bottom: -8px; height: 2px; background: linear-gradient(90deg, transparent, #00ffff, transparent); transform: scaleX(0); transition: transform .4s ease; }
.cyan-brand[data-fx], .cyan-brand:focus-visible { transform: translateY(-2px) rotate(-3deg); text-shadow: 0 4px 18px rgba(0, 235, 245, .45); }
.cyan-brand[data-fx] span, .cyan-brand:focus-visible span { transform: translateY(-5px) scale(1.3); text-shadow: 0 0 12px #00ffff; }
.cyan-brand[data-fx]::after, .cyan-brand:focus-visible::after { transform: scaleX(1); }
.cyan-nav-links { display: flex; align-items: center; gap: clamp(22px, 2.7vw, 40px); }
.cyan-nav-links a {
  position: relative;
  padding: 12px 0;
  font-size: 12px;
  letter-spacing: .12em;
  white-space: nowrap;
  opacity: .7;
  transition: opacity .25s ease, transform .3s ease, text-shadow .3s ease;
}
.cyan-nav-links a::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 50%;
  width: 22px;
  height: 2px;
  background: #00dce7;
  box-shadow: 0 0 10px rgba(0, 255, 255, .35);
  transform: translateX(-50%) scaleX(0);
  transition: transform .3s ease;
}
.cyan-nav-links a.is-active { opacity: 1; }
.cyan-nav-links a.is-active::after, .cyan-nav-links a[data-fx]::after, .cyan-nav-links a:focus-visible::after { transform: translateX(-50%) scaleX(1); }
.cyan-nav-links a[data-fx], .cyan-nav-links a:focus-visible { opacity: 1; transform: translateY(-3px); text-shadow: 0 0 16px rgba(0, 220, 230, .5); }
.cyan-nav-icon, .cyan-account { border-radius: 50%; transition: transform .3s ease, background .3s ease, box-shadow .3s ease; }
.cyan-nav-icon[data-fx], .cyan-account[data-fx], .cyan-nav-icon:focus-visible, .cyan-account:focus-visible { transform: translateY(-2px); background: rgba(0, 225, 235, .1); box-shadow: 0 0 18px rgba(0, 225, 235, .12); }
.cyan-nav-icon svg { transition: transform .4s ease; }
.cyan-nav-icon[data-fx] svg { transform: rotate(-15deg); }
.cyan-nav-actions { display: flex; align-items: center; gap: 16px; }
.cyan-nav-icon { display: grid; place-items: center; width: 36px; height: 40px; cursor: pointer; }
.cyan-nav-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.cyan-account { cursor: pointer; padding: 5px; }
.cyan-account img { width: 30px; height: 30px; object-fit: cover; border-radius: 50%; border: 1px solid rgba(100, 155, 155, .2); }

/* ---------------- 音乐播放器（APlayer + MetingJS） ---------------- */
.cyan-music { --cy-accent: #00ffff; display: flex; align-items: center; }
:global(body.theme-light .cyan-music) { --cy-accent: #00cfd8; }
/* 播放中：只做轻微的呼吸脉冲 + 一点点青色辉光，不做旋转（转起来很怪） */
.cyan-music-toggle.is-playing { color: var(--cy-accent); }
.cyan-music-toggle.is-playing svg {
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--cy-accent) 70%, transparent));
  animation: cyMusicPulse 1.9s ease-in-out infinite;
}
@keyframes cyMusicPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .62; transform: scale(.92); }
}

/* 弹窗 = 四行自绘界面（高度比 APlayer 默认布局矮一截）：
     ① 小圆封面 · 歌名/作者 · 音量
     ② 进度条（整行，可拖）
     ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单
     ④ 歌单（点菜单展开，最多同时 5 首）
   APlayer 实例只负责取歌单与播放，默认 UI 整个隐藏。 */
.cyan-music-pop {
  /* 进度条与播放键的青色（接近 #00FFFF）；浅色主题下白底会糊，压深一档 */
  position: fixed;
  top: 76px;
  right: 74px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(320px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid var(--art-line);
  border-radius: 16px;
  /* 封面顶在左上角，靠这里把它的左上直角裁成和面板一致的圆角 */
  overflow: hidden;
  background: color-mix(in srgb, var(--art-bg) 88%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 22px 60px -26px rgba(0, 0, 0, .6), 0 2px 10px -6px rgba(0, 0, 0, .35);
}
:global(body.theme-light .cyan-music-pop) {
  background: rgba(255, 255, 255, .92);
  box-shadow: 0 20px 50px -28px rgba(15, 40, 45, .35), 0 2px 8px -6px rgba(15, 40, 45, .18);
}
/* APlayer 只当引擎：整棵默认 UI 不渲染（音频照常播放） */
.cyan-music-pop :deep(.aplayer) { display: none }

/* —— ① 小圆封面 · 歌名/作者 · 音量 —— */
.cy-m-top { display: flex; align-items: center; gap: 10px; }
.cy-m-cover {
  flex: 0 0 50px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--cy-accent) 26%, transparent);
  background-size: cover;
  background-position: center;
}
/* 歌名一行、作者一行：长标题不容易被截断；两行合起来仍矮于 50px 的封面，窗口高度不变 */
.cy-m-meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.cy-m-title {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}
.cy-m-author {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink-4);
  font-size: 11px;
  font-style: normal;
  line-height: 1.3;
}
.cy-m-vol,
.cy-m-bar {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.cy-m-volicon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--cy-accent);
  opacity: .78;
  font-size: 14px;
  cursor: pointer;
  transition: color .25s ease, opacity .25s ease;
}
@media (hover: hover) and (pointer: fine) { .cy-m-volicon:hover { opacity: 1 } }
.cy-m-vol { flex: 0 0 56px; width: 56px; height: 15px; }
.cy-m-vol::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--cy-accent) 0 var(--vol), color-mix(in srgb, var(--art-ink-4) 40%, transparent) var(--vol) 100%);
}
.cy-m-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 9px;
  height: 9px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--cy-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cy-accent) 65%, transparent);
}
.cy-m-vol::-moz-range-track { height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--art-ink-4) 40%, transparent) }
.cy-m-vol::-moz-range-progress { height: 3px; border-radius: 2px; background: var(--cy-accent) }
.cy-m-vol::-moz-range-thumb { width: 9px; height: 9px; border: 0; border-radius: 50%; background: var(--cy-accent) }

/* —— ② 进度条整行 —— */
.cy-m-bar { width: 100%; height: 15px; }
.cy-m-bar::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--cy-accent) 0 var(--played), color-mix(in srgb, var(--art-ink-4) 35%, transparent) var(--played) 100%);
}
.cy-m-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: var(--cy-accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--cy-accent) 65%, transparent);
}
.cy-m-bar::-moz-range-track { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--art-ink-4) 35%, transparent) }
.cy-m-bar::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--cy-accent) }
.cy-m-bar::-moz-range-thumb { width: 11px; height: 11px; border: 0; border-radius: 50%; background: var(--cy-accent) }

/* —— ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单 —— */
.cy-m-ctrl { display: flex; align-items: center; }
.cy-m-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--art-ink-2);
  font-size: 16px;
  cursor: pointer;
  transition: color .25s ease, background .25s ease, opacity .25s ease;
}
.cy-m-btn:disabled { opacity: .3; cursor: default; }
/* 顺序贴左、菜单贴右，自动外边距把中间三个键压在正中 */
.cy-m-mode { margin-right: auto; }
.cy-m-menu { margin-left: auto; }
.cy-m-play { width: 36px; height: 36px; margin: 0 2px; color: var(--cy-accent); font-size: 20px; }
@media (hover: hover) and (pointer: fine) {
  .cy-m-btn:not(:disabled):hover { color: var(--cy-accent); background: color-mix(in srgb, var(--cy-accent) 14%, transparent) }
}

/* —— ④ 歌单：最多同时 5 首（每行 32px），其余滚动 —— */
/* 高度动画由外层裁剪；列表本身必须保留 overflow-y:auto，否则会被这里的 hidden 覆盖、滚不动 */
.cy-m-list-reveal { display: grid; grid-template-rows: 1fr; overflow: hidden; }
.cy-m-list-reveal .cy-m-list { min-height: 0; }
/* 展开 / 收起走高度动画（0fr → 1fr），和站内其它折叠区同一套做法 */
.cy-m-list-enter-active,
.cy-m-list-leave-active { transition: grid-template-rows .34s cubic-bezier(.22, 1, .36, 1), opacity .26s ease; }
.cy-m-list-enter-from,
.cy-m-list-leave-to { grid-template-rows: 0fr; opacity: 0; }
.cy-m-list {
  list-style: none;
  margin: 0;
  padding: 6px 0 0;
  max-height: 166px;
  overflow-y: auto;
  border-top: 1px solid var(--art-line);
}
.cy-m-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--art-ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: background .2s ease, color .2s ease;
}
.cy-m-list li:hover { background: color-mix(in srgb, var(--art-accent) 8%, transparent) }
.cy-m-list li.is-current { background: color-mix(in srgb, var(--cy-accent) 18%, transparent); color: var(--art-ink) }
.cy-m-list li.is-current .cy-m-idx { color: var(--cy-accent) }
.cy-m-idx { flex: 0 0 18px; color: var(--art-ink-4); font-family: var(--art-mono); font-size: 10px }
.cy-m-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cy-m-by {
  flex: 0 1 auto;
  max-width: 40%;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink-4);
  font-size: 11px;
}
.cy-m-list::-webkit-scrollbar { width: 5px }
.cy-m-list::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--art-line-2) }

/* 弹窗进出只做淡入淡出：这块带 backdrop-filter，动 transform 会让模糊每帧重算，反而卡 */
.music-pop-enter-active { transition: opacity .3s ease; }
.music-pop-leave-active { transition: opacity .2s ease; }
.music-pop-enter-from, .music-pop-leave-to { opacity: 0; }

/* 手机端：改成贴着导航栏下方的整宽面板 */
@media (max-width: 640px) {
  .cyan-music-pop { top: 82px; left: 12px; right: 12px; width: auto; max-height: calc(100vh - 96px); overflow-y: auto }
}
@media (prefers-reduced-motion: reduce) {
  .cyan-music-toggle.is-playing svg { animation: none }
  .music-pop-enter-active, .music-pop-leave-active { transition: none }
}

.cyan-menu-toggle { display: none; }
.cyan-menu-label { display: none; }
.cyan-navbar a:focus-visible, .cyan-navbar button:focus-visible { outline: 2px solid #4a999f; outline-offset: 5px; border-radius: 3px; }
.cyan-shell { padding-top: 74px; }
.cyan-shell--home { padding: 0; height: 100vh; height: 100dvh; min-height: 0; overflow-x: hidden; overflow-y: auto; }
.cyan-shell--home > .art-main { max-width: none; min-height: 0; height: 100%; padding: 0; flex: none; }
/* 只锁首页：随笔、留言与控制台仍由文档正常滚动。 */
:global(html:has(.cyan-shell--home)), :global(body:has(.cyan-shell--home)) { overflow: hidden; }
:global(body:has(.cyan-shell--home) #oml2d-stage) { visibility: hidden !important; pointer-events: none !important; }

/* 手机端菜单蒙层：只有 ≤640px 且菜单打开时才铺开，点它任意位置即收起 */
.cyan-nav-scrim { display: none; }
.nav-scrim-enter-active, .nav-scrim-leave-active { transition: opacity .24s ease; }
.nav-scrim-enter-from, .nav-scrim-leave-to { opacity: 0; }

@media (max-width: 640px) {
  .cyan-nav-scrim {
    display: block;
    position: fixed;
    inset: 74px 0 0;
    z-index: 105;
    background: rgba(3, 12, 16, .45);
  }
  :global(body.theme-light .cyan-nav-scrim) { background: rgba(20, 50, 56, .18); }
  .cyan-navbar-inner { gap: 16px; }
  .cyan-brand { font-size: 29px; }
  .cyan-nav-actions { gap: 8px; }
  /* 手机端把入口做成带文字的胶囊：纯汉堡图标很容易被当成装饰忽略掉 */
  .cyan-menu-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: auto;
    height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(0, 225, 235, .28);
    border-radius: 999px;
    background: rgba(0, 225, 235, .06);
    color: var(--art-ink-2);
    font-size: 12px;
    letter-spacing: .04em;
  }
  .cyan-menu-toggle svg { width: 15px; height: 15px; stroke-width: 1.7; }
  .cyan-menu-label { display: inline; white-space: nowrap; }
  .cyan-menu-toggle[data-fx], .cyan-menu-toggle:focus-visible, .cyan-menu-toggle[aria-expanded="true"] {
    border-color: rgba(0, 225, 235, .6);
    background: rgba(0, 225, 235, .14);
    color: var(--art-ink);
  }
  :global(body.theme-light .cyan-menu-toggle) {
    border-color: rgba(15, 110, 120, .26);
    background: rgba(15, 110, 120, .055);
    color: #25565c;
  }
  .cyan-nav-links {
    position: absolute;
    top: 73px;
    left: 0;
    right: 0;
    padding: 12px 22px 20px;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px 26px;
    background: #0e2023;
    border-bottom: 1px solid rgba(100, 155, 155, .15);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    /* 收起：整块上移淡出；展开时再滑下来 */
    transform: translateY(-12px);
    /* visibility 用 0s + 延迟：动画期间保持可见，结束后再隐藏，
       避开「离散属性插值 + 常驻合成层被拆除」在收起瞬间闪一下 */
    transition: opacity .22s ease, transform .26s cubic-bezier(.4, 0, .6, 1), visibility 0s linear .26s;
  }
  :global(body.theme-light .cyan-navbar .cyan-nav-links) { background: #eff8f6; }
  .cyan-nav-links.is-open {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    transition: opacity .3s ease, transform .38s cubic-bezier(.22, 1, .36, 1), visibility 0s;
  }
  .cyan-nav-links a { font-size: 13px; }
  /* 菜单项依次落下，比整块一起出现更有层次；动画只定义 from，终态仍交给原有样式 */
  .cyan-nav-links.is-open a { animation: nav-item-drop .38s cubic-bezier(.22, 1, .36, 1) backwards; }
  .cyan-nav-links.is-open a:nth-child(1) { animation-delay: .04s; }
  .cyan-nav-links.is-open a:nth-child(2) { animation-delay: .085s; }
  .cyan-nav-links.is-open a:nth-child(3) { animation-delay: .13s; }
  .cyan-nav-links.is-open a:nth-child(4) { animation-delay: .175s; }
  .cyan-nav-links.is-open a:nth-child(5) { animation-delay: .22s; }
  /* 汉堡按钮开合时转一下，和面板动效呼应 */
  .cyan-menu-toggle svg { transition: transform .32s cubic-bezier(.22, 1, .36, 1); }
  .cyan-menu-toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
}
@keyframes nav-item-drop {
  from { opacity: 0; transform: translateY(-8px); }
}
@media (prefers-reduced-motion: reduce) {
  .cyan-navbar, .cyan-navbar *, .cyan-navbar *::after,
  .nav-scrim-enter-active, .nav-scrim-leave-active { transition: none !important; animation: none !important; }
  .cyan-navbar a:hover, .cyan-navbar a:focus-visible, .cyan-navbar button:hover, .cyan-navbar button:focus-visible, .cyan-brand:hover span, .cyan-brand:focus-visible span, .cyan-nav-icon:hover svg { transform: none; }
}
</style>
