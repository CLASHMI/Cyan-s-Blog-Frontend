<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import BlogCard from '@/components/BlogCard.vue'
import FilterSelect from '@/components/FilterSelect.vue'
import { generateSvgAvatar, useAuthStore } from '@/stores/useAuthStore'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { useUiStore } from '@/stores/useUiStore'
import { SystemConstant } from '@/utils/constants'
import { apiBase, request } from '@/utils/request'
import { tagHue } from '@/utils/tagColor'

const authStore = useAuthStore()
const categoryStore = useCategoryStore()
const uiStore = useUiStore()
const route = useRoute()
/* 后端枚举：排序策略 */
const { SortStrategy } = SystemConstant

/* 纯视觉：面板光斑与描边跟随鼠标（触屏不启用） */
const vSpotlight = {
    mounted(el) {
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
        let frame = 0
        el._spotMove = (e) => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect()
                el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
                el.style.setProperty('--my', `${e.clientY - rect.top}px`)
            })
        }
        el.addEventListener('pointermove', el._spotMove)
    },
    unmounted(el) {
        if (el._spotMove) el.removeEventListener('pointermove', el._spotMove)
    },
}

/* ---------------- 活跃度热力图 ---------------- */
const currentHeatmapYear = ref(new Date().getFullYear())
const activityCounts = ref({})
const categoryCounts = ref(null)
const totalPostsCount = computed(() => Object.values(activityCounts.value).reduce((sum, count) => sum + Number(count), 0))
const tagCounts = ref({})
const tagOptions = ref([])
/* 只有发布/删除随笔后才需要重新拉全量数据 */
let heatmapLoaded = false

function changeHeatmapYear(delta) {
    currentHeatmapYear.value += delta
}

async function loadActivityHeatmap(force = false) {
    if (heatmapLoaded && !force) return
    try {
        const data = await request('/stats/activity')
        const tags = Array.isArray(data.tagCounts) ? data.tagCounts : []
        activityCounts.value = data.dayCounts || {}
        categoryCounts.value = data.categoryCounts || null
        tagCounts.value = Object.fromEntries(tags.map((t) => [t.name, t.count]))
        tagOptions.value = tags.map((t) => ({ id: t.id, name: t.name }))
        heatmapLoaded = true
    } catch (e) {}
}

const heatmapWeeks = computed(() => {
    const year = currentHeatmapYear.value
    const counts = activityCounts.value
    const gridStart = new Date(year, 0, 1)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())
    const gridEnd = new Date(year, 11, 31)
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

    const weeks = []
    const day = new Date(gridStart)
    while (day <= gridEnd) {
        const week = []
        for (let i = 0; i < 7; i++) {
            const y = day.getFullYear()
            const m = String(day.getMonth() + 1).padStart(2, '0')
            const d = String(day.getDate()).padStart(2, '0')
            const dateStr = `${y}-${m}-${d}`
            let cls = 'w-3.5 h-3.5 rounded-[2px] transition-colors duration-300 '
            let title = dateStr
            if (y !== year) {
                cls += 'opacity-0 cursor-default'
                title = ''
            } else {
                const count = counts[dateStr] || 0
                if (count === 0) {
                    cls += 'art-heat-empty cursor-default'
                } else {
                    if (count === 1) {
                        cls += 'bg-cyan-900/60 border border-cyan-800/60 hover:border-cyan-500 cursor-pointer'
                    } else if (count === 2) {
                        cls += 'bg-cyan-600 border border-cyan-500 cursor-pointer'
                    } else {
                        cls += 'bg-cyan-400 border border-cyan-300 shadow-[0_0_8px_rgba(0,255,255,0.45)] cursor-pointer'
                    }
                    title += ` : 发布了 ${count} 篇`
                }
            }
            week.push({ date: dateStr, cls, title })
            day.setDate(day.getDate() + 1)
        }
        weeks.push(week)
    }
    return weeks
})

const heatmapStatsText = computed(() => {
    const year = currentHeatmapYear.value
    const activeDays = Object.keys(activityCounts.value).filter((d) => d.startsWith(String(year))).length
    return `${year} 年共活跃 ${activeDays} 天`
})

/* ---------------- 热力图横向滚动：定位到本周 + 可滑动提示 ---------------- */
const heatmapScrollEl = ref(null)
let heatmapScrollObserver = null
/* 同一年的自动定位只做一次，用户自己滑过之后就不再抢滚动条 */
let heatmapCenteredYear = null

function isHeatmapScrollable(el) {
    return el.scrollWidth > el.clientWidth + 4
}

/* 手机上一屏放不下 53 周，默认把视图对到「今天」那一列，省得每次从一月手动滑过去 */
function centerHeatmapOnToday() {
    const el = heatmapScrollEl.value
    if (!el || !isHeatmapScrollable(el)) return
    const year = currentHeatmapYear.value
    if (heatmapCenteredYear === year) return
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const weeks = heatmapWeeks.value
    const index = weeks.findIndex((week) => week.some((cell) => cell.date === todayKey))
    if (index < 0) {
        /* 翻到别的年份：回到一月，不保留上一年滚过的位置 */
        el.scrollLeft = 0
    } else {
        const columnWidth = el.scrollWidth / weeks.length
        const target = columnWidth * index - el.clientWidth / 2 + columnWidth / 2
        el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target))
    }
    heatmapCenteredYear = year
}

/* 首帧容器宽度可能还是 0，交给 ResizeObserver：宽度一就位就定位，旋转屏幕也能跟上 */
function refreshHeatmapScroll() {
    centerHeatmapOnToday()
}

watch(activityCounts, () => nextTick(refreshHeatmapScroll))
watch(currentHeatmapYear, () => {
    heatmapCenteredYear = null
    nextTick(refreshHeatmapScroll)
})

/* 标签云：字号与着色强度按该标签下的随笔数归一化 */
const tagCloud = computed(() => {
    const counts = tagCounts.value
    /* 只保留被随笔用过的标签，一篇都没关联的直接过滤掉 */
    const used = tagOptions.value.filter((t) => (counts[t.name] || 0) > 0)
    if (!used.length) return []
    const values = used.map((t) => counts[t.name])
    const max = Math.max(...values)
    const min = Math.min(...values)
    return used
        .sort((a, b) => counts[b.name] - counts[a.name] || a.name.localeCompare(b.name))
        .map((t) => {
            const count = counts[t.name]
            const ratio = max === min ? 0.6 : (count - min) / (max - min)
            return {
                id: t.id,
                name: t.name,
                count,
                hue: tagHue(t.name) + 'deg',
                intensity: +(0.15 + ratio * 0.85).toFixed(3),
                size: (12.5 + ratio * 10.5).toFixed(1),
                weight: ratio > 0.66 ? 700 : ratio > 0.33 ? 600 : 500,
            }
        })
})

/* 当前生效的标签筛选名，用于清除按钮的回显 */
const activeTagName = computed(() => tagCloud.value.find((t) => t.id === filterTagId.value)?.name || '')

/* ---------------- 随笔流 ---------------- */
const blogs = ref([])
const blogLoading = ref(true)
const blogStatusMessage = ref('')
const blogTotalCount = ref(0)
const currentBlogPage = ref(1)
const totalBlogPages = ref(1)
const filterBlogCategory = ref('')
const filterTagId = ref('')
const searchBlogKeyword = ref('')
const filterSort = ref(String(SortStrategy.LATEST))

const blogCategories = computed(() => categoryStore.list)
const blogCategoryOptions = computed(() => [
    { value: '', label: '全部分类' },
    ...categoryStore.options,
])
const blogPageInfo = computed(
    () => `第 ${currentBlogPage.value} 页 / 共 ${totalBlogPages.value} 页`,
)
const sortOptions = [
    { value: String(SortStrategy.LATEST), label: '最新发布' },
    { value: String(SortStrategy.HOTTEST), label: '最高热度' },
    { value: String(SortStrategy.TOP_RATED), label: '最高评分' },
    { value: String(SortStrategy.MOST_LIKED), label: '最高点赞' },
]

/* ---------------- 全站随笔聚合统计（总字数 / 总点击量） ---------------- */
const postStats = ref(null)
const postStatsWords = computed(() => Number(postStats.value?.totalWords || 0).toLocaleString('en-US'))
const postStatsViews = computed(() => Number(postStats.value?.totalViews || 0).toLocaleString('en-US'))
let postStatsSeq = 0
let postStatsLoadedAt = 0

async function loadPostStats(force = false) {
    /* 后端这份聚合缓存 60 秒，前端同样节流，来回切页不会反复打接口 */
    if (!force && postStatsLoadedAt && Date.now() - postStatsLoadedAt < 60000) return
    const seq = ++postStatsSeq
    try {
        const data = await request('/stats/post', { silent: true })
        if (seq !== postStatsSeq || !data) return
        postStats.value = data
        postStatsLoadedAt = Date.now()
    } catch (e) {}
}

let blogsSeq = 0
const listKey = ref(0)

async function loadBlogs({ animate = true, silent = false } = {}) {
    const seq = ++blogsSeq
    blogLoading.value = true
    try {
        const params = new URLSearchParams({
            pageNum: currentBlogPage.value,
            pageSize: 6,
        })
        if (filterBlogCategory.value) params.append('categoryId', filterBlogCategory.value)
        if (filterTagId.value) params.append('tagId', filterTagId.value)
        if (searchBlogKeyword.value.trim()) params.append('keyword', searchBlogKeyword.value.trim())
        if (filterSort.value !== String(SortStrategy.LATEST)) {
            params.append('sortStrategy', filterSort.value)
        }

        const data = await request(`/blog/list?${params.toString()}`, { silent })
        if (seq !== blogsSeq) return
        blogs.value = data.records || []
        totalBlogPages.value = Math.max(1, Math.ceil((data.total || 0) / 6))
        blogTotalCount.value = Number(data.total) || 0
        blogStatusMessage.value = blogs.value.length ? '' : '还没有随笔发布哦。'
        /* 切筛选 / 翻页才重放列表入场动画；从详情返回的静默刷新保留原 DOM，不跳滚动 */
        if (animate) listKey.value++
    } catch (e) {
        if (seq === blogsSeq) {
            blogs.value = []
            blogStatusMessage.value = '随笔加载失败，请稍后重试。'
        }
    } finally {
        if (seq === blogsSeq) blogLoading.value = false
    }
}

function changeBlogPage(delta) {
    if (currentBlogPage.value + delta < 1 || currentBlogPage.value + delta > totalBlogPages.value) return
    currentBlogPage.value += delta
    loadBlogs()
}

function applyBlogFilters() {
    currentBlogPage.value = 1
    loadBlogs()
}

/* 标签云点选：同一个标签再点一次即取消筛选 */
function toggleTagFilter(id) {
    filterTagId.value = filterTagId.value === id ? '' : id
    applyBlogFilters()
}

function clearTagFilter() {
    filterTagId.value = ''
    applyBlogFilters()
}

function handleBlogDeleted() {
    heatmapLoaded = false
    loadBlogs()
    loadActivityHeatmap()
    loadRecentPosts()
}

/* 视图被 keep-alive 缓存后不再重新挂载，发布/更新随笔仍靠版本号触发重拉 */
watch(
    () => uiStore.postsRevision,
    () => {
        /* 随笔增删改都可能影响标签分布，顺带重算标签云 */
        heatmapLoaded = false
        loadBlogs()
        loadActivityHeatmap()
        loadRecentPosts()
        loadPostStats(true)
    },
)
/* 评论 / 点赞后刷新全站点击量聚合 */
watch(() => uiStore.statsRevision, () => loadPostStats(true))
/* 仅在增删随笔后自增：热力图重拉，评分/评论不涉及 */
watch(
    () => uiStore.heatmapRevision,
    () => {
        heatmapLoaded = false
        loadActivityHeatmap()
    },
)

/* 详情页是浮层，列表一直挂载、不会触发 onActivated：靠路由变化感知“从详情返回”，静默补拉点击量 */
let blogViewActivated = false

function refreshBlogList() {
    if (document.hidden) return
    loadBlogs({ animate: false, silent: true })
    loadPostStats(true)
}

watch(
    () => route.path,
    (path, prev) => {
        if (path === '/blog' && prev && prev.startsWith('/post/')) refreshBlogList()
    },
)

onActivated(() => {
    /* 首次挂载已由 onMounted 拉过，跳过；之后从其它缓存视图返回才静默刷新 */
    if (!blogViewActivated) {
        blogViewActivated = true
        return
    }
    refreshBlogList()
})

/* ---------------- 独立侧栏：单个组件失败不影响文章流 ---------------- */
const weather = ref(null)
const weatherLoading = ref(false)
const weatherError = ref('')
const recentPosts = ref([])
const recentLoading = ref(false)
const recentError = ref('')
const dailyQuote = ref('')
const quoteLoading = ref(false)
const quoteError = ref('')
const quoteEditorOpen = ref(false)
const quoteConfirmOpen = ref(false)
const draftQuote = ref('')
const quoteSaving = ref('')
const quoteSaveError = ref('')
const quoteAiAttempted = ref(false)
const quoteReady = ref(false)
const quoteDraftCount = computed(() => Array.from(draftQuote.value.trim()).length)
const quoteDraftValid = computed(() => quoteDraftCount.value > 0 && quoteDraftCount.value <= 20
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(draftQuote.value.trim()))
let quoteLoadedAt = 0
let quoteSeq = 0
let weatherLoadedAt = 0
let quoteDay = ''
let recentSeq = 0
let refreshTimer = 0

const shanghaiDay = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let weatherSeq = 0

async function loadWeather() {
    if (weatherLoading.value) return
    const seq = ++weatherSeq
    weatherLoading.value = true
    weatherError.value = ''
    try {
        const result = await request('/weather/current', { silent: true })
        if (seq !== weatherSeq) return
        weather.value = result
        weatherLoadedAt = Date.now()
    } catch (error) {
        if (seq !== weatherSeq) return
        weatherError.value = error.message === '天气尚未配置' ? '天气尚未配置' : '天气暂不可用'
    } finally {
        if (seq === weatherSeq) weatherLoading.value = false
    }
}

/* 城市是管理员设置的站点配置；访客不能触发城市搜索或改写。 */
const cityPickerOpen = ref(false)
const cityKeyword = ref('')
const cityResults = ref([])
const citySearching = ref(false)
const citySelecting = ref('')
const cityError = ref('')
const citySearched = ref(false)
let citySearchSeq = 0

async function searchCities() {
    if (!authStore.isGlobalAdmin || citySearching.value || citySelecting.value) return
    const keyword = cityKeyword.value.trim()
    if (keyword.length < 2) { cityError.value = '请输入至少两个字的城市名，也可以输入 Location ID。'; return }
    const seq = ++citySearchSeq
    citySearching.value = true
    cityError.value = ''
    cityResults.value = []
    citySearched.value = false
    try {
        const result = await request(`/weather/cities?keyword=${encodeURIComponent(keyword)}`, { silent: true })
        if (seq !== citySearchSeq) return
        cityResults.value = Array.isArray(result) ? result : []
        citySearched.value = true
    } catch (error) {
        if (seq === citySearchSeq) cityError.value = error.message || '城市搜索暂不可用'
    } finally {
        if (seq === citySearchSeq) citySearching.value = false
    }
}

async function selectWeatherCity(city) {
    if (!authStore.isGlobalAdmin || citySelecting.value || citySearching.value) return
    citySelecting.value = city.id
    cityError.value = ''
    ++weatherSeq // 防止切换前的天气请求覆盖新城市。
    weatherLoading.value = false
    try {
        const result = await request('/weather/city', { method: 'PUT', body: JSON.stringify({ id: city.id }), silent: true })
        ++weatherSeq
        weatherLoading.value = false
        weather.value = result
        weatherLoadedAt = Date.now()
        weatherError.value = ''
        cityPickerOpen.value = false
    } catch (error) {
        cityError.value = error.message || '切换失败，仍保留原来的城市。'
    } finally { citySelecting.value = '' }
}

/* 最新加入的用户，不表示在线状态；只渲染公开接口的精简字段。 */
const recentUsers = ref([])
const usersLoading = ref(false)
const usersError = ref('')
const failedAvatars = ref(new Set())
let usersLoadedAt = 0
const scrollUsers = computed(() => recentUsers.value.length > 5)

async function loadRecentUsers() {
    if (usersLoading.value) return
    usersLoading.value = true
    usersError.value = ''
    try {
        const data = await request('/user/recent', { silent: true })
        recentUsers.value = Array.isArray(data) ? data.slice(0, 25) : []
        usersLoadedAt = Date.now()
    } catch { usersError.value = '访客记录暂不可用' }
    finally { usersLoading.value = false }
}

function visitorTime(value) {
    const parts = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
    return parts ? `${parts[2]}.${parts[3]} ${parts[4]}:${parts[5]}` : '—'
}

function visitorAvatar(user) {
    const avatar = String(user.avatar || '').trim()
    const fallback = generateSvgAvatar(user.nickname, user.role)
    if (!avatar || failedAvatars.value.has(avatar)) return fallback
    if (/^https?:\/\//i.test(avatar)) return avatar
    return avatar.startsWith('/') && !avatar.startsWith('//') ? apiBase + avatar : fallback
}

async function loadRecentPosts() {
    const seq = ++recentSeq
    recentLoading.value = true
    recentError.value = ''
    try {
        const data = await request('/blog/recent', { silent: true })
        if (seq === recentSeq) recentPosts.value = Array.isArray(data) ? data.slice(0, 5) : []
    } catch (error) {
        if (seq === recentSeq) recentError.value = '最近更新暂不可用'
    } finally {
        if (seq === recentSeq) recentLoading.value = false
    }
}

function applyDailyQuote(data) {
    if (!data || typeof data.date !== 'string' || typeof data.text !== 'string'
        || typeof data.aiAttempted !== 'boolean') throw new Error('今日一言接口版本不匹配，请更新并重启后端。')
    if (data.date !== shanghaiDay()) throw new Error('今日一言日期已变化，请重新读取。')
    dailyQuote.value = data.text
    quoteAiAttempted.value = data.aiAttempted
    quoteReady.value = true
    quoteDay = data.date
    quoteLoadedAt = Date.now()
    quoteError.value = ''
}

async function loadDailyQuote() {
    if (quoteLoading.value || quoteSaving.value) return
    const day = shanghaiDay()
    if (quoteDay !== day) {
        dailyQuote.value = ''; quoteReady.value = false; quoteAiAttempted.value = false
        quoteEditorOpen.value = false; quoteConfirmOpen.value = false; draftQuote.value = ''; quoteSaveError.value = ''
    }
    const seq = ++quoteSeq
    quoteLoading.value = true
    quoteError.value = ''
    try {
        const data = await request('/ai/dailyQuote', { silent: true })
        if (seq !== quoteSeq || day !== shanghaiDay()) return
        applyDailyQuote(data)
    } catch (error) {
        if (seq === quoteSeq) { quoteError.value = error.message || '今日一言暂不可用'; quoteReady.value = false }
    } finally {
        if (seq === quoteSeq) quoteLoading.value = false
    }
}

function openQuoteEditor() {
    if (!authStore.isGlobalAdmin || quoteSaving.value) return
    quoteConfirmOpen.value = false
    draftQuote.value = dailyQuote.value
    quoteSaveError.value = ''
    quoteEditorOpen.value = !quoteEditorOpen.value
}

function confirmGenerateQuote() {
    if (!authStore.isGlobalAdmin || quoteSaving.value || !quoteReady.value || quoteAiAttempted.value) return
    quoteConfirmOpen.value = true
}

async function saveQuote(generate = false) {
    if (!authStore.isGlobalAdmin || quoteSaving.value) return
    if (quoteDay && quoteDay !== shanghaiDay()) {
        quoteSaveError.value = '日期已变化，请重新读取后编辑。'
        await loadDailyQuote()
        return
    }
    if (generate && (!quoteReady.value || quoteAiAttempted.value)) return
    if (!generate && !quoteDraftValid.value) {
        quoteSaveError.value = '请填写1至20字的单行短句（含标点）。'
        return
    }
    quoteConfirmOpen.value = false
    const seq = ++quoteSeq // 提交后到达的旧读取响应不能覆盖新内容。
    quoteLoading.value = false
    quoteSaving.value = generate ? 'ai' : 'manual'
    quoteSaveError.value = ''
    let failed = false
    try {
        const data = await request(generate ? '/ai/dailyQuote/generate' : '/ai/dailyQuote/manual', {
            method: generate ? 'POST' : 'PUT',
            ...(generate ? {} : { body: JSON.stringify({ text: draftQuote.value.trim() }) }),
            silent: true,
        })
        if (seq !== quoteSeq) return
        applyDailyQuote(data)
        quoteEditorOpen.value = false
        uiStore.showToast(generate ? '今日一言已生成并发布' : '今日一言已保存')
    } catch (error) {
        if (seq === quoteSeq) { quoteSaveError.value = error.message || '保存失败，请稍后再试。'; failed = true }
    } finally {
        if (seq === quoteSeq) {
            quoteSaving.value = ''
            // 失败、超时也重新读取额度；不重复发起生成，且保留手写草稿。
            if (failed) await loadDailyQuote()
        }
    }
}

/* 今日心情：访客只读；生成只发生在管理员明确提交时。 */
const moodOptions = [
    { value: 'HAPPY', label: '开心', emoji: '😊' },
    { value: 'CALM', label: '平静', emoji: '😌' },
    { value: 'FOCUSED', label: '专注', emoji: '🤓' },
    { value: 'TIRED', label: '疲惫', emoji: '😴' },
    { value: 'LOW', label: '低落', emoji: '🥺' },
    { value: 'EXCITED', label: '雀跃', emoji: '🥳' },
]
const dailyMood = ref(null)
const moodLoading = ref(false)
const moodSaving = ref(false)
const moodError = ref('')
const moodSaveError = ref('')
const moodPickerOpen = ref(false)
const draftMood = ref('HAPPY')
let moodLoadedAt = 0
let moodSeq = 0

async function loadDailyMood() {
    if (moodLoading.value || moodSaving.value) return
    const day = shanghaiDay()
    if (dailyMood.value?.date !== day) dailyMood.value = null
    const seq = ++moodSeq
    moodLoading.value = true
    moodError.value = ''
    try {
        const data = await request('/mood/today', { silent: true })
        if (seq !== moodSeq || day !== shanghaiDay()) return
        if (data.date !== day) throw new Error('mood date mismatch')
        dailyMood.value = data
        moodLoadedAt = Date.now()
    } catch {
        if (seq === moodSeq) moodError.value = '心情暂时没有送达，稍后再来看看。'
    } finally {
        moodLoading.value = false
    }
}

function openMoodPicker() {
    draftMood.value = dailyMood.value?.mood || 'HAPPY'
    moodSaveError.value = ''
    moodPickerOpen.value = !moodPickerOpen.value
}

async function saveDailyMood() {
    if (!authStore.isGlobalAdmin || moodSaving.value) return
    moodSaving.value = true
    moodSaveError.value = ''
    ++moodSeq // 旧的读取请求不能覆盖本次提交。
    try {
        const data = await request('/mood/select', {
            method: 'POST', body: JSON.stringify({ mood: draftMood.value }), silent: true,
        })
        if (data.date !== shanghaiDay()) throw new Error('日期已变化，请重新选择今日心情。')
        dailyMood.value = data
        moodLoadedAt = Date.now()
        moodError.value = ''
        moodPickerOpen.value = false
    } catch (error) {
        moodSaveError.value = error.message || '记录失败，请稍后再试。'
    } finally {
        moodSaving.value = false
    }
}

watch(() => authStore.isGlobalAdmin, (isAdmin) => {
    if (!isAdmin) {
        quoteEditorOpen.value = false; quoteSaveError.value = ''; draftQuote.value = ''
        ++quoteSeq; quoteLoading.value = false; quoteSaving.value = ''
        moodPickerOpen.value = false; moodSaveError.value = ''
        cityPickerOpen.value = false; cityError.value = ''; cityResults.value = []
        ++citySearchSeq; citySearching.value = false
    }
})

function refreshWidgets() {
    if (document.hidden) return
    if (!usersLoadedAt || Date.now() - usersLoadedAt >= 300000) loadRecentUsers()
    if (dailyMood.value?.date !== shanghaiDay() || Date.now() - moodLoadedAt >= 60000) loadDailyMood()
    if (!weatherLoadedAt || Date.now() - weatherLoadedAt >= 3600000) loadWeather()
    if (quoteDay !== shanghaiDay() || Date.now() - quoteLoadedAt >= 60000) loadDailyQuote()
    if (!postStatsLoadedAt || Date.now() - postStatsLoadedAt >= 60000) loadPostStats()
}

function startWidgetRefresh() {
    stopWidgetRefresh()
    refreshWidgets()
    // 页面跨日停留、从详情返回或切回标签页时，都能取到新一天的缓存。
    refreshTimer = window.setInterval(refreshWidgets, 60000)
    document.addEventListener('visibilitychange', refreshWidgets)
}

function stopWidgetRefresh() {
    clearInterval(refreshTimer)
    document.removeEventListener('visibilitychange', refreshWidgets)
}

onActivated(startWidgetRefresh)
onDeactivated(stopWidgetRefresh)
onBeforeUnmount(stopWidgetRefresh)

function weatherIcon(code) {
    const icon = Number(code)
    if (icon === 100) return 'ph-sun'
    if (icon === 150) return 'ph-moon'
    if (icon >= 400 && icon < 500) return 'ph-snowflake'
    if (icon >= 300 && icon < 400) return 'ph-cloud-rain'
    if (icon >= 500 && icon < 600) return 'ph-cloud-fog'
    return 'ph-cloud'
}

function recentCover(value) {
    if (!value) return ''
    let cover = String(value).trim()
    if (cover.startsWith('[')) {
        try { cover = JSON.parse(cover).find((item) => typeof item === 'string' && item.trim()) || '' }
        catch { return '' }
    }
    if (!cover || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(cover)) return ''
    if (/^https?:\/\//i.test(cover)) return cover
    return cover.startsWith('/') && !cover.startsWith('//') ? apiBase + cover : ''
}

const failedCovers = ref(new Set())
const weatherLink = computed(() => {
    try {
        const url = new URL(weather.value?.link || '')
        return url.protocol === 'https:' && (url.hostname === 'qweather.com' || url.hostname.endsWith('.qweather.com')) ? url.href : ''
    } catch { return '' }
})

/* 等身份落定再拉列表，首个请求才不会缺 Token。 */
onMounted(async () => {
    loadRecentPosts()
    startWidgetRefresh()
    if ('ResizeObserver' in window && heatmapScrollEl.value) {
        heatmapScrollObserver = new ResizeObserver(refreshHeatmapScroll)
        heatmapScrollObserver.observe(heatmapScrollEl.value)
    }
    await authStore.ensureAuth()
    loadBlogs()
    loadActivityHeatmap()
    /* 接口慢或失败时热力图也要先对准本周，不能只依赖数据回包 */
    nextTick(refreshHeatmapScroll)
})
onBeforeUnmount(() => {
    heatmapScrollObserver?.disconnect()
    heatmapScrollObserver = null
})
</script>

<template>
  <div>
      <section id="blogView" class="art-section">
          <div class="journal-layout">
              <aside class="journal-sidebar" aria-label="随笔侧栏">
                  <section class="journal-widget category-widget" v-spotlight aria-labelledby="categoryTitle">
                      <div class="widget-heading">
                          <h3 id="categoryTitle" class="art-panel-title"><i class="ph-light ph-folders" aria-hidden="true"></i>分类目录</h3>
                          <span class="widget-kicker">INDEX / {{ String(blogCategories.length).padStart(2, '0') }}</span>
                      </div>
                      <div class="category-filters" role="group" aria-label="按分类筛选随笔" tabindex="0">
                          <button v-for="category in blogCategoryOptions" :key="category.value" type="button"
                              :class="{ 'is-active': filterBlogCategory === category.value }"
                              :aria-pressed="filterBlogCategory === category.value"
                              @click="filterBlogCategory = category.value; applyBlogFilters()">
                              <span class="category-name">{{ category.label }}</span>
                              <span class="category-count" :aria-label="categoryCounts ? `${category.value ? (categoryCounts[category.value] || 0) : totalPostsCount} 篇随笔` : '数量加载中'">{{ categoryCounts ? (category.value ? (categoryCounts[category.value] || 0) : totalPostsCount) : '—' }}</span>
                          </button>
                      </div>
                  </section>

                  <section class="journal-widget tag-widget" v-spotlight aria-labelledby="tagTitle">
                      <div class="widget-heading">
                          <h3 id="tagTitle" class="art-panel-title"><i class="ph-light ph-star-four" aria-hidden="true"></i>已使用标签</h3>
                          <span class="widget-kicker">TOPICS / {{ String(tagCloud.length).padStart(2, '0') }}</span>
                      </div>
                      <div class="tag-constellation">
                          <div class="tag-orbits" aria-hidden="true"><span></span><span></span><i>+</i><i>+</i><i>·</i></div>
                          <div class="art-tagcloud-body">
                              <button v-for="(tag, tagIndex) in tagCloud" :key="tag.id" type="button" class="art-tagcloud-item"
                                  :class="{ 'is-active': filterTagId === tag.id }" :aria-pressed="filterTagId === tag.id"
                                  :aria-label="`${tag.name}，${tag.count} 篇随笔`"
                                  :style="{ '--tag-h': tag.hue, '--tag-i': tag.intensity, '--tag-size': tag.size + 'px', '--n': tagIndex, fontWeight: tag.weight }"
                                  @click="toggleTagFilter(tag.id)">
                                  <span class="tag-node" aria-hidden="true"></span><span class="tag-name">{{ tag.name }}</span><i class="art-tagcloud-count">{{ String(tag.count).padStart(2, '0') }}</i>
                              </button>
                              <p v-if="!tagCloud.length" class="art-tagcloud-empty">还没有随笔用过标签</p>
                          </div>
                      </div>
                      <div v-if="activeTagName" class="tag-caption"><span>正在探索 · {{ activeTagName }}</span><button type="button" @click="clearTagFilter">清除筛选 <i class="ph-bold ph-x" aria-hidden="true"></i></button></div>
                  </section>

                  <section class="journal-widget weather-widget" v-spotlight aria-labelledby="weatherTitle" :aria-busy="weatherLoading">
                      <div class="widget-heading"><h3 id="weatherTitle" class="art-panel-title"><i class="ph-light ph-cloud-sun" aria-hidden="true"></i>天气</h3><span class="widget-kicker">{{ weather?.city || 'WEATHER' }}</span></div>
                      <button v-if="authStore.isGlobalAdmin" type="button" class="weather-city-edit" :aria-expanded="cityPickerOpen" aria-controls="weatherCityPicker" :disabled="!!citySelecting" @click="cityPickerOpen = !cityPickerOpen"><i class="ph-light ph-map-pin" aria-hidden="true"></i>选择城市<i class="ph-bold ph-caret-down city-picker-chevron" aria-hidden="true"></i></button>
                      <Transition name="city-panel">
                          <div v-if="authStore.isGlobalAdmin && cityPickerOpen" class="city-picker-reveal">
                              <form id="weatherCityPicker" class="city-picker" @submit.prevent="searchCities">
                                  <label for="weatherCityKeyword">站点天气城市</label>
                                  <div class="city-search"><input id="weatherCityKeyword" v-model="cityKeyword" type="search" maxlength="40" placeholder="搜索城市，如重庆、杭州" autocomplete="off" :disabled="citySearching || !!citySelecting"><button type="submit" :disabled="citySearching || !!citySelecting">{{ citySearching ? '搜索中…' : '搜索' }}</button></div>
                                  <p class="city-hint">选择后全站生效，后续新心情也使用此城市。</p>
                                  <ul v-if="cityResults.length" class="city-results" aria-label="城市搜索结果">
                                      <li v-for="(city, index) in cityResults" :key="city.id" :style="{ '--city-delay': `${Math.min(index, 5) * 35}ms` }"><button type="button" :disabled="!!citySelecting || citySearching" @click="selectWeatherCity(city)"><span>{{ city.name }}<small>{{ [city.country, city.adm1, city.adm2].filter(Boolean).filter((name, i, names) => names.indexOf(name) === i).join(' · ') }}</small></span><i v-if="citySelecting === city.id" class="ph-bold ph-spinner-gap animate-spin" aria-label="切换中"></i><i v-else class="ph-light ph-arrow-up-right" aria-hidden="true"></i></button></li>
                                  </ul>
                                  <p v-else-if="citySearched" class="city-hint" role="status">没有找到该城市，试试完整名称或拼音。</p>
                                  <p v-if="cityError" class="mood-message" role="alert">{{ cityError }}</p>
                              </form>
                          </div>
                      </Transition>
                      <template v-if="weather">
                          <div :key="weather.city" class="weather-current">
                              <div><span class="weather-temp">{{ weather.temp }}<small>°</small></span><span class="weather-unit">C</span></div>
                              <div class="weather-condition"><i class="ph-light" :class="weatherIcon(weather.icon)" aria-hidden="true"></i><span>{{ weather.text }}</span></div>
                          </div>
                          <p class="weather-wind">{{ weather.windDir }}<span>{{ weather.obsTime?.slice(11, 16) }} 更新</span></p>
                          <div class="weather-forecast">
                              <div v-for="day in weather.daily" :key="day.date">
                                  <time :datetime="day.date">{{ day.date.slice(5).replace('-', '/') }}</time>
                                  <i class="ph-light" :class="weatherIcon(day.icon)" :title="day.text" role="img" :aria-label="day.text"></i>
                                  <span>{{ day.min }}° / {{ day.max }}°</span>
                              </div>
                          </div>
                          <a v-if="weatherLink" class="weather-credit" :href="weatherLink" target="_blank" rel="noopener noreferrer">和风天气 <i class="ph-bold ph-arrow-up-right" aria-hidden="true"></i></a>
                          <span v-else class="weather-credit">数据来源 · 和风天气</span>
                      </template>
                      <p v-if="weatherLoading && !weather" class="widget-status" role="status">正在感知天气…</p>
                      <div v-else-if="weatherError" class="widget-status weather-unavailable" role="status">
                          <i v-if="!weather" class="ph-light ph-cloud-slash weather-offline-icon" aria-hidden="true"></i>
                          <div><span>{{ weatherError }}{{ weather ? '，显示上次数据' : '' }}</span><small v-if="weatherError === '天气尚未配置'">等待站点接入天气服务</small></div>
                          <button type="button" @click="loadWeather">重试 <i class="ph-bold ph-arrow-clockwise" aria-hidden="true"></i></button>
                      </div>
                  </section>

                  <section class="journal-widget mood-widget" v-spotlight aria-labelledby="moodTitle" :aria-busy="moodLoading || moodSaving">
                      <div class="widget-heading">
                          <h3 id="moodTitle" class="art-panel-title"><i class="ph-light ph-smiley" aria-hidden="true"></i>今日心情</h3>
                          <button v-if="authStore.isGlobalAdmin" type="button" class="mood-edit" :aria-expanded="moodPickerOpen" aria-controls="moodPicker" :disabled="moodSaving" @click="openMoodPicker">
                              <i class="ph-bold ph-pencil-simple" aria-hidden="true"></i>{{ dailyMood?.mood ? '更换心情' : '记录心情' }}
                          </button>
                          <span v-else class="widget-kicker">LITTLE MOMENTS</span>
                      </div>
                      <div v-if="dailyMood?.mood" class="mood-scene" aria-live="polite">
                          <span class="mood-face" role="img" :aria-label="dailyMood.label">{{ dailyMood.emoji }}</span>
                          <div class="mood-copy"><span class="mood-label">{{ dailyMood.label }}<span> / {{ dailyMood.date.slice(5).replace('-', '.') }}</span></span><p>{{ dailyMood.text }}</p></div>
                      </div>
                      <div v-else class="mood-scene mood-empty">
                          <span class="mood-face" aria-hidden="true">☁️</span>
                          <div class="mood-copy"><span class="mood-label">留一格，给今天</span><p>{{ moodLoading ? '正在读取今天的心情…' : '今天的心情，还没落笔。' }}</p></div>
                      </div>

                      <p v-if="moodError" class="mood-message" role="status">{{ moodError }}</p>
                      <form v-if="authStore.isGlobalAdmin && moodPickerOpen" id="moodPicker" class="mood-picker" @submit.prevent="saveDailyMood">
                          <p class="mood-picker-title">今天，想用哪一种表情？</p>
                          <div class="mood-options" role="group" aria-label="选择今日心情">
                              <button v-for="option in moodOptions" :key="option.value" type="button" :class="{ 'is-selected': draftMood === option.value }" :aria-pressed="draftMood === option.value" :disabled="moodSaving" @click="draftMood = option.value">
                                  <span aria-hidden="true">{{ option.emoji }}</span>{{ option.label }}
                              </button>
                          </div>
                          <p class="mood-cache-note">借天气营造氛围，只写心情。同日同心情复用缓存；切换城市不会重新生成已有短句。</p>
                          <p v-if="moodSaveError" class="mood-message" role="alert">{{ moodSaveError }}</p>
                          <div class="mood-actions">
                              <button type="button" :disabled="moodSaving" @click="moodPickerOpen = false">取消</button>
                              <button type="submit" class="mood-submit" :disabled="moodSaving"><i v-if="moodSaving" class="ph-bold ph-spinner-gap animate-spin" aria-hidden="true"></i>{{ moodSaving ? '正在记录…' : '记录今天' }}</button>
                          </div>
                      </form>
                  </section>

                  <section class="journal-widget" v-spotlight aria-labelledby="recentTitle" :aria-busy="recentLoading">
                      <div class="widget-heading"><h3 id="recentTitle" class="art-panel-title"><i class="ph-light ph-clock-counter-clockwise" aria-hidden="true"></i>最近更新</h3><span class="widget-kicker">LATEST / {{ String(recentPosts.length).padStart(2, '0') }}</span></div>
                      <p v-if="recentLoading && !recentPosts.length" class="widget-status" role="status">正在读取更新…</p>
                      <div v-else-if="recentError" class="widget-status" role="status"><span>{{ recentError }}</span><button type="button" @click="loadRecentPosts">重试</button></div>
                      <p v-else-if="!recentPosts.length" class="widget-status">还没有发布的随笔</p>
                      <ol v-else class="recent-list">
                          <li v-for="post in recentPosts" :key="post.id">
                              <RouterLink :to="'/post/' + post.id" class="recent-link">
                                  <span class="recent-cover" aria-hidden="true">
                                      <img v-if="recentCover(post.coverImage) && !failedCovers.has(post.id)" :src="recentCover(post.coverImage)" alt="" loading="lazy" @error="failedCovers.add(post.id)">
                                      <i v-else class="ph-light ph-note-pencil"></i>
                                  </span>
                                  <span class="recent-copy"><span class="recent-title">{{ post.title || '无标题随笔' }}</span><time :datetime="post.updateTime">{{ post.updateTime?.slice(0, 10) }}</time></span>
                                  <i class="ph-bold ph-arrow-up-right recent-arrow" aria-hidden="true"></i>
                              </RouterLink>
                          </li>
                      </ol>
                  </section>

                  <section class="journal-widget quote-widget" v-spotlight aria-labelledby="quoteTitle" :aria-busy="quoteLoading || !!quoteSaving">
                      <div class="widget-heading">
                          <h3 id="quoteTitle" class="art-panel-title"><i class="ph-light ph-quotes" aria-hidden="true"></i>今日一言</h3>
                          <button v-if="authStore.isGlobalAdmin" type="button" class="mood-edit" :aria-expanded="quoteEditorOpen" aria-controls="quoteEditor" :disabled="!!quoteSaving" @click="openQuoteEditor"><i class="ph-bold ph-pencil-simple" aria-hidden="true"></i>编辑</button>
                          <span v-else class="widget-kicker">DAILY</span>
                      </div>
                      <blockquote v-if="dailyQuote" class="daily-quote" aria-live="polite">“{{ dailyQuote }}”</blockquote>
                      <p v-else-if="quoteLoading" class="widget-status" role="status">正在读取今日一言…</p>
                      <p v-else-if="!quoteError" class="widget-status">今天的一句话，还没落笔。</p>
                      <div v-if="quoteError" class="widget-status" role="status"><span>{{ quoteError }}</span><button type="button" :disabled="quoteLoading || !!quoteSaving" @click="loadDailyQuote">重试</button></div>
                      <Transition name="quote-panel">
                          <div v-if="authStore.isGlobalAdmin && quoteEditorOpen" class="quote-editor-reveal">
                              <form id="quoteEditor" class="quote-editor" @submit.prevent="saveQuote(false)">
                                  <label for="quoteDraft">写下今天的一句话</label>
                                  <textarea id="quoteDraft" v-model="draftQuote" rows="2" maxlength="80" placeholder="留一句值得记住的话。" :disabled="!!quoteSaving" aria-describedby="quoteLimit" :aria-invalid="!!draftQuote && !quoteDraftValid"></textarea>
                                  <div id="quoteLimit" class="quote-editor-note"><span>含标点不超过20字 · 当天有效</span><span :class="{ 'is-over-limit': quoteDraftCount > 20 }">{{ quoteDraftCount }} / 20</span></div>
                                  <div v-if="!quoteConfirmOpen" class="quote-editor-actions">
                                      <button type="button" :disabled="!!quoteSaving || quoteLoading || !quoteReady || quoteAiAttempted" @click="confirmGenerateQuote"><i class="ph-light" :class="quoteSaving === 'ai' ? 'ph-spinner-gap animate-spin' : 'ph-sparkle'" aria-hidden="true"></i>{{ quoteSaving === 'ai' ? '生成中…' : quoteAiAttempted ? '今日已尝试AI' : 'AI生成一次' }}</button>
                                      <button type="submit" class="quote-save" :disabled="!!quoteSaving || !quoteDraftValid">{{ quoteSaving === 'manual' ? '保存中…' : '保存手写' }}</button>
                                  </div>
                                  <Transition name="quote-confirm">
                                      <div v-if="quoteConfirmOpen" class="quote-generate-confirm" role="group" aria-label="确认生成今日一言">
                                          <p class="quote-editor-hint">生成成功会替换当前短句，失败也会消耗今天的机会。确定继续？</p>
                                          <div class="quote-editor-actions">
                                              <button type="button" @click="quoteConfirmOpen = false">取消</button>
                                              <button type="button" class="quote-save" @click="saveQuote(true)">确认生成一次</button>
                                          </div>
                                      </div>
                                  </Transition>
                                  <p class="quote-editor-hint">AI每天最多尝试一次，成功后直接发布；手写可再次修改。</p>
                              </form>
                          </div>
                      </Transition>
                      <p v-if="authStore.isGlobalAdmin && quoteSaveError" class="mood-message" role="alert">{{ quoteSaveError }}</p>
                  </section>
                  <section class="journal-widget visitors-widget" v-spotlight aria-labelledby="visitorsTitle" :aria-busy="usersLoading">
                      <div class="widget-heading"><h3 id="visitorsTitle" class="art-panel-title"><i class="ph-light ph-footprints" aria-hidden="true"></i>最近来客</h3><span class="widget-kicker">HELLO / {{ String(recentUsers.length).padStart(2, '0') }}</span></div>
                      <p v-if="usersLoading && !recentUsers.length" class="widget-status" role="status">正在收集足迹…</p>
                      <div v-else-if="usersError" class="widget-status" role="status"><span>{{ usersError }}</span><button type="button" @click="loadRecentUsers">重试</button></div>
                      <p v-else-if="!recentUsers.length" class="widget-status">还没有来客，留一处安静的座位。</p>
                      <div v-else class="visitors-viewport" :class="{ 'is-scrolling': scrollUsers }" tabindex="0" aria-label="最新加入的用户，悬停或聚焦可暂停滚动">
                          <div class="visitors-track" :style="{ '--visitors-duration': `${recentUsers.length * 2}s` }">
                              <ul v-for="copy in (scrollUsers ? 2 : 1)" :key="copy" class="visitors-list" :aria-hidden="copy === 2 ? 'true' : undefined">
                                  <li v-for="user in recentUsers" :key="`${copy}-${user.id}`" class="visitor-row">
                                      <img :src="visitorAvatar(user)" alt="" width="24" height="24" decoding="async" @error="failedAvatars.add(String(user.avatar || '').trim())">
                                      <span class="visitor-name" :title="user.nickname || '无名来客'">{{ user.nickname || '无名来客' }}</span>
                                      <span v-if="user.role === SystemConstant.Role.ADMIN" class="visitor-role">站长</span>
                                      <time class="visitor-time" :datetime="user.createTime ? String(user.createTime).replace(' ', 'T') : undefined" :title="user.createTime ? `加入时间：${user.createTime}` : '加入时间暂无记录'" :aria-label="user.createTime ? `加入时间：${user.createTime}` : '加入时间暂无记录'">{{ visitorTime(user.createTime) }}</time>
                                  </li>
                              </ul>
                          </div>
                      </div>
                  </section>
              </aside>
              <div class="journal-main">
                  <div class="art-insight">
<section class="art-heatmap" v-spotlight>
                  <div class="art-heatmap-head">
                      <h3 class="art-panel-title">活跃度</h3>
                      <div class="art-year">
                          <button aria-label="上一年" @click="changeHeatmapYear(-1)" class="art-year-btn"><i
                                  class="ph-bold ph-caret-left"></i></button>
                          <span id="heatmapYearDisplay" :key="currentHeatmapYear" class="art-year-value">{{ currentHeatmapYear }}</span>
                          <button aria-label="下一年" @click="changeHeatmapYear(1)" class="art-year-btn"><i
                                  class="ph-bold ph-caret-right"></i></button>
                      </div>
                  </div>

                  <div class="art-heatmap-body">
                      <div class="art-weekdays">
                          <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
                      </div>
                      <div id="heatmapScrollContainer" ref="heatmapScrollEl" class="art-heatmap-scroll">
                          <div id="heatmapGrid" class="flex flex-wrap gap-x-[7px] gap-y-4">
                              <div v-for="(week, weekIndex) in heatmapWeeks" :key="weekIndex"
                                  class="flex flex-col gap-1.5" :style="{ '--w': weekIndex }">
                                  <div v-for="cell in week" :key="cell.date" :class="cell.cls"
                                      :title="cell.title"></div>
                              </div>
                          </div>
                      </div>
                  </div>

                  <div class="art-heatmap-foot">
                      <span id="heatmapStats" class="art-heatmap-stats">{{ heatmapStatsText }}</span>
                      <div class="art-legend">
                          <span>少</span>
                          <div class="w-3.5 h-3.5 rounded-[2px] bg-zinc-800/40 border border-zinc-800/80"></div>
                          <div class="w-3.5 h-3.5 rounded-[2px] bg-cyan-900/60 border border-cyan-800/60"></div>
                          <div class="w-3.5 h-3.5 rounded-[2px] bg-cyan-600 border border-cyan-500"></div>
                          <div
                              class="w-3.5 h-3.5 rounded-[2px] bg-cyan-400 border border-cyan-300 shadow-[0_0_8px_rgba(0,255,255,0.45)]">
                          </div>
                          <span>多</span>
                      </div>
                  </div>
              </section>
                  </div>
          <div class="art-sec-head art-blog-head">
              <h2 class="art-sec-title">随笔记录</h2>
              <p class="art-sec-meta">Blog Notes</p>
              <p class="art-sec-note">
                  <span id="journeyTotalCount" class="art-sec-stat">共 <span
                              class="art-sec-num">{{ blogTotalCount }}</span> 篇</span>
                  <span v-if="postStats" class="art-sec-sep" aria-hidden="true">·</span>
                  <span v-if="postStats" id="journeyPostStats" class="art-sec-stat">共 <span
                              class="art-sec-num">{{ postStatsWords }}</span> 字</span>
                  <span v-if="postStats" class="art-sec-sep" aria-hidden="true">·</span>
                  <span v-if="postStats" class="art-sec-stat"><i class="ph-bold ph-eye"></i> <span
                              class="art-sec-num">{{ postStatsViews }}</span></span>
              </p>
          </div>

          <div class="art-blog-filters">
              <FilterSelect id="filterBlogCategory" v-model="filterBlogCategory" :options="blogCategoryOptions" @change="applyBlogFilters" />
              <FilterSelect id="filterSort" v-model="filterSort" :options="sortOptions" @change="applyBlogFilters" />
              <div class="art-search">
                  <i class="ph-bold ph-magnifying-glass"></i>
                  <input type="text" id="searchBlogInput" v-model="searchBlogKeyword"
                      @keypress.enter="applyBlogFilters" autocomplete="off" placeholder="搜索标题或标签" aria-label="搜索标题或标签">
              </div>
              <button v-if="filterTagId" type="button" id="clearTagFilter" class="art-btn art-btn-sm art-btn-ghost"
                  @click="clearTagFilter"><i class="ph-bold ph-x"></i> 清除标签筛选: {{ activeTagName }}</button>
          </div>

          <Transition name="fade-slide" mode="out-in">
              <div id="blogList" :key="listKey" class="art-blog-list">
                  <div v-if="blogLoading && !blogs.length" class="art-empty"><i
                          class="ph-bold ph-spinner-gap animate-spin"></i> 获取随笔中...</div>
                  <BlogCard v-for="blog in blogs" :key="blog.id" :post="blog" :categories="blogCategories"
                      @deleted="handleBlogDeleted" />
                  <div v-if="!blogLoading && blogStatusMessage" class="art-empty">{{ blogStatusMessage }}</div>
              </div>
          </Transition>

          <div v-if="totalBlogPages > 1" class="art-pager">
              <button aria-label="上一页" @click="changeBlogPage(-1)" :disabled="currentBlogPage <= 1" class="art-icon-btn art-icon-btn-sm"><i
                      class="ph-bold ph-caret-left"></i></button>
              <span id="blogPageInfo" class="art-pager-info">{{ blogPageInfo }}</span>
              <button aria-label="下一页" @click="changeBlogPage(1)" :disabled="currentBlogPage >= totalBlogPages"
                  class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
          </div>
              </div>
          </div>
      </section>
  </div>
</template>

<style scoped>
/* 标题区移除后，主体紧接导航，保留必要的呼吸间距。 */
#blogView { padding-top: clamp(20px, 2.5vw, 32px); }

/* 仅收紧本页容器，文章标题、摘要的字体规则继续使用全局原样式。 */
.journal-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 7fr); gap: clamp(24px, 2.5vw, 40px); align-items: start; }
.journal-main, .journal-sidebar { min-width: 0; }

/* 随笔记录标题下的统计：数字用等宽 + 提亮一档做轻强调，标签保持弱化，不跟标题抢注意力。 */
.art-sec-note .art-sec-num {
    color: var(--art-ink);
    font-family: var(--art-mono);
    font-size: 1.1em;
    font-variant-numeric: tabular-nums;
    letter-spacing: .02em;
}
.journal-sidebar { display: flex; flex-direction: column; gap: 20px; }
.journal-main .art-insight { --insight-lift: 0px; --heat-cell: clamp(8px, .72vw, 12px); --heat-gap: 3px; display: block; margin: 0 0 38px; }
.art-heatmap { padding: 18px 22px 20px; border-radius: 22px; }
.art-insight #heatmapGrid { gap: 0 var(--heat-gap); }
.art-insight #heatmapGrid > div { gap: var(--heat-gap); }
.art-insight #heatmapGrid > div > div { width: var(--heat-cell); height: var(--heat-cell); }
.art-insight .art-weekdays { gap: var(--heat-gap); }
.art-insight .art-weekdays span { width: var(--heat-cell); height: var(--heat-cell); line-height: var(--heat-cell); }
.art-heatmap-scroll { scrollbar-width: thin; scrollbar-color: var(--art-line-2) transparent; }
.journal-main .art-blog-filters { gap: 12px 16px; }
.journal-main .art-blog-filters .art-search { max-width: none; }
.journal-main :deep(.art-blog-list) { gap: 22px; padding-top: 22px; }
.journal-main :deep(.art-blog-card) { gap: 12px; padding: 10px; }
.journal-main :deep(.art-blog-info) { padding: 10px 12px; }
.journal-main :deep(.art-blog-title) { margin-bottom: 8px; }
.journal-main :deep(.art-blog-foot) { margin-top: 12px; padding-top: 10px; gap: 8px 10px; }
.journal-main :deep(.art-blog-foot-right) { margin-left: auto; }
.journal-widget { position: relative; isolation: isolate; border: 1px solid var(--art-line); border-radius: 20px; padding: 20px 22px; background: linear-gradient(145deg, rgba(0,255,255,.035), transparent 55%), color-mix(in srgb, var(--art-bg) 45%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,.025); backdrop-filter: blur(14px); transition: border-color .4s, box-shadow .4s, transform .4s; }
.journal-widget::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none; opacity: 0; background: radial-gradient(280px circle at var(--mx, 50%) var(--my, 0%), rgba(0,255,255,.055), transparent 75%); transition: opacity .4s; }
.widget-heading .art-panel-title { display: inline-flex; align-items: center; gap: 9px; letter-spacing: .1em; }
.widget-heading .art-panel-title > i { color: var(--art-accent); font-size: 18px; opacity: .75; }
.widget-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--art-line); }
.widget-kicker { font-family: var(--art-mono); font-size: 9px; letter-spacing: .13em; color: var(--art-ink-4); text-align: right; overflow-wrap: anywhere; }
.category-filters { display: flex; flex-wrap: wrap; align-content: start; gap: 8px; max-height: 154px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--art-line-2) transparent; margin-top: 16px; padding: 2px 4px 4px 2px; }
.category-filters button { flex: 0 1 auto; min-width: 0; max-width: 100%; border: 1px solid var(--art-line); border-radius: 8px; padding: 7px 11px; font-size: 11px; line-height: 1.5; color: var(--art-ink-3); background: transparent; transition: color .3s, border-color .3s, background .3s; }
.category-name { overflow-wrap: anywhere; }
.category-filters button.is-active{ color: var(--art-accent); border-color: color-mix(in srgb, var(--art-accent) 30%, transparent); background: color-mix(in srgb, var(--art-accent) 7%, transparent); }
@media (hover: hover) and (pointer: fine){.category-filters button:hover{ color: var(--art-accent); border-color: color-mix(in srgb, var(--art-accent) 30%, transparent); background: color-mix(in srgb, var(--art-accent) 7%, transparent); }}
.category-filters:focus-visible { outline: 1px solid var(--art-accent); outline-offset: 3px; }
.mood-edit { display: inline-flex; align-items: center; gap: 5px; padding: 4px 0 4px 6px; font-size: 10px; color: var(--art-accent); }
.mood-scene { display: flex; align-items: center; gap: 18px; padding: 24px 0 20px; }
.mood-face { display: grid; place-items: center; position: relative; isolation: isolate; flex: 0 0 68px; height: 74px; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; font-size: 47px; line-height: 1; filter: drop-shadow(0 5px 12px rgba(0,0,0,.1)); }
.mood-face::before { content: ''; position: absolute; inset: 5px -2px; border-radius: 45% 55% 60% 40%; background: radial-gradient(circle at 35% 30%, rgba(255,209,128,.13), rgba(0,255,255,.035)); border: 1px solid rgba(255,209,128,.1); z-index: -1; transform: rotate(-12deg); }
.mood-copy { flex: 1; min-width: 0; }
.mood-label { display: block; font-size: 11px; color: var(--art-ink-2); letter-spacing: .1em; }
.mood-label > span { margin-left: 8px; color: var(--art-ink-4); font-family: var(--art-mono); font-size: 9px; letter-spacing: .02em; }
.mood-copy p { margin: 9px 0 0; font-family: var(--art-serif); font-size: 14px; line-height: 1.9; color: var(--art-ink-2); overflow-wrap: anywhere; }
.mood-empty .mood-face { opacity: .7; font-size: 40px; }
.mood-empty .mood-copy p { font-family: inherit; font-size: 12px; color: var(--art-ink-4); }
.mood-context { display: flex; flex-direction: column; gap: 6px; margin: 0; padding-top: 12px; border-top: 1px dashed var(--art-line); font-size: 10px; line-height: 1.7; color: var(--art-ink-3); }
.mood-context small { font-size: 9px; color: var(--art-ink-4); }
.mood-picker { padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--art-line); }
.mood-picker-title { margin: 0 0 12px; font-size: 11px; color: var(--art-ink-3); }
.mood-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mood-options button { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 4px 10px; border: 1px solid var(--art-line); border-radius: 12px; font-size: 11px; color: var(--art-ink-3); background: transparent; transition: background .2s, border-color .2s; }
.mood-options button > span { font-size: 25px; line-height: 1.2; }
.mood-options button.is-selected{ border-color: color-mix(in srgb, var(--art-accent) 35%, transparent); background: color-mix(in srgb, var(--art-accent) 6%, transparent); color: var(--art-accent); }
@media (hover: hover) and (pointer: fine){.mood-options button:hover{ border-color: color-mix(in srgb, var(--art-accent) 35%, transparent); background: color-mix(in srgb, var(--art-accent) 6%, transparent); color: var(--art-accent); }}
.mood-cache-note { margin: 12px 0; font-size: 10px; line-height: 1.8; color: var(--art-ink-4); }
.mood-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.mood-actions button { padding: 8px 12px; border-radius: 8px; font-size: 11px; color: var(--art-ink-3); }
.mood-actions .mood-submit { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--art-accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--art-accent) 22%, transparent); color: var(--art-accent); }
.mood-widget button:disabled { opacity: .5; cursor: wait; }
.mood-message { margin: 0 0 12px; font-size: 11px; line-height: 1.8; color: var(--art-ink-3); }
.tag-constellation { position: relative; isolation: isolate; margin: 0 -8px; }
.tag-orbits { position: absolute; inset: 0; overflow: hidden; z-index: -1; pointer-events: none; background: radial-gradient(ellipse at center, color-mix(in srgb, var(--art-accent) 4%, transparent), transparent 70%); }
.tag-orbits > span { position: absolute; left: 10%; top: 24%; width: 80%; height: 52%; border: 1px solid color-mix(in srgb, var(--art-accent) 10%, transparent); border-radius: 50%; transform: rotate(-24deg); }
.tag-orbits > span:nth-child(2) { left: 22%; top: 7%; width: 56%; height: 86%; transform: rotate(30deg); border-style: dashed; border-color: color-mix(in srgb, var(--art-accent) 8%, transparent); }
.tag-orbits > i { position: absolute; left: 14%; top: 70%; color: var(--art-accent); opacity: .28; font: 13px var(--art-mono); }
.tag-orbits > i:nth-of-type(2) { left: 85%; top: 22%; }
.tag-orbits > i:nth-of-type(3) { left: 50%; top: 8%; font-size: 24px; }
.tag-widget .art-tagcloud-body { position: relative; min-height: 158px; padding: 30px 8px; gap: 18px 12px; align-content: center; justify-content: center; }
.tag-widget .art-tagcloud-item { flex: 0 1 auto; min-width: 0; align-items: center; padding: 7px 11px; gap: 8px; border-radius: 11px; font-size: min(var(--tag-size), 18px); background: color-mix(in srgb, var(--art-bg) 88%, hsl(var(--tag-h) 60% 55%) 12%); border-color: hsl(var(--tag-h) 65% 65% / .22); }
.tag-widget .art-tagcloud-item:nth-child(3n + 2) { margin-top: 18px; }
.tag-widget .art-tagcloud-item:nth-child(3n) { margin-top: -8px; }
.tag-widget .art-tagcloud-item.is-active{ border-color: hsl(var(--tag-h) 75% 65% / .65); background: color-mix(in srgb, var(--art-bg) 80%, hsl(var(--tag-h) 65% 55%) 20%); }
@media (hover: hover) and (pointer: fine){.tag-widget .art-tagcloud-item:hover{ border-color: hsl(var(--tag-h) 75% 65% / .65); background: color-mix(in srgb, var(--art-bg) 80%, hsl(var(--tag-h) 65% 55%) 20%); }}
.tag-node { flex: 0 0 5px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; opacity: .8; }
.tag-name { min-width: 0; overflow-wrap: anywhere; }
.tag-widget .art-tagcloud-count { align-self: center; flex-shrink: 0; padding: 2px 5px; font-size: 9px; font-weight: 400; border-radius: 4px; }
.tag-caption { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid var(--art-line); padding-top: 12px; font-size: 10px; line-height: 1.7; color: var(--art-ink-4); }
.tag-caption > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.tag-caption button { flex-shrink: 0; color: var(--art-ink-3); }
@media (hover: hover) and (pointer: fine){.tag-caption button:hover{ color: var(--art-accent); }}
.widget-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 80px; margin: 0; font-size: 12px; line-height: 1.8; color: var(--art-ink-3); }
.widget-status button { flex-shrink: 0; color: var(--art-accent); font-size: 11px; }
.weather-unavailable { min-height: 104px; }
.weather-offline-icon { font-size: 32px; color: var(--art-ink-4); opacity: .65; }
.weather-unavailable > div { flex: 1; }
.weather-unavailable small { display: block; margin-top: 5px; font-size: 10px; color: var(--art-ink-4); }
.weather-current { display: flex; align-items: center; justify-content: space-between; padding: 18px 0 8px; }
.weather-temp { font-family: var(--art-mono); font-size: 48px; line-height: 1.2; font-weight: 300; letter-spacing: -.08em; color: var(--art-ink); }
.weather-temp small { font-size: 28px; vertical-align: top; letter-spacing: 0; }
.weather-unit { font-family: var(--art-mono); font-size: 12px; color: var(--art-ink-3); padding-left: 6px; }
.weather-condition { display: flex; align-items: center; gap: 10px; color: var(--art-ink-2); font-size: 12px; }
.weather-condition i { color: var(--art-accent); font-size: 32px; }
.weather-wind { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--art-ink-3); margin: 0 0 18px; }
.weather-wind span { color: var(--art-ink-4); font-family: var(--art-mono); font-size: 10px; }
.weather-forecast { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--art-line); padding-top: 16px; }
.weather-forecast > div { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: var(--art-mono); font-size: 10px; color: var(--art-ink-3); }
.weather-forecast > div + div { border-left: 1px solid var(--art-line); }
.weather-forecast i { font-size: 20px; color: var(--art-ink-2); }
.weather-credit { display: block; margin-top: 16px; font-size: 9px; text-align: right; color: var(--art-ink-4); }
.recent-list { list-style: none; padding: 0; margin: 6px 0 -6px; }
.recent-list li + li { border-top: 1px solid var(--art-line); }
.recent-link { display: flex; align-items: center; gap: 12px; padding: 14px 0; }
.recent-cover { display: grid; place-items: center; overflow: hidden; flex: 0 0 58px; height: 46px; border: 1px solid var(--art-line); border-radius: 9px; background: linear-gradient(140deg, rgba(0,255,255,.09), rgba(0,255,255,.01)); color: var(--art-ink-3); font-size: 20px; }
.recent-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s; }
.recent-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 7px; }
.recent-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; color: var(--art-ink-2); font-size: 12px; line-height: 1.7; transition: color .3s; }
.recent-copy time { font-family: var(--art-mono); font-size: 9px; letter-spacing: .05em; color: var(--art-ink-4); }
.recent-arrow { font-size: 12px; color: var(--art-ink-4); transition: color .3s, transform .3s; }
@media (hover: hover) and (pointer: fine){.recent-link:hover .recent-title, .recent-link:hover .recent-arrow{ color: var(--art-accent); }}
@media (hover: hover) and (pointer: fine){.recent-link:hover img{ transform: scale(1.06); }}
@media (hover: hover) and (pointer: fine){.recent-link:hover .recent-arrow{ transform: translate(2px, -2px); }}
.daily-quote { margin: 24px 0 20px; padding-left: 14px; border-left: 2px solid color-mix(in srgb, var(--art-accent) 30%, transparent); font-family: var(--art-serif); font-size: 18px; line-height: 1.9; letter-spacing: .05em; color: var(--art-ink-2); overflow-wrap: anywhere; }
.quote-editor { padding-top: 15px; border-top: 1px solid var(--art-line); }
/* 编辑区展开/收起：行高从 0fr 长到 1fr，内边距与描边一起生长，不是生硬地跳出来 */
.quote-editor-reveal { display: grid; grid-template-rows: 1fr; }
.quote-editor-reveal .quote-editor { min-height: 0; overflow: hidden; }
.quote-panel-enter-active, .quote-panel-leave-active { transition: grid-template-rows .32s cubic-bezier(.22, 1, .36, 1), opacity .24s ease, transform .32s cubic-bezier(.22, 1, .36, 1); }
.quote-panel-enter-active .quote-editor, .quote-panel-leave-active .quote-editor { transition: padding .32s ease, border-width .32s ease; }
.quote-panel-enter-from, .quote-panel-leave-to { grid-template-rows: 0fr; opacity: 0; transform: translateY(-6px); }
.quote-panel-enter-from .quote-editor, .quote-panel-leave-to .quote-editor { padding-top: 0; border-top-width: 0; }
/* 手写按钮区与 AI 确认块交叉淡入淡出，切换不突兀 */
.quote-confirm-enter-active, .quote-confirm-leave-active { transition: opacity .2s ease, transform .2s ease; }
.quote-confirm-enter-from { opacity: 0; transform: translateY(-6px); }
.quote-confirm-leave-to { opacity: 0; transform: translateY(5px); }
.quote-editor label { display: block; color: var(--art-ink-2); font-size: 11px; margin-bottom: 9px; }
.quote-editor textarea { display: block; width: 100%; resize: vertical; min-height: 74px; max-height: 160px; border: 1px solid var(--art-line); border-radius: 10px; background: transparent; color: var(--art-ink); padding: 10px 12px; font-family: var(--art-font); font-size: 12px; line-height: 1.8; transition: border-color .2s ease; }
.quote-editor textarea:focus-visible { outline: 1px solid var(--art-accent); outline-offset: 2px; border-color: var(--art-accent); }
.quote-editor-note { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-top: 7px; color: var(--art-ink-3); font-size: 10px; }
.quote-editor-note .is-over-limit { color: #e68f8f; }
.quote-editor-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
.quote-editor-actions button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; padding: 8px 10px; border: 1px solid var(--art-line); border-radius: 8px; color: var(--art-ink-2); font-size: 11px; transition: background .2s ease, border-color .2s ease; }
.quote-editor-actions .quote-save { margin-left: auto; color: var(--art-accent); }
@media (hover: hover) and (pointer: fine){.quote-editor-actions button:not(:disabled):hover{ border-color: var(--art-accent); background: color-mix(in srgb, var(--art-accent) 6%, transparent); }}
.quote-editor-actions button:focus-visible { outline: 1px solid var(--art-accent); outline-offset: 3px; }
.quote-editor-actions button:disabled, .quote-editor textarea:disabled { opacity: .45; cursor: not-allowed; }
.quote-editor-hint { margin-top: 10px; color: var(--art-ink-3); font-size: 10px; line-height: 1.8; }
@media (prefers-reduced-motion: reduce) {
    .quote-editor *, .quote-editor *::before,
    .quote-editor-reveal, .quote-panel-enter-active, .quote-panel-leave-active,
    .quote-confirm-enter-active, .quote-confirm-leave-active { animation: none !important; transition: none !important; }
}
.quote-credit { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 0; text-align: right; font-family: var(--art-mono); font-size: 9px; letter-spacing: .1em; color: var(--art-ink-4); }
.quote-credit > span { width: 18px; height: 1px; background: var(--art-line-2); }
.journal-widget button:focus-visible, .journal-widget a:focus-visible { outline: 2px solid var(--art-accent); outline-offset: 4px; }
:global(body.theme-light .journal-widget) { background: #fff; box-shadow: 0 4px 16px rgba(15,23,42,.035); }
@media (min-width: 768px) {
    .journal-main :deep(.art-blog-card) { height: auto; min-height: 248px; }
    .journal-main :deep(.art-blog-media) { flex: 0 0 42%; max-width: 42%; height: auto; min-height: 220px; }
    .journal-main :deep(.art-blog-media img), .journal-main :deep(.art-blog-media video), .journal-main :deep(.art-blog-media .art-media-mosaic) { position: absolute; inset: 0; }
    .journal-main :deep(.art-blog-info) { flex: 1; width: auto; }
    .journal-main :deep(.art-blog-excerpt) { -webkit-line-clamp: 3; }
}
@media (hover: hover) and (pointer: fine) {
    .journal-widget:hover { border-color: rgba(0,255,255,.22); box-shadow: 0 8px 24px rgba(0,0,0,.08); transform: translateY(-2px); }
    .journal-widget:hover::before { opacity: 1; }
}
@media (max-width: 1023px) {
    .journal-layout { grid-template-columns: minmax(0, 1fr); }
    .journal-main { order: -1; }
    .journal-sidebar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
}
@media (max-width: 767px) {
    /* 手机上关掉 7 张侧栏卡片的毛玻璃：backdrop-filter 每帧都要重算，
       滚动时会把 GPU 拖垮（表现就是热力图闪出半张）。清爽模式本来就已经关了玻璃 */
    .journal-widget {
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
    }
    /* 手机端卡片再收一点：摘要本来就不显示，标题下面那截留白
       （卡片 head 的 20px 下边距 + 页脚 12px 上边距）看着很空。封面 170px 高度保持不动。 */
    .journal-main :deep(.art-blog-card) { gap: 10px; padding: 8px; }
    .journal-main :deep(.art-blog-info) { padding: 8px 10px; }
    .journal-main :deep(.art-blog-head) { margin-bottom: 6px; }
    .journal-main :deep(.art-blog-foot) { margin-top: 6px; padding-top: 8px; }
    /* 标签多的时候别跟点赞/评分/继续阅读抢同一行：
       给它一整行，5 个标签也能完整排下，卡片高度也只是多这一行，不会被撑成三行 */
    .journal-main :deep(.art-blog-foot-right) { order: 1; margin-left: auto; }
    .journal-main :deep(.art-blog-tags) { order: 2; flex: 1 1 100%; }
    /* 两个下拉并排、搜索整行：筛选条从三行压到两行 */
    .journal-main .art-blog-filters { gap: 10px; }
    .journal-main .art-blog-filters :deep(.custom-select-wrapper) { flex: 1 1 calc(50% - 5px); }
    .journal-main .art-blog-filters .art-search { flex: 1 1 100%; }
    /* 年份切换是点击控件，触控区不能停在 30px */
    .art-heatmap .art-year { gap: 6px; }
    .art-heatmap .art-year-btn { width: 40px; height: 40px; font-size: 13px; }
    .art-heatmap .art-year-value { width: 60px; }
}
@media (max-width: 639px) {
    .journal-sidebar { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .journal-widget, .art-heatmap { padding: 16px; border-radius: 20px; }
    .journal-main .art-insight { margin-bottom: 32px; }

    /* 手机一行放不下「标题 + BLOG NOTES + 统计」，优先保证「标题在左、统计贴最右同行」：
       装饰性的英文标签让位隐藏。统计过长时整体折到第二行贴右，绝不与标题重叠。 */
    .art-sec-head.art-blog-head { column-gap: 10px; row-gap: 8px; }
    .art-sec-head.art-blog-head .art-sec-meta { display: none; }
}
@media (prefers-reduced-motion: reduce) {
    .journal-widget, .journal-widget::before, .recent-arrow, .recent-cover img, .category-filters button, .mood-options button, .tag-widget .art-tagcloud-item { animation: none; transition: none; transform: none; }
}
/* 分类数量与城市选择保持紧凑，不改变文章栏尺寸。 */
.category-filters button { display: inline-flex; align-items: center; gap: 8px; }
.category-name { min-width: 0; }
.category-count { flex-shrink: 0; text-align: center; min-width: 15px; font: 10px var(--art-mono); color: var(--art-ink-3); opacity: .8; }
.weather-city-edit { display: inline-flex; align-items: center; gap: 5px; margin: -4px 0 10px; padding: 5px 0; font-size: 11px; color: var(--art-accent); }
.city-picker { border-block: 1px solid var(--art-line); padding: 14px 0; margin-bottom: 16px; }
.city-picker label { display: block; font-size: 11px; color: var(--art-ink-2); margin-bottom: 9px; }
.city-search { display: flex; gap: 8px; }
.city-search input { width: 0; flex: 1; min-width: 0; padding: 9px; border: 1px solid var(--art-line); border-radius: 8px; background: transparent; color: var(--art-ink); font-size: 12px; }
.city-search button { flex-shrink: 0; padding: 8px; border: 1px solid var(--art-line); border-radius: 8px; font-size: 11px; color: var(--art-accent); }
.city-hint { font-size: 10px; line-height: 1.7; color: var(--art-ink-3); margin: 8px 0 0; }
.city-results { list-style: none; padding: 0; margin: 8px 0 0; max-height: 170px; overflow-y: auto; }
.city-results button { display: flex; width: 100%; align-items: center; justify-content: space-between; text-align: left; padding: 9px 3px; border-bottom: 1px solid var(--art-line); font-size: 12px; color: var(--art-ink-2); }
.city-results button small { display: block; margin-top: 3px; font-size: 10px; color: var(--art-ink-3); }
.city-picker button:disabled, .weather-city-edit:disabled { opacity: .5; cursor: wait; }
.city-picker-chevron { transition: transform .25s ease; }
.weather-city-edit[aria-expanded="true"] .city-picker-chevron { transform: rotate(180deg); }
.city-picker-reveal { display: grid; grid-template-rows: 1fr; }
.city-picker-reveal .city-picker { min-height: 0; overflow: hidden; }
.city-panel-enter-active, .city-panel-leave-active { transition: grid-template-rows .28s ease, opacity .22s ease, transform .28s ease; }
.city-panel-enter-active .city-picker, .city-panel-leave-active .city-picker { transition: padding .28s ease, margin .28s ease, border-width .28s ease; }
.city-panel-enter-from, .city-panel-leave-to { grid-template-rows: 0fr; opacity: 0; transform: translateY(-5px); }
.city-panel-enter-from .city-picker, .city-panel-leave-to .city-picker { padding-block: 0; margin-bottom: 0; border-width: 0; }
.city-results li { animation: city-result-in .3s ease both; animation-delay: var(--city-delay, 0ms); }
.city-results button { transition: background .2s ease, color .2s ease, padding .2s ease; }
.city-results button:focus-visible{ padding-left: 8px; color: var(--art-accent); background: color-mix(in srgb, var(--art-accent) 6%, transparent); }
@media (hover: hover) and (pointer: fine){.city-results button:not(:disabled):hover{ padding-left: 8px; color: var(--art-accent); background: color-mix(in srgb, var(--art-accent) 6%, transparent); }}
.city-search input { transition: border-color .2s ease, box-shadow .2s ease; }
.city-search input:focus-visible { outline: none; border-color: var(--art-accent); box-shadow: inset 0 0 0 1px var(--art-line); }
.city-results button:focus-visible, .city-search button:focus-visible, .weather-city-edit:focus-visible { outline: 1px solid var(--art-accent); outline-offset: -1px; }
.weather-current { animation: city-result-in .35s ease both; }
@keyframes city-result-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.visitors-widget { height: 256px; box-sizing: border-box; }
.visitors-viewport { height: 160px; overflow: hidden; position: relative; mask-image: linear-gradient(to bottom, transparent, #000 8px, #000 calc(100% - 8px), transparent); }
.visitors-list { list-style: none; padding: 0; margin: 0; }
.visitor-row { display: flex; align-items: center; gap: 10px; height: 32px; padding: 4px 2px; box-sizing: border-box; }
.visitor-row img { width: 24px; height: 24px; flex: 0 0 24px; border: 1px solid var(--art-line); border-radius: 50%; object-fit: cover; }
.visitor-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--art-ink-3); font-size: 11px; }
.visitor-time { flex: 0 0 auto; margin-left: auto; color: var(--art-ink-4); font: 9px var(--art-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.visitor-role { color: var(--art-accent); opacity: .7; font-size: 9px; }
.is-scrolling .visitors-track { animation: visitors-rise var(--visitors-duration) linear infinite; }
.visitors-widget:focus-within .visitors-track{ animation-play-state: paused; }
@media (hover: hover) and (pointer: fine){.visitors-widget:hover .visitors-track{ animation-play-state: paused; }}
.visitors-viewport:focus-visible { outline: 1px solid var(--art-accent); outline-offset: 4px; }
@keyframes visitors-rise { from { transform: translateY(0); } to { transform: translateY(-50%); } }
@media (prefers-reduced-motion: reduce) {
    .city-picker-reveal, .city-picker-reveal *, .city-picker-chevron, .weather-current { animation: none !important; transition: none !important; }
    .city-panel-enter-from, .city-panel-leave-to { transform: none; }
    .is-scrolling .visitors-track { animation: none; transform: none; }
    .visitors-list[aria-hidden="true"] { display: none; }
    .visitors-viewport { overflow-y: auto; mask-image: none; }
}</style>
