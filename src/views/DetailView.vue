<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { MdCatalog, MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { useRoute, useRouter } from 'vue-router'

import { usePostLike } from '@/composables/usePostLike'
import { generateSvgAvatar, useAuthStore } from '@/stores/useAuthStore'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { appliedLightMode, useUiStore } from '@/stores/useUiStore'
import { SystemConstant } from '@/utils/constants'
import { apiBase, request } from '@/utils/request'
import { tagHue } from '@/utils/tagColor'
import { firstLine } from '@/utils/text'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const uiStore = useUiStore()
const categoryStore = useCategoryStore()
/* 后端枚举：用户角色 */
const { Role } = SystemConstant

/* md-editor 跟随实际生效的主题，和整页换肤同一刻变色 */
const mdTheme = computed(() => (appliedLightMode.value ? 'light' : 'dark'))

/* 详情是独立路由页，帖子 id 只认 URL */
const postId = computed(() => route.params.id)

const detail = ref(null)
const detailError = ref('')
const loadingDetail = ref(true)

/* ---------------- 详情内回到顶部（仅手机端） ---------------- */
const DETAIL_TOP_THRESHOLD = 160
/* 分页区在接近底部时进入视口，提前收起回顶按钮避免遮挡翻页操作 */
const DETAIL_BOTTOM_HIDE_GAP = 80
const detailBodyEl = ref(null)
const showDetailTop = ref(false)
/* 目录标题只在正文回到最顶部时出现，不依赖目录自身是否发生滚动 */
const catalogHeadVisible = ref(true)

/* 移动端滚的是 .art-detail-body，桌面端滚动容器是左侧舞台，两个都监听同一套逻辑 */
function onDetailScroll(event) {
  const scroller = event.currentTarget
  const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
  showDetailTop.value =
    scroller.scrollTop > DETAIL_TOP_THRESHOLD && remaining > DETAIL_BOTTOM_HIDE_GAP
  if (event.currentTarget === scrollElement.value) {
    catalogHeadVisible.value = scroller.scrollTop <= 1
  }
}

/* 随笔目录监听左栏滚动容器（模板 ref 直接指向 #detail-scroll-container），用于高亮当前标题 */
const scrollElement = ref(null)
/* 目录自己的滚动容器：文章滚动时把当前激活项带回可视区 */
const catalogInnerEl = ref(null)
onMounted(loadSidePosts)

function scrollDetailTop() {
  const targets = [detailBodyEl.value, scrollElement.value].filter(Boolean)
  targets.forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }))
}

const { liked, likeCount, likePending, toggleLike } = usePostLike(detail)

const rating = ref(0)
const commentInput = ref('')
const submitting = ref(false)

const comments = ref([])
const commentsStatusMessage = ref('')
const commentsLoading = ref(true)
const commentsReady = ref(false)
const commentThreadEl = ref(null)
const commentAnimations = new Set()
const currentCommentPage = ref(1)
const totalCommentPages = ref(1)
const commentTotal = ref(0)

let detailSeq = 0
let commentsSeq = 0

const commentLength = computed(() => commentInput.value.length)

const detailTitle = computed(() => {
  const p = detail.value
  if (!p) return ''
  return p.title || firstLine(p.content) || '无标题随笔'
})

// 来源随当前历史条目保存，刷新、后退/前进都对应同一个返回目标。
const previousPost = ref(null)
const backLabel = computed(() => previousPost.value?.title || '返回随笔页')

function syncPreviousPost() {
  const state = router.options.history.state
  const previous = state.readingReturn
  previousPost.value = previous && previous.path === state.back && /^\/post\/[^/?#]+(?:[?#]|$)/.test(previous.path)
    ? previous
    : null
}

const detailCategoryText = computed(() => {
  const p = detail.value
  if (!p) return ''
  return p.categoryName || categoryStore.nameOf(p.categoryId) || '未分类'
})

const detailTagNames = computed(() => (Array.isArray(detail.value?.tagNames) ? detail.value.tagNames : []))

const detailTime = computed(() => {
  if (!detail.value) return ''
  return detail.value.createTime ? detail.value.createTime.replace('T', ' ') : '未知时间'
})

const hasContent = computed(() => !!(detail.value?.content && detail.value.content.trim()))

const hideDesc = computed(() => !!detail.value && !hasContent.value)
/* 手机端把时间与点击量挪到“随笔正文”那一行右侧：顶栏那两份只在正文行不显示时才留着 */
const showDescTime = computed(() => hasContent.value)

const detailRating = computed(() =>
  detail.value?.averageRating ? Number(detail.value.averageRating).toFixed(1) : '0.0',
)

/* 单篇字数与点击量：字数沿用列表卡片的 content.length 口径 */
const detailWordCount = computed(() => (detail.value?.content ? detail.value.content.length : 0))
const detailViewCount = computed(() => Number(detail.value?.viewCount) || 0)

/* 既没有正文也没有配图时，左栏给一个空状态 */
const showEmptyStage = computed(() => !!detail.value && !hasContent.value)

/* ---------------- 左侧目录：没提取到目录就不占列，左侧完全留白 ---------------- */
const catalogList = ref([])
const hasCatalog = computed(() => catalogList.value.length > 0)

/* MdPreview 只在挂载时把目录交给 MdCatalog：换文章后老 MdCatalog 收不到后续广播（实测同 id 新挂一个就能拿到新目录，
   老实例连别人触发的广播都不响应），目录会定格在上一篇。等目录真的变了就把 MdCatalog 重挂一次，让它重新取当前目录 */
const catalogKey = ref(0)
let lastCatalogSign = null

/* 目录指纹：换成内容判断，不按数组引用——切主题等重渲染也会回传一份新数组，按引用去重会白重挂一次 */
function catalogSign(list) {
  return list.map((item) => `${item.level}|${item.text}|${item.line}`).join('\n')
}

/* MdPreview 解析完正文会把标题清单回传，用它判断这篇到底有没有目录 */
function onGetCatalog(list) {
  const next = Array.isArray(list) ? list : []
  catalogList.value = next
  const sign = catalogSign(next)
  if (sign !== lastCatalogSign) {
    lastCatalogSign = sign
    catalogKey.value += 1
  }
}

/* 默认标题 id 只取标题文本，重复标题会共享同一个锚点，目录激活项也会卡在第一次出现的位置 */
function detailHeadingId({ level, index }) {
  return `art-reading-heading-${level}-${index}`
}

/* 激活项进入目录上下留白范围时，平滑滚动到目录中间；用户手动浏览目录时不额外干预 */
function keepCatalogActiveVisible(_item, node) {
  const scroller = catalogInnerEl.value
  if (!(node instanceof HTMLElement) || !scroller?.contains(node)) return

  const edge = 20
  const scrollerRect = scroller.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const outside =
    nodeRect.top < scrollerRect.top + edge || nodeRect.bottom > scrollerRect.bottom - edge
  if (!outside) return

  const target =
    scroller.scrollTop +
    nodeRect.top -
    scrollerRect.top -
    (scroller.clientHeight - node.offsetHeight) / 2
  scroller.scrollTo({
    top: Math.max(0, target),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

/* ---------------- 目录列宽拖拽（右侧栏宽度固定，不参与拖拽） ---------------- */
const CATALOG_MAX_W = 340
/* 正文保底宽度：拖到极限时目录被压到 0，也不会把正文挤没 */
const CONTENT_MIN_W = 360
/* 目录与正文之间的把手占一条 8px 列，与 .art-detail-grip 的 width 一致 */
const GRIP_W = 8
/* 右侧栏固定宽度，与 .art-detail-page .art-detail-body 的 280px 保持一致 */
const SIDE_FIXED_W = 280
const catalogWidth = ref(190)
const resizing = ref(false)
/* 当前拖拽的收尾函数，组件卸载时兜底清理 */
let endResize = null

function startCatalogResize(event) {
  const bodyEl = event.currentTarget.parentElement
  if (!bodyEl) return
  const gripEl = event.currentTarget
  const totalWidth = bodyEl.getBoundingClientRect().width
  const startX = event.clientX
  const startWidth = catalogWidth.value
  resizing.value = true
  gripEl.classList.add('is-dragging')
  document.body.classList.add('art-col-resizing')

  const onMove = (e) => {
    const delta = e.clientX - startX
    const limit = Math.max(0, Math.min(CATALOG_MAX_W, totalWidth - SIDE_FIXED_W - CONTENT_MIN_W - GRIP_W))
    catalogWidth.value = Math.min(Math.max(startWidth + delta, 0), limit)
  }
  endResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', endResize)
    window.removeEventListener('pointercancel', endResize)
    gripEl.classList.remove('is-dragging')
    document.body.classList.remove('art-col-resizing')
    resizing.value = false
    endResize = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', endResize)
  window.addEventListener('pointercancel', endResize)
}

/* ---------------- 右侧栏数据：精选（后端随机 5 篇）与近期最热 ---------------- */
const sideRecommend = ref([])
const sideHot = ref([])
const sideLoading = ref(true)

async function loadSidePosts() {
  const hotUrl = `/blog/list?sortStrategy=${SystemConstant.SortStrategy.HOTTEST}&pageNum=1&pageSize=5`
  try {
    const [recommend, hot] = await Promise.all([
      request('/blog/list?isRecommend=1'),
      request(hotUrl),
    ])
    sideRecommend.value = recommend?.records || []
    sideHot.value = hot?.records || []
  } catch (e) {
    sideRecommend.value = []
    sideHot.value = []
  } finally {
    sideLoading.value = false
  }
}

/* 两个列表结构完全一致：用一份数据驱动，模板只写一遍 */
const sideGroups = computed(() => [
  {
    key: 'recommend',
    title: '精选文章',
    icon: 'ph-fill ph-push-pin',
    posts: sideRecommend.value,
    empty: '这里空空如也哦。',
  },
  { key: 'hot', title: '近期最热', icon: 'ph-bold ph-fire', posts: sideHot.value, empty: '这里空空如也哦。' },
])

function openPost(id) {
  if (id === null || id === undefined) return
  router.push({
    path: '/post/' + id,
    state: { readingReturn: { path: route.fullPath, title: detailTitle.value || '无标题随笔' } },
  })
}

/* 侧栏卡片封面：与随笔页“最近更新”同一套解析规则，相对路径补成后端地址 */
function sideCover(value) {
  if (!value) return ''
  let cover = String(value).trim()
  if (cover.startsWith('[')) {
    try {
      cover = JSON.parse(cover).find((item) => typeof item === 'string' && item.trim()) || ''
    } catch {
      return ''
    }
  }
  if (!cover || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(cover)) return ''
  if (/^https?:\/\//i.test(cover)) return cover
  return cover.startsWith('/') && !cover.startsWith('//') ? apiBase + cover : ''
}

/* 封面加载失败就退回图标占位，避免破图 */
const failedCovers = ref(new Set())

const commentPageInfo = computed(
  () => `第 ${currentCommentPage.value} / ${totalCommentPages.value} 页`,
)

const commentPageInfoText = computed(() => (detail.value ? commentPageInfo.value : '第 1 / 1 页'))

function commentTime(comment) {
  return comment.createTime ? comment.createTime.replace('T', ' ') : '刚刚'
}

/* 随笔导出 Markdown：交给浏览器下载，不经过后端 */
function downloadMarkdown() {
  const post = detail.value
  if (!post) return
  const title = detailTitle.value || '随笔'
  const lines = [`# ${title}`]
  if (detailTime.value) lines.push('', `> ${detailTime.value}`)
  lines.push('', post.content || '', '')
  const url = URL.createObjectURL(
    new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  uiStore.showToast('已导出 Markdown')
}

function commentAvatar(comment) {
  return comment.avatar || generateSvgAvatar(comment.nickname, comment.role)
}

function handleAvatarError(event, comment) {
  event.target.src = generateSvgAvatar(comment?.nickname, comment?.role)
}

/* 返回文字与目的地一致：有上一篇随笔就后退，否则回列表。 */
function goBack() {
  if (previousPost.value || router.options.history.state.back === '/blog') router.back()
  else router.push('/blog')
}

/* 换文章入场动效的序号：0 = 首次进入（直接打开详情，不挂类，仍走外层 fade-slide 与全局淡入），
   每换一次文章 +1。类一旦挂上就不再摘——摘掉会让 animation-name 回落到全局 artDetailFade
   并重播一次淡入，正文落地后会闪一下；同一个值还给顶栏当 key：顶栏是常驻元素，
   animation-name 不变就不会重播动画，换 key 才能让它的淡入每次换文章都重新播 */
const postSwapSeq = ref(0)

async function loadDetail(id) {
  if (id === null || id === undefined) return
  const seq = ++detailSeq
  loadingDetail.value = true
  try {
    const data = await request(`/blog/detail/${id}`)
    if (seq !== detailSeq) return
    detail.value = data
  } catch (e) {
    if (seq !== detailSeq) return
    detail.value = null
    detailError.value = '这条内容不存在或已被删除。'
    /* 正文都没了，目录不能再挂着上一篇的标题；这里不会再有新目录回传，放心让它收起 */
    catalogList.value = []
  } finally {
    if (seq === detailSeq) loadingDetail.value = false
  }
}

function stopCommentMotion() {
  commentAnimations.forEach(animation => animation.cancel())
  commentAnimations.clear()
  if (commentThreadEl.value) commentThreadEl.value.style.overflow = ''
}

/* 只在已有评论更新时过渡高度；首屏不动画，也不为刷新插入加载占位。 */
async function loadComments(id, page = 1) {
  if (id === null || id === undefined) return
  const seq = ++commentsSeq
  commentsLoading.value = true
  try {
    const data = await request(`/comment/list?postId=${id}&pageNum=${page}&pageSize=10`)
    if (seq !== commentsSeq) return
    const records = data.records || data
    const total = data.total !== undefined ? data.total : records.length || 0

    const thread = commentThreadEl.value
    const animate = commentsReady.value && thread && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const before = animate ? thread.getBoundingClientRect() : null
    const oldRows = new Map(animate ? Array.from(thread.querySelectorAll('[data-comment-id]'), el =>
      [el.dataset.commentId, el.getBoundingClientRect().top - before.top]) : [])
    stopCommentMotion()
    comments.value = records
    currentCommentPage.value = page
    commentTotal.value = total
    totalCommentPages.value = Math.max(1, Math.ceil(total / 10))
    commentsStatusMessage.value = records.length ? '' : '这里空空如也哦。'
    commentsReady.value = true
    commentsLoading.value = false
    await nextTick()
    if (!animate || seq !== commentsSeq || !thread.isConnected) return

    const after = thread.getBoundingClientRect()
    const rows = Array.from(thread.querySelectorAll('[data-comment-id]'), el => ({
      el, top: el.getBoundingClientRect().top - after.top,
    }))
    const timing = { duration: 520, easing: 'cubic-bezier(.4, 0, .2, 1)' }
    // 分页器与空状态一起参与高度变化；仅动画期间裁切，结束后恢复自然高度。
    thread.style.overflow = 'clip'
    const resize = thread.animate([{ height: `${before.height}px` }, { height: `${after.height}px` }], timing)
    commentAnimations.add(resize)
    resize.onfinish = () => {
      thread.style.overflow = ''
      commentAnimations.delete(resize)
    }
    rows.forEach(({ el, top }) => {
      const oldTop = oldRows.get(el.dataset.commentId)
      const motion = el.animate([
        { opacity: oldTop === undefined ? 0 : 1, transform: `translateY(${oldTop === undefined ? 10 : oldTop - top}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], timing)
      commentAnimations.add(motion)
      motion.onfinish = () => commentAnimations.delete(motion)
    })
  } catch (e) {
    if (seq === commentsSeq) {
      comments.value = []
      commentsStatusMessage.value = '评论加载失败，请稍后重试。'
    }
  } finally {
    if (seq === commentsSeq) commentsLoading.value = false
  }
}

function changeCommentPage(delta) {
  if (
    currentCommentPage.value + delta < 1 ||
    currentCommentPage.value + delta > totalCommentPages.value
  )
    return
  loadComments(postId.value, currentCommentPage.value + delta)
}

function setRating(value) {
  /* 再点同一颗星星即取消评分 */
  rating.value = rating.value === value ? 0 : value
}

async function refreshDetailRating() {
  const id = postId.value
  if (!id) return
  try {
    const data = await request(`/blog/detail/${id}`)
    if (detail.value && String(detail.value.id) === String(data.id)) detail.value = data
    uiStore.refreshPosts()
  } catch (e) {}
}

async function submitComment() {
  if (submitting.value) return
  submitting.value = true
  const content = commentInput.value.trim()
  if (!content) {
    submitting.value = false
    return uiStore.showToast('说点什么吧', false)
  }
  try {
    await request('/comment/add', {
      method: 'POST',
      body: JSON.stringify({ postId: postId.value, content, rating: rating.value }),
    })
    uiStore.showToast('发送成功！')
    uiStore.refreshStats()
    commentInput.value = ''
    setRating(0)
    await loadComments(postId.value, 1)
    await refreshDetailRating()
  } catch (e) {
  } finally {
    submitting.value = false
  }
}

function deleteComment(id) {
  uiStore.openConfirm('确定删除这条评论吗？', async () => {
    try {
      await request(`/comment/delete/${id}`, { method: 'DELETE' })
      uiStore.showToast('已删除')
      uiStore.refreshStats()
      loadComments(postId.value, currentCommentPage.value)
      refreshDetailRating()
    } catch (e) {}
  })
}

/* ---------------- AI 文章摘要：打字机 ---------------- */
/* 后端接口约定：GET /ai/postSummary?postId=xxx，返回纯文本摘要字符串 */
const SUMMARY_TYPE_SPEED = 30
const SUMMARY_LOADING_HINT = 'AI 正在阅读并提炼本文精髓...'
/* 摘要最长字数：与后端硬上限一致。卡片按这个字数预留固定高度，逐字打字时下方正文不再被顶动 */
const SUMMARY_MAX_CHARS = 150
/* 幽灵占位串：全用全角汉字，撑出的行数即「最长摘要」所需行数，行数随卡片宽度自适应，无需写死像素 */
const SUMMARY_GHOST_TEXT = '字'.repeat(SUMMARY_MAX_CHARS)
/* 最长等多久：后端那边摘要请求 20 秒就超时，这里再留点余量兜住传输层卡死的情况 */
const SUMMARY_WAIT_MS = 25000
const SUMMARY_WAIT_TIMEOUT = Symbol('summary-wait-timeout')
let summaryWaitTimer = null

const summaryVisible = ref(false)
const summaryLoading = ref(false)
const summaryTyping = ref(false)
const summaryText = ref('')
let summaryTimer = null
let summarySeq = 0

/* 收尾：清掉定时器并把光标状态置回，避免快速切文章时旧动画继续往新内容里写字 */
function stopSummaryTyping() {
  if (summaryTimer) {
    clearInterval(summaryTimer)
    summaryTimer = null
  }
  summaryTyping.value = false
}

function stopSummaryWait() {
  if (summaryWaitTimer) {
    clearTimeout(summaryWaitTimer)
    summaryWaitTimer = null
  }
}

/* 兜住后端可能的超长返回：优先截到最近一句句末，避免半句话；找不到句末才硬截并补省略号 */
function clampSummaryText(text) {
  if (text.length <= SUMMARY_MAX_CHARS) return text
  const head = text.slice(0, SUMMARY_MAX_CHARS)
  const cut = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('…'),
  )
  return cut >= SUMMARY_MAX_CHARS / 2 ? head.slice(0, cut + 1) : head.slice(0, SUMMARY_MAX_CHARS - 1) + '…'
}

/* 逐字把完整摘要推进响应式变量：每 30ms 一个字符，末尾光标随 summaryTyping 闪烁 */
function startTypewriter(text) {
  stopSummaryTyping()
  summaryText.value = ''
  summaryTyping.value = true
  /* 兜住后端可能的超长返回：卡片只按 SUMMARY_MAX_CHARS 预留高度 */
  const fullText = clampSummaryText(text)
  /* 尊重系统“减少动态效果”：直接整段显示，不做逐字动画 */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    summaryText.value = fullText
    summaryTyping.value = false
    return
  }
  let index = 0
  summaryTimer = setInterval(() => {
    index += 1
    summaryText.value = fullText.slice(0, index)
    if (index >= fullText.length) stopSummaryTyping()
  }, SUMMARY_TYPE_SPEED)
}

/*
 * 拉取文章摘要。约定后端 GET /ai/postSummary?postId=xxx 返回纯文本。
 * 摘要是锦上添花：接口未就绪、返回为空或请求失败时整块收起，不影响正文阅读。
 */
async function loadPostSummary(id) {
  if (id === null || id === undefined) return
  const seq = ++summarySeq
  stopSummaryTyping()
  stopSummaryWait()
  summaryText.value = ''
  summaryVisible.value = true
  summaryLoading.value = true
  try {
    /* 游客 token 由 /user/init 异步签发，摘要接口需要登录态，先等身份就位再请求，避免 401 */
    await authStore.ensureAuth()
    if (seq !== summarySeq) return
    /* 到点就收起：迟到的响应由 race 直接丢弃，读者不会对着转圈无限等 */
    const data = await Promise.race([
      request(`/ai/postSummary?postId=${id}`, { silent: true }),
      new Promise((resolve) => {
        summaryWaitTimer = setTimeout(() => resolve(SUMMARY_WAIT_TIMEOUT), SUMMARY_WAIT_MS)
      }),
    ])
    if (seq !== summarySeq) return
    if (data === SUMMARY_WAIT_TIMEOUT) {
      summaryVisible.value = false
      return
    }
    const text = typeof data === 'string' ? data.trim() : ''
    if (!text) {
      summaryVisible.value = false
      return
    }
    startTypewriter(text)
  } catch (e) {
    if (seq !== summarySeq) return
    summaryVisible.value = false
  } finally {
    stopSummaryWait()
    if (seq === summarySeq) summaryLoading.value = false
  }
}

/* 正文真正加载出来后再取摘要；同一篇的评分刷新会带回同一个 id，不会重复触发 */
watch(
  () => detail.value?.id,
  (id) => {
    if (id !== null && id !== undefined) loadPostSummary(id)
  },
)

onUnmounted(() => {
  stopCommentMotion()
  if (endResize) endResize()
  summarySeq += 1
  stopSummaryTyping()
  stopSummaryWait()
})

/* 路由按 path 重建组件，这里顺带兜住同组件换 id 的情况 */
watch(
  postId,
  (id, prevId) => {
    stopCommentMotion()
    commentsReady.value = false
    syncPreviousPost()
    /* 只有换文章（而非首次进入）才启动入场动效：顶栏、加载态与新正文各淡入一次 */
    if (prevId && prevId !== id) postSwapSeq.value += 1
    detail.value = null
    detailError.value = ''
    /* 这里不清 catalogList：目录列若跟着清，正文列会在换文章瞬间先撑宽再收回，看着像横向抖一下；
       新正文解析完会把目录回传进来，届时列宽自然跟着新文章走 */
    /* 从侧栏列表换一篇是同一个组件实例，正文的滚动位置要手动归零 */
    if (detailBodyEl.value) detailBodyEl.value.scrollTop = 0
    if (scrollElement.value) scrollElement.value.scrollTop = 0
    catalogHeadVisible.value = true
    setRating(0)
    commentInput.value = ''
    loadDetail(id)
    loadComments(id, 1)
  },
  { immediate: true },
)
</script>

<template>
    <section id="detailView" class="art-detail-page" :class="{ 'is-post-swap': postSwapSeq > 0 }">
        <div :key="postSwapSeq" class="art-detail-bar">
            <div class="art-detail-bar-left">
                <button @click="goBack" class="art-icon-btn art-icon-btn-sm" :title="backLabel" :aria-label="backLabel"><i
                        class="ph-bold ph-arrow-left"></i></button>
                <div class="art-detail-meta">
                    <button type="button" id="detailTitle" class="art-detail-title reading-back-label" @click="goBack"
                        :title="backLabel"><span class="detail-bar-title--post">{{ detailTitle || backLabel }}</span><span
                            class="detail-bar-title--back">{{ backLabel }}</span></button>
                    <div class="art-detail-tags">
                        <span id="detailCategory" class="art-chip">{{ detailCategoryText }}</span>
                        <span v-for="name in detailTagNames" :key="name" class="art-chip art-tag"
                            :style="{ '--tag-h': tagHue(name) + 'deg' }">{{ name }}</span>
                        <span id="detailWordCount" class="art-chip"><i class="ph-bold ph-text-aa"></i>
                            {{ detailWordCount }} 字</span>
                        <span id="detailViewCount" class="art-chip art-detail-view"
                            :class="{ 'is-moved': showDescTime }" title="点击量"><i class="ph-bold ph-eye"></i>
                            {{ detailViewCount }}</span>
                    </div>
                </div>
            </div>
            <span id="detailTime" class="art-detail-time art-detail-time--bar"
                :class="{ 'is-moved': showDescTime }">{{ detailTime }}</span>
            <button type="button" class="reading-top-link" @click="scrollDetailTop" title="回到文章顶部，使用主页与音乐导航">
                <i class="ph ph-arrow-up" aria-hidden="true"></i>回到页首
            </button>
            <button id="detailDownloadBtn" @click.stop="downloadMarkdown" class="art-detail-like"
                title="下载 Markdown 文档" aria-label="下载 Markdown 文档"><i
                    class="ph-bold ph-download-simple"></i></button>
            <button id="detailLikeBtn" @click.stop="toggleLike" class="art-detail-like" title="点赞"
                :class="[liked ? 'is-liked' : '', likePending ? 'pointer-events-none opacity-60' : '']"><i
                    class="ph-fill ph-heart"></i> {{ likeCount }}</button>
        </div>

        <div id="detail-reading-body" ref="detailBodyEl" class="art-detail-body"
            :class="{ 'art-detail-body--with-catalog': hasCatalog }"
            :style="{ '--art-detail-catalog-w': catalogWidth + 'px' }" @scroll.passive="onDetailScroll">
            <!-- 目录列（仅 PC）：没提取到目录时不占列，左侧完全留白 -->
            <section v-if="hasCatalog" class="art-detail-catalog">
                <div ref="catalogInnerEl" class="art-catalog-inner">
                    <div class="reading-catalog-head" :class="{ 'is-visible': catalogHeadVisible }"
                        :aria-hidden="!catalogHeadVisible">
                        <span>文章目录</span><span>{{ catalogList.length.toString().padStart(2, '0') }}</span>
                    </div>
                    <MdCatalog :key="catalogKey" editor-id="blog-preview-id" :scroll-element="scrollElement"
                        :theme="mdTheme" :md-heading-id="detailHeadingId" @onActive="keepCatalogActiveVisible" />
                </div>
            </section>
            <button v-if="hasCatalog" type="button" class="art-detail-grip" :class="{ 'is-dragging': resizing }"
                @pointerdown="startCatalogResize" title="拖动调整目录宽度" aria-label="拖动调整目录宽度"></button>

            <div id="detail-scroll-container" ref="scrollElement" class="art-detail-stage"
                @scroll.passive="onDetailScroll">
                <!-- 详情未回来前用等高占位撑住画板，避免结构先塌后撑 -->
                <div v-if="loadingDetail" class="art-detail-loading">
                    <i class="ph-bold ph-spinner-gap animate-spin"></i>
                </div>
                <div v-else-if="detailError" class="art-detail-empty-stage">
                    <i class="ph-light ph-wind art-detail-empty-icon text-zinc-600" aria-hidden="true"></i>
                    <p class="art-detail-empty-text text-zinc-600">{{ detailError }}</p>
                </div>
                <template v-else>
                    <header class="reading-heading">
                        <p class="reading-eyebrow">随笔 <span aria-hidden="true">/</span> {{ detailCategoryText }}</p>
                        <h1>{{ detailTitle }}</h1>
                        <div class="reading-metadata">
                            <time>{{ detailTime }}</time>
                            <span>{{ detailWordCount }} 字 · 约 {{ Math.max(1, Math.ceil(detailWordCount / 350)) }} 分钟</span>
                            <span>{{ detailViewCount }} 次阅读</span>
                        </div>
                        <div v-if="detailTagNames.length" class="reading-tags">
                            <span v-for="name in detailTagNames" :key="name"># {{ name }}</span>
                        </div>
                    </header>
                    <!-- AI 文章摘要：标题与元数据下方、正文上方，逐字打字机输出 -->
                    <Transition name="ai-summary">
                        <section v-if="summaryVisible" id="aiPostSummary" class="art-ai-summary"
                            :aria-busy="summaryLoading" aria-label="AI 文章摘要">
                            <div class="art-ai-summary-head">
                                <span class="art-ai-summary-badge"><i class="ph-bold ph-sparkle"></i> 摘要</span>
                                <span class="art-ai-summary-caption">AI · POST BRIEF</span>
                            </div>
                            <div class="art-ai-summary-body">
                                <!-- 幽灵占位：按最长字数撑出固定行数，逐字打字时不再顶动下方正文 -->
                                <p class="art-ai-summary-ghost" aria-hidden="true">{{ SUMMARY_GHOST_TEXT }}</p>
                                <p v-if="summaryLoading" class="art-ai-summary-loading" role="status">
                                    <span class="art-ai-summary-pulse" aria-hidden="true"></span>{{ SUMMARY_LOADING_HINT }}
                                </p>
                                <p v-else class="art-ai-summary-text">{{ summaryText }}<span v-if="summaryTyping"
                                        class="art-ai-summary-caret" aria-hidden="true">_</span></p>
                            </div>
                        </section>
                    </Transition>
                    <div id="detailDescBox" class="art-detail-desc" :class="hideDesc ? 'hidden' : ''">
                        <p id="detailDescLabel" class="art-panel-sub">随笔正文<span v-if="showDescTime"
                                class="art-detail-desc-meta"><span class="art-detail-time">{{ detailTime }}</span><span
                                    class="art-chip art-detail-view" title="点击量"><i class="ph-bold ph-eye"></i>
                                    {{ detailViewCount }}</span></span>
                        </p>
                        <div id="detailContent" class="art-article-typography art-reading-text">
                            <MdPreview editor-id="blog-preview-id" :modelValue="detail.content || ''"
                                :theme="mdTheme" :md-heading-id="detailHeadingId" @onGetCatalog="onGetCatalog" />
                        </div>
                    </div>
                    <div v-if="showEmptyStage" class="art-detail-empty-stage">
                        <i class="ph-light ph-wind art-detail-empty-icon text-zinc-600" aria-hidden="true"></i>
                        <p class="art-detail-empty-text text-zinc-600">这里空空如也哦。</p>
                    </div>
                </template>
                <section class="art-detail-comments-panel" aria-label="文章评论">
                    <div class="art-detail-side-head">
                        <div><h4 class="art-detail-side-title">评论区</h4><p class="reading-comment-caption">评价一下这篇随笔吧...</p></div>
                        <div class="flex items-center gap-3">
                            <span id="detailCommentTotal"
                                class="art-detail-comment-total font-mono text-zinc-500">共 {{ commentTotal }} 条</span>
                            <div id="detailScore" class="art-detail-score">
                                <i class="ph-fill ph-star"></i>
                                <span id="detailRating">{{ detailRating }}</span>
                            </div>
                        </div>
                    </div>

                    <div ref="commentThreadEl" class="reading-comment-thread" :aria-busy="commentsLoading">
                    <div id="detailCommentList" class="art-comment-list art-detail-comments">
                        <div v-for="comment in comments" :key="comment.id" :data-comment-id="comment.id" class="art-comment">
                            <img :src="commentAvatar(comment)" @error="handleAvatarError($event, comment)"
                                :alt="comment.nickname" class="art-comment-avatar">
                            <div class="art-comment-body">
                                <div class="art-comment-head">
                                    <span class="art-comment-name">
                                        <span class="art-comment-nick" :title="comment.nickname">{{ comment.nickname }}</span>
                                        <span v-if="comment.role === Role.ADMIN" class="art-badge-admin"><i
                                                class="ph-fill ph-crown"></i>站长</span>
                                    </span>
                                    <div class="art-comment-right">
                                        <span class="art-comment-time">{{ commentTime(comment) }}</span>
                                        <div v-if="comment.rating > 0" class="art-comment-stars">
                                            <i v-for="star in Number(comment.rating)" :key="star"
                                                class="ph-fill ph-star"></i>
                                        </div>
                                        <span class="art-comment-floor">#{{ comment.id }}</span>
                                    </div>
                                </div>
                                <p class="art-comment-text">{{ comment.content }}</p>
                                <button v-if="authStore.isGlobalAdmin" @click.stop="deleteComment(comment.id)"
                                    class="art-icon-btn art-icon-btn-sm art-icon-btn-danger art-comment-del"><i
                                        class="ph-bold ph-trash"></i></button>
                            </div>
                        </div>
                        <div v-if="commentsLoading && !commentsReady" class="art-empty"><i
                                class="ph-bold ph-spinner-gap animate-spin"></i> 评论加载中...</div>
                        <div v-else-if="commentsStatusMessage" class="art-empty">{{ commentsStatusMessage }}</div>
                    </div>

                    <div v-if="totalCommentPages > 1" class="art-detail-side-foot">
                        <button @click="changeCommentPage(-1)" :disabled="!!detail && currentCommentPage <= 1"
                            class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-left"></i></button>
                        <span id="detailCommentPageInfo" class="art-pager-info">{{ commentPageInfoText }}</span>
                        <button @click="changeCommentPage(1)" :disabled="!!detail && currentCommentPage >= totalCommentPages"
                            class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
                    </div>
                    </div>

                    <div class="art-detail-compose">
                        <div class="art-detail-compose-head">
                            <div class="art-rater-wrap">
                                <span id="detailCommentCounter" class="art-counter">{{ commentLength }}/500</span>
                                <div id="starRater" class="art-rater">
                                    <i v-for="star in 5" :key="star" class="ph-fill ph-star art-star text-zinc-700"
                                        :class="{ 'is-on': star <= rating }"
                                        @click="setRating(star)"></i>
                                </div>
                            </div>
                        </div>
                        <div class="art-detail-compose-row">
                            <input type="text" id="detailCommentInput" v-model="commentInput" maxlength="500"
                                autocomplete="off" placeholder="添加一条评论..." aria-label="评论内容" class="art-detail-input">
                            <button @click="submitComment" :disabled="submitting" class="art-send" aria-label="发送评论">
                                <i class="ph-bold ph-spinner-gap animate-spin art-send-icon"
                                    :class="{ 'is-off': !submitting }"></i>
                                <i class="ph-bold ph-paper-plane-right art-send-icon" :class="{ 'is-off': submitting }"></i>
                            </button>
                        </div>
                        <p class="art-compose-hint" :class="{ 'is-off': !submitting }">发送中...</p>
                    </div>
                </section>
            </div>

            <aside id="reading-recommendations" class="art-detail-side">
                <section v-for="group in sideGroups" :key="group.key" class="art-side-group">
                    <div class="art-detail-side-head">
                        <div><p class="reading-side-eyebrow">{{ group.key === 'recommend' ? '值得停留' : '此刻共读' }}</p><h4 class="art-detail-side-title">{{ group.title }}</h4></div>
                        <i class="art-side-group-icon" :class="group.icon"></i>
                    </div>
                    <Transition name="side-reveal" mode="out-in">
                        <ul :key="sideLoading ? 'loading' : 'loaded'" class="art-side-list"
                            :aria-busy="sideLoading">
                            <template v-if="sideLoading">
                                <li v-for="index in 4" :key="`skeleton-${index}`" class="art-side-skeleton"
                                    aria-hidden="true">
                                    <span class="art-side-skeleton-cover"></span>
                                    <span class="art-side-skeleton-copy">
                                        <span class="art-side-skeleton-line"></span>
                                        <span class="art-side-skeleton-line is-short"></span>
                                    </span>
                                </li>
                            </template>
                            <template v-else>
                                <li v-for="(post, index) in group.posts" :key="post.id">
                                    <button type="button" class="art-side-item" :class="{ 'is-current': String(post.id) === String(postId) }" :aria-current="String(post.id) === String(postId) ? 'page' : undefined" @click="openPost(post.id)">
                                        <span class="art-side-item-cover" aria-hidden="true">
                                            <img v-if="sideCover(post.coverImage) && !failedCovers.has(post.id)"
                                                :src="sideCover(post.coverImage)" alt="" loading="lazy"
                                                @error="failedCovers.add(post.id)">
                                            <span v-else class="reading-side-number">{{ String(index + 1).padStart(2, '0') }}</span>
                                        </span>
                                        <span class="art-side-item-copy">
                                            <span class="art-side-item-title">{{ post.title || firstLine(post.content) || '无标题随笔' }}</span>
                                            <span class="art-side-item-meta">
                                                <time v-if="post.createTime" :datetime="post.createTime">{{ post.createTime.slice(0, 10) }}</time>
                                                <span class="art-side-item-view" title="点击量"><i class="ph-bold ph-eye"></i>
                                                    {{ post.viewCount || 0 }}</span>
                                            </span>
                                        </span>
                                        <i class="ph-bold ph-arrow-up-right art-side-item-arrow" aria-hidden="true"></i>
                                    </button>
                                </li>
                                <li v-if="!group.posts.length" class="art-side-empty">{{ group.empty }}</li>
                            </template>
                        </ul>
                    </Transition>
                </section>
            </aside>
        </div>

        <!-- 详情内回到顶部：只在手机端出现（桌面端有全局按钮，且左侧目录足够直达） -->
        <Transition name="fade">
            <button v-if="showDetailTop" type="button" class="art-icon-btn art-icon-btn-lg art-detail-top-btn"
                @click="scrollDetailTop" title="回到顶部" aria-label="回到顶部">
                <i class="ph-bold ph-arrow-up"></i>
            </button>
        </Transition>
    </section>
</template>

<style scoped>
.reading-top-link, .reading-comment-caption, .reading-side-eyebrow,
.reading-eyebrow, .reading-metadata, .reading-tags { display: none; }
/* 手机端标题已经在顶栏上，正文不再重复一遍；桌面端顶栏只有返回来源，正文标题保留。 */
.reading-heading { display: none; flex: none; padding: 22px 18px 0; }
.reading-heading h1 { margin: 0; font-family: var(--art-serif); font-size: 24px; font-weight: 400; line-height: 1.55; color: var(--art-ink); overflow-wrap: anywhere; }
.reading-back-label { text-align: left; cursor: pointer; }
.detail-bar-title--back { display: none; }
.reading-back-label:focus-visible { outline: 2px solid var(--art-accent); outline-offset: 4px; }
.reading-comment-thread { display: flex; flex-direction: column; flex: 1 0 auto; min-height: 0; overflow-anchor: none; }
/* 手机端固定顶部留位，不再用滚动进度反向改变滚动容器高度。 */
.art-detail-page {
    top: 74px;
    height: calc(100dvh - 74px);
}
@media (min-width:1024px) and (prefers-reduced-motion: no-preference) {
    .art-detail-page { transition: top .6s cubic-bezier(.4, 0, .6, 1), height .6s cubic-bezier(.4, 0, .6, 1); }
}
/* 桌面阅读外壳：单行工具栏常驻，完整标题与元信息随正文滚走。 */
@media (min-width:1024px) {
    .art-detail-page, :global(body.theme-light .art-detail-page) {
        top: calc(74px - 62px * var(--nav-retreat, 0));
        height: calc(100dvh - 74px + 62px * var(--nav-retreat, 0));
        background: var(--reading-atmosphere), var(--art-bg);
        background-attachment: fixed;
        background-size: 100vw 100dvh;
    }
    .art-detail-page .art-detail-bar {
        min-height: 52px; height: 52px; gap: 14px; padding: 0 22px;
        background: transparent; border-bottom-color: transparent; backdrop-filter: none; -webkit-backdrop-filter: none;
    }
    .art-detail-bar .art-detail-tags, .art-detail-bar .art-detail-time--bar { display: none; }
    .art-detail-bar .art-detail-title { font-size: 12px; letter-spacing: .05em; color: var(--art-ink-3); }
    .detail-bar-title--post { display: none; }
    .detail-bar-title--back { display: block; }
    .reading-top-link {
        display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0;
        padding: 8px 10px; font-size: 11px; letter-spacing: .06em; color: var(--art-ink-2);
        border: 1px solid var(--art-line); border-radius: 6px; background: transparent; cursor: pointer;
    }
    .reading-top-link:hover { color: var(--art-accent); border-color: var(--art-accent); }
    .reading-top-link:focus-visible { outline: 2px solid var(--art-accent); outline-offset: 3px; }
    .art-detail-page .art-detail-stage { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
    .art-detail-page .reading-heading {
        display: block; flex: none; width: 100%; max-width: 820px; margin: 0 auto;
        padding: 38px 28px 24px;
    }
    .reading-eyebrow { display: flex; gap: 14px; margin: 0 0 20px; font-size: 10px; letter-spacing: .18em; color: var(--art-ink-3); }
    .reading-eyebrow > span { color: var(--art-accent); opacity: .5; }
    .reading-heading h1 { margin: 0 0 20px; font-family: var(--art-serif); font-size: clamp(26px, 2.6vw, 38px); font-weight: 400; line-height: 1.55; letter-spacing: .04em; color: var(--art-ink); overflow-wrap: anywhere; }
    .reading-metadata, .reading-tags { display: flex; flex-wrap: wrap; gap: 10px 18px; font-size: 11px; line-height: 1.8; color: var(--art-ink-3); }
    .reading-tags { margin-top: 13px; color: var(--art-ink-3); }
    .art-detail-page .art-detail-desc { width: 100%; max-width: 820px; margin: 0 auto; padding: 24px 28px 40px; }
    .art-detail-page #detailDescLabel { display: none; }
    .art-detail-page .art-ai-summary { width: calc(100% - 56px); max-width: 764px; align-self: center; margin: 0 28px; }
    .art-detail-page .art-reading-text :deep(.md-editor-preview) { font-size: 16px; line-height: 1.95; letter-spacing: .02em; }
    .art-detail-page .art-reading-text :deep(.md-editor-preview :is(p, li, blockquote)) { line-height: 1.95; }
    :global(body.theme-light .art-detail-page .art-detail-bar),
    :global(body.theme-light .art-detail-page .art-detail-stage) { background: transparent; }
}
/* 抽屉 / 右侧栏 / 评论区容器的布局样式都在本文件底部（全局 style.css 未改动），此处只留 md-editor 目录树的深度覆写 */

/* 隐藏目录组件自带的指示条 */
.art-detail-catalog :deep(.md-editor-catalog-indicator) {
    display: none !important
}

/* 清掉组件自带的容器缩进，目录树左靠 */
.art-detail-catalog :deep(.md-editor-catalog),
.art-detail-catalog :deep(.md-editor-catalog-container),
.art-detail-catalog :deep(.md-editor-catalog-wrapper) {
    padding-left: 0 !important;
    margin-left: 0 !important
}

/* 只清最外层缩进，嵌套层保留相对缩进 */
.art-detail-catalog :deep(.md-editor-catalog-container > .md-editor-catalog-link) {
    padding-inline-start: 0 !important
}

/* 未选中压暗，当前阅读项高亮左边框 */
.art-detail-catalog :deep(.md-editor-catalog-link span) {
    color: var(--art-ink-4);
    font-size: 12.5px;
    line-height: 1.8;
    letter-spacing: .04em;
    /* 未选中保留同宽透明边框，避免文字跳动 */
    border-left: 2px solid transparent;
    padding-left: 10px;
    transition: color .3s ease, border-color .3s ease
}
@media (hover: hover) and (pointer: fine){.art-detail-catalog :deep(.md-editor-catalog-link span:hover){
    color: var(--art-ink)
}}

.art-detail-catalog :deep(.md-editor-catalog-active > span) {
    color: var(--art-accent);
    border-left-color: var(--art-accent)
}

/* 窄侧栏：分页器与输入区收一收左右留白 */
.art-detail-side-foot,
.art-detail-compose {
    padding-left: 16px;
    padding-right: 16px
}

/* 评论总数小字（项目 style.css 未编入对应的 Tailwind 类） */
.art-detail-comment-total {
    font-size: 10px;
    letter-spacing: .1em;
    white-space: nowrap
}

/* 字数与星级靠右对齐 */
.art-detail-compose-head {
    justify-content: flex-end
}

/* 星级：选中时新点亮的那几颗依次弹一下，颜色同时淡入过去 */
.art-star {
    transition: color .28s ease, transform .45s var(--art-ease)
}

.art-star.is-on {
    animation: art-star-pop .3s var(--art-ease)
}

/* 从第 1 颗往后依次点亮，避免五颗同时弹 */
.art-star.is-on:nth-child(2) {
    animation-delay: 32ms
}

.art-star.is-on:nth-child(3) {
    animation-delay: 64ms
}

.art-star.is-on:nth-child(4) {
    animation-delay: 96ms
}

.art-star.is-on:nth-child(5) {
    animation-delay: 128ms
}

/* 悬停：全局那条是 1.18，偏大，这里收到 1.1 */
@media (hover: hover) and (pointer: fine) {
    .art-star:hover {
        transform: scale(1.1)
    }
}

/* 按下（包括再点一次取消）时先缩一下，保证任何一次点击都有反馈 */
.art-star:active {
    transform: scale(.92);
    transition-duration: .12s
}

@keyframes art-star-pop {
    0% {
        transform: scale(1)
    }

    45% {
        transform: scale(1.16)
    }

    100% {
        transform: scale(1)
    }
}

/* 手机端同样：星级上方留白 6px -> 14px 让出空间，输入区整体下移 8px */
@media (max-width:1023px) {
    .art-detail-compose-head {
        margin-bottom: 14px
    }

    /* 底部留白同步收 8px，方框高度保持原样 */
    .art-detail-compose {
        padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px))
    }
}

/* 发送按钮：提交态图标交叉淡入淡出，圆形尺寸保持不变 */
.art-send {
    display: inline-grid;
    place-items: center
}

.art-send:disabled {
    opacity: .72;
    cursor: not-allowed;
    transform: none
}

.art-send-icon {
    grid-area: 1 / 1;
    transition: opacity .28s ease, transform .28s var(--art-ease)
}

.art-send-icon.is-off {
    opacity: 0;
    transform: scale(.75)
}

/* 提交态文字提示：常驻占位，只切换透明度，避免布局跳动 */
.art-compose-hint {
    margin: 6px 0 0;
    font-size: 11px;
    letter-spacing: .04em;
    color: var(--art-ink-4);
    text-align: right;
    transition: opacity .28s ease
}

.art-compose-hint.is-off {
    opacity: 0
}

/* 手机端空间紧张：目录只在 PC 端出现（抽屉样式见全局 style.css） */
@media (max-width: 1023px) {
    /* 顶栏太窄，标签胶囊会和分类挤成两行：手机上只留分类，标签交给随笔卡片展示 */
    .art-detail-tags .art-tag {
        display: none
    }

    /* 手机上标题独占一行，字数/点击量落到标题下方，长标题不会被角标挤成省略号 */
    .art-detail-meta {
        flex-wrap: wrap;
        align-items: flex-start;
        row-gap: 5px
    }

    .art-detail-title {
        flex: 1 1 100%;
        width: 100%
    }

    .art-detail-tags {
        flex: 1 1 100%;
        gap: 6px
    }

    /* 手机顶栏窄，角标收一收内边距与字距，字数/点击量就不必各占一行 */
    .art-detail-tags .art-chip {
        padding: 3px 8px;
        letter-spacing: .06em
    }
}

/* ---------------- AI 文章摘要卡片 ---------------- */
/* 底色与描边只比背景亮一档；深浅主题各给一组青色，靠变量切换 */
.art-ai-summary {
    --ai-fill: rgba(0, 255, 255, .05);
    --ai-line: rgba(0, 255, 255, .2);
    --ai-glow: rgba(0, 255, 255, .6);
    position: relative;
    /* 桌面端 .art-detail-stage 是定高 flex 列，长正文会把可收缩子项压扁；摘要卡必须禁止收缩，否则被裁掉 */
    flex: none;
    /* 与正文块同宽同缩进，夹在元数据与正文之间 */
    margin: clamp(18px, 3vw, 30px) clamp(18px, 3vw, 30px) 0;
    padding: 14px 18px 16px;
    border: 1px solid var(--ai-line);
    border-radius: 14px;
    background: var(--ai-fill);
    overflow: hidden;
}

/* 出现与收起走同一条过渡：摘要拿不到时是"轻轻收起"，不再是凭空消失 */
.ai-summary-enter-active {
    transition: opacity .45s var(--art-ease), transform .45s var(--art-ease)
}

.ai-summary-leave-active {
    transition: opacity .28s ease, transform .28s ease
}

.ai-summary-enter-from,
.ai-summary-leave-to {
    opacity: 0;
    transform: translateY(6px)
}

/* 顶边一道短高光，给卡片一点“信号在线”的极客感 */
.art-ai-summary::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 62%;
    height: 1px;
    background: linear-gradient(90deg, var(--ai-glow), transparent)
}

.art-ai-summary-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px
}

.art-ai-summary-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--ai-line);
    border-radius: 999px;
    color: var(--art-accent);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .22em;
    line-height: 1.6
}

.art-ai-summary-caption {
    color: var(--art-ink-4);
    font-family: var(--art-mono);
    font-size: 9px;
    letter-spacing: .18em
}

/* 方框高度由幽灵串撑出，正文绝对定位覆盖其上；打字只增字不变高，下方正文不再被顶动 */
.art-ai-summary-body {
    position: relative
}

/* 幽灵串与正文共用同一套排版，行数才会完全一致 */
.art-ai-summary-ghost,
.art-ai-summary-text,
.art-ai-summary-loading {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.9;
    letter-spacing: .02em
}

/* 幽灵串只占位：不可见、不可选、不读屏 */
.art-ai-summary-ghost {
    color: var(--art-ink-2);
    visibility: hidden;
    user-select: none
}

.art-ai-summary-text,
.art-ai-summary-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    color: var(--art-ink-2)
}

/* 打字机光标：只在逐字输出期间出现，输出完随 summaryTyping 一起消失 */
.art-ai-summary-caret {
    display: inline-block;
    margin-left: 2px;
    color: var(--art-accent);
    font-family: var(--art-mono);
    animation: ai-summary-caret 1s step-end infinite
}

/* 加载占位：呼吸灯 + 提示语 */
.art-ai-summary-loading {
    display: flex;
    align-items: center;
    bottom: 0;
    color: var(--art-ink-4)
}

.art-ai-summary-pulse {
    flex: none;
    width: 6px;
    height: 6px;
    margin-right: 10px;
    border-radius: 50%;
    background: var(--art-accent);
    box-shadow: 0 0 8px var(--art-accent);
    animation: ai-summary-breathe 1.6s ease-in-out infinite
}

@keyframes ai-summary-caret {
    50% {
        opacity: 0
    }
}

@keyframes ai-summary-breathe {

    0%,
    100% {
        opacity: .25;
        transform: scale(.8)
    }

    50% {
        opacity: 1;
        transform: scale(1.15)
    }
}

/* 浅色主题：青色压深一档，白底上才有可读的描边与底色 */
:global(body.theme-light .art-ai-summary) {
    --ai-fill: rgba(14, 127, 156, .05);
    --ai-line: rgba(14, 127, 156, .22);
    --ai-glow: rgba(14, 127, 156, .5)
}

@media (prefers-reduced-motion: reduce) {

    .art-ai-summary,
    .art-ai-summary-pulse,
    .art-ai-summary-caret {
        animation: none
    }

    .ai-summary-enter-active,
    .ai-summary-leave-active {
        transition: none
    }

    .art-send-icon,
    .art-compose-hint {
        transition: none
    }

    .art-star.is-on {
        animation: none
    }

    .art-side-skeleton-cover,
    .art-side-skeleton-line {
        animation: none
    }

    .side-reveal-enter-active,
    .side-reveal-leave-active {
        transition: none
    }
}

/* ============ 本轮 PC 端功能新增（只作用于本组件，全局 style.css 未改动） ============ */

/* ---- 右侧栏：精选文章 / 近期最热（PC 端上下平分，各自内部滚动） ---- */
/* 分段容器：头部固定，列表吃掉半区内剩余高度 */
.art-side-group {
    flex: 0 0 auto;
    border-bottom: 1px solid var(--art-line)
}

.art-side-group:last-child {
    border-bottom: 0
}

.art-side-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 4px clamp(16px, 3vw, 28px) 18px;
    list-style: none
}

/* 列表项就是一张图文小卡片：封面 + 标题日期 + 右上箭头 */
.art-side-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: var(--art-ink-2);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    text-align: left;
    cursor: pointer;
    transition: color .3s ease, border-color .3s ease, background-color .3s ease
}

/* 封面：正方形、圆角、cover 裁切；没封面时退回渐变底 + 图标 */
.art-side-item-cover {
    display: grid;
    place-items: center;
    overflow: hidden;
    flex: 0 0 48px;
    width: 48px;
    height: 48px;
    border: 1px solid var(--art-line);
    border-radius: 10px;
    background: linear-gradient(140deg, rgba(0, 255, 255, .09), rgba(0, 255, 255, .01));
    color: var(--art-ink-3);
    font-size: 18px
}

.art-side-item-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform .5s
}

.art-side-item-copy {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 6px
}

/* 标题最多两行，超出省略 */
.art-side-item-title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
    font-weight: 500
}

.art-side-item-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--art-ink-4);
    font-family: var(--art-mono);
    font-size: 10px;
    letter-spacing: .04em
}

.art-side-item-view {
    display: inline-flex;
    align-items: center;
    gap: 4px
}

.art-side-item-arrow {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--art-ink-4);
    transition: color .3s ease, transform .3s ease
}

.art-side-empty {
    padding: 12px 10px;
    color: var(--art-ink-4);
    font-size: 12px;
    text-align: center
}

/* 右侧栏先以稳定骨架占位，数据回来后整组轻微上浮淡入，避免两段内容突然跳出 */
.art-side-skeleton {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 13px 8px;
    list-style: none
}

.art-side-skeleton-cover {
    flex: 0 0 42px;
    width: 42px;
    height: 48px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--art-ink-4) 8%, transparent);
    animation: side-skeleton-pulse 1.4s ease-in-out infinite alternate
}

.art-side-skeleton-copy {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 9px
}

.art-side-skeleton-line {
    width: 88%;
    height: 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--art-ink-4) 8%, transparent);
    animation: side-skeleton-pulse 1.4s ease-in-out infinite alternate
}

.art-side-skeleton-line.is-short {
    width: 48%;
    height: 7px
}

.side-reveal-enter-active,
.side-reveal-leave-active {
    transition: opacity .34s ease, transform .34s cubic-bezier(.4, 0, .2, 1)
}

.side-reveal-enter-from {
    opacity: 0;
    transform: translateY(8px)
}

.side-reveal-leave-to {
    opacity: 0;
    transform: translateY(-4px)
}

@keyframes side-skeleton-pulse {
    to { opacity: .42 }
}

.art-side-group-icon {
    color: var(--art-accent);
    font-size: 13px
}

body.theme-light .art-side-item {
    color: var(--art-ink-2)
}

@media (hover: hover) and (pointer: fine){.art-side-item:hover{
    color: var(--art-ink);
    border-color: var(--art-line);
    background: rgba(255, 255, 255, .03)
}}

/* 悬停时箭头往右上挑一下，封面轻微放大 */
@media (hover: hover) and (pointer: fine){.art-side-item:hover .art-side-item-arrow{
    color: var(--art-accent);
    transform: translate(2px, -2px)
}}

@media (hover: hover) and (pointer: fine){.art-side-item:hover .art-side-item-cover img{
    transform: scale(1.06)
}}

@media (hover: hover) and (pointer: fine){body.theme-light .art-side-item:hover{
    background: rgba(14, 127, 156, .06)
}}

/* ---- 左侧目录列：PC 端可拖拽调宽，无目录时不占列 ---- */
@media (min-width:1024px) {
    /* 目录 + 把手 + 正文 + 固定宽度的右侧栏；目录宽度由 JS 写入 CSS 变量 */
    .art-detail-page .art-detail-body {
        grid-template-columns: minmax(0, 1fr) 280px
    }

    .art-detail-page .art-detail-body--with-catalog {
        grid-template-columns: var(--art-detail-catalog-w, 190px) 8px minmax(0, 1fr) 280px;
        column-gap: 0
    }

    /* 拖到 0 时真的收干净：内边距与滚动条都放在内层 */
    .art-detail-page .art-detail-catalog {
        width: var(--art-detail-catalog-w, 190px);
        min-width: 0;
        padding: 0;
        overflow: hidden
    }

    .art-catalog-inner {
        width: 100%;
        /* 拖窄时保持原宽被裁掉，目录项不折行 */
        min-width: 190px;
        height: 100%;
        padding: 2px 10px 16px 4px;
        overflow-y: auto;
        overscroll-behavior: contain
    }

    /* 拖拽把手：横跨接缝的窄条，悬停 / 拖拽时亮起 */
    .art-detail-grip {
        position: relative;
        width: 8px;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
        z-index: 4
    }

    .art-detail-grip::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 2px;
        height: 44px;
        border-radius: 2px;
        background: var(--art-line-2);
        transform: translate(-50%, -50%);
        transition: height .3s var(--art-ease), background-color .3s ease
    }

    .art-detail-grip:hover::before,
    .art-detail-grip.is-dragging::before {
        height: 76px;
        background: var(--art-accent)
    }

    /* 评论区搬到正文列后，输入区与分页器不能再沿用窄侧栏的 16px，
       否则输入框比评论列表多出 12px，看着像错位 */
    .art-detail-side-foot,
    .art-detail-compose {
        padding-left: clamp(16px, 3vw, 28px);
        padding-right: clamp(16px, 3vw, 28px)
    }

    /* 星级与下方输入区挨得太紧：PC 端输入区整体下移 8px */
    .art-detail-compose-head {
        margin-bottom: 20px
    }

    /* 这 8px 从输入区下方让出来：方框高度与五角星位置都不动，只有输入框+发送按钮下移 */
    .art-detail-compose {
        padding-bottom: 12px
    }

    /* 侧栏整列不滚：两个半区各占 50%，超出部分只在自己区内滚 */
    .art-detail-page .art-detail-side {
        overflow: hidden
    }

    .art-detail-page .art-side-group {
        flex: 1 1 50%;
        min-height: 0;
        display: flex;
        flex-direction: column
    }

    .art-detail-page .art-detail-side-head {
        flex: 0 0 auto
    }

    .art-detail-page .art-side-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain
    }
}

/* 手机端空间紧张：目录只在 PC 出现 */
@media (max-width:1023px) {
    .art-detail-catalog,
    .art-detail-grip {
        display: none
    }
}

/* ---- 换文章（PC / 手机同一套）：顶栏、加载态与新的正文各自淡入一次 ---- */
@keyframes post-swap-in {
    from {
        opacity: 0;
        transform: translateY(20px)
    }

    to {
        opacity: 1;
        transform: none
    }
}

/* 只动顶栏与正文块、不动画板容器本身：stage 里挂着吸底输入区（sticky），整体 transform 会带着它一起位移 */
/* 最扎眼的“瞬间感”来自顶栏标题（它在 stage 之外，原来完全没参与动效），所以这次带上顶栏一起淡入；
   顶栏是常驻元素，靠 postSwapSeq 换 key 才能每次换文章都重播（见 script 里的说明） */
/* 缓动不用 --art-ease：它是 expo-out，前 20% 就走完约 80% 的透明度，看着只闪了 200ms；
   换成全程均匀推进的曲线。时长从 .42s→.7s 仍然偏快（第三轮反馈“太快、过渡不明显”），
   拉到 1.1s 并把位移从 12px 提到 20px，1.1s 里透明度和位移一直在变，切换才看得出是一次过渡 */
.art-detail-page.is-post-swap > .art-detail-bar,
.art-detail-page.is-post-swap .art-detail-stage > .reading-heading,
.art-detail-page.is-post-swap .art-detail-stage > .art-detail-loading,
.art-detail-page.is-post-swap .art-detail-stage > .art-detail-desc,
.art-detail-page.is-post-swap .art-detail-stage > .art-detail-empty-stage {
    /* 不留填充态：动画收尾回到基础值（opacity 1 / transform none），正文不会长期挂着 transform */
    animation: post-swap-in 1.1s cubic-bezier(.4, 0, .2, 1)
}

@media (prefers-reduced-motion: reduce) {

    .art-detail-page.is-post-swap > .art-detail-bar,
    .art-detail-page.is-post-swap .art-detail-stage > .reading-heading,
    .art-detail-page.is-post-swap .art-detail-stage > .art-detail-loading,
    .art-detail-page.is-post-swap .art-detail-stage > .art-detail-desc,
    .art-detail-page.is-post-swap .art-detail-stage > .art-detail-empty-stage {
        animation: none
    }
}

/* 加载占位在 PC 上撑满一屏：换文章（或首屏加载）时评论区不会被上浮进视野，
   否则加载那几百毫秒里会“闪到评论输入框”，正文回来后又跳回正文 */
@media (min-width:1024px) {
    .art-detail-page .art-detail-stage > .art-detail-loading {
        min-height: 100%
    }
}

/* ---- 评论区容器：PC 端跟着正文同列、落在正文最下方 ---- */
.art-detail-comments-panel {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--art-line);
    background-color: rgba(4, 8, 10, .45)
}

body.theme-light .art-detail-comments-panel {
    background-color: #f7f8fa
}

@media (max-width:1023px) {
    /* 精选 / 近期最热是 PC 专属模块：手机上整块不渲染（压过全局基础规则的 display:flex） */
    .art-detail-page .art-detail-side {
        display: none
    }

    /* 评论区并进正文列后由正文列撑满剩余高度，吸底输入区才会落在屏幕底部 */
    .art-detail-page .art-detail-stage {
        flex: 1 0 auto
    }
}
/* 阅读辅助区：目录是轻线索，推荐是小卡片，评论衔接正文的收尾。 */
@media (min-width:1024px) {
    .art-detail-page { --reading-panel: #101e24; --reading-edge: rgba(139, 192, 200, .14); }
    :global(body.theme-light .art-detail-page) { --reading-panel: #fff; --reading-edge: rgba(61, 103, 112, .15); }
    .art-detail-page .art-catalog-inner { padding: 32px 14px 28px 4px; }
    .reading-catalog-head {
        display: flex; justify-content: space-between; align-items: center; margin: 0 0 20px 12px; padding-bottom: 15px;
        border-bottom: 1px solid var(--reading-edge); color: var(--art-ink-2); font-size: 11px; letter-spacing: .16em;
        opacity: 0; visibility: hidden; transform: translateY(-8px); pointer-events: none;
        transition: opacity .22s ease, transform .28s cubic-bezier(.4, 0, .2, 1), visibility 0s linear .28s;
    }
    .reading-catalog-head.is-visible {
        opacity: 1; visibility: visible; transform: none; pointer-events: auto;
        transition-delay: 0s;
    }
    .reading-catalog-head > span:last-child { color: var(--art-ink-4); font: 10px var(--art-mono); letter-spacing: .06em; }
    .art-detail-catalog :deep(.md-editor-catalog-link) { border-left: 1px solid var(--reading-edge); }
    .art-detail-catalog :deep(.md-editor-catalog-link > span) { display: block; padding: 7px 10px; margin: 2px 0; border-left-width: 2px; border-radius: 0 7px 7px 0; font-size: 11px; line-height: 1.65; letter-spacing: .02em; }
    .art-detail-catalog :deep(.md-editor-catalog-active > span) { background: color-mix(in srgb, var(--art-accent) 7%, transparent); color: var(--art-accent); }
    .art-detail-catalog :deep(.md-editor-catalog-link > span:hover) { background: color-mix(in srgb, var(--art-accent) 4%, transparent); }
    .art-detail-page .art-detail-side {
        padding: 28px 0 28px 18px; gap: 18px; overflow-y: auto; overscroll-behavior: contain;
        background: transparent; border-left: 0; backdrop-filter: none; -webkit-backdrop-filter: none;
    }
    .art-detail-page .art-detail-side .art-side-group {
        flex: 0 0 auto; min-width: 0; border: 1px solid var(--reading-edge); border-radius: 16px;
        background: color-mix(in srgb, var(--reading-panel) 70%, transparent);
    }
    .art-detail-side .art-side-group > .art-detail-side-head { padding: 20px 18px 14px; border: 0; gap: 10px; }
    .reading-side-eyebrow { display: block; margin: 0 0 8px; color: var(--art-ink-4); font-size: 9px; letter-spacing: .16em; }
    .art-detail-side .art-detail-side-title { font-family: var(--art-serif); font-size: 15px; font-weight: 400; letter-spacing: .06em; }
    .art-side-group-icon { padding: 9px; border-radius: 50%; background: color-mix(in srgb, var(--art-accent) 6%, transparent); font-size: 12px; }
    .art-detail-page .art-side-group .art-side-list { flex: none; overflow: visible; padding: 0 10px 10px; }
    .art-detail-side .art-side-item { gap: 11px; padding: 13px 8px; border-radius: 10px; border: 1px solid transparent; }
    .art-detail-side .art-side-list li + li { border-top: 1px solid var(--reading-edge); }
    .art-detail-side .art-side-item-cover { width: 42px; height: 48px; flex: 0 0 42px; border: 0; border-radius: 7px; background: linear-gradient(145deg, color-mix(in srgb, var(--art-accent) 8%, transparent), transparent); }
    .reading-side-number { font-family: var(--art-serif); font-size: 23px; font-style: italic; color: var(--art-ink-4); }
    .art-detail-side .art-side-item-title { font-size: 12px; line-height: 1.8; font-weight: 400; }
    .art-detail-side .art-side-item-meta { margin-top: 5px; font-size: 9px; gap: 8px; }
    .art-detail-side .art-side-item-arrow { font-size: 10px; opacity: .5; }
    .art-detail-side .art-side-item:hover, .art-detail-side .art-side-item.is-current { background: color-mix(in srgb, var(--art-accent) 5%, transparent); border-color: var(--reading-edge); }
    .art-detail-side .art-side-item.is-current .art-side-item-title { color: var(--art-accent); }
    .art-detail-page .art-detail-stage > .art-detail-comments-panel {
        --comment-fill: color-mix(in srgb, var(--art-bg) 91%, #8da8ad);
        flex: 0 0 auto; width: calc(100% - 56px); max-width: 700px; margin: 8px auto 56px;
        border: 0; border-radius: 6px; background: var(--comment-fill); box-shadow: none;
    }
    .art-detail-comments-panel > .art-detail-side-head { padding: 24px 28px 12px; align-items: center; border: 0; }
    .art-detail-comments-panel .art-detail-side-title { font-family: var(--art-serif); font-size: 17px; font-weight: 400; letter-spacing: .06em; color: var(--art-ink); }
    .reading-comment-caption { display: block; margin: 6px 0 0; font-size: 11px; line-height: 1.8; letter-spacing: .02em; color: var(--art-ink-3); }
    .art-detail-comments-panel .reading-comment-thread { flex: none; }
    /* 保留空状态的 80px 留白 + 18px 行高 + 28px 上间距，首条短评论也不能收窄默认高度。 */
    .art-detail-comments-panel .art-detail-comments { flex: none; min-height: 126px; overflow: visible; padding: 0 28px; }
    .art-detail-comments-panel .art-comment { padding: 18px 0; gap: 12px; }
    .art-detail-comments-panel .art-comment-avatar { width: 28px; height: 28px; }
    .art-detail-comments-panel .art-comment-head { flex-wrap: wrap; gap: 6px 12px; }
    .art-detail-comments-panel .art-comment-text { font-size: 13px; line-height: 1.9; }
    .art-detail-comments-panel .art-empty { padding: 40px 8px; font-size: 12px; color: var(--art-ink-3); }
    .art-detail-comments-panel .art-detail-compose { padding: 14px 28px 10px; background: var(--comment-fill); border: 0; border-radius: 0 0 6px 6px; }
    .art-detail-comments-panel .art-detail-compose-head { margin-bottom: 22px; }
    .art-detail-comments-panel .art-detail-input { min-width: 0; background: color-mix(in srgb, var(--art-bg) 72%, transparent); border: 1px solid var(--reading-edge); border-radius: 6px; }
    .art-detail-comments-panel .art-send { border-radius: 6px; }
    .art-detail-comments-panel .art-detail-side-foot { padding: 12px 28px; border: 0; }
}

@media (min-width:1024px) and (prefers-reduced-motion: reduce) {
    .reading-catalog-head { transition: none; }
}
</style>
