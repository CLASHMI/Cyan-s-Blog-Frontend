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
import { request } from '@/utils/request'
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

/* 移动端滚的是 .art-detail-body，桌面端滚动容器是左侧舞台，两个都监听同一套逻辑 */
function onDetailScroll(event) {
  const scroller = event.currentTarget
  const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
  showDetailTop.value =
    scroller.scrollTop > DETAIL_TOP_THRESHOLD && remaining > DETAIL_BOTTOM_HIDE_GAP
}

/* 随笔目录监听左栏滚动容器，用于高亮当前标题 */
const scrollElement = ref(null)
onMounted(() => {
  scrollElement.value = document.getElementById('detail-scroll-container')
  loadSidePosts()
})

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

/* MdPreview 解析完正文会把标题清单回传，用它判断这篇到底有没有目录 */
function onGetCatalog(list) {
  catalogList.value = Array.isArray(list) ? list : []
}

/* ---------------- 目录列宽拖拽（右侧栏宽度固定，不参与拖拽） ---------------- */
const CATALOG_MAX_W = 340
/* 正文保底宽度：拖到极限时目录被压到 0，也不会把正文挤没 */
const CONTENT_MIN_W = 360
/* 目录与正文之间的把手占一条 8px 列，与 .art-detail-grip 的 width 一致 */
const GRIP_W = 8
/* 右侧栏固定宽度，与 .art-detail-page .art-detail-body 的 320px 保持一致 */
const SIDE_FIXED_W = 320
const catalogWidth = ref(220)
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
  }
}

function openPost(id) {
  if (id === null || id === undefined) return
  router.push('/post/' + id)
}

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

/* 详情从随笔流进入，优先回到来源页 */
function goBack() {
  if (router.options.history.state.back) router.back()
  else router.push('/blog')
}

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
  } finally {
    if (seq === detailSeq) loadingDetail.value = false
  }
}

/* 只有用户手动翻页才走 View Transition，首屏直接渲染 */
async function loadComments(id, page = 1, animated = false) {
  if (id === null || id === undefined) return
  const seq = ++commentsSeq
  commentsLoading.value = true
  try {
    const data = await request(`/comment/list?postId=${id}&pageNum=${page}&pageSize=10`)
    if (seq !== commentsSeq) return
    const records = data.records || data
    const total = data.total !== undefined ? data.total : records.length || 0

    const applyComments = async () => {
      comments.value = records
      currentCommentPage.value = page
      commentTotal.value = total
      totalCommentPages.value = Math.max(1, Math.ceil(total / 10))
      commentsStatusMessage.value = records.length ? '' : '暂无评论，快来抢沙发吧。'
      await nextTick()
    }
    if (animated && document.startViewTransition) document.startViewTransition(applyComments)
    else await applyComments()
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
  loadComments(postId.value, currentCommentPage.value + delta, true)
}

function setRating(value) {
  rating.value = value
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
    loadComments(postId.value, 1)
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
  if (endResize) endResize()
  summarySeq += 1
  stopSummaryTyping()
  stopSummaryWait()
})

/* 路由按 path 重建组件，这里顺带兜住同组件换 id 的情况 */
watch(
  postId,
  (id) => {
    detail.value = null
    detailError.value = ''
    catalogList.value = []
    /* 从侧栏列表换一篇是同一个组件实例，正文的滚动位置要手动归零 */
    if (detailBodyEl.value) detailBodyEl.value.scrollTop = 0
    if (scrollElement.value) scrollElement.value.scrollTop = 0
    setRating(0)
    commentInput.value = ''
    loadDetail(id)
    loadComments(id, 1)
  },
  { immediate: true },
)
</script>

<template>
    <section id="detailView" class="art-detail-page">
        <div class="art-detail-bar">
            <div class="art-detail-bar-left">
                <button @click="goBack" class="art-icon-btn art-icon-btn-sm" title="返回上一页"><i
                        class="ph-bold ph-arrow-left"></i></button>
                <div class="art-detail-meta">
                    <h3 id="detailTitle" class="art-detail-title">{{ detailTitle }}</h3>
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
            <button id="detailDownloadBtn" @click.stop="downloadMarkdown" class="art-detail-like"
                title="下载 Markdown 文档" aria-label="下载 Markdown 文档"><i
                    class="ph-bold ph-download-simple"></i></button>
            <button id="detailLikeBtn" @click.stop="toggleLike" class="art-detail-like" title="点赞"
                :class="[liked ? 'is-liked' : '', likePending ? 'pointer-events-none opacity-60' : '']"><i
                    class="ph-fill ph-heart"></i> {{ likeCount }}</button>
        </div>

        <div ref="detailBodyEl" class="art-detail-body"
            :class="{ 'art-detail-body--with-catalog': hasCatalog }"
            :style="{ '--art-detail-catalog-w': catalogWidth + 'px' }" @scroll.passive="onDetailScroll">
            <!-- 目录列（仅 PC）：没提取到目录时不占列，左侧完全留白 -->
            <section v-if="hasCatalog" class="art-detail-catalog">
                <div class="art-catalog-inner">
                    <MdCatalog editor-id="blog-preview-id" :scroll-element="scrollElement" :theme="mdTheme" />
                </div>
            </section>
            <button v-if="hasCatalog" type="button" class="art-detail-grip" :class="{ 'is-dragging': resizing }"
                @pointerdown="startCatalogResize" title="拖动调整目录宽度" aria-label="拖动调整目录宽度"></button>

            <div id="detail-scroll-container" class="art-detail-stage" @scroll.passive="onDetailScroll">
                <!-- 详情未回来前用等高占位撑住画板，避免结构先塌后撑 -->
                <div v-if="loadingDetail" class="art-detail-loading">
                    <i class="ph-bold ph-spinner-gap animate-spin"></i>
                </div>
                <div v-else-if="detailError" class="art-detail-empty-stage">
                    <i class="ph-light ph-wind art-detail-empty-icon text-zinc-600" aria-hidden="true"></i>
                    <p class="art-detail-empty-text text-zinc-600">{{ detailError }}</p>
                </div>
                <template v-else>
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
                                :theme="mdTheme" @onGetCatalog="onGetCatalog" />
                        </div>
                    </div>
                    <div v-if="showEmptyStage" class="art-detail-empty-stage">
                        <i class="ph-light ph-wind art-detail-empty-icon text-zinc-600" aria-hidden="true"></i>
                        <p class="art-detail-empty-text text-zinc-600">只有风经过... 这篇随笔没有留下正文。</p>
                    </div>
                </template>
                <section class="art-detail-comments-panel">
                    <div class="art-detail-side-head">
                        <h4 class="art-detail-side-title">评论区</h4>
                        <div class="flex items-center gap-3">
                            <span id="detailCommentTotal"
                                class="art-detail-comment-total font-mono text-zinc-500">共 {{ commentTotal }} 条</span>
                            <div id="detailScore" class="art-detail-score">
                                <i class="ph-fill ph-star"></i>
                                <span id="detailRating">{{ detailRating }}</span>
                            </div>
                        </div>
                    </div>

                    <div id="detailCommentList" class="art-comment-list art-detail-comments">
                        <div v-for="comment in comments" :key="comment.id" class="art-comment">
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
                        <div v-if="commentsLoading" class="art-empty"><i
                                class="ph-bold ph-spinner-gap animate-spin"></i> 评论加载中...</div>
                        <div v-else-if="commentsStatusMessage" class="art-empty">{{ commentsStatusMessage }}</div>
                    </div>

                    <div class="art-detail-side-foot">
                        <button @click="changeCommentPage(-1)" :disabled="!!detail && currentCommentPage <= 1"
                            class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-left"></i></button>
                        <span id="detailCommentPageInfo" class="art-pager-info">{{ commentPageInfoText }}</span>
                        <button @click="changeCommentPage(1)" :disabled="!!detail && currentCommentPage >= totalCommentPages"
                            class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
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
                                autocomplete="off" placeholder="添加一条评论..." class="art-detail-input">
                            <button @click="submitComment" :disabled="submitting" class="art-send">
                                <i class="ph-bold ph-spinner-gap animate-spin art-send-icon"
                                    :class="{ 'is-off': !submitting }"></i>
                                <i class="ph-bold ph-paper-plane-right art-send-icon" :class="{ 'is-off': submitting }"></i>
                            </button>
                        </div>
                        <p class="art-compose-hint" :class="{ 'is-off': !submitting }">发送中...</p>
                    </div>
                </section>
            </div>

            <aside class="art-detail-side">
                <section class="art-side-group">
                    <div class="art-detail-side-head">
                        <h4 class="art-detail-side-title">精选文章</h4>
                        <i class="ph-fill ph-push-pin art-side-group-icon"></i>
                    </div>
                    <ul class="art-side-list">
                        <li v-for="post in sideRecommend" :key="post.id">
                            <button type="button" class="art-side-item" @click="openPost(post.id)">
                                <span class="art-side-item-title">{{ post.title || firstLine(post.content) || '无标题随笔' }}</span>
                                <span class="art-side-item-meta" title="点击量"><i class="ph-bold ph-eye"></i>
                                    {{ post.viewCount || 0 }}</span>
                            </button>
                        </li>
                        <li v-if="!sideRecommend.length" class="art-side-empty">还没有精选文章</li>
                    </ul>
                </section>
                <section class="art-side-group">
                    <div class="art-detail-side-head">
                        <h4 class="art-detail-side-title">近期最热</h4>
                        <i class="ph-bold ph-fire art-side-group-icon"></i>
                    </div>
                    <ul class="art-side-list">
                        <li v-for="post in sideHot" :key="post.id">
                            <button type="button" class="art-side-item" @click="openPost(post.id)">
                                <span class="art-side-item-title">{{ post.title || firstLine(post.content) || '无标题随笔' }}</span>
                                <span class="art-side-item-meta" title="点击量"><i class="ph-bold ph-eye"></i>
                                    {{ post.viewCount || 0 }}</span>
                            </button>
                        </li>
                        <li v-if="!sideHot.length" class="art-side-empty">暂无数据</li>
                    </ul>
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
}

/* ============ 本轮 PC 端功能新增（只作用于本组件，全局 style.css 未改动） ============ */

/* ---- 右侧栏：精选文章 / 近期最热 ---- */
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

.art-side-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--art-ink-2);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    text-align: left;
    cursor: pointer;
    transition: color .3s ease, border-color .3s ease, background-color .3s ease
}

.art-side-item-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis
}

.art-side-item-meta {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--art-ink-4);
    font-family: var(--art-mono);
    font-size: 11px;
    letter-spacing: .04em
}

.art-side-empty {
    padding: 12px 10px;
    color: var(--art-ink-4);
    font-size: 12px;
    text-align: center
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

@media (hover: hover) and (pointer: fine){body.theme-light .art-side-item:hover{
    background: rgba(14, 127, 156, .06)
}}

/* ---- 左侧目录列：PC 端可拖拽调宽，无目录时不占列 ---- */
@media (min-width:1024px) {
    /* 目录 + 把手 + 正文 + 固定宽度的右侧栏；目录宽度由 JS 写入 CSS 变量 */
    .art-detail-page .art-detail-body {
        grid-template-columns: minmax(0, 1fr) 320px
    }

    .art-detail-page .art-detail-body--with-catalog {
        grid-template-columns: var(--art-detail-catalog-w, 220px) 8px minmax(0, 1fr) 320px;
        column-gap: 0
    }

    /* 拖到 0 时真的收干净：内边距与滚动条都放在内层 */
    .art-detail-page .art-detail-catalog {
        width: var(--art-detail-catalog-w, 220px);
        min-width: 0;
        padding: 0;
        overflow: hidden
    }

    .art-catalog-inner {
        width: 100%;
        /* 拖窄时保持原宽被裁掉，目录项不折行 */
        min-width: 220px;
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

    /* 两个列表可能比一屏长，侧栏自己滚 */
    .art-detail-page .art-detail-side {
        overflow-y: auto
    }
}

/* 手机端空间紧张：目录只在 PC 出现 */
@media (max-width:1023px) {
    .art-detail-catalog,
    .art-detail-grip {
        display: none
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
</style>
