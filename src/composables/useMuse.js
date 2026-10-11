import { ref } from 'vue'

import { useAuthStore } from '@/stores/useAuthStore'
import { request } from '@/utils/request'

/* 状态放模块作用域，App.vue 与设置弹窗共用 */
const MUSE_CACHE_KEY = 'muse_summary_cache'
const AWAKE_DELAY_MS = 1500
const TYPE_INTERVAL_MS = 45
/* 单帧最多补几个字：手机掉帧时不至于"唰"地写完，也不至于卡成慢动作 */
const TYPE_MAX_STEP = 4
/* 超过这么久没推进，说明是整段卡顿（典型场景：正在滑屏）：丢掉积压时间，
   恢复后按正常速度接着打，不追赶也不停住 */
const TYPE_STALL_MS = 500
/* 台词说完后再停留多久自动收起 */
const AUTO_HIDE_MS = 10000
const FALLBACK_TEXT = '（悄悄探头）服务器好像睡着啦，但没关系，我会一直陪在这里的~'

const awake = ref(false)
const bubbleVisible = ref(false)
const loading = ref(false)
const content = ref('')

let summaryText = ''
/* 打字机用 rAF 按时间推进（见 typeWriter）：手机滚动时定时器会被节流/积压，
   用 setInterval 就会出现「滑的时候卡住、松手后剩余内容一次性冒出来」 */
let typeRaf = 0
let typeFull = ''
let typeShown = 0
let typeLastAt = 0
let autoHideTimer = null
/* 实时读 authStore，身份切换后取对应身份的说辞 */
let authRef = null

function currentIsAdmin() {
  return !!authRef?.isGlobalAdmin
}

/* 站长与访客各存一份缓存 */
function cacheKey(isAdmin) {
  return `${MUSE_CACHE_KEY}_${isAdmin ? 'admin' : 'guest'}`
}

async function getMuseSummary(isAdmin, forceLocal = false, forceRemote = false) {
  const key = cacheKey(isAdmin)
  if (!forceLocal) {
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null')
      if (cached && cached.text && Date.now() - cached.t < 30 * 60 * 1000) return cached.text
    } catch (e) {}
  }
  /* forceRemote：让后端跳过 30 分钟缓存重新生成 */
  const text = await request(`/ai/summary${forceRemote ? '?refresh=1' : ''}`)
  if (text) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), text }))
    } catch (e) {}
  }
  return text
}

function clearAutoHide() {
  if (autoHideTimer) clearTimeout(autoHideTimer)
  autoHideTimer = null
}

function scheduleAutoHide() {
  clearAutoHide()
  autoHideTimer = setTimeout(() => {
    autoHideTimer = null
    bubbleVisible.value = false
  }, AUTO_HIDE_MS)
}

function typeWriter(text) {
  stopTypeWriter()
  content.value = ''
  const full = String(text || '')
  if (!full) {
    scheduleAutoHide()
    return
  }
  typeFull = full
  typeShown = 0
  typeLastAt = performance.now()
  const step = (now) => {
    const elapsed = now - typeLastAt
    if (elapsed >= TYPE_STALL_MS) {
      /* 整段卡顿：不补帧，重新计时 */
      typeLastAt = now
    } else if (elapsed >= TYPE_INTERVAL_MS) {
      /* 按经过的时间补齐该打的字，但单帧有上限，避免一口气冒出来 */
      const advance = Math.min(Math.floor(elapsed / TYPE_INTERVAL_MS), TYPE_MAX_STEP)
      typeShown = Math.min(typeShown + advance, typeFull.length)
      content.value = typeFull.slice(0, typeShown)
      typeLastAt += advance * TYPE_INTERVAL_MS
    }
    if (typeShown < typeFull.length) {
      typeRaf = requestAnimationFrame(step)
    } else {
      typeRaf = 0
      scheduleAutoHide()
    }
  }
  typeRaf = requestAnimationFrame(step)
}

function stopTypeWriter() {
  if (typeRaf) {
    cancelAnimationFrame(typeRaf)
    typeRaf = 0
  }
  typeFull = ''
  typeShown = 0
}

/* 拉取并播放当前身份的说辞 */
async function playSummary(forceLocal = false, forceRemote = false) {
  stopTypeWriter()
  loading.value = true
  try {
    const isAdmin = currentIsAdmin()
    summaryText = await getMuseSummary(isAdmin, forceLocal, forceRemote)
    if (!summaryText) throw new Error('Empty')
    loading.value = false
    bubbleVisible.value = true
    typeWriter(summaryText)
  } catch (e) {
    loading.value = false
    bubbleVisible.value = true
    content.value = FALLBACK_TEXT
    scheduleAutoHide()
  }
}

/* 延迟露面，拉不到就用兜底文案 */
function awakeMuse() {
  setTimeout(async () => {
    awake.value = true
    bubbleVisible.value = true
    await playSummary()
  }, AWAKE_DELAY_MS)
}

/* 身份切换后重新请求说辞 */
async function refreshSummary() {
  if (!awake.value) return
  /* 会话未就绪（/ai/summary 需要登录态）时等下一次变化 */
  if (!authRef?.token) return
  /* 前后端缓存都跳过，确保拿到新身份的说辞 */
  await playSummary(true, true)
}

function toggleMuseBubble() {
  if (!bubbleVisible.value) {
    bubbleVisible.value = true
    if (summaryText) typeWriter(summaryText)
    else scheduleAutoHide()
  } else {
    bubbleVisible.value = false
    clearAutoHide()
    stopTypeWriter()
  }
}

export function useMuse() {
  if (!authRef) authRef = useAuthStore()
  return { awake, bubbleVisible, loading, content, awakeMuse, refreshSummary, toggleMuseBubble }
}
