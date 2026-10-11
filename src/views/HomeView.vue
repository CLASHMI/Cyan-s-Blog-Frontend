<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUiStore } from '@/stores/useUiStore'
import { request } from '@/utils/request'
import { copyText } from '@/utils/clipboard'

const emit = defineEmits(['journal-entry', 'journal-entry-cancel'])
const authStore = useAuthStore()
const uiStore = useUiStore()
const router = useRouter()
const homeRoot = ref(null)
const scrollProgress = ref(0)
let homeScroller
let scrollFrame = 0
const scrollEntryDistance = 1200
let wheelDistance = 0
let lastEntryWheelAt = 0
let lastContentScroll = 0
let enteringJournal = false

function cancelScrollEntry() {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  scrollProgress.value = 0
  wheelDistance = 0
}

function entryBlocked() {
  return router.currentRoute.value.path !== '/' || document.hidden
    || Object.values(uiStore.dialogs).some(Boolean)
    || !!document.querySelector('.cyan-nav-links.is-open')
}

function onHomeScroll() {
  lastContentScroll = performance.now()
  cancelScrollEntry()
}

function startScrollEntry() {
  if (scrollFrame || enteringJournal || scrollProgress.value < 1) return
  // 只在累计滚满后等待一帧绘制；不再按时间自动增加进度。
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = requestAnimationFrame(async () => {
      scrollFrame = 0
      if (entryBlocked() || scrollProgress.value < 1) return cancelScrollEntry()
      if (performance.now() - lastEntryWheelAt < 220) return smoothScrollProgress()
      enteringJournal = true
      emit('journal-entry')
      try {
        await router.push('/blog')
        if (router.currentRoute.value.path !== '/blog') emit('journal-entry-cancel')
      } catch {
        emit('journal-entry-cancel')
        uiStore.showToast('暂时无法进入随笔，请点击导航重试。', false)
      } finally {
        enteringJournal = false
        cancelScrollEntry()
      }
    })
  })
}

/* 手机端浮动入口：点按等同于下滑进入随笔，复用同一套过渡与兜底提示 */
async function enterJournal() {
  if (enteringJournal || entryBlocked()) return
  enteringJournal = true
  emit('journal-entry')
  try {
    await router.push('/blog')
    if (router.currentRoute.value.path !== '/blog') emit('journal-entry-cancel')
  } catch {
    emit('journal-entry-cancel')
    uiStore.showToast('暂时无法进入随笔，请点击导航重试。', false)
  } finally {
    enteringJournal = false
  }
}

function smoothScrollProgress() {
    if (scrollFrame || enteringJournal) return
  let previousTime = performance.now()
  const advance = now => {
    scrollFrame = 0
    if (entryBlocked()) return cancelScrollEntry()
    const target = wheelDistance / scrollEntryDistance
    // 仅平滑追随滚轮累计值，不产生额外进度；反向滚动同样平滑回退。
    const distance = target - scrollProgress.value
    const blend = 1 - Math.exp(-(now - previousTime) / 55)
    previousTime = now
    scrollProgress.value = motionPreference?.matches || Math.abs(distance) < 0.0005
      ? target : scrollProgress.value + distance * blend
    if (scrollProgress.value !== target) {
      scrollFrame = requestAnimationFrame(advance)
    } else if (target === 1) {
      // 消费本轮手势的连续滚动/惯性尾段，停稳后才切页，避免新页被继续滚走。
      if (now - lastEntryWheelAt < 220) scrollFrame = requestAnimationFrame(advance)
      else startScrollEntry()
    }
  }
  scrollFrame = requestAnimationFrame(advance)
}

function onHomeWheel(event) {
  if (enteringJournal) {
    if (event.cancelable) event.preventDefault()
    return
  }
  if (entryBlocked() || event.ctrlKey || event.metaKey
      || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return cancelScrollEntry()
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return cancelScrollEntry()
  // 内嵌滚动区自行消费滚轮，不抢夺表单、弹层等内容的操作。
  for (let node = target; node && node !== homeScroller; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return cancelScrollEntry()
  }
  const now = performance.now()
  if (!homeScroller || homeScroller.scrollHeight - homeScroller.clientHeight - homeScroller.scrollTop > 2
      || now - lastContentScroll < 220) return cancelScrollEntry()
  // 没有待回退的进度时，上滚交还页面正常处理。
  if (event.deltaY < 0 && wheelDistance === 0 && scrollProgress.value === 0) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? homeScroller.clientHeight : 1
  if (event.cancelable) event.preventDefault()
  wheelDistance = Math.max(0, Math.min(scrollEntryDistance, wheelDistance + event.deltaY * unit))
  lastEntryWheelAt = now
  if (scrollProgress.value === 1 && wheelDistance < scrollEntryDistance) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
  }
  // 更新目标即可，运行中的动画会逐帧读取最新值，不重置过渡。
  smoothScrollProgress()
}

function onEntryKey(event) {
  if (event.key === 'Escape' || event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') cancelScrollEntry()
}

watch(() => Object.values(uiStore.dialogs).some(Boolean), open => { if (open) cancelScrollEntry() })
watch(() => router.currentRoute.value.path, cancelScrollEntry)
const contactGroups = [
  [
    { name: 'Email', icon: 'envelope-simple', value: '2982420177@qq.com', message: '邮箱已复制' },
    { name: 'WeChat', icon: 'wechat-logo', value: 'q2982420177', message: '微信号已复制' },
    { name: 'GitHub', icon: 'github-logo', href: 'https://github.com/CLASHMI' },
  ],
  [
    { name: 'Gitee', icon: 'git-branch', href: 'https://gitee.com/huang-zhijie377' },
    { name: 'CSDN', icon: 'article', href: 'https://blog.csdn.net/2301_80038984' },
    { name: 'Bilibili', icon: 'television-simple', href: 'https://b23.tv/0RGElcJ' },
  ],
]

async function copyContact(contact) {
  try {
    await copyText(contact.value)
    uiStore.showToast(contact.message)
  } catch {
    uiStore.showToast(`复制失败，请手动复制：${contact.value}`, false)
  }
}

const slogan = '空想青明镜'
const letters = Array.from(slogan)
const typedCount = ref(0)
const typingDone = ref(false)
let typeTimer
let welcomeTimer
let motionPreference
const welcomeMessages = [
  '你好，欢迎光临我的隐秘世界。',
  '我是Cyan，是拂过青浪的自由之风。',
  '在「空」的青布上，画下美好的「想」。',
  '天边有一个乌托邦，日落是它唯一的居民。',
]
const welcomeIndex = ref(0)
let welcomeRotationTimer

function startWelcomeRotation() {
  clearInterval(welcomeRotationTimer)
  /* 已去掉暂停按钮，默认一直轮播；只有系统要求减少动态效果时才不自动切换 */
  if (!typingDone.value || motionPreference?.matches) return
  welcomeRotationTimer = setInterval(() => {
    welcomeIndex.value = (welcomeIndex.value + 1) % welcomeMessages.length
  }, 10000)
}

function selectWelcome(index) {
  welcomeIndex.value = index
  startWelcomeRotation()
}

watch(typingDone, startWelcomeRotation)

const statItems = [
  { key: 'totalPosts', label: '随笔', id: 'statPosts' },
  { key: 'totalComments', label: '互动', id: 'statInteractions' },
  { key: 'totalLikes', label: '点赞', id: 'statLikes' },
  { key: 'totalVisitors', label: '游客', id: 'statVisitors' },
  { key: 'totalTags', label: '标签', id: 'statTags' },
  { key: 'totalCategories', label: '分类', id: 'statCategories' },
]
const heroStats = ref({})
const statsLoading = ref(true)
const statsError = ref(false)
let statsSeq = 0

async function loadHeroStats() {
  const revision = uiStore.statsRevision
  if (heroStatsCached && heroStatsCachedRevision === revision) {
    heroStats.value = heroStatsCache
    statsError.value = false
    statsLoading.value = false
    return
  }
  const seq = ++statsSeq
  statsLoading.value = true
  statsError.value = false
  try {
    await authStore.ensureAuth()
    const stats = await request('/stats/overview')
    if (seq !== statsSeq) return
    if (!stats || typeof stats !== 'object') throw new Error('Invalid overview')
    heroStatsCache = stats
    heroStatsCached = true
    heroStatsCachedRevision = revision
    heroStats.value = stats
  } catch {
    if (seq === statsSeq) statsError.value = true
  } finally {
    if (seq === statsSeq) statsLoading.value = false
  }
}

function statValue(key) {
  const value = heroStats.value[key]
  if (value === undefined || value === null || value === '') return '—'
  return typeof value === 'number' ? value.toLocaleString('en-US') : value
}

/* 首页中间的站长头像：缓存在模块作用域，只有首次进入或 avatarRevision 变化（站长换完头像）时才请求 */
const ownerAvatar = ref('')
const ownerAvatarFailed = ref(false)
let ownerAvatarSeq = 0

async function loadOwnerAvatar() {
  const revision = uiStore.avatarRevision
  if (ownerAvatarCached && ownerAvatarCachedRevision === revision) {
    ownerAvatar.value = ownerAvatarCache
    ownerAvatarFailed.value = false
    return
  }
  const seq = ++ownerAvatarSeq
  ownerAvatarFailed.value = false
  try {
    const url = await request('/user/ownerAvatar')
    if (seq !== ownerAvatarSeq) return
    ownerAvatarCache = typeof url === 'string' ? url : ''
    ownerAvatarCached = true
    ownerAvatarCachedRevision = revision
  } catch {
    if (seq !== ownerAvatarSeq) return
    ownerAvatarCache = ''
    ownerAvatarCached = false
  }
  ownerAvatar.value = ownerAvatarCache
  ownerAvatarFailed.value = false
}

watch(() => uiStore.avatarRevision, loadOwnerAvatar)
watch(() => uiStore.statsRevision, loadHeroStats)

function finishTyping() {
  clearTimeout(typeTimer)
  clearTimeout(welcomeTimer)
  typedCount.value = letters.length
  typingDone.value = true
}

function typeNextLetter() {
  typedCount.value += 1
  if (typedCount.value < letters.length) {
    typeTimer = setTimeout(typeNextLetter, typedCount.value === 2 ? 360 : 200)
  } else {
    welcomeTimer = setTimeout(() => { typingDone.value = true }, 280)
  }
}

function onMotionChange(event) {
  if (!event.matches) return
  finishTyping()
  /* 系统刚切到「减少动态效果」：停掉自动轮播，不留一个一直在动的区域 */
  startWelcomeRotation()
}

onMounted(() => {
  homeScroller = homeRoot.value?.closest('.cyan-shell--home')
  homeScroller?.addEventListener('wheel', onHomeWheel, { passive: false })
  homeScroller?.addEventListener('scroll', onHomeScroll, { passive: true })
  homeScroller?.addEventListener('pointerdown', cancelScrollEntry)
  window.addEventListener('keydown', onEntryKey)
  window.addEventListener('blur', cancelScrollEntry)
  window.addEventListener('resize', cancelScrollEntry)
  document.addEventListener('visibilitychange', cancelScrollEntry)
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', onMotionChange)
  if (motionPreference.matches) finishTyping()
  else typeTimer = setTimeout(typeNextLetter, 460)
  loadHeroStats()
  loadOwnerAvatar()
})

onUnmounted(() => {
  cancelScrollEntry()
  homeScroller?.removeEventListener('wheel', onHomeWheel)
  homeScroller?.removeEventListener('scroll', onHomeScroll)
  homeScroller?.removeEventListener('pointerdown', cancelScrollEntry)
  window.removeEventListener('keydown', onEntryKey)
  window.removeEventListener('blur', cancelScrollEntry)
  window.removeEventListener('resize', cancelScrollEntry)
  document.removeEventListener('visibilitychange', cancelScrollEntry)
  clearTimeout(typeTimer)
  clearTimeout(welcomeTimer)
  clearInterval(welcomeRotationTimer)
  motionPreference?.removeEventListener('change', onMotionChange)
  statsSeq += 1
  ownerAvatarSeq += 1
})
</script>

<script>
/* 模块作用域缓存：setup 块里的变量每次挂载都会重建，跨页面切换要复用必须放在这一层。
   首页每次进入都会重新挂载，所以把「概况统计 / 站长头像」缓存在这里，
   配合 statsRevision / avatarRevision 失效，回访首页就不再重复请求。 */
let heroStatsCache = null
let heroStatsCachedRevision = -1
let heroStatsCached = false
let ownerAvatarCache = ''
let ownerAvatarCachedRevision = -1
let ownerAvatarCached = false
</script>

<template>
  <section ref="homeRoot" class="cyan-home" aria-labelledby="home-title">
    <div class="home-atmosphere" aria-hidden="true">
      <div class="home-aura home-aura--left"></div>
      <div class="home-aura home-aura--right"></div>
      <div class="home-stream home-stream--far"></div>
      <div class="home-stream home-stream--near"></div>
      <div class="home-mirror"></div>
      <div class="home-dust"></div>
      <div class="home-vignette"></div>
    </div>

    <div class="home-center">
      <p class="home-eyebrow"><span></span>CYAN · A FLOW OF THOUGHTS<span></span></p>
      <!-- 保留原标题的粗细对比；渐变落到每个字上，避免嵌套文字裁剪。 -->
      <h1 id="home-title" class="art-display home-title" :aria-label="slogan" :class="{ 'is-complete': typingDone }">
        <span class="home-type-line" aria-hidden="true"><span
            v-for="(letter, index) in letters" :key="index" class="home-letter" :style="{ '--letter-index': index }"
            :class="{ 'art-display-mark': index < 2, 'is-visible': index < typedCount, 'has-caret': index === typedCount - 1 }">{{ letter }}</span></span>
      </h1>
      <div class="home-owner" aria-label="站长 Cyan">
        <div class="home-contact-orbit">
          <nav v-for="(contacts, side) in contactGroups" :key="side" class="home-contact-arc"
            :class="side === 0 ? 'is-left' : 'is-right'" :aria-label="side === 0 ? '联系方式' : '更多主页'">
            <span v-for="(contact, index) in contacts" :key="contact.name" class="home-contact-node"
              :style="{ '--contact-delay': `${(index + side * 3) * -.7}s` }">
              <component :is="contact.href ? 'a' : 'button'" class="home-contact-link"
                :href="contact.href" :type="contact.href ? undefined : 'button'"
                :target="contact.href ? '_blank' : undefined" :rel="contact.href ? 'noopener noreferrer' : undefined"
                :aria-label="contact.href ? `${contact.name}（新窗口打开）` : `复制${contact.name}：${contact.value}`"
                :title="contact.value || contact.name" @click="!contact.href && copyContact(contact)">
                <i class="ph" :class="`ph-${contact.icon}`" aria-hidden="true"></i>
                <span class="home-contact-label" aria-hidden="true">{{ contact.name }}</span>
              </component>
            </span>
          </nav>
          <div class="home-avatar-frame">
            <span class="home-avatar-orbit" aria-hidden="true"></span>
            <img v-if="ownerAvatar && !ownerAvatarFailed" class="home-owner-avatar" :src="ownerAvatar"
              alt="站长当前头像" @error="ownerAvatarFailed = true">
            <div v-else class="home-owner-avatar" role="img" aria-label="站长头像的青色圆形占位"></div>
          </div>
        </div>
      <p class="home-owner-name">Cyan<span>站长</span></p>
      </div>
      <div class="home-welcome" :class="{ 'is-visible': typingDone }">
        <div class="home-welcome-window">
          <Transition name="welcome-slide">
            <div :key="welcomeIndex" class="home-welcome-line"><p>{{ welcomeMessages[welcomeIndex] }}</p></div>
          </Transition>
        </div>
        <div class="home-welcome-controls" role="group" aria-label="欢迎语轮播">
          <button v-for="(_, index) in welcomeMessages" :key="index" type="button"
            class="home-welcome-dot" :class="{ 'is-active': welcomeIndex === index }"
            :aria-label="`显示第 ${index + 1} 句欢迎语`" :aria-pressed="welcomeIndex === index"
            @click="selectWelcome(index)"><span></span></button>
        </div>
        <!-- 欢迎语左下方的进入入口：三道依次亮起的青色箭头，像加速轨道一样指向随笔 -->
        <div class="home-journal-row">
          <Transition name="journal-enter">
            <button v-if="typingDone" type="button" class="home-journal-enter" @click="enterJournal"
              aria-label="进入随笔列表" title="进入随笔">
              <i class="ph-bold ph-caret-right" aria-hidden="true"></i>
              <i class="ph-bold ph-caret-right" aria-hidden="true"></i>
              <i class="ph-bold ph-caret-right" aria-hidden="true"></i>
            </button>
          </Transition>
        </div>
      </div>
    </div>

    <section class="home-observatory" aria-label="小站数据" :aria-busy="statsLoading">
      <div class="home-stats-heading" aria-hidden="true"><span class="home-signal"></span>在这里，留下的回响<span class="home-stats-line"></span><span class="home-stats-caption">TRACES OF LIFE</span></div>
      <dl class="home-stats">
        <div v-for="item in statItems" :key="item.key" class="home-stat">
          <dt>{{ item.label }}</dt>
          <dd :id="item.id">{{ statValue(item.key) }}</dd>
        </div>
      </dl>
      <p v-if="statsError" class="home-stats-error" role="status">统计暂未更新 <button type="button" @click="loadHeroStats">重试</button></p>
    </section>

    <div class="home-colophon">
      <span>NOTES / LIFE / CONSCIOUSNESS</span>
      <span>CYAN — #00FFFF</span>
    </div>
    <Teleport to="body">
      <div v-if="scrollProgress > 0" class="home-entry-feedback">
        <div class="home-entry-track" role="progressbar" aria-label="进入随笔" :aria-valuenow="Math.round(scrollProgress * 100)" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ transform: `scaleX(${scrollProgress})` }"></span>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.cyan-home {
  --home-cyan: #00ffff;
  --home-ground: #030c10;
  --home-ink: #dbffff;
  --home-muted: #96bec2;
  --home-dim: #789fa6;
  --home-number: #d2fbff;
  --home-title: linear-gradient(110deg, #76eeee 10%, #c6ffff 38%, #8bffff 64%, #76eeee 90%);
  --home-mark: linear-gradient(110deg, #00dfe8 10%, #00ffff 36%, #a5ffff 50%, #00ffff 64%, #00dfe8 90%);
  --home-vignette: rgba(0, 5, 9, .5);
  position: relative;
  isolation: isolate;
  width: 100%;
  height: auto;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 110px 24px 28px;
  gap: 30px;
  overflow: hidden;
  color: var(--home-ink);
  background: var(--home-ground);
}
.home-atmosphere { position: absolute; z-index: -1; inset: 0; overflow: hidden; pointer-events: none; }
/* 色源统一为 #00FFFF；用不同透明度呈现深浅，不把青色调成薄荷绿。 */
.home-aura {
  position: absolute;
  width: 100%;
  height: 100%;
  filter: blur(48px);
  will-change: transform;
}
.home-aura--left {
  left: -36%;
  top: -34%;
  background: radial-gradient(ellipse at 50% 50%, rgba(0, 255, 255, .25), rgba(0, 255, 255, .065) 38%, transparent 63%);
  animation: aura-left 24s ease-in-out infinite alternate;
}
.home-aura--right {
  right: -40%;
  bottom: -36%;
  background: radial-gradient(ellipse at 50% 50%, rgba(0, 255, 255, .2), rgba(0, 255, 255, .045) 38%, transparent 64%);
  animation: aura-right 29s ease-in-out infinite alternate;
}
/* 斜向的青色意识流：大椭圆的局部弧线，叠加柔雾，而非实体圆环或卡片。 */
.home-stream {
  position: absolute;
  left: -22%;
  top: 18%;
  width: 144%;
  height: 67%;
  border-radius: 50%;
  transform: rotate(-24deg);
  will-change: transform;
}
.home-stream--far {
  border-top: 1px solid rgba(0, 255, 255, .13);
  box-shadow: 0 -22px 70px -26px rgba(0, 255, 255, .24), inset 0 25px 65px -40px rgba(0, 255, 255, .2);
  background: radial-gradient(ellipse at 50% 0%, rgba(0, 255, 255, .10), transparent 58%);
  filter: blur(2px);
  animation: stream-drift 30s ease-in-out infinite alternate;
}
.home-stream--near {
  left: -16%;
  top: 36%;
  width: 137%;
  height: 52%;
  border-top: 1px solid rgba(134, 255, 255, .2);
  box-shadow: 0 -9px 34px -16px rgba(0, 255, 255, .4), inset 0 30px 60px -42px rgba(0, 255, 255, .3);
  -webkit-mask-image: linear-gradient(90deg, transparent 4%, #000 26%, transparent 55%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent 4%, #000 26%, transparent 55%, #000 82%, transparent);
  animation: stream-drift 24s ease-in-out infinite alternate-reverse;
}
.home-mirror {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(66vw, 850px);
  aspect-ratio: 1;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(ellipse, rgba(0, 255, 255, .035), transparent 66%);
  border: 1px solid rgba(0, 255, 255, .065);
  -webkit-mask-image: linear-gradient(145deg, transparent 12%, #000 42%, transparent 68%);
  mask-image: linear-gradient(145deg, transparent 12%, #000 42%, transparent 68%);
}
.home-dust {
  position: absolute;
  inset: 0;
  opacity: .55;
  background:
    radial-gradient(1px 1px at 14% 28%, #adffff 70%, transparent),
    radial-gradient(1px 1px at 27% 61%, #00ffff 70%, transparent),
    radial-gradient(1px 1px at 71% 23%, #00ffff 70%, transparent),
    radial-gradient(1px 1px at 86% 58%, #bcffff 70%, transparent),
    radial-gradient(1px 1px at 62% 72%, #00ffff 70%, transparent),
    radial-gradient(1px 1px at 42% 17%, #5ddddd 70%, transparent);
  animation: dust-breathe 7s ease-in-out infinite alternate;
}
.home-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 44%, transparent 25%, var(--home-vignette) 100%); }
.home-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; text-align: center; }
.home-eyebrow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 24px;
  color: var(--home-dim);
  font-size: 9px;
  letter-spacing: .36em;
  animation: home-arrive 1.6s ease both;
}
.home-eyebrow span { width: 24px; height: 1px; background: linear-gradient(90deg, transparent, rgba(0, 255, 255, .5)); }
.home-eyebrow span:last-child { transform: rotate(180deg); }
/* 保留「空想」重、「青明镜」轻；轻微前倾与冷光切线增加赛博感。 */
.cyan-home .home-title.art-display {
  margin: 0;
  font-family: 'Bahnschrift', 'DengXian', 'Microsoft YaHei', sans-serif;
  background: none;
  -webkit-text-fill-color: currentColor;
  color: var(--home-ink);
  letter-spacing: .055em;
  font-weight: 300;
  transform: skewX(-6deg);
  font-size: clamp(56px, 7.2vw, 100px);
  line-height: 1.3;
}
.cyan-home .home-title .home-letter {
  display: inline-block;
  background-image: var(--home-title);
  background-size: 260% 100%;
  animation: title-flow 8s ease-in-out infinite, thought-float 5s ease-in-out infinite;
  animation-delay: calc(var(--letter-index) * -.8s);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.cyan-home .home-title .art-display-mark {
  font-weight: 600;
  background-image: var(--home-mark);
  filter: drop-shadow(0 3px 14px rgba(0, 255, 255, .16));
}
.home-type-line { position: relative; display: inline-block; white-space: nowrap; }
.home-letter { position: relative; opacity: 0; transition: opacity .3s ease; }
.home-letter.is-visible { opacity: 1; }
.home-letter.has-caret::after {
  content: '';
  position: absolute;
  right: -.03em;
  top: 16%;
  width: 2px;
  height: .85em;
  background: var(--home-cyan);
  box-shadow: 0 0 12px rgba(0, 255, 255, .6);
  animation: caret-blink 1s step-end infinite;
}
.is-complete .home-letter.has-caret::after { animation: caret-retire 1.2s ease forwards; }
.home-owner { display: flex; flex-direction: column; align-items: center; margin-top: 30px; }
.home-contact-orbit { display: grid; grid-template-columns: 44px 126px 44px; align-items: center; column-gap: 32px; }
.home-contact-orbit .home-avatar-frame { grid-column: 2; grid-row: 1; }
.home-contact-arc { display: flex; flex-direction: column; align-items: center; gap: 9px; grid-row: 1; }
.home-contact-arc.is-left { grid-column: 1; }
.home-contact-arc.is-right { grid-column: 3; }
.home-contact-node { display: block; position: relative; animation: contact-drift 6s ease-in-out infinite; animation-delay: var(--contact-delay); }
.home-contact-arc.is-left .home-contact-node { left: 10px; }
.home-contact-arc.is-left .home-contact-node:nth-child(2) { left: -5px; }
.home-contact-arc.is-right .home-contact-node { left: -10px; }
.home-contact-arc.is-right .home-contact-node:nth-child(2) { left: 5px; }
.home-contact-orbit:focus-within .home-contact-node{ animation-play-state: paused; }
@media (hover: hover) and (pointer: fine){.home-contact-orbit:hover .home-contact-node{ animation-play-state: paused; }}
.home-contact-link { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(0, 210, 220, .18); background: rgba(0, 190, 205, .035); color: var(--home-muted); cursor: pointer; text-decoration: none; transition: color .25s ease, background .25s ease, border-color .25s ease, box-shadow .25s ease, transform .25s ease; }
.home-contact-link i { font-size: 19px; }
.home-contact-link:focus-visible{ color: var(--home-ink); border-color: rgba(0, 210, 220, .5); background: rgba(0, 190, 205, .09); box-shadow: 0 0 18px rgba(0, 210, 220, .1); transform: scale(1.06); }
@media (hover: hover) and (pointer: fine){.home-contact-link:hover{ color: var(--home-ink); border-color: rgba(0, 210, 220, .5); background: rgba(0, 190, 205, .09); box-shadow: 0 0 18px rgba(0, 210, 220, .1); transform: scale(1.06); }}
.home-contact-link:focus-visible { outline: 1px solid var(--home-muted); outline-offset: 4px; }
.home-contact-label { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translate(-50%, 3px); pointer-events: none; opacity: 0; color: var(--home-muted); font-size: 9px; letter-spacing: .04em; white-space: nowrap; transition: opacity .2s ease, transform .2s ease; }
.home-contact-link:focus-visible .home-contact-label{ opacity: 1; transform: translate(-50%, 0); }
@media (hover: hover) and (pointer: fine){.home-contact-link:hover .home-contact-label{ opacity: 1; transform: translate(-50%, 0); }}
@keyframes contact-drift { 0%, 100% { transform: translateY(1px); } 50% { transform: translateY(-2px); } }
.home-avatar-frame { position: relative; display: grid; place-items: center; width: 126px; height: 126px; border-radius: 50%; transition: transform .5s ease, filter .5s ease; }
.home-avatar-frame::before, .home-avatar-frame::after { content: ''; position: absolute; border-radius: 50%; pointer-events: none; }
.home-avatar-frame::before { inset: 0; border: 1px solid rgba(0, 225, 235, .24); border-top-color: #00ffff; border-bottom-color: #00ffff; animation: avatar-orbit 12s linear infinite; }
.home-avatar-frame::after { inset: 6px; border: 1px dashed rgba(0, 215, 225, .45); animation: avatar-orbit 28s linear infinite reverse; }
.home-avatar-orbit { position: absolute; inset: -4px; border-radius: 50%; animation: avatar-orbit 9s linear infinite; }
.home-avatar-orbit::before { content: ''; position: absolute; top: 8px; left: 22px; width: 6px; height: 6px; border-radius: 50%; background: #00ffff; box-shadow: 0 0 12px #00ffff; }
.home-owner-avatar { display: block; width: 98px; height: 98px; border-radius: 50%; object-fit: cover; background: #00ffff; box-shadow: 0 0 24px rgba(0, 255, 255, .22); }
.home-avatar-frame[data-fx]{ transform: translateY(-4px) scale(1.07); filter: drop-shadow(0 0 12px rgba(0, 255, 255, .35)); }
.home-owner-name { margin-top: 10px; color: var(--home-ink); font-family: Georgia, serif; font-size: 24px; letter-spacing: .035em; line-height: 1.3; }
.home-owner-name span { display: block; margin-top: 5px; font-family: var(--art-font); font-size: 8px; letter-spacing: .2em; color: var(--home-dim); }
.home-welcome { position: relative; width: 100%; margin-top: 19px; opacity: 0; transform: translateY(8px); transition: opacity 1s ease, transform 1s ease; }
.home-welcome.is-visible { opacity: 1; transform: translateY(0); }
.home-welcome-window { position: relative; height: 42px; overflow: hidden; }
.home-welcome-line { position: absolute; inset: 0; display: grid; place-items: center; }
.home-welcome-line p { color: var(--home-muted); font-size: 13px; font-weight: 300; line-height: 1.8; letter-spacing: .16em; animation: welcome-float 4.5s ease-in-out infinite; }
/* 欢迎语文字与 4 个圆点整体下移 4px：相对偏移不影响布局盒，也不会带动右下的箭头 */
.home-welcome-window { top: 4px; }
.home-welcome-controls { position: relative; top: 4px; }
/* 欢迎语轮播：0.7s 太快，翻页几乎一闪而过；放慢到 1.4s 并换成更柔和的缓动 */
.welcome-slide-enter-active, .welcome-slide-leave-active { transition: opacity 1.4s ease, transform 1.4s cubic-bezier(.4, 0, .2, 1); }
.welcome-slide-enter-from { opacity: 0; transform: translateY(100%); }
.welcome-slide-leave-to { opacity: 0; transform: translateY(-100%); }
.home-welcome-controls { display: flex; align-items: center; justify-content: center; gap: 2px; }
.home-welcome-controls button { display: grid; place-items: center; width: 28px; height: 28px; cursor: pointer; border-radius: 50%; color: var(--home-muted); transition: background .25s ease; }
@media (hover: hover) and (pointer: fine){.home-welcome-controls button:hover{ background: rgba(0, 225, 235, .12); }}
.home-welcome-controls button:focus-visible { outline: 2px solid #00b7c3; outline-offset: 2px; }
.home-welcome-dot span { width: 4px; height: 4px; border-radius: 4px; background: var(--home-dim); opacity: .3; transition: width .3s ease, background .3s ease, opacity .3s ease; }
.home-welcome-dot.is-active span { width: 16px; background: #00cdd7; opacity: 1; }
/* 数据保持轻量排版，悬停时浮起并显露青色底光。 */
.home-observatory { flex: none; align-self: center; width: min(840px, 100% - 32px); margin-bottom: 14px; animation: stats-arrive 1.5s ease both .4s; }
.home-stats-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; color: var(--home-dim); font-size: 9px; letter-spacing: .17em; }
.home-signal { width: 4px; height: 4px; border-radius: 50%; background: var(--home-cyan); box-shadow: 0 0 9px rgba(0, 255, 255, .65); }
.home-stats-line { flex: 1; height: 1px; margin: 0 12px; background: linear-gradient(90deg, rgba(0, 255, 255, .17), rgba(0, 255, 255, .025)); }
.home-stats-caption { font-family: var(--art-mono); font-size: 8px; letter-spacing: .2em; }
.home-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 0; }
.home-stat { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 0; padding: 18px 8px; border-radius: 12px; transition: transform .35s cubic-bezier(.22, 1, .36, 1), background .35s ease, box-shadow .35s ease; }
.home-stat::after { content: ''; position: absolute; bottom: 0; left: 25%; right: 25%; height: 2px; background: linear-gradient(90deg, transparent, #00eeee, transparent); transform: scaleX(0); opacity: 0; transition: transform .4s ease, opacity .4s ease; }
.home-stat[data-fx]{ transform: translateY(-8px); background: rgba(0, 235, 245, .065); box-shadow: 0 12px 28px -18px rgba(0, 220, 230, .5); }
.home-stat[data-fx]::after{ transform: scaleX(1); opacity: 1; }
.home-stat[data-fx] dd{ transform: scale(1.1); }
.home-stat[data-fx] dt{ color: var(--home-ink); letter-spacing: .35em; }
.home-stat dt { transition: color .35s ease, letter-spacing .35s ease; }
.home-stat + .home-stat::before { content: ''; position: absolute; left: 0; top: 7px; height: 28px; width: 1px; background: linear-gradient(transparent, rgba(0, 255, 255, .14), transparent); }
.home-stat dt { order: 2; color: var(--home-dim); font-size: 10px; font-weight: 300; letter-spacing: .25em; }
.home-stat dd { order: 1; margin: 0; color: var(--home-number); font-family: var(--art-mono); font-size: clamp(18px, 2.2vw, 28px); font-weight: 200; font-variant-numeric: tabular-nums; line-height: 1.2; text-shadow: 0 0 18px rgba(0, 255, 255, .2); transition: color .4s ease, text-shadow .4s ease, transform .35s ease; }
.home-stat[data-fx] dd{ color: var(--home-cyan); text-shadow: 0 0 24px rgba(0, 255, 255, .55); }
.home-stats-error { margin-top: 12px; width: 100%; color: #92b8bc; text-align: center; font-size: 10px; }
.home-stats-error button { margin-left: 8px; color: var(--home-cyan); text-decoration: underline; cursor: pointer; }
.home-colophon { position: relative; flex: none; display: flex; justify-content: space-between; gap: 20px; margin: 0 clamp(0px, 2.5vw, 50px); padding-bottom: env(safe-area-inset-bottom); color: var(--home-dim); font-family: var(--art-mono); font-size: 8px; letter-spacing: .13em; }
/* 欢迎语右下方的进入入口：三道依次亮起的青色箭头，像加速轨道一样指向随笔。
   绝对定位脱离文档流（不顶动上下内容），且只在移动端出现。
   无底板无边框，只靠纯青色的半透明箭头本身；依次点亮后整体循环。 */
.home-journal-row {
  position: absolute;
  right: -6px;
  bottom: -7px;
  display: none;
  justify-content: flex-end;
}
@media (max-width: 1023px) { .home-journal-row { display: flex; } }
.home-journal-enter {
  --arrow-cyan: #00ffff;
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--arrow-cyan);
  cursor: pointer;
}
.home-journal-enter i {
  display: block;
  font-size: 20px;
  line-height: 1;
  opacity: 0;
  filter: drop-shadow(0 0 8px color-mix(in srgb, var(--arrow-cyan) 40%, transparent));
  animation: home-journal-arrows 1.8s ease-in-out infinite;
}
.home-journal-enter i:nth-child(2) { animation-delay: .22s; }
.home-journal-enter i:nth-child(3) { animation-delay: .44s; }
/* chevron 墨迹 9px、字宽 20px（两侧各 5.5px 空白）：负边距抵消掉大部分留白，
   把三道箭头收到墨迹间距约 3px，像一条加速轨道 */
.home-journal-enter i + i { margin-left: -8px; }
/* 浅色主题背景是白的，纯 #00FFFF 会糊掉，压深一点点但仍保持青色 */
:global(body.theme-light .cyan-home .home-journal-enter) { --arrow-cyan: #00bfcc; }
@keyframes home-journal-arrows {
  /* 只做透明度，不做位移：箭头原地依次亮起，不会晃动 */
  0% { opacity: 0; }
  18% { opacity: .7; }
  55% { opacity: .26; }
  100% { opacity: 0; }
}
.journal-enter-enter-active { transition: opacity .6s ease; }
.journal-enter-leave-active { transition: opacity .3s ease; }
.journal-enter-enter-from,
.journal-enter-leave-to { opacity: 0; }
.home-entry-feedback { position: fixed; inset: auto 0 0; z-index: 100; pointer-events: none; }
.home-entry-track { height: 7px; background: rgba(3, 20, 25, .78); box-shadow: 0 -1px 0 rgba(0, 255, 255, .3); }
.home-entry-track span { display: block; width: 100%; height: 100%; transform-origin: left; background: #00FFFF; box-shadow: 0 0 20px rgba(0, 255, 255, .9), 0 -3px 14px rgba(0, 255, 255, .35); }
@media (prefers-reduced-motion: reduce) { .home-entry-track span { box-shadow: none; } }
/* 使用现有 body.theme-light，与其他板块同一主题状态，不另存偏好。 */
:global(body.theme-light .cyan-home) {
  --home-ground: #fff;
  --home-ink: #123e48;
  --home-muted: #365f68;
  --home-dim: #4d737a;
  --home-number: #164c59;
  --home-title: linear-gradient(110deg, #73e7ec 10%, #b0f5f5 40%, #85eeef 65%, #73e7ec 90%);
  --home-mark: linear-gradient(110deg, #00dce7 10%, #00ffff 36%, #83ffff 50%, #00ffff 64%, #00dce7 90%);
  --home-vignette: rgba(255, 255, 255, .62);
}
:global(body.theme-light .cyan-home .home-stats-error) { color: #365f68; }
:global(body.theme-light .cyan-home .home-stats-error button){ color: #007581; }
:global(body.theme-light .cyan-home .home-stat[data-fx] dd){ color: #007581; }
@keyframes aura-left { to { transform: translate3d(9%, 8%, 0) scale(1.12); } }
@keyframes aura-right { to { transform: translate3d(-8%, -5%, 0) scale(1.15); } }
@keyframes stream-drift { to { transform: translate3d(2%, -3%, 0) rotate(-17deg) scale(1.06); } }
@keyframes dust-breathe { to { opacity: .2; transform: translateY(-6px); } }
@keyframes caret-blink { 50% { opacity: 0; } }
@keyframes caret-retire { to { opacity: 0; } }
@keyframes home-arrive { from { opacity: 0; } to { opacity: 1; } }
@keyframes stats-arrive { from { opacity: 0; translate: 0 10px; } to { opacity: 1; translate: 0 0; } }
@keyframes title-flow { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes thought-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes welcome-float { 0%, 100% { transform: translateY(2px); } 50% { transform: translateY(-3px); } }
@keyframes avatar-orbit { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .cyan-home { padding: 100px 20px 26px; gap: 26px; }
  .cyan-home .home-title.art-display { font-size: clamp(36px, 9.6vw, 56px); }
  .home-eyebrow { font-size: 7px; letter-spacing: .24em; gap: 12px; margin-bottom: 24px; }
  .home-eyebrow span { width: 16px; }
  .home-owner { margin-top: 28px; }
  .home-contact-orbit { grid-template-columns: 44px 150px 44px; column-gap: 12px; }
  .home-contact-link { width: 44px; height: 44px; }
  .home-contact-arc.is-left .home-contact-node { left: 3px; }
  .home-contact-arc.is-right .home-contact-node { left: -3px; }
  /* 手机端头像下方留白较多，把中间的头像放大填满空隙 */
  .home-avatar-frame { width: 150px; height: 150px; }
  .home-owner-avatar { width: 118px; height: 118px; }
  .home-welcome-line p { font-size: 11px; letter-spacing: .06em; }
  .home-mirror { width: 115vw; }
  .home-aura { filter: blur(30px); }
  .home-stream { width: 220%; left: -60%; height: 55%; }
  .home-observatory { width: 100%; max-width: 400px; margin-bottom: 0; }
  .home-stats-heading { margin-bottom: 14px; font-size: 8px; }
  .home-stats-caption { font-size: 6px; }
  .home-stats-line { margin: 0 4px; }
  .home-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 0; }
  .home-stat { gap: 7px; padding: 12px 8px; }
  .home-stat dd { font-size: 23px; }
  .home-stat dt { font-size: 9px; }
  .home-stat:nth-child(4)::before { display: none; }
  .home-colophon { justify-content: center; }
  .home-colophon > span { display: none; }
}
/* 普通浏览器窗口优先收紧留白，不缩小原有标题和正文；再矮则由外层自然滚动。 */
@media (min-width: 641px) and (max-height: 820px) {
  .cyan-home { padding-top: 88px; padding-bottom: 24px; gap: 16px; }
  .home-eyebrow { margin-bottom: 12px; }
  .home-owner { margin-top: 16px; }
  .home-welcome { margin-top: 10px; }
  .home-observatory { margin-bottom: 0; }
  .home-stats-heading { margin-bottom: 12px; }
  .home-stat { padding-top: 10px; padding-bottom: 10px; gap: 8px; }
}
/* 矮屏允许首页内部滚动，头像、欢迎语和统计不重叠或裁切。 */
@media (prefers-reduced-motion: reduce) {
  .cyan-home *, .cyan-home *::before, .cyan-home *::after { animation: none !important; transition: none !important; }
  .home-aura, .home-stream { will-change: auto; }
  .home-letter.has-caret::after { display: none; }
  .home-journal-enter i { opacity: .5; }
  .home-stat[data-fx], .home-stat[data-fx] dd, .home-avatar-frame[data-fx], .home-contact-link:hover, .home-contact-link:focus-visible { transform: none; }
}</style>
