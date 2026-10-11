import { isRef, ref, watch, reactive, computed } from 'vue'

import { useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'
import { request } from '@/utils/request'

function likedPostsKey(uuid) {
  return `anim_liked_posts_${uuid || 'guest'}`
}

function getLikedPosts(uuid) {
  try {
    return new Set(JSON.parse(localStorage.getItem(likedPostsKey(uuid)) || '[]'))
  } catch (e) {
    return new Set()
  }
}

function setPostLiked(uuid, id, isLiked) {
  const likedPosts = getLikedPosts(uuid)
  if (isLiked) likedPosts.add(String(id))
  else likedPosts.delete(String(id))
  localStorage.setItem(likedPostsKey(uuid), JSON.stringify([...likedPosts]))
}

const globalLikeStatus = reactive({}) // key: 格式为 `uuid_postId`
const globalLikeCounts = reactive({}) // key: 格式为 `postId` (总数是客观的，不分用户)

export function usePostLike(source) {
  const current = () => (isRef(source) ? source.value : source)
  const authStore = useAuthStore()
  const uiStore = useUiStore()

  const likePending = ref(false)

  watch(
    () => [current()?.id, current()?.likeCount, authStore.user?.uuid],
    // 引入旧值参数，用于嗅探真正的“身份切换”
    ([id, count, uuid], [oldId, oldCount, oldUuid] = []) => {
      if (id) {
        const sid = String(id)
        const currentUuid = uuid || 'guest'
        const statusKey = `${currentUuid}_${sid}`

        if (globalLikeStatus[statusKey] === undefined || uuid !== oldUuid) {
          globalLikeStatus[statusKey] = getLikedPosts(currentUuid).has(sid)
        }

        if (globalLikeCounts[sid] === undefined || (count !== undefined && count > globalLikeCounts[sid])) {
          globalLikeCounts[sid] = count || 0
        }
      }
    },
    { immediate: true },
  )
  const liked = computed(() => {
    const id = current()?.id
    if (!id) return false
    const currentUuid = authStore.user?.uuid || 'guest'
    return !!globalLikeStatus[`${currentUuid}_${id}`]
  })

  const likeCount = computed(() => {
    const id = current()?.id
    return id ? (globalLikeCounts[String(id)] || 0) : 0
  })

  async function toggleLike() {
    const post = current()
    if (likePending.value || !post || post.id === null || post.id === undefined) return

    likePending.value = true
    try {
      const sid = String(post.id)
      const currentUuid = authStore.user?.uuid || 'guest'
      const statusKey = `${currentUuid}_${sid}`

      const wasLiked = globalLikeStatus[statusKey]

      await request(wasLiked ? `/blog/unlike/${post.id}` : `/blog/like/${post.id}`, {
        method: 'POST',
      })

      globalLikeStatus[statusKey] = !wasLiked
      const base = globalLikeCounts[sid] || 0
      globalLikeCounts[sid] = !wasLiked ? base + 1 : Math.max(0, base - 1)

      setPostLiked(currentUuid, post.id, !wasLiked)
      uiStore.showToast(!wasLiked ? '已点赞！' : '已取消点赞！')

      uiStore.refreshStats()
    } catch (e) {
    } finally {
      likePending.value = false
    }
  }

  return { liked, likeCount, likePending, toggleLike }
}
