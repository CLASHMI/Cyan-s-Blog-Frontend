<script>
/* 同一批进入视口的卡片依次错开入场（所有卡片共享计数） */
let revealBatch = 0
let revealBatchTimer = 0
function nextRevealDelay() {
  const delay = Math.min(revealBatch, 5) * 110
  revealBatch++
  clearTimeout(revealBatchTimer)
  revealBatchTimer = setTimeout(() => { revealBatch = 0 }, 120)
  return delay
}
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { usePostLike } from '@/composables/usePostLike'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'
import { handleMediaError } from '@/utils/mediaFallback'
import { apiBase, request } from '@/utils/request'
import { tagHue } from '@/utils/tagColor'
import { firstLine } from '@/utils/text'

const props = defineProps({
  post: Object,
  categories: { type: Array, default: () => [] },
})
const emit = defineEmits(['deleted'])

const authStore = useAuthStore()
const uiStore = useUiStore()
const router = useRouter()
const { liked, likeCount, likePending, toggleLike } = usePostLike(props.post)

/* ---------------- 动效：入场揭示 + 桌面端光斑与倾斜 ---------------- */
const cardEl = ref(null)
const revealed = ref(false)
const inView = ref(false)
let observer = null

const canHoverFine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* 光斑跟随指针，卡片随之轻微倾斜（只在鼠标设备上启用） */
let tiltFrame = 0
function onPointerMove(e) {
  if (e.pointerType !== 'mouse' || !canHoverFine() || reduceMotion()) return
  const el = cardEl.value
  if (!el) return
  cancelAnimationFrame(tiltFrame)
  tiltFrame = requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
    el.style.setProperty('--ry', `${((px - 0.5) * 3).toFixed(2)}deg`)
    el.style.setProperty('--rx', `${((0.5 - py) * 4).toFixed(2)}deg`)
  })
}

function onPointerLeave() {
  const el = cardEl.value
  if (!el) return
  cancelAnimationFrame(tiltFrame)
  el.style.setProperty('--ry', '0deg')
  el.style.setProperty('--rx', '0deg')
}

onMounted(() => {
  const el = cardEl.value
  if (!el || !('IntersectionObserver' in window)) {
    revealed.value = true
    inView.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        inView.value = entry.isIntersecting
        if (entry.isIntersecting && !revealed.value) {
          el.style.setProperty('--reveal-delay', `${nextRevealDelay()}ms`)
          revealed.value = true
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(tiltFrame)
})

/* 拖选文字时不误触详情 */
function openDetail() {
  if (window.getSelection && window.getSelection().toString().length > 0) return
  router.push('/post/' + props.post.id)
}

async function editPost() {
  try {
    const detail = await request(`/blog/detail/${props.post.id}`)
    uiStore.startPostEdit(detail)
    router.push('/admin')
  } catch (e) {}
}

function deletePost() {
  uiStore.openConfirm('确定删除这篇随笔吗？', async () => {
    try {
      await request(`/blog/delete/${props.post.id}`, { method: 'DELETE' })
      uiStore.showToast('随笔已删除')
      emit('deleted')
    } catch (e) {}
  })
}

/* 精选状态以卡片自身数据为准：切换后就地改回来，不整页刷新 */
const isRecommended = computed(() => props.post.isRecommend === 1)
const recommendPending = ref(false)

async function toggleRecommend() {
  if (recommendPending.value) return
  recommendPending.value = true
  try {
    const data = await request(`/blog/recommend/${props.post.id}`, { method: 'POST' })
    props.post.isRecommend = data.isRecommend
    uiStore.showToast(data.isRecommend === 1 ? '已设为站长精选' : '已取消精选')
  } catch (e) {
  } finally {
    recommendPending.value = false
  }
}

function getFullUrl(url) {
  if (!url) return ''
  if (url.startsWith('http') || url.startsWith('data:')) return url
  return apiBase + url
}

function withThumbParams(url) {
  return url + (url.includes('?') ? '&' : '?') + 'imageView2/2/w/800/q/85'
}

function categoryName(id) {
  if (id === null || id === undefined || id === '') return ''
  const hit = props.categories.find((item) => String(item.id) === String(id))
  return hit ? hit.name : ''
}

const title = computed(() => props.post.title || firstLine(props.post.content) || '无标题随笔')
const catName = computed(() => props.post.categoryName || categoryName(props.post.categoryId))
const tagNames = computed(() => (Array.isArray(props.post.tagNames) ? props.post.tagNames : []))
const date = computed(() => (props.post.createTime ? props.post.createTime.substring(0, 10) : ''))
/* 兼容历史数据：cover_image 可能是 JSON 数组字符串，取第一个有效地址 */
function normalizeCover(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text)
      if (Array.isArray(arr)) return arr.find((item) => typeof item === 'string' && item) || ''
    } catch (e) {}
  }
  return text
}

const coverUrl = computed(() => {
  const cover = normalizeCover(props.post.coverImage)
  return cover ? getFullUrl(cover) : ''
})
const wordCount = computed(() => (props.post.content ? props.post.content.length : 0))
const readTime = computed(() => Math.max(1, Math.ceil(wordCount.value / 400)))
const viewCount = computed(() => Number(props.post.viewCount) || 0)
/* 评分：averageRating 为空或 0 一律按「无评分」处理，卡片上给出明确交代 */
const ratingValue = computed(() => {
  const value = Number(props.post.averageRating)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const hasRating = computed(() => ratingValue.value > 0)
const ratingText = computed(() => (hasRating.value ? ratingValue.value.toFixed(1) : '无评分'))

/* 卡片摘要：洗掉图片/链接/HTML 与行首 Markdown 标记，只留纯文本 */
const cleanExcerpt = computed(() =>
  String(props.post.content || '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim(),
)

/* ---------------- 无图随笔：纯 CSS 抽象封面 ---------------- */
const isMediaLess = computed(() => !coverUrl.value)

/* 16 套调色板，每套 4 团高亮光斑 */
const ABSTRACT_PALETTES = [
  /* 赛博朋克霓虹 */
  { base: '#12061f', glows: ['rgba(255, 42, 138, .62)', 'rgba(0, 231, 255, .56)', 'rgba(122, 60, 255, .54)', 'rgba(255, 214, 0, .34)'] },
  /* 赛博蓝紫 */
  { base: '#050b1c', glows: ['rgba(56, 189, 248, .58)', 'rgba(129, 140, 248, .54)', 'rgba(236, 72, 153, .42)', 'rgba(14, 165, 233, .46)'] },
  /* 极光绿 */
  { base: '#04121a', glows: ['rgba(52, 211, 153, .58)', 'rgba(45, 212, 191, .52)', 'rgba(125, 211, 252, .46)', 'rgba(167, 139, 250, .4)'] },
  /* 极光紫粉 */
  { base: '#0d0620', glows: ['rgba(168, 85, 247, .58)', 'rgba(244, 114, 182, .52)', 'rgba(56, 189, 248, .44)', 'rgba(129, 140, 248, .46)'] },
  /* 酸性荧光 */
  { base: '#101a02', glows: ['rgba(163, 230, 53, .6)', 'rgba(250, 204, 21, .52)', 'rgba(34, 211, 238, .4)', 'rgba(132, 204, 22, .5)'] },
  /* 酸性洋红 */
  { base: '#1a0518', glows: ['rgba(255, 0, 128, .56)', 'rgba(190, 242, 100, .44)', 'rgba(255, 214, 10, .42)', 'rgba(217, 70, 239, .52)'] },
  /* 莫兰迪静谧 */
  { base: '#1a1a1f', glows: ['rgba(148, 163, 184, .46)', 'rgba(196, 181, 253, .42)', 'rgba(94, 234, 212, .36)', 'rgba(251, 207, 232, .32)'] },
  /* 莫兰迪陶土 */
  { base: '#1c1512', glows: ['rgba(217, 119, 87, .5)', 'rgba(233, 196, 106, .44)', 'rgba(148, 163, 184, .36)', 'rgba(212, 165, 165, .4)'] },
  /* 深海珊瑚 */
  { base: '#03151c', glows: ['rgba(0, 180, 216, .56)', 'rgba(255, 111, 97, .5)', 'rgba(72, 202, 228, .44)', 'rgba(144, 224, 239, .36)'] },
  /* 落日熔金 */
  { base: '#1d0a06', glows: ['rgba(255, 122, 0, .58)', 'rgba(255, 61, 0, .5)', 'rgba(255, 214, 102, .46)', 'rgba(236, 72, 153, .38)'] },
  /* 樱花暮色 */
  { base: '#1a0d16', glows: ['rgba(251, 113, 133, .54)', 'rgba(217, 70, 239, .44)', 'rgba(165, 180, 252, .46)', 'rgba(253, 186, 116, .4)'] },
  /* 森林苔原 */
  { base: '#08160f', glows: ['rgba(74, 222, 128, .54)', 'rgba(45, 212, 191, .46)', 'rgba(163, 230, 53, .42)', 'rgba(20, 184, 166, .46)'] },
  /* 电光柠檬 */
  { base: '#141a00', glows: ['rgba(223, 255, 0, .56)', 'rgba(34, 211, 238, .44)', 'rgba(132, 204, 22, .46)', 'rgba(250, 250, 250, .24)'] },
  /* 午夜蓝调 */
  { base: '#040a18', glows: ['rgba(37, 99, 235, .58)', 'rgba(59, 130, 246, .5)', 'rgba(147, 51, 234, .46)', 'rgba(6, 182, 212, .44)'] },
  /* 霓虹蜜桃 */
  { base: '#1b0a12', glows: ['rgba(255, 138, 101, .56)', 'rgba(255, 82, 182, .5)', 'rgba(255, 202, 40, .46)', 'rgba(124, 77, 255, .44)'] },
  /* 冰川玻璃 */
  { base: '#061318', glows: ['rgba(186, 230, 253, .52)', 'rgba(94, 234, 212, .46)', 'rgba(147, 197, 253, .44)', 'rgba(216, 180, 254, .4)'] },
]

/* 同一篇文章的 hash 稳定不变，刷新后封面不会跳色 */
function hashText(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

/* 按 hash 派生的稳定伪随机序列 */
function seededRandom(seed) {
  let state = (seed || 1) >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const abstractSeed = computed(() =>
  hashText(`${props.post.id ?? ''}|${props.post.title || props.post.content || ''}`),
)

/* 水印取标题首字，没有标题就退回 ID */
const abstractMark = computed(() => {
  const text = String(title.value || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : `#${props.post.id ?? ''}`
})

const abstractMediaStyle = computed(() => {
  if (!isMediaLess.value) return null
  const seed = abstractSeed.value
  const palette = ABSTRACT_PALETTES[seed % ABSTRACT_PALETTES.length]
  const rand = seededRandom(seed + 17)
  const angle = Math.round(rand() * 360)
  /* 4 团随机径向渐变，由伪元素做模糊融合 */
  const blobs = palette.glows.map((color) => {
    const x = Math.round(2 + rand() * 96)
    const y = Math.round(2 + rand() * 96)
    const rx = Math.round(30 + rand() * 42)
    const ry = Math.round(26 + rand() * 38)
    return `radial-gradient(${rx}% ${ry}% at ${x}% ${y}%, ${color}, rgba(0, 0, 0, 0) 68%)`
  })
  return {
    '--art-abstract-angle': `${angle}deg`,
    '--art-abstract-blur': `${Math.round(16 + rand() * 18)}px`,
    '--art-abstract-mesh': [
      ...blobs,
      `linear-gradient(${angle}deg, ${palette.base} 0%, rgba(5, 8, 12, .92) 55%, ${palette.base} 100%)`,
    ].join(', '),
    backgroundColor: palette.base,
  }
})
</script>

<template>
    <article ref="cardEl" class="art-blog-card" :class="{ 'is-revealed': revealed, 'is-inview': inView }"
        @click="openDetail" @pointermove="onPointerMove" @pointerleave="onPointerLeave">
        <span class="art-blog-spot" aria-hidden="true"></span>
        <div class="art-blog-media" :class="isMediaLess ? 'art-blog-media--abstract' : ''"
            :style="abstractMediaStyle">
            <template v-if="isMediaLess">
                <span class="art-blog-abstract-mark" aria-hidden="true">{{ abstractMark }}</span>
                <span class="art-blog-abstract-id" aria-hidden="true">NO.{{ post.id }}</span>
            </template>
            <img v-else :src="withThumbParams(coverUrl)" alt="" loading="lazy" @error="handleMediaError">
        </div>
        <div class="art-blog-info">
            <header class="art-blog-head">
                <div class="art-blog-meta-top">
                    <span v-if="date" class="meta-tag"><i class="ph-bold ph-calendar-blank"></i> {{ date }}</span>
                    <span v-if="catName" class="meta-tag"><i class="ph-bold ph-folder-open"></i> {{ catName }}</span>
                    <span class="meta-tag"><i class="ph-bold ph-text-aa"></i> {{ wordCount }} 字 / 约 {{ readTime }}
                        分钟</span>
                    <span class="meta-tag" title="点击量"><i class="ph-bold ph-eye"></i> {{ viewCount }}</span>
                </div>
                <h3 class="art-blog-title">{{ title }}</h3>
            </header>
            <p v-if="cleanExcerpt" class="art-blog-excerpt">{{ cleanExcerpt }}</p>
            <footer class="art-blog-foot">
                <div class="art-card-stats">
                    <span class="flex items-center gap-1.5 transition-colors"
                        :class="[liked ? 'is-liked' : '', likePending ? 'pointer-events-none opacity-60' : '']"
                        @click.stop="toggleLike"><i class="ph-fill ph-heart"></i>
                        {{ likeCount }}</span>
                </div>
                <span class="art-card-rating" :class="{ 'is-empty': !hasRating }"
                    :title="hasRating ? ratingText + ' 分（满分 5 分）' : '这篇随笔还没有人打分'">
                    <i class="ph-fill ph-star"></i>{{ ratingText }}
                </span>
                <div v-if="tagNames.length" class="art-blog-tags">
                    <span v-for="name in tagNames" :key="name" class="art-chip art-tag"
                        :style="{ '--tag-h': tagHue(name) + 'deg' }">{{ name }}</span>
                </div>
                <div class="art-blog-foot-right">
                    <div v-if="authStore.isGlobalAdmin" class="art-card-actions">
                        <i class="ph-push-pin"
                            :class="[isRecommended ? 'ph-fill is-recommend' : 'ph-bold', recommendPending ? 'pointer-events-none opacity-60' : '']"
                            :title="isRecommended ? '取消站长精选' : '设为站长精选'" @click.stop="toggleRecommend"></i>
                        <i class="ph-bold ph-pencil-simple" @click.stop="editPost"></i>
                        <i class="ph-bold ph-trash" @click.stop="deletePost"></i>
                    </div>
                    <span class="art-blog-more">继续阅读 <i class="ph-bold ph-arrow-right"></i></span>
                </div>
            </footer>
        </div>
    </article>
</template>

<style scoped>
/* 已精选：跟主题青走；未精选与另外两个图标同为灰。
   带上 .art-blog-card 前缀是为了压过全局 .art-card-actions i:hover 的 color:#fff */
.art-blog-card .art-card-actions i.is-recommend {
    color: var(--art-accent)
}
</style>
