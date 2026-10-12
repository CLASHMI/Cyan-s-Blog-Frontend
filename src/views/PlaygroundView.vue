<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'
import { request } from '@/utils/request'

const authStore = useAuthStore()
const uiStore = useUiStore()
const router = useRouter()

/* ---------------- 列表 ----------------
   后端约定：GET /resource/list?pageNum=&pageSize=&keyword=&sortStrategy=
   keyword 同时模糊匹配 title 与 description；sortStrategy=1 按热度(like_count)，缺省按最新(create_time) */
const PAGE_SIZE = 24
const SORT_OPTIONS = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' },
]

const resources = ref([])
const total = ref(0)
const loading = ref(true)
const statusMessage = ref('')
const loadFailed = ref(false)
const keyword = ref('')
const sortStrategy = ref('latest')
const currentPage = ref(1)
const totalPages = ref(1)
/* 列表内容换代时自增，作为列表的 key：重挂载会按序重播卡片入场动效 */
const listRevision = ref(0)

const pageInfo = computed(() => `第 ${currentPage.value} / ${totalPages.value} 页`)

let listSeq = 0
let searchTimer = null
let bumpTimer = null

async function loadResources() {
  const seq = ++listSeq
  loading.value = true
  loadFailed.value = false
  try {
    const params = new URLSearchParams({ pageNum: currentPage.value, pageSize: PAGE_SIZE })
    const kw = keyword.value.trim()
    if (kw) params.append('keyword', kw)
    if (sortStrategy.value === 'hot') params.append('sortStrategy', '1')

    const data = await request(`/resource/list?${params.toString()}`)
    if (seq !== listSeq) return
    const records = Array.isArray(data?.records) ? data.records : Array.isArray(data) ? data : []
    resources.value = records
    total.value = Number.isFinite(data?.total) ? data.total : records.length
    totalPages.value = Math.max(1, Math.ceil((Number(data?.total) || records.length) / PAGE_SIZE))
    statusMessage.value = records.length ? '' : '这里空空如也哦。'
    syncLikeCounts()
    /* 排序 / 翻页 / 搜索换了内容：让卡片重新入场，不要硬切 */
    if (records.length) listRevision.value += 1
    /* 页码越界（例如删到页尾）时回退到最后一页重查 */
    if (!records.length && currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value
      loadResources()
    }
  } catch (e) {
    if (seq !== listSeq) return
    resources.value = []
    total.value = 0
    totalPages.value = 1
    loadFailed.value = true
    statusMessage.value = '资源暂时取不到，稍后再来看看。'
  } finally {
    if (seq === listSeq) loading.value = false
  }
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadResources()
  }, 260)
}

function setSort(value) {
  if (sortStrategy.value === value) return
  clearTimeout(searchTimer)
  sortStrategy.value = value
  currentPage.value = 1
  loadResources()
}

function changePage(delta) {
  if (loading.value) return
  clearTimeout(searchTimer)
  if (currentPage.value + delta < 1 || currentPage.value + delta > totalPages.value) return
  currentPage.value += delta
  loadResources()
}

/* ---------------- 点赞 ----------------
   后端约定：POST /resource/like/{id}
   成功 -> 200；重复点赞由联合唯一索引兜底，返回非 200 并带「已点过赞」提示 */
const likedIds = ref({})
const likeCounts = ref({})
const likePending = ref({})
const bumpId = ref('')

function likedStorageKey() {
  return `anim_liked_resources_${authStore.user?.uuid || 'guest'}`
}

function readLikedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(likedStorageKey()) || '[]'))
  } catch (e) {
    return new Set()
  }
}

function writeLikedIds() {
  const ids = Object.keys(likedIds.value).filter((key) => likedIds.value[key])
  try {
    localStorage.setItem(likedStorageKey(), JSON.stringify(ids))
  } catch (e) {}
}

/* 列表刷新后用服务端数据对齐计数，并保留本地已点赞标记 */
function syncLikeCounts() {
  const counts = {}
  const liked = readLikedIds()
  const likedMap = { ...likedIds.value }
  for (const item of resources.value) {
    const sid = String(item.id)
    counts[sid] = Number(item.likeCount) || 0
    if (liked.has(sid)) likedMap[sid] = true
  }
  likeCounts.value = counts
  likedIds.value = likedMap
}

function isLiked(item) {
  return !!likedIds.value[String(item.id)]
}

function likeCountOf(item) {
  const sid = String(item.id)
  return sid in likeCounts.value ? likeCounts.value[sid] : Number(item.likeCount) || 0
}

async function toggleResourceLike(item) {
  const id = item?.id
  if (id === null || id === undefined) return
  const sid = String(id)
  if (likePending.value[sid]) return

  const wasLiked = !!likedIds.value[sid]
  likePending.value = { ...likePending.value, [sid]: true }
  try {
    await request(wasLiked ? `/resource/unlike/${id}` : `/resource/like/${id}`, {
      method: 'POST',
      silent: true,
    })
    likedIds.value = { ...likedIds.value, [sid]: !wasLiked }
    likeCounts.value = {
      ...likeCounts.value,
      [sid]: wasLiked ? Math.max(0, likeCountOf(item) - 1) : likeCountOf(item) + 1,
    }
    /* 只在点赞成功时播一次 +1 微动效 */
    if (!wasLiked) {
      bumpId.value = sid
      clearTimeout(bumpTimer)
      bumpTimer = setTimeout(() => {
        if (bumpId.value === sid) bumpId.value = ''
      }, 900)
    }
    writeLikedIds()
    uiStore.showToast(wasLiked ? '已取消点赞' : '点赞成功！')
  } catch (e) {
    const msg = e?.message || ''
    if (!wasLiked && (msg.includes('点过赞') || msg.includes('已点赞'))) {
      /* 唯一索引冲突：服务端认为已点赞，本地同步成已赞状态即可 */
      likedIds.value = { ...likedIds.value, [sid]: true }
      writeLikedIds()
      uiStore.showToast('已经点过赞啦')
    } else {
      uiStore.showToast(msg || (wasLiked ? '取消点赞失败，稍后再试' : '点赞失败，稍后再试'), false)
    }
  } finally {
    likePending.value = { ...likePending.value, [sid]: false }
  }
}

/* ---------------- 打开资源 ---------------- */
function normalizeUrl(url) {
  const text = String(url || '').trim()
  if (!text) return ''
  /* 站内绝对路径（/games/xx.html）和自带协议（https:、mailto:…）都原样用，其余补 https:// */
  if (text.startsWith('/') || text.startsWith('#')) return text
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  return `https://${text}`
}

function openResource(item) {
  const href = normalizeUrl(item?.url)
  if (!href) {
    uiStore.showToast('这个资源没有可用链接', false)
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

function hostOf(url) {
  const text = String(url || '').trim()
  if (!text) return ''
  /* 站内资源没有域名，直接标出来 */
  if (text.startsWith('/')) return '本站页面'
  const href = normalizeUrl(text)
  if (!href) return ''
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch (e) {
    return ''
  }
}

/* ---------------- 站长编辑 / 删除 ----------------
   杂物柜本身就是资源列表，站长直接在卡片上改删，控制台只保留表单 */
function editResource(item) {
  uiStore.startResourceEdit({
    id: item.id,
    title: item.title,
    url: item.url,
    coverImage: item.coverImage,
    description: item.description,
  })
  router.push('/admin')
}

function deleteResource(item) {
  uiStore.openConfirm(`确定删除「${item.title}」这个资源吗？`, async () => {
    try {
      await request(`/resource/delete/${item.id}`, { method: 'DELETE' })
      uiStore.showToast('资源已删除')
      loadResources()
    } catch (e) {}
  })
}

/* 默认标识与外观只依赖资源标识：随机感，但刷新、搜索和排序不会变脸。
   不识别具体工具，不为单个链接配置封面。上传的图片一律作为小 Logo 展示。 */
const MARKS = [
  'M12 3 14.5 9.5 21 12 14.5 14.5 12 21 9.5 14.5 3 12 9.5 9.5Z',
  'M12 3 21 8v9l-9 5-9-5V8Zm0 10v9M3 8l9 5 9-5M7.5 5.5l9 5V15',
  'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM8 12v8m8-16v8',
  'M5 4h4v5H4V5a1 1 0 0 1 1-1Zm10 0h4a1 1 0 0 1 1 1v4h-5ZM4 15h5v5H5a1 1 0 0 1-1-1Zm11 0h5v4a1 1 0 0 1-1 1h-4Z',
  'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4 18.4 5.6',
  'M5 18C2 8 9 3 20 4c1 11-5 17-13 14Zm0 3L16 9',
  'M8 4a4 4 0 0 1 4 4v8a4 4 0 1 1-4-4h8a4 4 0 1 1-4 4V8a4 4 0 1 1 4 4H8a4 4 0 1 1 0-8Z',
  'M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
]
const failedCovers = ref(new Set())
function hashIdentity(value) {
  let hash = 2166136261
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return (hash ^ (hash >>> 16)) >>> 0
}
const displayResources = computed(() => resources.value.map((item, index) => {
  const seed = hashIdentity(item.id ?? item.url ?? item.title)
  const cover = String(item.coverImage || '').trim()
  return {
    ...item,
    href: normalizeUrl(item.url),
    host: hostOf(item.url),
    cover: failedCovers.value.has(cover) ? '' : cover,
    mark: MARKS[seed % MARKS.length],
    ordinal: String((currentPage.value - 1) * PAGE_SIZE + index + 1).padStart(2, '0'),
    style: {
      '--item-delay': `${Math.min(index, 8) * 60}ms`,
      '--orbit-duration': `${8 + (seed % 5)}s`,
      '--orbit-phase': `-${seed % 9}s`,
    },
  }
}))

// 共用一个观察器：离屏暂停持续动效，重新进入视口不重复播放入场。
const pageVisible = ref(!document.hidden)
let visibilityObserver
const vInView = {
  mounted(el) {
    visibilityObserver ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('is-in-view', entry.isIntersecting)
        if (entry.isIntersecting) entry.target.classList.add('has-entered')
      }
    }, { threshold: 0.05 })
    visibilityObserver.observe(el)
  },
  unmounted(el) {
    visibilityObserver?.unobserve(el)
  },
}
function onPageVisibility() {
  pageVisible.value = !document.hidden
}

const boardEmpty = computed(() => !loading.value && !resources.value.length)
let disposed = false
onMounted(async () => {
  document.addEventListener('visibilitychange', onPageVisibility)
  await authStore.ensureAuth()
  if (!disposed) loadResources()
})
onUnmounted(() => {
  disposed = true
  visibilityObserver?.disconnect()
  document.removeEventListener('visibilitychange', onPageVisibility)
  clearTimeout(searchTimer)
  clearTimeout(bumpTimer)
  listSeq += 1
})
</script>

<template>
  <section id="playgroundView" class="art-section oae" aria-label="杂物柜">
    <div class="art-sec-head">
      <div>
        <h2 class="art-sec-title">杂物柜</h2>
        <p class="art-sec-note">收藏的网站、工具与零碎资源 <span class="oae-total">· 共 {{ total }} 件</span></p>
      </div>
      <p class="art-sec-meta">Odds &amp; Ends</p>
    </div>

    <div class="oae-toolbar">
      <label class="art-search oae-search">
        <i class="ph-bold ph-magnifying-glass" aria-hidden="true"></i>
        <input v-model="keyword" type="search" autocomplete="off" aria-label="搜索名称或描述"
          placeholder="翻找一点有趣的…" @input="onSearchInput">
      </label>
      <div class="oae-controls">
        <div class="oae-sort" role="group" aria-label="排序方式">
          <button v-for="opt in SORT_OPTIONS" :key="opt.value" type="button" class="oae-sort-btn"
            :class="{ 'is-active': sortStrategy === opt.value }" :aria-pressed="sortStrategy === opt.value"
            @click="setSort(opt.value)">{{ opt.label }}</button>
        </div>
      </div>
    </div>

    <div class="oae-field" :class="{ 'is-motion-paused': !pageVisible }" :aria-busy="loading">
      <div v-if="loading && !resources.length" class="oae-board oae-skeletons" role="status" aria-label="正在翻柜子">
        <div v-for="n in 8" :key="n" class="oae-skeleton" aria-hidden="true"><span></span><span></span></div>
      </div>
      <div v-else-if="boardEmpty" class="oae-empty" role="status">
        <i :class="loadFailed ? 'ph-light ph-cloud-slash' : 'ph-light ph-sparkle'" aria-hidden="true"></i>
        <h3>{{ loadFailed ? '柜子暂时没打开' : statusMessage }}</h3>
        <p v-if="loadFailed">{{ statusMessage }}</p>
        <button v-if="loadFailed" type="button" @click="loadResources">重新打开</button>
        <button v-else-if="keyword" type="button" @click="keyword = ''; onSearchInput()">看看全部</button>
      </div>
      <ul v-else :key="listRevision" class="oae-board" :class="{ 'is-loading': loading }" aria-label="收藏的资源">
        <li v-for="item in displayResources" :key="item.id" v-in-view class="oae-tile" :style="item.style">
          <article class="oae-card">
            <div class="oae-emblem" aria-hidden="true">
              <span class="oae-orbit"></span>
              <span class="oae-logo" :class="{ 'has-image': item.cover }">
                <img v-if="item.cover" :src="item.cover" alt="" width="34" height="34" loading="lazy"
                  decoding="async" @error="failedCovers.add(item.cover)">
                <svg v-else viewBox="0 0 24 24" fill="none"><path :d="item.mark" stroke="currentColor"
                  stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="oae-index">{{ item.ordinal }}</span>
            </div>
            <div class="oae-copy">
              <header class="oae-head">
                <h3 class="oae-title">
                  <a v-if="item.href" :href="item.href" target="_blank" rel="noopener noreferrer" :title="item.title"
                    :aria-label="`${item.title}（在新标签页打开）`">{{ item.title }}</a>
                  <button v-else type="button" @click="openResource(item)">{{ item.title }}</button>
                </h3>
                <i class="ph-bold ph-arrow-up-right oae-arrow" aria-hidden="true"></i>
              </header>
              <p class="oae-desc" :class="{ 'is-empty': !item.description }" :title="item.description">
                {{ item.description || '这里空空如也哦。' }}
              </p>
              <footer class="oae-foot">
                <span class="oae-host" :title="item.host">{{ item.host || '未附链接' }}</span>
                <div v-if="authStore.isGlobalAdmin" class="oae-actions">
                  <button type="button" class="oae-action" title="编辑" aria-label="编辑该资源"
                    @click.stop="editResource(item)"><i class="ph-bold ph-pencil-simple" aria-hidden="true"></i></button>
                  <button type="button" class="oae-action oae-action-danger" title="删除" aria-label="删除该资源"
                    @click.stop="deleteResource(item)"><i class="ph-bold ph-trash" aria-hidden="true"></i></button>
                </div>
                <button type="button" class="oae-like"
                  :class="{ 'is-liked': isLiked(item), 'is-bump': bumpId === String(item.id) }"
                  :aria-pressed="isLiked(item)" :disabled="likePending[String(item.id)]"
                  :aria-label="`${isLiked(item) ? '取消点赞' : '点赞'}：${item.title}，${likeCountOf(item)} 人喜欢`"
                  @click="toggleResourceLike(item)">
                  <i :class="isLiked(item) ? 'ph-fill ph-heart' : 'ph-bold ph-heart'" aria-hidden="true"></i>
                  <span class="oae-like-count" aria-live="polite">{{ likeCountOf(item) }}</span>
                  <span class="oae-like-label">喜欢</span>
                  <span v-if="bumpId === String(item.id) && isLiked(item)" class="oae-like-burst" aria-hidden="true">+1</span>
                </button>
              </footer>
            </div>
          </article>
        </li>
      </ul>
    </div>

    <nav v-if="!boardEmpty && totalPages > 1" class="art-pager oae-pager" aria-label="资源分页">
      <button type="button" class="art-icon-btn art-icon-btn-sm" aria-label="上一页"
        :disabled="loading || currentPage <= 1" @click="changePage(-1)"><i class="ph-bold ph-caret-left" aria-hidden="true"></i></button>
      <span id="resourcePageInfo" class="art-pager-info" aria-live="polite">{{ pageInfo }}</span>
      <button type="button" class="art-icon-btn art-icon-btn-sm" aria-label="下一页"
        :disabled="loading || currentPage >= totalPages" @click="changePage(1)"><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>
    </nav>
    <p v-else-if="!loading && !boardEmpty" class="oae-end"><span></span>收藏还在慢慢生长<span></span></p>
  </section>
</template>

<style scoped>
.oae {
  --cabinet-tint: color-mix(in srgb, var(--art-accent) 7%, transparent);
  --cabinet-line: color-mix(in srgb, var(--art-accent) 20%, transparent);
}
.oae-total { font: 10px var(--art-mono); color: var(--art-ink-3); white-space: nowrap; }
.oae-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 20px; }
.oae-search { flex: 1 1 200px; max-width: 300px; height: 40px; }
.oae-search:focus-within { border-color: var(--art-accent); }
.oae-aside { color: var(--art-ink-3); font-size: 11px; letter-spacing: .1em; }
.oae-controls { display: flex; align-items: center; gap: 14px; margin-left: auto; }
.oae-sort { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--art-line); border-radius: 30px; }
.oae-sort-btn { min-height: 32px; padding: 0 16px; border-radius: 24px; color: var(--art-ink-3); font-size: 11px; cursor: pointer; transition: background-color .2s, color .2s; }
@media (hover: hover) and (pointer: fine){.oae-sort-btn:hover{ color: var(--art-accent); }}
.oae-sort-btn.is-active { color: #04161a; background: var(--art-accent); }
:global(body.theme-light .oae-sort-btn.is-active) { color: #fff; }
/* 阅读坐标固定：只让图标和装饰运动，不再让文字随机漂移。 */
.oae-field { margin: 36px 0 0; }
.oae-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 44px; margin: 0; padding: 0; list-style: none; transition: opacity .2s; }
.oae-board.is-loading { opacity: .55; pointer-events: none; }
.oae-tile { min-width: 0; }
.oae-tile.has-entered { animation: cabinet-arrive .65s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--item-delay); }
.oae-card { position: relative; display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 18px; height: 100%; min-width: 0; padding: 24px 0 18px; }
/* 单根细线划分归属，没有卡片底板、四周边框或方形阴影。 */
.oae-card::before, .oae-card::after { content: ''; position: absolute; height: 1px; bottom: 0; left: 0; right: 0; pointer-events: none; }
.oae-card::before { background: var(--art-line); }
.oae-card::after { background: var(--art-accent); transform: scaleX(0); transform-origin: left; opacity: .8; transition: transform .45s cubic-bezier(.2,.8,.2,1); }
.oae-emblem { position: relative; width: 52px; padding-top: 2px; text-align: center; }
.oae-emblem::before { content: ''; position: absolute; left: -12px; top: -10px; width: 76px; height: 76px; border-radius: 50%; background: radial-gradient(circle, var(--cabinet-tint), transparent 70%); opacity: .6; transition: opacity .3s; pointer-events: none; }
.oae-orbit { position: absolute; top: 0; left: 0; width: 52px; height: 52px; border: 1px solid var(--cabinet-line); border-right-color: transparent; border-radius: 50%; animation: cabinet-orbit var(--orbit-duration) linear infinite; animation-delay: var(--orbit-phase); animation-play-state: paused; pointer-events: none; }
.oae-orbit::after { content: ''; position: absolute; left: 24px; top: -2px; width: 4px; height: 4px; border-radius: 50%; background: var(--art-accent); box-shadow: 0 0 7px var(--cabinet-line); }
.oae-logo { position: relative; display: grid; place-items: center; width: 48px; height: 48px; margin: 0 auto; color: var(--art-accent); transition: transform .35s cubic-bezier(.2,.8,.2,1); }
.oae-logo svg { width: 25px; height: 25px; }
.oae-logo img { width: 34px; height: 34px; object-fit: contain; }
.oae-logo svg, .oae-logo img { animation: cabinet-breathe 4s ease-in-out infinite; animation-delay: var(--orbit-phase); animation-play-state: paused; }
.oae-index { display: block; margin-top: 11px; font: 9px var(--art-mono); letter-spacing: .12em; color: var(--art-ink-4); }
.oae-copy { display: flex; flex-direction: column; min-width: 0; }
.oae-head { display: flex; align-items: flex-start; gap: 10px; min-height: 26px; }
.oae-title { flex: 1; min-width: 0; margin: 0; color: var(--art-ink); font-size: 14px; line-height: 1.8; font-weight: 550; letter-spacing: .015em; overflow-wrap: anywhere; transition: color .25s; }
.oae-title a, .oae-title button { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: inherit; text-decoration: none; text-align: left; cursor: pointer; }
.oae-title a::after, .oae-title button::after { content: ''; position: absolute; inset: 0; }
.oae-title a:focus-visible, .oae-title button:focus-visible { outline: none; text-decoration: underline; text-decoration-color: var(--art-accent); text-underline-offset: 5px; }
.oae-arrow { flex-shrink: 0; margin-top: 7px; font-size: 12px; color: var(--art-ink-3); transition: transform .25s, color .25s; }
.oae-desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; min-height: 44px; margin: 5px 0 8px; font-size: 12px; line-height: 22px; color: var(--art-ink-2); }
.oae-desc.is-empty { color: var(--art-ink-4); }
.oae-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; margin-top: auto; }
/* 站长编辑/删除：默认隐藏，悬停或键盘聚焦卡片时淡入；触摸端没有悬停，直接常显 */
.oae-actions { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 2px; margin-left: auto; opacity: 0; transition: opacity .3s ease; }
.oae-action { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; border-radius: 50%; color: var(--art-ink-4); cursor: pointer; transition: color .2s, background-color .2s; }
.oae-action > i { font-size: 13px; }
@media (hover: hover) and (pointer: fine){.oae-action:hover{ color: var(--art-accent); background: var(--cabinet-tint); }}
@media (hover: hover) and (pointer: fine){.oae-action-danger:hover{ color: #f87171; background: rgba(248, 113, 113, .12); }}
.oae-card:focus-within .oae-actions { opacity: 1; }
@media (hover: none) { .oae-actions { opacity: 1; } }
.oae-host { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 10px var(--art-mono); color: var(--art-ink-3); }
/* 数字和按钮始终可见，不能再把功能信息作为 hover 装饰隐藏。 */
.oae-like { position: relative; z-index: 1; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 62px; min-height: 36px; padding: 0 8px; margin-right: -8px; border-radius: 20px; color: var(--art-ink-2); cursor: pointer; transition: color .2s, background-color .2s; }
.oae-like > i { font-size: 14px; }
.oae-like-count { color: var(--art-ink); font: 12px var(--art-mono); font-variant-numeric: tabular-nums; }
.oae-like-label { font-size: 11px; color: var(--art-ink-3); }
.oae-like.is-liked{ color: var(--art-accent); background: var(--cabinet-tint); }
@media (hover: hover) and (pointer: fine){.oae-like:hover{ color: var(--art-accent); background: var(--cabinet-tint); }}
.oae-like.is-liked .oae-like-count { color: var(--art-accent); }
.oae-like:disabled { cursor: wait; }
.oae-like.is-bump > i { animation: cabinet-heart .55s cubic-bezier(.2,.8,.2,1); }
.oae-like.is-bump .oae-like-count { animation: cabinet-count .35s ease-out; }
.oae-like-burst { position: absolute; top: -3px; left: 15px; color: var(--art-accent); font: 10px var(--art-mono); pointer-events: none; animation: cabinet-plus .85s ease-out both; }
.oae button:focus-visible { outline: 2px solid var(--art-accent); outline-offset: 3px; }
.oae-card:focus-within::after { transform: scaleX(1); }
.oae-card:focus-within .oae-title { color: var(--art-accent); }
.oae-tile.is-in-view .oae-orbit, .oae-tile.is-in-view .oae-logo svg, .oae-tile.is-in-view .oae-logo img { animation-play-state: running; }
.oae-field.is-motion-paused .oae-orbit, .oae-field.is-motion-paused .oae-logo svg, .oae-field.is-motion-paused .oae-logo img { animation-play-state: paused; }
.oae-field.is-motion-paused .oae-tile { animation-play-state: paused; }
@media (hover: hover) and (pointer: fine) {
  .oae-card:hover .oae-actions { opacity: 1; }
  .oae-card:hover::after { transform: scaleX(1); }
  .oae-card:hover .oae-title { color: var(--art-accent); }
  .oae-card:hover .oae-emblem::before { opacity: 1; }
  .oae-card:hover .oae-logo { transform: translateY(-2px) scale(1.12); }
  .oae-card:hover .oae-arrow { color: var(--art-accent); transform: translate(3px, -3px); }
}
.oae-pager { margin-top: 32px; }
.oae-end { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 38px 0 24px; font-size: 10px; letter-spacing: .16em; color: var(--art-ink-4); }
.oae-end span { width: 22px; height: 1px; background: var(--cabinet-line); }
.oae-empty { padding: 60px 15px; text-align: center; }
.oae-empty > i { display: block; margin-bottom: 20px; font-size: 28px; color: var(--art-accent); }
.oae-empty h3 { font-size: 15px; color: var(--art-ink-2); }
.oae-empty p { margin: 12px 0 18px; font-size: 12px; color: var(--art-ink-3); }
.oae-empty button { padding: 9px 18px; border: 1px solid var(--cabinet-line); border-radius: 24px; font-size: 12px; color: var(--art-accent); background: var(--cabinet-tint); cursor: pointer; }
.oae-skeleton { display: flex; align-items: flex-start; gap: 18px; height: 160px; padding-top: 24px; animation: cabinet-pulse 1.4s ease-in-out infinite alternate; }
.oae-skeleton span { display: block; flex: 0 0 52px; height: 52px; border-radius: 50%; background: var(--cabinet-tint); }
.oae-skeleton span + span { flex: 1; height: 8px; margin-top: 8px; border-radius: 4px; box-shadow: 0 24px 0 var(--cabinet-tint), 0 42px 0 var(--cabinet-tint); }
@keyframes cabinet-arrive { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes cabinet-orbit { to { transform: rotate(360deg); } }
@keyframes cabinet-breathe { 0%, 100% { transform: translateY(1px); } 50% { transform: translateY(-2px); } }
@keyframes cabinet-heart { 35% { transform: scale(1.4) rotate(-12deg); } 65% { transform: scale(.9); } }
@keyframes cabinet-count { from { opacity: .3; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@keyframes cabinet-plus { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-22px); } }
@keyframes cabinet-pulse { to { opacity: .4; } }
@media (max-width: 1100px) {
  .oae-board { gap: 20px 32px; }
  .oae-card { grid-template-columns: 44px minmax(0, 1fr); gap: 14px; }
  .oae-emblem, .oae-orbit { width: 44px; }
  .oae-orbit { height: 44px; }
  .oae-orbit::after { left: 20px; }
  .oae-logo { width: 40px; height: 40px; }
  .oae-like-label { display: none; }
  .oae-like { min-width: 48px; }
}
@media (max-width: 900px) {
  .oae-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .oae-aside { display: none; }
}
@media (max-width: 600px) {
  .oae-toolbar { gap: 10px; }
  .oae-search { flex-basis: 130px; }
  .oae-controls { gap: 8px; }
  .oae-sort-btn { padding: 0 11px; }
  .oae-field { margin-top: 20px; }
  .oae-board { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .oae-card { grid-template-columns: 46px minmax(0, 1fr); gap: 17px; padding: 21px 0 15px; }
  .oae-desc { min-height: 0; margin: 4px 0 5px; }
  .oae-like { min-height: 44px; min-width: 64px; }
  .oae-like-label { display: inline; }
  .oae-end { margin-top: 28px; }
}
@media (prefers-reduced-motion: reduce) {
  .oae-tile.has-entered, .oae-orbit, .oae-logo svg, .oae-logo img, .oae-skeleton,
  .oae-like.is-bump > i, .oae-like.is-bump .oae-like-count { animation: none; }
  .oae-title, .oae-logo, .oae-arrow, .oae-board, .oae-like, .oae-sort-btn,
  .oae-actions, .oae-action, .oae-card::after, .oae-emblem::before { transition: none; }
  .oae-card:hover .oae-logo, .oae-card:hover .oae-arrow { transform: none; }
  .oae-like-burst { display: none; }
}</style>
