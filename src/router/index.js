import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/useAuthStore'

/* 路由级懒加载：各页按需下载，首屏不再背负 md-editor / 控制台等重依赖 */
const HomeView = () => import('@/views/HomeView.vue')
const BlogView = () => import('@/views/BlogView.vue')
const DetailView = () => import('@/views/DetailView.vue')
const BoardView = () => import('@/views/BoardView.vue')
const AdminView = () => import('@/views/AdminView.vue')
const PlaygroundView = () => import('@/views/PlaygroundView.vue')

/* 列表页高度随异步数据增长，滚动复位不能停在原地干等：
   够高就精确落位，不够高就先贴到当前能滚到的最远处，随内容增长继续推进，
   否则用户会先看到列表顶部、再突然跳到底部（前进后退回到长列表时尤其明显） */
function restoreScroll(top) {
  return new Promise((resolve) => {
    /* 归零放到下一轮任务：此时离场视图已固定，复位不会带动它 */
    if (!top) {
      setTimeout(() => resolve({ top: 0 }), 0)
      return
    }
    const deadline = performance.now() + 1600
    /* 用户自己开始滚动就立刻让路，别把人拽回来 */
    let cancelled = false
    const releaseUserScroll = () => {
      cancelled = true
    }
    const userScrollEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    userScrollEvents.forEach((type) => {
      window.addEventListener(type, releaseUserScroll, { passive: true, once: true })
    })
    const finish = () => {
      userScrollEvents.forEach((type) => {
        window.removeEventListener(type, releaseUserScroll)
      })
      resolve(false)
    }
    let applied = -1
    const settle = () => {
      if (cancelled) {
        finish()
        return
      }
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      /* 够得着就精确落位；还不够高就先贴到当前最远处 */
      const target = max >= top ? top : max
      if (target !== applied) {
        window.scrollTo(0, target)
        applied = target
      }
      if (max >= top || performance.now() > deadline) {
        finish()
        return
      }
      requestAnimationFrame(settle)
    }
    /* 逐帧推进：页面长到哪就跟到哪，别让用户先瞥到列表顶部再跳下来 */
    settle()
  })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, from, savedPosition) {
    /* 回首页必须复位，不能沿用详情页下的列表滚动位置。 */
    if (to.path === '/') return { top: 0 }
    /* 详情页进出保持滚动原样，列表位置不丢 */
    if (to.path.startsWith('/post/') || from.path.startsWith('/post/')) return false
    /* 首次进入（含刷新）一律回到顶部：浏览器会把上次的位置塞进 savedPosition，
       照它恢复会先停在顶部等异步内容加载完、再跳一次，刷新本来就该从顶部看起 */
    const isFirstNavigation = from.matched.length === 0
    /* 普通跳转延迟 10ms：先固定离场视图，再复位滚动 */
    if (isFirstNavigation || !savedPosition) {
      return new Promise((resolve) => setTimeout(() => resolve({ top: 0 }), 10))
    }
    return restoreScroll(savedPosition.top)
  },
  routes: [
    {
      path: '/',
      component: HomeView,
    },
    {
      path: '/blog',
      component: BlogView,
    },
    {
      path: '/post/:id',
      component: DetailView,
    },
    {
      path: '/board',
      component: BoardView,
    },
    {
      path: '/playground',
      component: PlaygroundView,
    },
    {
      path: '/admin',
      component: AdminView,
    },
    /* 旧地址或未知路径一律回首页，避免只渲染空壳、不发数据请求 */
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  if (to.path === '/admin' && !useAuthStore().isGlobalAdmin) return '/'
  return true
})

export default router
