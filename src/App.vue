<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { copyText } from './utils/clipboard'

import AppNavbar from './components/AppNavbar.vue'
import CursorParticles from './components/CursorParticles.vue'
import MuseStage from './components/MuseStage.vue'
import SettingDialog from './components/SettingDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

/* 详情浮层是重依赖（md-editor 等）：异步加载，不拖累首页首屏 */
const DetailView = defineAsyncComponent(() => import('./views/DetailView.vue'))

import { useAuthStore } from './stores/useAuthStore'
import { useCategoryStore } from './stores/useCategoryStore'
import { useUiStore } from './stores/useUiStore'

const authStore = useAuthStore()
const uiStore = useUiStore()
const categoryStore = useCategoryStore()

const route = useRoute()
const isDetail = computed(() => route.path.startsWith('/post/'))
const isHome = computed(() => route.path === '/')

const mainView = ref(null)
const navRetreat = ref(0)
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
const leavingSnapshots = new WeakMap()
const leavingViews = new Set()

/* 离场视图在场时暂停看板娘渲染：状态通过 prop 交给 MuseStage */
const routePaused = ref(false)

function syncRoutePaused() {
  routePaused.value = leavingViews.size > 0
}
watch(() => route.path, (path, previousPath) => {
  if (route.path !== '/blog') journalEntryHandoff.value = false
  // pre watcher 在布局更新前取尺寸；before-leave 时首页容器已变成内容区。
  const el = mainView.value?.firstElementChild
  if (el) leavingSnapshots.set(el, {
    rect: el.getBoundingClientRect(),
    coveredByDetail: previousPath?.startsWith('/post/') === true,
  })
})

/* 离场视图固定在原位，滚动复位时不跳 */
function freezeLeavingView(el) {
  const snapshot = leavingSnapshots.get(el)
  const rect = snapshot?.rect || el.getBoundingClientRect()
  // The retained page was covered by the detail overlay; do not reveal it on exit.
  if (snapshot?.coveredByDetail) el.style.visibility = 'hidden'
  el.style.position = 'fixed'
  el.style.top = `${Math.round(rect.top)}px`
  el.style.left = `${Math.round(rect.left)}px`
  el.style.width = `${Math.round(rect.width)}px`
  el.style.height = `${Math.round(rect.height)}px`
  /* 盖住页脚，避免塌陷那一帧露边 */
  el.style.zIndex = '2'
  leavingViews.add(el)
  syncRoutePaused()
}

function releaseView(el) {
  leavingSnapshots.delete(el)
  el.style.visibility = ''
  el.style.position = ''
  el.style.top = ''
  el.style.left = ''
  el.style.width = ''
  el.style.height = ''
  el.style.zIndex = ''
  if (leavingViews.delete(el)) syncRoutePaused()
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

const showBackToTop = ref(false)

function handleGlobalScroll() {
  showBackToTop.value = window.scrollY > 400
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  authStore.ensureAuth()
  categoryStore.loadCategories()
  document.addEventListener('pointerover', onFxOver)
  document.addEventListener('pointerout', onFxOut)
  document.addEventListener('pointerdown', onFxDown)
  document.addEventListener('pointercancel', clearFx)
  window.addEventListener('scroll', handleGlobalScroll, { passive: true })
  handleGlobalScroll()
})

onUnmounted(() => {
  document.removeEventListener('pointerover', onFxOver)
  document.removeEventListener('pointerout', onFxOut)
  document.removeEventListener('pointerdown', onFxDown)
  document.removeEventListener('pointercancel', clearFx)
  clearFx()
  window.removeEventListener('scroll', handleGlobalScroll)
})

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

  <div class="art-shell cyan-shell" :style="{ '--nav-retreat': navRetreat }" :class="{ 'art-shell--detail': isDetail, 'cyan-shell--home': isHome }">
    <div v-if="isDetail" class="reading-backdrop" aria-hidden="true"></div>
    <AppNavbar @retreat-change="navRetreat = $event" />

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

  <MuseStage :route-paused="routePaused" />
  <CursorParticles />

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
/* 全屏背景与阅读浮层共用同一幅静态薄雾，导航保持透明，无独立色板。 */
.art-glow, .cyan-shell {
  --reading-atmosphere:
    radial-gradient(ellipse at 16% 0%, color-mix(in srgb, var(--art-accent) 5%, transparent), transparent 48%),
    radial-gradient(ellipse at 94% 35%, rgba(116, 135, 165, .065), transparent 55%);
}
/* 详情保留底层列表；背景必须覆盖整个视口，包括透明导航下的 74px。 */
.reading-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
  pointer-events: none;
  background: var(--reading-atmosphere), var(--art-bg);
}
.art-glow.art-glow {
  background: var(--reading-atmosphere), var(--art-bg);
}
@media (min-width:1024px) {
  .cyan-shell:not(.cyan-shell--home) > .art-main { padding-top: 12px; }
}

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

.cyan-shell { padding-top: 74px; }
.cyan-shell--home { padding: 0; height: 100vh; height: 100dvh; min-height: 0; overflow-x: hidden; overflow-y: auto; }
.cyan-shell--home > .art-main { max-width: none; min-height: 0; height: 100%; padding: 0; flex: none; }
/* 只锁首页：随笔、留言与控制台仍由文档正常滚动。 */
:global(html:has(.cyan-shell--home)), :global(body:has(.cyan-shell--home)) { overflow: hidden; }
:global(body:has(.cyan-shell--home) #oml2d-stage) { visibility: hidden !important; pointer-events: none !important; }

/* ---- Toast：容器与气泡都在本组件模板里，样式随组件走 ---- */
/* Toast */.art-toast {    display: flex;    align-items: center;    gap: 12px;    padding: 12px 20px;    border-radius: 100px;    font-size: 13px;    letter-spacing: .04em;    color: #fafafa;    background: rgba(6, 18, 22, .95);    border: 1px solid var(--art-line-2);    box-shadow: 0 24px 60px rgba(0, 0, 0, .6);    -webkit-backdrop-filter: blur(18px);    backdrop-filter: blur(18px)}.art-toast-icon {    font-size: 15px}.art-toast-ok .art-toast-icon {    color: #4ade80}.art-toast-err {    background: rgba(40, 10, 12, .94);    border-color: rgba(248, 113, 113, .3)}.art-toast-err .art-toast-icon {    color: #f87171}/* Toast 进出场（JS 控制 class） */.toast-enter {    transform: translateY(100%);    opacity: 0}.toast-enter-active {    transform: translateY(0);    opacity: 1;    transition: all .3s cubic-bezier(.16, 1, .3, 1)}.toast-exit-active {    /* 离场时脱离文档流：其余 Toast 立刻补位，配合 .toast-move 形成滑动让位 */    position: absolute;    transform: translateY(100%);    opacity: 0;    transition: all .3s cubic-bezier(.16, 1, .3, 1)}/* TransitionGroup 让位动画：剩余 Toast 平滑移动到新位置 */.toast-move {    transition: transform .3s cubic-bezier(.16, 1, .3, 1)}

/* 移动端：给底部悬浮元素让位（原来挂在全局“移动端适配”媒体查询里） */
@media (max-width:1023px) {
    #toastContainer {
        bottom: calc(108px + env(safe-area-inset-bottom, 0px))
    }
}
/* 页脚（阶段三-4：从 style.css 原样搬来，仅加 scoped 归属）*/
.art-footer {
    position: relative;
    z-index: 1;
    border-top: 1px solid var(--art-line);
    margin-top: clamp(40px, 6vw, 90px)
}

.art-footer-inner {
    max-width: 1480px;
    margin: 0 auto;
    padding: clamp(18px, 2.6vw, 26px) clamp(20px, 4vw, 60px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    font-size: 11px;
    letter-spacing: .06em;
    color: var(--art-ink-3)
}

.art-footer-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 18px
}

.art-footer a,
.art-footer button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--art-ink-3);
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    transition: color .35s ease
}
@media (hover: hover) and (pointer: fine){.art-footer a:hover, .art-footer button:hover{
    color: #fff
}}

.art-footer-sep {
    color: var(--art-ink-4)
}

.art-footer-copy {
    font-size: 10px;
    letter-spacing: .2em;
    text-transform: uppercase;
    color: var(--art-ink-4)
}

.art-footer-aside {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 18px;
    margin-left: auto
}

.art-footer-icon {
    width: 14px;
    height: 14px;
    object-fit: contain;
    opacity: .75
}

@media (max-width:1023px) {
    .art-footer-inner {
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center
    }

    /* 联系入口横向排列并允许换行，避免每个链接独占一行把页脚拉得很长 */
    .art-footer-links {
        flex-direction: row;
        justify-content: center;
        gap: 10px 16px
    }

    .art-footer-sep {
        display: none
    }

    .art-footer-copy {
        margin-left: 0 !important
    }

    .art-footer-aside {
        flex-direction: column;
        gap: 10px;
        margin-left: 0
    }}

</style>