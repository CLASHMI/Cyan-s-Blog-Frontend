<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'

import { generateSvgAvatar, useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'
import { SystemConstant } from '@/utils/constants'
import { request } from '@/utils/request'

const authStore = useAuthStore()
const uiStore = useUiStore()
/* 后端枚举：用户角色 */
const { Role } = SystemConstant

const commentInput = ref('')
const searchKeyword = ref('')
const submitting = ref(false)

const comments = ref([])
const commentsStatusMessage = ref('')
const currentCommentPage = ref(1)
const totalCommentPages = ref(1)
const commentTotal = ref(0)

const commentPageInfo = computed(
    () => `第 ${currentCommentPage.value} 页 / 共 ${totalCommentPages.value} 页 · 共 ${commentTotal.value} 条`,
)

let commentsSeq = 0

async function loadComments(postId = 0, page = 1) {
    const seq = ++commentsSeq
    try {
        let url = `/comment/list?postId=${postId}&pageNum=${page}&pageSize=10`
        if (postId === 0 && searchKeyword.value.trim()) {
            url += `&content=${encodeURIComponent(searchKeyword.value.trim())}`
        }

        const data = await request(url)
        if (seq !== commentsSeq) return
        const records = data.records || data
        const total = data.total !== undefined ? data.total : records.length || 0
        const totalPages = Math.max(1, Math.ceil(total / 10))
        /* 页码越界（比如删留言删到页尾）：回退到最后一页重查，否则会停在空页且翻页条已隐藏 */
        if (page > totalPages) return loadComments(postId, totalPages)

        const applyComments = async () => {
            comments.value = records
            currentCommentPage.value = page
            commentTotal.value = total
            totalCommentPages.value = totalPages
            commentsStatusMessage.value = records.length ? '' : '未找到相关评论。'
            await nextTick()
        }
        if (document.startViewTransition) document.startViewTransition(applyComments)
        else await applyComments()
    } catch (e) {
        if (seq === commentsSeq) {
            comments.value = []
            commentsStatusMessage.value = '留言加载失败，请稍后重试。'
        }
    }
}

function changeCommentPage(delta) {
    if (currentCommentPage.value + delta < 1 || currentCommentPage.value + delta > totalCommentPages.value) return
    loadComments(0, currentCommentPage.value + delta)
}

function applyCommentSearch() {
    loadComments(0, 1)
}

function commentTime(comment) {
    return comment.createTime ? comment.createTime.replace('T', ' ') : '刚刚'
}

function avatarSrc(comment) {
    return comment.avatar || generateSvgAvatar(comment.nickname, comment.role)
}

function handleAvatarError(event, nickname, role) {
    event.target.src = generateSvgAvatar(nickname, role)
}

function ratingStars(comment) {
    return Number(comment.rating) > 0 ? Number(comment.rating) : 0
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
            body: JSON.stringify({ postId: 0, content, rating: 0 }),
        })
        uiStore.showToast('发送成功！')
        uiStore.refreshStats()
        commentInput.value = ''
        loadComments(0, 1)
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
            loadComments(0, currentCommentPage.value)
        } catch (e) {}
    })
}

/* 等身份落定再拉列表，首个请求才不会缺 Token */
onMounted(async () => {
    await authStore.ensureAuth()
    loadComments(0, 1)
})

</script>

<template>
  <section id="boardView" class="art-section">
      <div class="art-board">
          <div class="art-sec-head">
              <h2 class="art-sec-title">留下你的建议</h2>
              <p class="art-sec-meta">Guestbook</p>
          </div>

          <div class="art-composer">
              <img id="boardAvatar" :src="authStore.avatar" @error="handleAvatarError($event, authStore.nickname, authStore.user?.role)"
                  alt="头像" class="art-comment-avatar hidden sm:block">
              <div class="art-composer-main">
                  <div class="art-composer-mobile">
                      <img id="boardAvatarMobile" :src="authStore.avatar"
                          @error="handleAvatarError($event, authStore.nickname, authStore.user?.role)" alt="头像"
                          class="art-comment-avatar">
                      <span>留个言吧...</span>
                  </div>
                  <textarea id="globalCommentInput" v-model="commentInput" maxlength="500" rows="3"
                      placeholder="畅所欲言..." class="art-textarea"></textarea>
                  <div class="art-composer-foot">
                      <span id="globalCommentCounter" class="art-counter">{{ commentInput.length }}/500</span>
                      <button @click="submitComment" :disabled="submitting"
                          class="art-btn art-btn-sm art-comment-submit">
                          <span class="art-comment-submit-face" :class="{ 'is-off': submitting }">发布</span>
                          <span class="art-comment-submit-face" :class="{ 'is-off': !submitting }"><i
                                  class="ph-bold ph-spinner-gap animate-spin"></i>发送中</span>
                      </button>
                  </div>
              </div>
          </div>

          <div class="art-list-head">
              <h3 class="art-list-title">最新留言</h3>
              <div class="art-search art-search-sm">
                  <i class="ph-bold ph-magnifying-glass"></i>
                  <input type="text" id="searchBoardInput" v-model="searchKeyword"
                      @keypress.enter="applyCommentSearch" autocomplete="off" placeholder="搜索留言">
              </div>
          </div>

          <div id="globalCommentList" class="art-comment-list">
              <div v-for="comment in comments" :key="comment.id" class="art-comment">
                  <img :src="avatarSrc(comment)" @error="handleAvatarError($event, comment.nickname, comment.role)"
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
                              <div v-if="ratingStars(comment) > 0" class="art-comment-stars"><i
                                      v-for="n in ratingStars(comment)" :key="n" class="ph-fill ph-star"></i></div>
                              <span class="art-comment-floor">#{{ comment.id }}</span>
                          </div>
                      </div>
                      <p class="art-comment-text">{{ comment.content }}</p>
                      <button v-if="authStore.isGlobalAdmin" @click.stop="deleteComment(comment.id)"
                          class="art-icon-btn art-icon-btn-sm art-icon-btn-danger art-comment-del"><i
                              class="ph-bold ph-trash"></i></button>
                  </div>
              </div>
              <div v-if="commentsStatusMessage" class="art-empty">{{ commentsStatusMessage }}</div>
          </div>

          <div v-if="totalCommentPages > 1" class="art-pager">
              <button @click="changeCommentPage(-1)" :disabled="currentCommentPage <= 1"
                  class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-left"></i></button>
              <span id="globalCommentPageInfo" class="art-pager-info">{{ commentPageInfo }}</span>
              <button @click="changeCommentPage(1)" :disabled="currentCommentPage >= totalCommentPages"
                  class="art-icon-btn art-icon-btn-sm"><i class="ph-bold ph-caret-right"></i></button>
          </div>
      </div>
  </section>
</template>
