<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MdEditor, MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import 'md-editor-v3/lib/preview.css'

import FilterSelect from '@/components/FilterSelect.vue'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { appliedLightMode, useUiStore } from '@/stores/useUiStore'
import { request } from '@/utils/request'
import { tagHue } from '@/utils/tagColor'
import { firstLine } from '@/utils/text'

const uiStore = useUiStore()
const categoryStore = useCategoryStore()

/* md-editor 跟随实际生效的主题，和整页换肤同一刻变色 */
const mdTheme = computed(() => (appliedLightMode.value ? 'light' : 'dark'))

const activePanel = ref('panelBlog')
/* 面板顺序决定切换动画方向：往后切从右侧滑入，往回切从左侧滑入 */
const PANEL_ORDER = ['panelBlog', 'panelCategory', 'panelTag', 'panelResource']
const panelDirection = ref('is-fwd')

/* ---------------- 随笔表单 ---------------- */
const formPostId = ref('')
const formPostTitle = ref('')
const formPostCategory = ref('')
const formPostContent = ref('')
const MAX_POST_TAGS = 5
const formPostTagIds = ref([])
/* 编辑态标题快照 */
const editingPanelTitle = ref('')
/* 沉浸写作大屏弹窗开关 */
const blogEditorOpen = ref(false)

const submitting = ref(false)
const submitBusyLabel = ref('')

const categoryOptions = computed(() =>
  categoryStore.options.length
    ? categoryStore.options
    : [{ value: '', label: '暂无分类，请先去分类管理添加' }],
)

const blogSubmitLabel = computed(() => (formPostId.value ? '保存修改' : '发布随笔'))
const blogPanelTitle = computed(() => (formPostId.value ? editingPanelTitle.value : '创建新随笔'))
const postContentLength = computed(() => formPostContent.value.length)

/* 表单里的草稿预览：沉浸写作期间被弹窗盖住，先冻结不跟着每个按键重渲染，关闭时再同步 */
const miniPreviewContent = ref('')
watch(
  [formPostContent, blogEditorOpen],
  ([content, open]) => {
    if (!open) miniPreviewContent.value = content
  },
  { immediate: true },
)

/* ---------------- 标签选择 ---------------- */
const allTags = ref([])

async function loadTags() {
  try {
    const res = await request('/tag/list?pageNum=1&pageSize=500')
    allTags.value = res.records || res || []
  } catch (e) {}
}

function toggleTag(id) {
  const next = new Set(formPostTagIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    if (next.size >= MAX_POST_TAGS) return uiStore.showToast(`最多选择 ${MAX_POST_TAGS} 个标签`, false)
    next.add(id)
  }
  formPostTagIds.value = [...next]
}

/* 分类变化后回到第一项，避免停在一个已失效的值 */
watch(
  categoryOptions,
  (options) => {
    if (options.length && options[0].value && !options.some((o) => o.value === formPostCategory.value))
      formPostCategory.value = options[0].value
  },
  { immediate: true },
)

function clearBlogForm() {
  formPostId.value = ''
  formPostTitle.value = ''
  formPostContent.value = ''
  formPostTagIds.value = []
  editingPanelTitle.value = ''
  /* 分类保留当前选择，失效回落第一项 */
  if (!categoryOptions.value.some((o) => o.value === formPostCategory.value))
    formPostCategory.value = categoryOptions.value[0]?.value || ''
}

/* 正文里的第一张图，自动拿来当封面 */
function extractCover(source) {
  const match = String(source || '').match(/!\[.*?\]\((.*?)\)/)
  return match && match[1] ? match[1].trim() : null
}

async function submitBlog() {
  const categoryId = formPostCategory.value ? Number(formPostCategory.value) : null
  const title = formPostTitle.value.trim()
  const content = formPostContent.value.trim()

  if (!title) return uiStore.showToast('请输入标题', false)
  if (!categoryId) return uiStore.showToast('请选择一个分类', false)
  if (!content) return uiStore.showToast('请输入随笔正文', false)

  submitting.value = true
  try {
    const payload = {
      categoryId,
      title,
      content,
      coverImage: extractCover(content),
      tagIds: formPostTagIds.value,
    }
    if (formPostId.value) payload.id = Number(formPostId.value)

    submitBusyLabel.value = '保存中...'
    await request(formPostId.value ? '/blog/update' : '/blog/add', {
      method: formPostId.value ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    })
    uiStore.showToast(formPostId.value ? '随笔已更新' : '随笔已发布')
    uiStore.refreshStats()
    uiStore.refreshPosts()
    if (!formPostId.value) uiStore.refreshHeatmap()
    clearBlogForm()
  } catch (e) {
  } finally {
    submitting.value = false
    submitBusyLabel.value = ''
  }
}

/* MdEditor 图片直传：逐个走 /blog/upload，再用回调把外链插回 Markdown */
async function onUploadImg(files, callback) {
  const urls = []
  try {
    for (let i = 0; i < files.length; i++) {
      submitBusyLabel.value = `上传图片 ${i + 1}/${files.length}...`
      const formData = new FormData()
      formData.append('file', files[i])
      urls.push(await request('/blog/upload', { method: 'POST', body: formData }))
    }
    callback(urls)
  } catch (e) {
    uiStore.showToast('图片上传失败，请重试', false)
  } finally {
    submitBusyLabel.value = ''
  }
}

/* 沉浸写作弹窗：正文绑在 formPostContent 上，关闭保留草稿 */
function closeBlogEditor() {
  blogEditorOpen.value = false
  uiStore.showToast('已保存')
}

/* 清空正文：先走二次确认 */
function clearBlogContent() {
  if (!formPostContent.value) {
    return uiStore.showToast('正文已经是空的啦', false)
  }
  uiStore.openConfirm('确定要清空随笔正文吗？此操作不可撤销。', () => {
    formPostContent.value = ''
    uiStore.showToast('正文已清空')
  })
}

/* 草稿到达后回显表单 */
watch(
  () => uiStore.postEditDraft,
  async (draft) => {
    if (!draft) return
    if (!allTags.value.length) await loadTags()
    formPostId.value = draft.id
    formPostTitle.value = draft.title || ''
    formPostCategory.value = draft.categoryId ? String(draft.categoryId) : ''
    formPostContent.value = draft.content || ''
    /* 详情只带回 tagNames，按名称匹配现有标签回显 */
    const names = Array.isArray(draft.tagNames) ? draft.tagNames : []
    formPostTagIds.value = allTags.value.filter((t) => names.includes(t.name)).map((t) => t.id)
    editingPanelTitle.value = `编辑随笔: ${draft.title || firstLine(draft.content) || '无标题'}`
    activePanel.value = 'panelBlog'
    uiStore.showToast('可以开始编辑')
    uiStore.consumePostEditDraft()
  },
  { immediate: true },
)

/* ---------------- 分类管理 ---------------- */
const adminCategories = ref([])
const adminStatusMessage = ref('')
const currentCategoryPage = ref(1)
const totalCategoryPages = ref(1)
const categoryTotal = ref(0)

const formCatId = ref('')
const formCatName = ref('')
const searchCatName = ref('')

const categoryLoaded = ref(false)
const categoryPageInfo = computed(() =>
  categoryLoaded.value
    ? `第 ${currentCategoryPage.value} 页 / 共 ${totalCategoryPages.value} 页`
    : '第 1 页',
)
const categoryCountText = computed(() => (categoryLoaded.value ? `· 共 ${categoryTotal.value} 个` : ''))

let catSeq = 0

async function loadAdminCategories() {
  const seq = ++catSeq
  try {
    let url = `/category/list?pageNum=${currentCategoryPage.value}&pageSize=8`
    if (searchCatName.value.trim()) url += `&name=${encodeURIComponent(searchCatName.value.trim())}`

    const res = await request(url)
    if (seq !== catSeq) return
    const data = res.records || res
    const total = res.total !== undefined ? res.total : res.records ? res.records.length : data.length
    categoryTotal.value = total
    totalCategoryPages.value = Math.max(1, Math.ceil(total / 8))
    categoryLoaded.value = true

    adminCategories.value = data
    adminStatusMessage.value = data.length ? '' : '未找到分类。'
  } catch (e) {
    if (seq === catSeq) {
      adminCategories.value = []
      adminStatusMessage.value = '加载失败，请稍后重试。'
    }
  }
}

function changeCategoryPage(delta) {
  if (
    currentCategoryPage.value + delta < 1 ||
    currentCategoryPage.value + delta > totalCategoryPages.value
  )
    return
  currentCategoryPage.value += delta
  loadAdminCategories()
}

function applyCategorySearch() {
  currentCategoryPage.value = 1
  loadAdminCategories()
}

async function submitCategory() {
  const payload = { name: formCatName.value.trim() }
  if (!payload.name) return uiStore.showToast('名称不能为空', false)
  if (formCatId.value) payload.id = Number(formCatId.value)
  try {
    await request(formCatId.value ? '/category/update' : '/category/add', {
      method: formCatId.value ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    })
    uiStore.showToast('分类已保存')
    formCatName.value = ''
    formCatId.value = ''
    categoryStore.loadCategories()
    loadAdminCategories()
  } catch (e) {}
}

function editCategory(category) {
  formCatId.value = category.id
  formCatName.value = category.name
}

function deleteCategory(id) {
  uiStore.openConfirm('确定删除此分类吗？如果已有随笔使用该分类将导致失败。', async () => {
    try {
      await request(`/category/delete/${id}`, { method: 'DELETE' })
      uiStore.showToast('分类已删除')
      categoryStore.loadCategories()
      loadAdminCategories()
    } catch (e) {}
  })
}

/* ---------------- 标签管理 ---------------- */
const adminTags = ref([])
const tagStatusMessage = ref('')
const currentTagPage = ref(1)
const totalTagPages = ref(1)
const tagTotal = ref(0)

const formTagId = ref('')
const formTagName = ref('')
const searchTagName = ref('')

const tagLoaded = ref(false)
const tagPageInfo = computed(() =>
  tagLoaded.value ? `第 ${currentTagPage.value} 页 / 共 ${totalTagPages.value} 页` : '第 1 页',
)
const tagCountText = computed(() => (tagLoaded.value ? `· 共 ${tagTotal.value} 个` : ''))

let tagSeq = 0

async function loadAdminTags() {
  const seq = ++tagSeq
  try {
    let url = `/tag/list?pageNum=${currentTagPage.value}&pageSize=8`
    if (searchTagName.value.trim()) url += `&name=${encodeURIComponent(searchTagName.value.trim())}`

    const res = await request(url)
    if (seq !== tagSeq) return
    const data = res.records || res
    const total = res.total !== undefined ? res.total : res.records ? res.records.length : data.length
    tagTotal.value = total
    totalTagPages.value = Math.max(1, Math.ceil(total / 8))
    tagLoaded.value = true

    adminTags.value = data
    tagStatusMessage.value = data.length ? '' : '未找到标签。'
  } catch (e) {
    if (seq === tagSeq) {
      adminTags.value = []
      tagStatusMessage.value = '加载失败，请稍后重试。'
    }
  }
}

function changeTagPage(delta) {
  if (currentTagPage.value + delta < 1 || currentTagPage.value + delta > totalTagPages.value) return
  currentTagPage.value += delta
  loadAdminTags()
}

function applyTagSearch() {
  currentTagPage.value = 1
  loadAdminTags()
}

async function submitTag() {
  const payload = { name: formTagName.value.trim() }
  if (!payload.name) return uiStore.showToast('名称不能为空', false)
  if (formTagId.value) payload.id = Number(formTagId.value)
  try {
    await request(formTagId.value ? '/tag/update' : '/tag/add', {
      method: formTagId.value ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    })
    uiStore.showToast('标签已保存')
    formTagName.value = ''
    formTagId.value = ''
    loadTags()
    loadAdminTags()
  } catch (e) {}
}

function editTag(tag) {
  formTagId.value = tag.id
  formTagName.value = tag.name
}

function deleteTag(id) {
  uiStore.openConfirm('确定删除此标签吗？关联随笔的标签将一并移除。', async () => {
    try {
      await request(`/tag/delete/${id}`, { method: 'DELETE' })
      uiStore.showToast('标签已删除')
      loadTags()
      loadAdminTags()
    } catch (e) {}
  })
}

/* ---------------- 资源管理（杂物柜） ----------------
   这里只留新增/编辑表单：资源列表就是杂物柜页，站长在卡片上直接改删 */
const formResId = ref('')
const formResTitle = ref('')
const formResUrl = ref('')
const formResCover = ref('')
const formResDesc = ref('')

function clearResourceForm() {
  formResId.value = ''
  formResTitle.value = ''
  formResUrl.value = ''
  formResCover.value = ''
  formResDesc.value = ''
}

async function submitResource() {
  if (submitting.value) return
  const title = formResTitle.value.trim()
  const url = formResUrl.value.trim()
  if (!title) return uiStore.showToast('请填写资源标题', false)
  if (!url) return uiStore.showToast('请填写资源链接', false)

  submitting.value = true
  submitBusyLabel.value = '保存中...'
  try {
    const payload = {
      title,
      url,
      coverImage: formResCover.value.trim(),
      description: formResDesc.value.trim(),
    }
    if (formResId.value) payload.id = Number(formResId.value)
    await request(formResId.value ? '/resource/update' : '/resource/add', {
      method: formResId.value ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    })
    uiStore.showToast(formResId.value ? '资源已更新' : '资源已发布')
    clearResourceForm()
  } catch (e) {
  } finally {
    submitting.value = false
    submitBusyLabel.value = ''
  }
}

/* 杂物柜卡片上点「编辑」带回草稿，回显到表单 */
watch(
  () => uiStore.resourceEditDraft,
  (draft) => {
    if (!draft) return
    formResId.value = draft.id
    formResTitle.value = draft.title || ''
    formResUrl.value = draft.url || ''
    formResCover.value = draft.coverImage || ''
    formResDesc.value = draft.description || ''
    activePanel.value = 'panelResource'
    uiStore.showToast('可以开始编辑')
    uiStore.consumeResourceEditDraft()
  },
  { immediate: true },
)

watch(activePanel, (panel, prev) => {
  panelDirection.value = PANEL_ORDER.indexOf(panel) >= PANEL_ORDER.indexOf(prev) ? 'is-fwd' : 'is-back'
  if (panel === 'panelCategory') loadAdminCategories()
  if (panel === 'panelTag') loadAdminTags()
})

/* 沉浸写作时通知全局收起看板娘 */
watch(blogEditorOpen, (open) => {
  uiStore.setImmersiveWriting(open)
})

onMounted(() => {
  loadTags()
})

/* 离开控制台时兜底恢复 */
onUnmounted(() => {
  uiStore.setImmersiveWriting(false)
})
</script>

<template>
  <section id="adminView" class="art-section art-admin">
      <div class="art-admin-menu">
          <p class="art-admin-menu-label">控制台菜单</p>
          <button data-panel="panelBlog" @click="activePanel = 'panelBlog'"
              :class="['admin-menu-btn', activePanel === 'panelBlog' ? 'active bg-zinc-900/50' : 'text-zinc-400']">
              <span :class="activePanel === 'panelBlog' ? 'text-white' : 'text-zinc-400'">撰写随笔</span>
          </button>
          <button data-panel="panelCategory" @click="activePanel = 'panelCategory'"
              :class="['admin-menu-btn', activePanel === 'panelCategory' ? 'active bg-zinc-900/50' : 'text-zinc-400']">
              <span :class="activePanel === 'panelCategory' ? 'text-white' : 'text-zinc-400'">分类管理</span>
          </button>
          <button data-panel="panelTag" @click="activePanel = 'panelTag'"
              :class="['admin-menu-btn', activePanel === 'panelTag' ? 'active bg-zinc-900/50' : 'text-zinc-400']">
              <span :class="activePanel === 'panelTag' ? 'text-white' : 'text-zinc-400'">标签管理</span>
          </button>
          <button data-panel="panelResource" @click="activePanel = 'panelResource'"
              :class="['admin-menu-btn', activePanel === 'panelResource' ? 'active bg-zinc-900/50' : 'text-zinc-400']">
              <span :class="activePanel === 'panelResource' ? 'text-white' : 'text-zinc-400'">资源管理</span>
          </button>
      </div>

      <div class="art-admin-stage" :class="panelDirection">

          <div id="panelBlog" v-show="activePanel === 'panelBlog'">
              <div class="art-panel-head">
                  <h3 id="panelBlogTitle" class="art-panel-title-lg">{{ blogPanelTitle }}</h3>
                  <button @click="clearBlogForm" class="art-btn art-btn-sm art-btn-ghost"><i
                          class="ph-bold ph-plus"></i> 写新随笔</button>
              </div>

              <div class="art-form">
                  <input type="hidden" id="formBlogId" v-model="formPostId">

                  <div class="art-form-grid">
                      <div class="art-field">
                          <label class="art-label">标题</label>
                          <input type="text" id="formBlogTitle" v-model="formPostTitle" maxlength="100"
                              autocomplete="off" class="art-input">
                      </div>
                      <div class="art-field" id="fieldBlogCategory">
                          <label class="art-label">分类</label>
                          <FilterSelect id="formBlogCategory" v-model="formPostCategory"
                              :options="categoryOptions" />
                      </div>
                  </div>

                  <div class="art-field" id="fieldBlogTags">
                      <label class="art-label">标签（最多 {{ MAX_POST_TAGS }} 个）</label>
                      <div class="art-tag-picker">
                          <button v-for="tag in allTags" :key="tag.id" type="button" class="art-tag-chip"
                              :class="[formPostTagIds.includes(tag.id) ? 'is-active' : '', !formPostTagIds.includes(tag.id) && formPostTagIds.length >= MAX_POST_TAGS ? 'is-disabled' : '']"
                              :style="{ '--tag-h': tagHue(tag.name) + 'deg' }"
                              @click="toggleTag(tag.id)">{{ tag.name }}</button>
                          <span v-if="!allTags.length" class="art-tag-empty">暂无标签，请先去标签管理添加</span>
                      </div>
                  </div>

                  <div class="art-field">
                      <label class="art-label">随笔正文</label>
                      <div class="art-blog-toolbar">
                          <button type="button" id="btnOpenBlogEditor" class="art-btn art-btn-sm art-blog-editor-trigger"
                              @click="blogEditorOpen = true">
                              <i class="ph-bold ph-pencil-simple"></i> 写作
                          </button>
                          <div class="flex items-center gap-3">
                              <button type="button" id="btnClearBlogContent" class="art-text-btn art-blog-clear-btn"
                                  @click="clearBlogContent">
                                  <i class="ph-bold ph-eraser"></i> 清空正文
                              </button>
                              <span id="formBlogContentCounter" class="art-counter">{{ postContentLength }}/50000</span>
                          </div>
                      </div>
                      <!-- 草稿预览：可自由滚动；有正文走 Markdown 渲染，没正文给虚线占位 -->
                      <div class="art-blog-preview-box" :class="postContentLength ? '' : 'is-empty'">
                          <div class="art-mini-preview">
                              <MdPreview v-if="postContentLength" :modelValue="miniPreviewContent"
                                  :theme="mdTheme" />
                              <p v-else class="art-blog-preview-empty">正文空空如也...</p>
                          </div>
                          <span v-if="postContentLength" class="art-preview-mask" aria-hidden="true"></span>
                      </div>
                  </div>

                  <div class="art-form-foot">
                      <button id="btnSubmitBlog" @click="submitBlog" :disabled="submitting" class="art-btn">
                          <template v-if="submitBusyLabel"><i
                                  class="ph-bold ph-spinner-gap animate-spin"></i> {{ submitBusyLabel }}</template>
                          <template v-else>{{ blogSubmitLabel }}</template>
                      </button>
                  </div>
              </div>
          </div>

          <!-- 沉浸写作：大屏弹窗铺满编辑器，正文仍绑定 formPostContent -->
          <Teleport to="body">
              <div v-if="blogEditorOpen" id="blogEditorOverlay" class="art-blog-editor-overlay">
                  <div class="art-blog-editor-window">
                      <header class="art-blog-editor-bar">
                          <span class="art-blog-editor-bar-title">
                              <i class="ph-bold ph-pen-nib"></i> 沉浸写作
                          </span>
                          <div class="art-blog-editor-bar-actions">
                              <span class="art-counter">{{ postContentLength }}/50000</span>
                              <button type="button" @click="closeBlogEditor" class="art-btn art-btn-sm">
                                  <i class="ph-bold ph-check"></i> 关闭
                              </button>
                          </div>
                      </header>
                      <MdEditor v-model="formPostContent" :theme="mdTheme"
                          class="art-blog-editor"
                          @onUploadImg="onUploadImg" />
                  </div>
              </div>
          </Teleport>

          <div id="panelCategory" v-show="activePanel === 'panelCategory'">
              <div class="art-panel-head">
                  <h3 class="art-panel-title-lg">分类管理<span id="adminCategoryCount"
                          class="art-panel-count">{{ categoryCountText }}</span></h3>
              </div>

              <div class="art-cat-toolbar">
                  <input type="hidden" id="formCatId" v-model="formCatId">
                  <input type="text" id="formCatName" v-model="formCatName" maxlength="50" autocomplete="off"
                      placeholder="分类名称..." class="art-input">
                  <button @click="submitCategory" class="art-btn art-btn-sm">保存</button>
              </div>

              <div class="art-cat-search">
                  <div class="art-search art-search-sm">
                      <i class="ph-bold ph-magnifying-glass"></i>
                      <input type="text" id="searchCatName" v-model="searchCatName"
                          @keypress.enter="applyCategorySearch" autocomplete="off" placeholder="搜索分类名称">
                  </div>
                  <button @click="applyCategorySearch" class="art-btn art-btn-sm art-btn-ghost">搜索</button>
              </div>

              <div id="adminCategoryList" class="art-cat-list">
                  <div v-for="category in adminCategories" :key="category.id" class="art-cat-row animate-fade-in"
                      style="animation-duration: 0.4s;">
                      <div class="art-cat-main">
                          <span class="art-cat-name">{{ category.name }}</span>
                      </div>
                      <div class="art-cat-actions">
                          <button @click="editCategory(category)" :data-name="category.name"
                              class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-pencil-simple"></i></button>
                          <button @click="deleteCategory(category.id)"
                              class="art-icon-btn art-icon-btn-sm art-icon-btn-danger"><i
                                  class="ph-bold ph-trash"></i></button>
                      </div>
                  </div>
                  <div v-if="adminStatusMessage" class="art-empty">{{ adminStatusMessage }}</div>
              </div>

              <div class="art-pager art-pager-split">
                  <button @click="changeCategoryPage(-1)" :disabled="currentCategoryPage <= 1"
                      class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-left"></i></button>
                  <span id="categoryPageInfo" class="art-pager-info">{{ categoryPageInfo }}</span>
                  <button @click="changeCategoryPage(1)" :disabled="currentCategoryPage >= totalCategoryPages"
                      class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
              </div>
          </div>

          <div id="panelResource" v-show="activePanel === 'panelResource'">
              <div class="art-panel-head">
                  <h3 class="art-panel-title-lg">资源管理</h3>
                  <button @click="clearResourceForm" class="art-btn art-btn-sm art-btn-ghost"><i
                          class="ph-bold ph-plus"></i> 新增资源</button>
              </div>

              <div class="art-form">
                  <input type="hidden" id="formResId" v-model="formResId">

                  <div class="art-form-grid">
                      <div class="art-field">
                          <label class="art-label">资源标题</label>
                          <input type="text" id="formResTitle" v-model="formResTitle" maxlength="100"
                              autocomplete="off" class="art-input" placeholder="例如：MDN Web Docs">
                      </div>
                      <div class="art-field">
                          <label class="art-label">跳转链接</label>
                          <input type="text" id="formResUrl" v-model="formResUrl" maxlength="500"
                              autocomplete="off" class="art-input" placeholder="https://...">
                      </div>
                  </div>

                  <div class="art-field">
                      <label class="art-label">封面图地址</label>
                      <input type="text" id="formResCover" v-model="formResCover" maxlength="255"
                          autocomplete="off" class="art-input">
                  </div>

                  <div class="art-field">
                      <label class="art-label art-label-row">一句话简介
                          <span id="formResDescCounter" class="art-counter">{{ formResDesc.length }}/50</span></label>
                      <!-- art-textarea 只管多行排版，外框借用和上面几个输入框同款的 art-input -->
                      <textarea id="formResDesc" v-model="formResDesc" maxlength="50" rows="2"
                          class="art-input art-textarea"></textarea>
                  </div>

                  <div class="art-form-foot">
                      <button type="button" id="btnSubmitResource" @click="submitResource" :disabled="submitting"
                          class="art-btn">
                          <template v-if="submitBusyLabel"><i
                                  class="ph-bold ph-spinner-gap animate-spin"></i> {{ submitBusyLabel }}</template>
                          <template v-else>{{ formResId ? '保存修改' : '发布资源' }}</template>
                      </button>
                  </div>
              </div>

          </div>

          <div id="panelTag" v-show="activePanel === 'panelTag'">
              <div class="art-panel-head">
                  <h3 class="art-panel-title-lg">标签管理<span id="adminTagCount"
                          class="art-panel-count">{{ tagCountText }}</span></h3>
              </div>

              <div class="art-cat-toolbar">
                  <input type="hidden" id="formTagId" v-model="formTagId">
                  <input type="text" id="formTagName" v-model="formTagName" maxlength="50" autocomplete="off"
                      placeholder="标签名称..." class="art-input">
                  <button @click="submitTag" class="art-btn art-btn-sm">保存</button>
              </div>

              <div class="art-cat-search">
                  <div class="art-search art-search-sm">
                      <i class="ph-bold ph-magnifying-glass"></i>
                      <input type="text" id="searchTagName" v-model="searchTagName"
                          @keypress.enter="applyTagSearch" autocomplete="off" placeholder="搜索标签名称">
                  </div>
                  <button @click="applyTagSearch" class="art-btn art-btn-sm art-btn-ghost">搜索</button>
              </div>

              <div id="adminTagList" class="art-cat-list">
                  <div v-for="tag in adminTags" :key="tag.id" class="art-cat-row animate-fade-in"
                      style="animation-duration: 0.4s;">
                      <div class="art-cat-main">
                          <span class="art-cat-name">{{ tag.name }}</span>
                      </div>
                      <div class="art-cat-actions">
                          <button @click="editTag(tag)" :data-name="tag.name"
                              class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-pencil-simple"></i></button>
                          <button @click="deleteTag(tag.id)"
                              class="art-icon-btn art-icon-btn-sm art-icon-btn-danger"><i
                                  class="ph-bold ph-trash"></i></button>
                      </div>
                  </div>
                  <div v-if="tagStatusMessage" class="art-empty">{{ tagStatusMessage }}</div>
              </div>

              <div class="art-pager art-pager-split">
                  <button @click="changeTagPage(-1)" :disabled="currentTagPage <= 1"
                      class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-left"></i></button>
                  <span id="tagPageInfo" class="art-pager-info">{{ tagPageInfo }}</span>
                  <button @click="changeTagPage(1)" :disabled="currentTagPage >= totalTagPages"
                      class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
              </div>
          </div>

      </div>
  </section>
</template>

<style scoped>
/* 标签多选：彩色芯片，选中即高亮；浅色下 hover 用深色，避免白字看不清 */
.art-tag-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 8px
}

.art-tag-chip {
    --tag-h: 190deg;
    padding: 6px 14px;
    font-size: 12px;
    letter-spacing: .06em;
    color: hsl(var(--tag-h) 80% 70%);
    border: 1px solid hsl(var(--tag-h) 75% 62% / .45);
    border-radius: 999px;
    background: hsl(var(--tag-h) 85% 60% / .14);
    transition: color .3s ease, border-color .3s ease, background-color .3s ease, box-shadow .3s ease
}
@media (hover: hover) and (pointer: fine){.art-tag-chip:hover{
    color: hsl(var(--tag-h) 88% 80%);
    border-color: hsl(var(--tag-h) 80% 66% / .8);
    background: hsl(var(--tag-h) 85% 60% / .22)
}}

.art-tag-chip.is-active {
    color: #04080a;
    border-color: hsl(var(--tag-h) 85% 64%);
    background: hsl(var(--tag-h) 85% 64%);
    box-shadow: 0 0 0 1px hsl(var(--tag-h) 85% 64% / .35)
}

.art-tag-chip.is-disabled {
    opacity: .4;
    cursor: not-allowed
}

body.theme-light .art-tag-chip {
    color: hsl(var(--tag-h) 74% 36%);
    border-color: hsl(var(--tag-h) 62% 50% / .5);
    background: hsl(var(--tag-h) 80% 58% / .14)
}
@media (hover: hover) and (pointer: fine){body.theme-light .art-tag-chip:hover{
    color: hsl(var(--tag-h) 80% 28%);
    border-color: hsl(var(--tag-h) 68% 44% / .85);
    background: hsl(var(--tag-h) 80% 58% / .26)
}}

body.theme-light .art-tag-chip.is-active {
    color: #04080a;
    border-color: hsl(var(--tag-h) 72% 52%);
    background: hsl(var(--tag-h) 72% 52%)
}

.art-tag-empty {
    font-size: 12px;
    color: var(--art-ink-4)
}

/* 大屏沉浸写作入口 */
.art-blog-editor-trigger {
    width: auto;
    justify-content: center;
    gap: 6px;
    padding: 9px 18px;
    font-size: 12px;
    letter-spacing: .1em
}

/* 随笔正文工具行：写作靠左，清空正文与字数靠右 */
.art-blog-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px
}
@media (hover: hover) and (pointer: fine){/* 清空正文按钮：hover 才提示危险 */
.art-blog-clear-btn:hover{
    color: #ef4444
}}

/* 草稿预览框：固定高度，内部滚动 */
.art-blog-preview-box {
    position: relative;
    height: 220px;
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid var(--art-line);
    border-radius: 14px;
    /* 与详情页内容区 .art-detail-stage 一致的深蓝黑透视底 */
    background-color: rgba(4, 8, 10, .65);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    transition: border-color .4s ease
}

.art-blog-preview-box.is-empty {
    border-style: dashed
}

/* 迷你预览区：可自由滚动 */
.art-mini-preview {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch
}

.art-blog-preview-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    margin: 0;
    font-size: 12px;
    letter-spacing: .06em;
    color: var(--art-ink-4)
}

/* 底部渐隐：不拦截滚动 */
.art-preview-mask {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 64px;
    background: linear-gradient(to bottom, rgba(4, 8, 10, 0), #04080a);
    pointer-events: none !important
}

.art-blog-editor-overlay {
    position: fixed;
    inset: 0;
    z-index: 9990;
    display: flex;
    padding: clamp(10px, 2.4vw, 32px);
    /* 不用 backdrop-filter：全屏模糊会在打字时反复重算，窗体本身已近乎不透明 */
    background: rgba(4, 8, 10, .92)
}

.art-blog-editor-window {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: clamp(12px, 1.6vw, 20px);
    border: 1px solid rgba(0, 255, 255, .18);
    border-radius: 20px;
    background: rgba(6, 14, 18, .94);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .7)
}

.art-blog-editor-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px
}

.art-blog-editor-bar-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: var(--art-ink-3)
}

.art-blog-editor-bar-actions {
    display: inline-flex;
    align-items: center;
    gap: 14px
}

/* 编辑器跟随 flex 容器铺满弹窗 */
.art-blog-editor {
    flex: 1 1 auto;
    min-height: 0;
    height: auto
}

/* md-editor-v3 v7 深色主题走 [data-theme=dark]：黑底透明，正文换站点字色 */
:deep(.md-editor[data-theme='dark']) {
    --md-bk-color: transparent !important;
    --md-color: var(--art-ink) !important;
    /* 让中间的分割线变得极淡但不至于隐形 */
    --md-border-color: rgba(255, 255, 255, 0.12) !important;
    /* 滚动条轨道透明 */
    --md-scrollbar-bg-color: transparent !important;
    --md-scrollbar-thumb-color: rgba(255, 255, 255, .12) !important;
    --md-scrollbar-thumb-hover-color: rgba(255, 255, 255, .22) !important
}

/* 中缝拖拽条单独给一条极淡的线 */
:deep(.md-editor-resize-operate) {
    background-color: rgba(255, 255, 255, 0.12)
}

/* 手机端：弹窗吃满屏幕，顶栏不换行 */
@media (max-width: 767px) {
    .art-blog-editor-overlay {
        padding: 4px
    }

    .art-blog-editor-window {
        gap: 8px;
        padding: 8px;
        border-radius: 14px
    }

    .art-blog-editor-bar {
        flex-wrap: nowrap;
        gap: 8px
    }

    .art-blog-editor-bar-title {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis
    }

    .art-blog-editor-bar-actions {
        flex: 0 0 auto;
        gap: 8px
    }

    /* 窄屏改成上下单栏堆叠 */
    .art-blog-editor :deep(.md-editor-content-wrapper) {
        flex-direction: column
    }

    .art-blog-editor :deep(.md-editor-custom-scrollbar) {
        width: 100% !important;
        flex: 1 1 0 !important;
        min-height: 0
    }

    /* 收掉没有内容的那一半，剩下一栏占满整高 */
    .art-blog-editor :deep(.md-editor-custom-scrollbar:not(:has(.md-editor-input-wrapper)):not(:has(.md-editor-preview-wrapper))) {
        display: none !important
    }

    /* 纯预览模式下收掉宽度为 0% 的面板 */
    .art-blog-editor :deep(.md-editor-custom-scrollbar[style*='width: 0%']) {
        display: none !important
    }

    /* 拖拽条改成横跨整宽的分隔线 */
    .art-blog-editor :deep(.md-editor-resize-operate) {
        inset-inline-start: 0 !important;
        inset-block-start: calc(50% - 1px) !important;
        width: 100% !important;
        height: 2px !important;
        cursor: row-resize
    }
}

/* 带字数统计的标签行：说明靠左，计数靠右 */
.art-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px
}</style>
