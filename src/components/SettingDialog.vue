<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'

const router = useRouter()
const authStore = useAuthStore()
const uiStore = useUiStore()

const nickname = ref('')
const adminSecret = ref('')
const avatarInput = ref(null)
const avatarUploading = ref(false)
const nicknameSaving = ref(false)

/* 头像限制 1MB，前端先拦截一次，后端还会再校验 */
const AVATAR_MAX_SIZE = 1024 * 1024

function pickAvatarFile() {
  avatarInput.value?.click()
}

async function handleAvatarChange(event) {
  const file = event.target.files && event.target.files[0]
  /* 清空 value：连续选同一个文件也能再次触发 change */
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return uiStore.showToast('头像仅支持 JPG / PNG / GIF / WEBP 图片', false)
  if (file.size > AVATAR_MAX_SIZE) return uiStore.showToast('头像大小不能超过 1MB', false)
  avatarUploading.value = true
  try {
    await authStore.uploadAvatar(file)
    uiStore.refreshAvatar()
    uiStore.showToast('头像已更新')
  } catch (e) {
  } finally {
    avatarUploading.value = false
  }
}

function handleAvatarError(event) {
  event.target.src = authStore.fallbackAvatar
}

async function handleUpdateNickname() {
  if (nicknameSaving.value) return
  const name = nickname.value.trim()
  if (!name) return uiStore.showToast('昵称不能为空', false)
  if (name.length > 10) return uiStore.showToast('昵称最多10个字符', false)
  /* 改名同样经过 AI 审核，期间锁定按钮并提示，防止连点 */
  nicknameSaving.value = true
  try {
    await authStore.updateNickname(name)
    uiStore.showToast('昵称已更新')
  } catch (e) {
  } finally {
    nicknameSaving.value = false
  }
}

async function handleLoginAdmin() {
  if (!adminSecret.value) return uiStore.showToast('密钥不能为空', false)
  try {
    await authStore.loginAdmin(adminSecret.value)
    uiStore.showToast('管理员权限已验证')
    uiStore.closeDialog('setting')
    /* 说辞由 App.vue 监听身份变化后重新请求，这里不能再唤醒，否则会连播两次 */
  } catch (e) {}
}

async function handleLogout() {
  /* 登出必须'先重置、后联网'：无论拿新游客身份是否被限流拦下，
     都要关掉设置弹窗、丢弃已输入的管理员密钥并回到首页 */
  try {
    await authStore.logout()
  } catch (e) {
    console.warn('[setting] 登出流程异常，已强制回到访客状态：', e && e.message)
  } finally {
    adminSecret.value = ''
    uiStore.closeDialog('setting')
    router.push('/')
  }
}
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0">
    <div v-show="uiStore.dialogs.setting" id="settingDialog"
        class="art-scrim fixed inset-0 z-[200] transition-opacity duration-300"
        @click="uiStore.closeDialog('setting')">
        <div class="art-modal art-modal-md art-modal-pad transition-transform duration-300"
            :class="uiStore.dialogs.setting ? 'scale-100' : 'scale-95'" @click.stop>
            <div class="art-modal-head">
                <h3 class="art-modal-title">偏好设置</h3>
                <button @click="uiStore.closeDialog('setting')" class="art-icon-btn art-icon-btn-sm"><i
                        class="ph-bold ph-x"></i></button>
            </div>
            <div class="art-modal-body">
                <div class="art-field">
                    <label class="art-label">显示昵称</label>
                    <div class="art-modal-inline">
                        <input type="text" id="settingNickname" v-model="nickname" maxlength="10" autocomplete="off"
                            placeholder="最多 10 个字符" class="art-input">
                        <button @click="handleUpdateNickname" :disabled="nicknameSaving" class="art-btn art-btn-sm">
                            <template v-if="nicknameSaving"><i
                                    class="ph-bold ph-spinner-gap animate-spin"></i> 审核中...</template>
                            <template v-else>更新</template>
                        </button>
                    </div>
                </div>

                <!-- 站长头像：仅站长可见，改完首页与评论头像一并更新 -->
                <div v-if="authStore.isGlobalAdmin" class="art-field">
                    <label class="art-label">站长头像</label>
                    <div class="art-modal-inline">
                        <img :src="authStore.avatar" @error="handleAvatarError" alt="站长头像" class="art-setting-avatar">
                        <button type="button" @click="pickAvatarFile" :disabled="avatarUploading" class="art-btn art-btn-sm">
                            <template v-if="avatarUploading"><i
                                    class="ph-bold ph-spinner-gap animate-spin"></i> 上传中</template>
                            <template v-else>更换头像</template>
                        </button>
                        <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                            class="hidden" @change="handleAvatarChange">
                    </div>
                    <p class="art-setting-hint">仅站长可修改，图片大小不超过 1MB</p>
                </div>

                <div class="art-modal-sep">
                    <label class="art-label"><i class="ph-fill ph-lock-key"></i> 管理员权限</label>

                    <div id="adminAccessArea" class="art-modal-inline flex-col sm:flex-row gap-2 sm:gap-3"
                        :class="authStore.isGlobalAdmin ? 'hidden' : 'flex'">
                        <input type="password" id="settingAdminSecret" v-model="adminSecret"
                            placeholder="管理员密钥" class="art-input">
                        <button @click="handleLoginAdmin" class="art-btn art-btn-sm">登录</button>
                    </div>

                    <div id="adminExitArea" class="art-modal-inline flex-col sm:flex-row gap-2 sm:gap-3"
                        :class="authStore.isGlobalAdmin ? 'flex' : 'hidden'">
                        <div class="art-admin-active">
                            <span>管理员已激活</span>
                        </div>
                        <button @click="handleLogout" class="art-btn art-btn-sm art-btn-danger">退出管理员身份</button>
                    </div>
                </div>

                <div id="adminLogoutArea" class="art-modal-sep art-modal-center"
                    :class="authStore.isGlobalAdmin ? '' : 'hidden'">
                    <button @click="handleLogout" class="art-text-btn">清除缓存并登出</button>
                </div>
            </div>
        </div>
    </div>
</Transition>
</template>

<style scoped>
/* 站长头像预览：方形图片裁成圆形，和全站头像风格一致 */
.art-setting-avatar {
    width: 40px;
    height: 40px;
    flex: none;
    object-fit: cover;
    border-radius: 50%;
    border: 1px solid rgba(0, 255, 255, .28);
    background: #0b1a1f
}

.art-setting-hint {
    margin: 8px 0 0;
    font-size: 11px;
    letter-spacing: .04em;
    color: var(--art-ink-4)
}
</style>
