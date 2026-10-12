<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useUiStore } from '../stores/useUiStore'

const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUiStore()

const isDetail = computed(() => route.path.startsWith('/post/'))
const isHome = computed(() => route.path === '/')
const navScrolled = ref(false)
const menuOpen = ref(false)
const navbarFrosted = computed(() => !isHome.value || navScrolled.value || menuOpen.value)

/* 路由一变就收起手机端菜单 */
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function handleNavScroll() {
  navScrolled.value = window.scrollY > 16
}

/* ---------------- 网易云音乐播放器（APlayer + MetingJS，脚本走 index.html 的 CDN） ---------------- */
/* 歌单通过 Meting API 拉取。MetingJS 自带默认就是这个地址，这里显式写出来，
   以后要换成自建 Meting 服务只改这一行；属性里用 :api="METING_API" 绑定。 */
const METING_API = 'https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r'
const musicWrapEl = ref(null)
const musicOpen = ref(false)
/* 首次点开才创建 <meting-js>：首屏零额外请求、零二次实例开销，点过一次后保持挂载（切歌不重新拉歌单） */
const musicMounted = ref(false)
const musicPlaying = ref(false)
const musicReady = ref(false)
/* 加载失败的兜底提示：为空 = 还没失败（正在加载或已就绪） */
const musicError = ref('')
const musicVolume = ref(0.1)
/* 播放模式：顺序 → 随机 → 单曲循环（APlayer 的 order 管顺序/随机，loop 管列表循环/单曲） */
const MUSIC_MODES = [
  { key: 'list', icon: 'ph-list-numbers', label: '顺序播放' },
  { key: 'random', icon: 'ph-shuffle', label: '随机播放' },
  { key: 'one', icon: 'ph-repeat-once', label: '单曲循环' },
]
const musicMode = ref('list')
const musicModeMeta = computed(() => MUSIC_MODES.find(m => m.key === musicMode.value) || MUSIC_MODES[0])
const musicTracks = ref([])
const musicIndex = ref(0)
const musicProgress = ref(0)   // 0-1000，映射播放进度百分比
const musicListOpen = ref(false)
let musicBindTimer = 0

/* 当前曲目与封面：界面自绘，数据都从 APlayer 实例里读 */
const musicTrack = computed(() => musicTracks.value[musicIndex.value] || { name: '', artist: '' })
const musicCover = computed(() => musicTracks.value[musicIndex.value]?.cover || '')
const volumeIcon = computed(() => {
  if (musicVolume.value <= 0) return 'ph-speaker-slash'
  return musicVolume.value < 0.5 ? 'ph-speaker-low' : 'ph-speaker-high'
})
let musicLastVolume = 0.1

function toggleMusic() {
  musicOpen.value = !musicOpen.value
  if (musicOpen.value) {
    musicMounted.value = true
    nextTick(bindMusicEvents)
  }
}

/* meting-js 是"先拉歌单、再 new APlayer"，实例不是同步就位的，
   所以轮询等 el.aplayer 出现后再挂 play/pause 事件；这段时间面板只显示加载动效。 */
const MUSIC_PROBE_TRIES = 50
/* 兜底提示分两种：脚本根本没到 vs 脚本在但歌单没回来（接口被墙、歌单为空都会走到这里） */
const MUSIC_SCRIPT_ERROR = '播放器脚本加载失败，请检查网络后重试。'
const MUSIC_PLAYLIST_ERROR = '歌单加载失败，请稍后重试。'

function bindMusicEvents() {
  if (musicBindTimer) return
  /* 两个 CDN 脚本都是 defer，一定先于模块脚本执行：这里取不到就是真没加载成功，不必再空等 */
  if (!window.APlayer || !(window.customElements && window.customElements.get('meting-js'))) {
    musicError.value = MUSIC_SCRIPT_ERROR
    return
  }
  let tries = 0
  const probe = () => {
    const el = musicWrapEl.value && musicWrapEl.value.querySelector('meting-js')
    const player = el && el.aplayer
    if (player) {
      musicBindTimer = 0
      musicReady.value = true
      musicError.value = ''
      const sync = () => { musicPlaying.value = !player.audio.paused }
      const readList = () => {
        musicTracks.value = (player.list.audios || []).map(a => ({
          name: a.name || '未知曲目',
          artist: a.artist || '',
          cover: a.cover || '',
        }))
        musicIndex.value = player.list.index || 0
      }
      player.on('play', () => { musicPlaying.value = true })
      player.on('pause', sync)
      player.on('ended', sync)
      player.on('volumechange', () => { musicVolume.value = Number(player.audio.volume) })
      /* 注意：APlayer 是先触发 listswitch、再更新 list.index，
         所以必须用事件里的 index，不能读 player.list.index */
      player.on('listswitch', (data) => {
        musicIndex.value = data && typeof data.index === 'number' ? data.index : (player.list.index || 0)
      })
      sync()
      readList()
      musicVolume.value = Number(player.audio.volume)
      musicMode.value = player.options.loop === 'one'
        ? 'one'
        : (player.options.order === 'random' ? 'random' : 'list')
      /* 进度直接听原生媒体事件，比 APlayer 自己的定时器更省事也更准 */
      const syncProgress = () => {
        const duration = player.duration || 0
        musicProgress.value = duration ? Math.round((player.audio.currentTime / duration) * 1000) : 0
      }
      player.audio.addEventListener('timeupdate', syncProgress)
      player.audio.addEventListener('loadedmetadata', syncProgress)
      player.audio.addEventListener('durationchange', syncProgress)
      return
    }
    if (++tries > MUSIC_PROBE_TRIES) {
      musicBindTimer = 0
      musicError.value = MUSIC_PLAYLIST_ERROR
      return
    }
    musicBindTimer = window.setTimeout(probe, 200)
  }
  probe()
}

/* 重试：重新挂一次 <meting-js>，等于重拉歌单、重建 APlayer */
function retryMusic() {
  if (!musicError.value) return
  const el = musicWrapEl.value && musicWrapEl.value.querySelector('meting-js')
  /* MetingJS 的 disconnectedCallback 会无条件执行 this.aplayer.destroy()，
     实例没建起来时移除元素会抛未捕获错误，先补个空壳再换掉这个元素 */
  if (el && !el.aplayer) el.aplayer = { destroy() {} }
  musicError.value = ''
  musicMounted.value = false
  nextTick(() => {
    musicMounted.value = true
    nextTick(bindMusicEvents)
  })
}

function musicPlayer() {
  const el = musicWrapEl.value && musicWrapEl.value.querySelector('meting-js')
  return el && el.aplayer
}

/* APlayer 普通模式自带上一首/下一首的 API，但没画按钮（只有 fixed 模式才有），所以这里自己加 */
function musicPrev() {
  const player = musicPlayer()
  if (player) player.skipBack()
}

function musicNext() {
  const player = musicPlayer()
  if (player) player.skipForward()
}

function musicToggle() {
  const player = musicPlayer()
  if (player) player.toggle()
}

function onVolumeInput(event) {
  const value = Number(event.target.value)
  musicVolume.value = value
  if (value > 0) musicLastVolume = value
  const player = musicPlayer()
  if (player) player.volume(value)
}

/* 喇叭图标：点一下静音，再点恢复 */
function musicToggleMute() {
  const player = musicPlayer()
  if (!player) return
  if (musicVolume.value > 0) {
    musicLastVolume = musicVolume.value
    musicVolume.value = 0
    player.volume(0)
  } else {
    const back = musicLastVolume || 0.1
    musicVolume.value = back
    player.volume(back)
  }
}

/* 播放模式：顺序 → 随机 → 单曲循环。APlayer 内部读取的就是 options.order / options.loop */
function musicCycleMode() {
  const player = musicPlayer()
  if (!player) return
  const i = MUSIC_MODES.findIndex(m => m.key === musicMode.value)
  const next = MUSIC_MODES[(i + 1) % MUSIC_MODES.length].key
  musicMode.value = next
  player.options.order = next === 'random' ? 'random' : 'list'
  player.options.loop = next === 'one' ? 'one' : 'all'
}

/* 进度条拖动：APlayer 的 seek 接收的是秒 */
function onSeekInput(event) {
  const value = Number(event.target.value)
  musicProgress.value = value
  const player = musicPlayer()
  if (player && player.duration) player.seek((player.duration * value) / 1000)
}

function playTrack(index) {
  const player = musicPlayer()
  if (!player) return
  player.list.switch(index)
  player.play()
}

/* 点空白处收起播放器（按钮在同一个包裹容器里，点按钮不会触发关闭） */
function onGlobalClickForMusic(event) {
  if (!musicOpen.value) return
  const wrap = musicWrapEl.value
  if (!wrap) return
  /* 用事件派发时的路径判断：面板里的按钮可能在自己的 click 处理里被换掉
     （例如点了重试，状态区随即重绘），这时 event.target 已经脱离 DOM，
     按它判断会误当成"点了空白处"，把面板一起收走 */
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
  if (path.includes(wrap)) return
  musicOpen.value = false
}

function handleAvatarError(event) {
  event.target.src = authStore.fallbackAvatar
}

onMounted(() => {
  navScrolled.value = window.scrollY > 16
  window.addEventListener('scroll', handleNavScroll, { passive: true })
  document.addEventListener('click', onGlobalClickForMusic)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleNavScroll)
  document.removeEventListener('click', onGlobalClickForMusic)
  if (musicBindTimer) clearTimeout(musicBindTimer)
})
</script>

<template>
    <header class="cyan-navbar" :class="{ 'is-frosted': navbarFrosted, 'is-home': isHome }"
        @keydown.esc="menuOpen = false">
      <div class="cyan-navbar-inner">
        <RouterLink to="/" class="cyan-brand" aria-label="Cyan · 主页" @click="scrollToTop">Cyan<span>.</span></RouterLink>
        <nav id="primary-navigation" class="cyan-nav-links" :class="{ 'is-open': menuOpen }" aria-label="主导航"
            @click="menuOpen = false">
          <RouterLink to="/" exact-active-class="is-active">主页</RouterLink>
          <RouterLink to="/blog" :class="{ 'is-active': isDetail }" exact-active-class="is-active">随笔</RouterLink>
          <RouterLink to="/board" exact-active-class="is-active">留言板</RouterLink>
          <RouterLink to="/playground" exact-active-class="is-active">杂物柜</RouterLink>
          <RouterLink v-if="authStore.isGlobalAdmin" to="/admin" exact-active-class="is-active">控制台</RouterLink>
        </nav>
        <div class="cyan-nav-actions">
          <!-- 音乐入口：点开在按钮下方弹出播放器（点空白处自动收起） -->
          <div ref="musicWrapEl" class="cyan-music">
            <button type="button" class="cyan-nav-icon cyan-music-toggle" :class="{ 'is-playing': musicPlaying }"
                :aria-expanded="musicOpen" aria-haspopup="dialog" aria-controls="cyMusicPanel"
                :aria-label="musicOpen ? '收起音乐播放器' : '打开音乐播放器'"
                :title="musicOpen ? '收起播放器' : '播放音乐'" @click="toggleMusic">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.2 17.4V6.3l9.3-1.8v11" />
                <circle cx="6.7" cy="17.7" r="2.5" />
                <circle cx="16" cy="15.8" r="2.5" />
              </svg>
            </button>
            <Transition name="music-pop">
              <div v-show="musicOpen" id="cyMusicPanel" class="cyan-music-pop" role="dialog"
                  aria-label="网易云音乐播放器">
                <!-- APlayer 只当引擎：默认 UI 全部藏起来，界面下面自绘（音频照常播放） -->
                <meting-js v-if="musicMounted" server="netease" type="playlist" id="6642044848"
                    :api="METING_API" autoplay="false" order="list" list-folded="true"
                    volume="0.1" storage-name="cyMusic-v3" theme="#00ffff"></meting-js>
                <!-- 实例没就位：面板只给状态（加载动效 / 兜底提示），控制条等能播了再出现 -->
                <div v-if="!musicReady" class="cy-m-state" role="status">
                  <i class="ph-bold cy-m-state-icon"
                      :class="musicError ? 'ph-warning-circle' : 'ph-spinner-gap animate-spin'"
                      aria-hidden="true"></i>
                  <p class="cy-m-state-text">{{ musicError || '正在加载歌单…' }}</p>
                  <button v-if="musicError" type="button" class="cy-m-retry" @click="retryMusic">重试</button>
                </div>
                <template v-else>
                  <!-- ① 圆形小封面 · 歌名/作者 · 音量 -->
                  <div class="cy-m-top">
                    <span class="cy-m-cover" :style="{ backgroundImage: musicCover ? `url(${musicCover})` : '' }"
                        aria-hidden="true"></span>
                    <span class="cy-m-meta">
                      <b class="cy-m-title" :title="musicTrack.name">{{ musicTrack.name }}</b>
                      <i class="cy-m-author" :title="musicTrack.artist">{{ musicTrack.artist }}</i>
                    </span>
                    <button type="button" class="cy-m-volicon" :aria-label="musicVolume > 0 ? '静音' : '恢复音量'"
                        :title="musicVolume > 0 ? '静音' : '恢复音量'" @click="musicToggleMute">
                      <i class="ph-bold" :class="volumeIcon"></i>
                    </button>
                    <input class="cy-m-vol" type="range" min="0" max="1" step="0.01" aria-label="音量"
                        :value="musicVolume" :style="{ '--vol': Math.round(musicVolume * 100) + '%' }"
                        @input="onVolumeInput">
                  </div>
                  <!-- ② 进度条整行（可拖动） -->
                  <input class="cy-m-bar" type="range" min="0" max="1000" step="1" aria-label="播放进度"
                      :value="musicProgress" :style="{ '--played': (musicProgress / 10) + '%' }"
                      @input="onSeekInput" @change="onSeekInput">
                  <!-- ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单 -->
                  <div class="cy-m-ctrl">
                    <button type="button" class="cy-m-btn cy-m-mode"
                        :aria-label="musicModeMeta.label + '，点击切换播放模式'"
                        :title="musicModeMeta.label" @click="musicCycleMode">
                      <i class="ph-bold" :class="musicModeMeta.icon"></i>
                    </button>
                    <button type="button" class="cy-m-btn" aria-label="上一首" title="上一首"
                        @click="musicPrev"><i class="ph-fill ph-skip-back"></i></button>
                    <button type="button" class="cy-m-btn cy-m-play"
                        :aria-label="musicPlaying ? '暂停' : '播放'" :title="musicPlaying ? '暂停' : '播放'"
                        @click="musicToggle"><i class="ph-fill" :class="musicPlaying ? 'ph-pause' : 'ph-play'"></i></button>
                    <button type="button" class="cy-m-btn" aria-label="下一首" title="下一首"
                        @click="musicNext"><i class="ph-fill ph-skip-forward"></i></button>
                    <button type="button" class="cy-m-btn cy-m-menu" :aria-expanded="musicListOpen"
                        :aria-label="musicListOpen ? '收起歌单' : '展开歌单'" :title="musicListOpen ? '收起歌单' : '展开歌单'"
                        @click="musicListOpen = !musicListOpen"><i class="ph-bold ph-playlist"></i></button>
                  </div>
                  <!-- ④ 歌单：最多同时 5 首，其余滚动；展开/收起走高度动画 -->
                  <Transition name="cy-m-list">
                    <div v-show="musicListOpen" class="cy-m-list-reveal">
                      <ul class="cy-m-list">
                        <li v-for="(track, index) in musicTracks" :key="index"
                            :class="{ 'is-current': index === musicIndex }" @click="playTrack(index)">
                          <span class="cy-m-idx">{{ String(index + 1).padStart(2, '0') }}</span>
                          <span class="cy-m-name">{{ track.name }}</span>
                          <span class="cy-m-by">{{ track.artist }}</span>
                        </li>
                      </ul>
                    </div>
                  </Transition>
                </template>
              </div>
            </Transition>
          </div>
          <button type="button" class="cyan-nav-icon" :aria-label="uiStore.isLightMode ? '切换深色主题' : '切换浅色主题'"
              :title="uiStore.isLightMode ? '切换深色主题' : '切换浅色主题'" @click="uiStore.toggleLightMode($event.currentTarget)">
            <svg v-if="uiStore.isLightMode" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
          </button>
          <button type="button" class="cyan-account" aria-label="账户设置" @click="uiStore.openDialog('setting')">
            <img :src="authStore.avatar" @error="handleAvatarError" alt="" width="30" height="30">
          </button>
          <button type="button" class="cyan-nav-icon cyan-menu-toggle" :aria-expanded="menuOpen" aria-controls="primary-navigation"
              :aria-label="menuOpen ? '关闭导航' : '展开导航'" @click="menuOpen = !menuOpen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'" /></svg>
            <span class="cyan-menu-label">{{ menuOpen ? '关闭' : '菜单' }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- 手机端菜单蒙层：点空白处也能收起，不必再去找那个按钮 -->
    <Transition name="nav-scrim">
      <div v-if="menuOpen" class="cyan-nav-scrim" aria-hidden="true" @click="menuOpen = false"></div>
    </Transition>
</template>

<style scoped>
/* 独立顶栏不复用旧侧栏主题，避免首页透明态被全局浅色规则覆盖。 */
.cyan-navbar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 110;
  color: var(--art-ink-2);
  border-bottom: 1px solid transparent;
  background: transparent;
  /* 回到首页时顶栏要在"毛玻璃"和"透明"之间切换：
     color 与 backdrop-filter 也得一起过渡，否则那一帧会硬闪一下 */
  transition: background-color .45s ease, border-color .45s ease, box-shadow .45s ease, color .45s ease,
    -webkit-backdrop-filter .45s ease, backdrop-filter .45s ease;
}
.cyan-navbar.is-home { color: #b8e1e5; }
:global(body.theme-light .cyan-navbar.is-home) { color: #25565c; }
.cyan-navbar.is-frosted {
  /* 吸顶栏每帧都要对下方像素重做一次高斯模糊，是全站最贵的滚动开销之一。
     把背景调实一点（.78 → .9）、模糊半径减半（22px → 12px）并去掉 saturate 的额外色彩通道，
     观感几乎不变，但每帧的模糊开销明显下降 */
  background: rgba(7, 18, 21, .9);
  border-color: rgba(169, 222, 222, .1);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 30px rgba(0, 25, 30, .035);
}
:global(body.theme-light .cyan-navbar.is-frosted) {
  background: rgba(241, 250, 248, .9);
  border-color: rgba(47, 102, 105, .1);
}
.cyan-navbar-inner {
  height: 74px;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 clamp(22px, 4.5vw, 76px);
  display: flex;
  align-items: center;
  gap: clamp(24px, 4vw, 60px);
}
.cyan-brand {
  margin-right: auto;
  position: relative;
  transition: transform .4s ease, text-shadow .4s ease;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 32px;
  line-height: 1;
  letter-spacing: -.055em;
}
.cyan-brand span { display: inline-block; color: #00ffff; transition: transform .4s ease, text-shadow .4s ease; }
.cyan-brand::after { content: ''; position: absolute; left: 0; right: 0; bottom: -8px; height: 2px; background: linear-gradient(90deg, transparent, #00ffff, transparent); transform: scaleX(0); transition: transform .4s ease; }
.cyan-brand[data-fx], .cyan-brand:focus-visible { transform: translateY(-2px) rotate(-3deg); text-shadow: 0 4px 18px rgba(0, 235, 245, .45); }
.cyan-brand[data-fx] span, .cyan-brand:focus-visible span { transform: translateY(-5px) scale(1.3); text-shadow: 0 0 12px #00ffff; }
.cyan-brand[data-fx]::after, .cyan-brand:focus-visible::after { transform: scaleX(1); }
.cyan-nav-links { display: flex; align-items: center; gap: clamp(22px, 2.7vw, 40px); }
.cyan-nav-links a {
  position: relative;
  padding: 12px 0;
  font-size: 12px;
  letter-spacing: .12em;
  white-space: nowrap;
  opacity: .7;
  transition: opacity .25s ease, transform .3s ease, text-shadow .3s ease;
}
.cyan-nav-links a::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 50%;
  width: 22px;
  height: 2px;
  background: #00dce7;
  box-shadow: 0 0 10px rgba(0, 255, 255, .35);
  transform: translateX(-50%) scaleX(0);
  transition: transform .3s ease;
}
.cyan-nav-links a.is-active { opacity: 1; }
.cyan-nav-links a.is-active::after, .cyan-nav-links a[data-fx]::after, .cyan-nav-links a:focus-visible::after { transform: translateX(-50%) scaleX(1); }
.cyan-nav-links a[data-fx], .cyan-nav-links a:focus-visible { opacity: 1; transform: translateY(-3px); text-shadow: 0 0 16px rgba(0, 220, 230, .5); }
.cyan-nav-icon, .cyan-account { border-radius: 50%; transition: transform .3s ease, background .3s ease, box-shadow .3s ease; }
.cyan-nav-icon[data-fx], .cyan-account[data-fx], .cyan-nav-icon:focus-visible, .cyan-account:focus-visible { transform: translateY(-2px); background: rgba(0, 225, 235, .1); box-shadow: 0 0 18px rgba(0, 225, 235, .12); }
.cyan-nav-icon svg { transition: transform .4s ease; }
.cyan-nav-icon[data-fx] svg { transform: rotate(-15deg); }
.cyan-nav-actions { display: flex; align-items: center; gap: 16px; }
.cyan-nav-icon { display: grid; place-items: center; width: 36px; height: 40px; cursor: pointer; }
.cyan-nav-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.cyan-account { cursor: pointer; padding: 5px; }
.cyan-account img { width: 30px; height: 30px; object-fit: cover; border-radius: 50%; border: 1px solid rgba(100, 155, 155, .2); }

/* ---------------- 音乐播放器（APlayer + MetingJS） ---------------- */
.cyan-music { --cy-accent: #00ffff; display: flex; align-items: center; }
:global(body.theme-light .cyan-music) { --cy-accent: #00cfd8; }
/* 播放中：只做轻微的呼吸脉冲 + 一点点青色辉光，不做旋转（转起来很怪） */
.cyan-music-toggle.is-playing { color: var(--cy-accent); }
.cyan-music-toggle.is-playing svg {
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--cy-accent) 70%, transparent));
  animation: cyMusicPulse 1.9s ease-in-out infinite;
}
@keyframes cyMusicPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .62; transform: scale(.92); }
}

/* 弹窗 = 四行自绘界面（高度比 APlayer 默认布局矮一截）：
     ① 小圆封面 · 歌名/作者 · 音量
     ② 进度条（整行，可拖）
     ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单
     ④ 歌单（点菜单展开，最多同时 5 首）
   APlayer 实例只负责取歌单与播放，默认 UI 整个隐藏。 */
.cyan-music-pop {
  /* 进度条与播放键的青色（接近 #00FFFF）；浅色主题下白底会糊，压深一档 */
  position: fixed;
  top: 76px;
  right: 74px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(320px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid var(--art-line);
  border-radius: 16px;
  /* 封面顶在左上角，靠这里把它的左上直角裁成和面板一致的圆角 */
  overflow: hidden;
  background: color-mix(in srgb, var(--art-bg) 88%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 22px 60px -26px rgba(0, 0, 0, .6), 0 2px 10px -6px rgba(0, 0, 0, .35);
}
:global(body.theme-light .cyan-music-pop) {
  background: rgba(255, 255, 255, .92);
  box-shadow: 0 20px 50px -28px rgba(15, 40, 45, .35), 0 2px 8px -6px rgba(15, 40, 45, .18);
}
/* APlayer 只当引擎：整棵默认 UI 不渲染（音频照常播放） */
.cyan-music-pop :deep(.aplayer) { display: none }

/* 实例还没就位：面板里唯一可见的状态行（转圈加载 / 失败提示 + 重试） */
.cy-m-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 0 4px;
}
.cy-m-state-icon { flex: 0 0 auto; color: var(--cy-accent); font-size: 17px; }
.cy-m-state-text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--art-ink-3);
  font-size: 12px;
  line-height: 1.5;
}
.cy-m-retry {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--cy-accent) 45%, transparent);
  border-radius: 100px;
  color: var(--cy-accent);
  font-size: 11px;
  letter-spacing: .06em;
  cursor: pointer;
  transition: background .25s ease, border-color .25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .cy-m-retry:hover {
    border-color: var(--cy-accent);
    background: color-mix(in srgb, var(--cy-accent) 12%, transparent);
  }
}

/* —— ① 小圆封面 · 歌名/作者 · 音量 —— */
.cy-m-top { display: flex; align-items: center; gap: 10px; }
.cy-m-cover {
  flex: 0 0 50px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--cy-accent) 26%, transparent);
  background-size: cover;
  background-position: center;
}
/* 歌名一行、作者一行：长标题不容易被截断；两行合起来仍矮于 50px 的封面，窗口高度不变 */
.cy-m-meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.cy-m-title {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}
.cy-m-author {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink-4);
  font-size: 11px;
  font-style: normal;
  line-height: 1.3;
}
.cy-m-vol,
.cy-m-bar {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.cy-m-volicon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--cy-accent);
  opacity: .78;
  font-size: 14px;
  cursor: pointer;
  transition: color .25s ease, opacity .25s ease;
}
@media (hover: hover) and (pointer: fine) { .cy-m-volicon:hover { opacity: 1 } }
.cy-m-vol { flex: 0 0 56px; width: 56px; height: 15px; }
.cy-m-vol::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--cy-accent) 0 var(--vol), color-mix(in srgb, var(--art-ink-4) 40%, transparent) var(--vol) 100%);
}
.cy-m-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 9px;
  height: 9px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--cy-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cy-accent) 65%, transparent);
}
.cy-m-vol::-moz-range-track { height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--art-ink-4) 40%, transparent) }
.cy-m-vol::-moz-range-progress { height: 3px; border-radius: 2px; background: var(--cy-accent) }
.cy-m-vol::-moz-range-thumb { width: 9px; height: 9px; border: 0; border-radius: 50%; background: var(--cy-accent) }

/* —— ② 进度条整行 —— */
.cy-m-bar { width: 100%; height: 15px; }
.cy-m-bar::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--cy-accent) 0 var(--played), color-mix(in srgb, var(--art-ink-4) 35%, transparent) var(--played) 100%);
}
.cy-m-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: var(--cy-accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--cy-accent) 65%, transparent);
}
.cy-m-bar::-moz-range-track { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--art-ink-4) 35%, transparent) }
.cy-m-bar::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--cy-accent) }
.cy-m-bar::-moz-range-thumb { width: 11px; height: 11px; border: 0; border-radius: 50%; background: var(--cy-accent) }

/* —— ③ 顺序 · 上一首 · 播放/暂停 · 下一首 · 菜单 —— */
.cy-m-ctrl { display: flex; align-items: center; }
.cy-m-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--art-ink-2);
  font-size: 16px;
  cursor: pointer;
  transition: color .25s ease, background .25s ease, opacity .25s ease;
}
.cy-m-btn:disabled { opacity: .3; cursor: default; }
/* 顺序贴左、菜单贴右，自动外边距把中间三个键压在正中 */
.cy-m-mode { margin-right: auto; }
.cy-m-menu { margin-left: auto; }
.cy-m-play { width: 36px; height: 36px; margin: 0 2px; color: var(--cy-accent); font-size: 20px; }
@media (hover: hover) and (pointer: fine) {
  .cy-m-btn:not(:disabled):hover { color: var(--cy-accent); background: color-mix(in srgb, var(--cy-accent) 14%, transparent) }
}

/* —— ④ 歌单：最多同时 5 首（每行 32px），其余滚动 —— */
/* 高度动画由外层裁剪；列表本身必须保留 overflow-y:auto，否则会被这里的 hidden 覆盖、滚不动 */
.cy-m-list-reveal { display: grid; grid-template-rows: 1fr; overflow: hidden; }
.cy-m-list-reveal .cy-m-list { min-height: 0; }
/* 展开 / 收起走高度动画（0fr → 1fr），和站内其它折叠区同一套做法 */
.cy-m-list-enter-active,
.cy-m-list-leave-active { transition: grid-template-rows .34s cubic-bezier(.22, 1, .36, 1), opacity .26s ease; }
.cy-m-list-enter-from,
.cy-m-list-leave-to { grid-template-rows: 0fr; opacity: 0; }
.cy-m-list {
  list-style: none;
  margin: 0;
  padding: 6px 0 0;
  max-height: 166px;
  overflow-y: auto;
  border-top: 1px solid var(--art-line);
}
.cy-m-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--art-ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: background .2s ease, color .2s ease;
}
.cy-m-list li:hover { background: color-mix(in srgb, var(--art-accent) 8%, transparent) }
.cy-m-list li.is-current { background: color-mix(in srgb, var(--cy-accent) 18%, transparent); color: var(--art-ink) }
.cy-m-list li.is-current .cy-m-idx { color: var(--cy-accent) }
.cy-m-idx { flex: 0 0 18px; color: var(--art-ink-4); font-family: var(--art-mono); font-size: 10px }
.cy-m-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cy-m-by {
  flex: 0 1 auto;
  max-width: 40%;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--art-ink-4);
  font-size: 11px;
}
.cy-m-list::-webkit-scrollbar { width: 5px }
.cy-m-list::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--art-line-2) }

/* 弹窗进出只做淡入淡出：这块带 backdrop-filter，动 transform 会让模糊每帧重算，反而卡 */
.music-pop-enter-active { transition: opacity .3s ease; }
.music-pop-leave-active { transition: opacity .2s ease; }
.music-pop-enter-from, .music-pop-leave-to { opacity: 0; }

/* 手机端：改成贴着导航栏下方的整宽面板 */
@media (max-width: 640px) {
  .cyan-music-pop { top: 82px; left: 12px; right: 12px; width: auto; max-height: calc(100vh - 96px); overflow-y: auto }
}
@media (prefers-reduced-motion: reduce) {
  .cyan-music-toggle.is-playing svg { animation: none }
  .music-pop-enter-active, .music-pop-leave-active { transition: none }
}

.cyan-menu-toggle { display: none; }
.cyan-menu-label { display: none; }
.cyan-navbar a:focus-visible, .cyan-navbar button:focus-visible { outline: 2px solid #4a999f; outline-offset: 5px; border-radius: 3px; }

/* 手机端菜单蒙层：只有 ≤640px 且菜单打开时才铺开，点它任意位置即收起 */
.cyan-nav-scrim { display: none; }
.nav-scrim-enter-active, .nav-scrim-leave-active { transition: opacity .24s ease; }
.nav-scrim-enter-from, .nav-scrim-leave-to { opacity: 0; }

@media (max-width: 640px) {
  .cyan-nav-scrim {
    display: block;
    position: fixed;
    inset: 74px 0 0;
    z-index: 105;
    background: rgba(3, 12, 16, .45);
  }
  :global(body.theme-light .cyan-nav-scrim) { background: rgba(20, 50, 56, .18); }
  .cyan-navbar-inner { gap: 16px; }
  .cyan-brand { font-size: 29px; }
  .cyan-nav-actions { gap: 8px; }
  /* 手机端把入口做成带文字的胶囊：纯汉堡图标很容易被当成装饰忽略掉 */
  .cyan-menu-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: auto;
    height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(0, 225, 235, .28);
    border-radius: 999px;
    background: rgba(0, 225, 235, .06);
    color: var(--art-ink-2);
    font-size: 12px;
    letter-spacing: .04em;
  }
  .cyan-menu-toggle svg { width: 15px; height: 15px; stroke-width: 1.7; }
  .cyan-menu-label { display: inline; white-space: nowrap; }
  .cyan-menu-toggle[data-fx], .cyan-menu-toggle:focus-visible, .cyan-menu-toggle[aria-expanded="true"] {
    border-color: rgba(0, 225, 235, .6);
    background: rgba(0, 225, 235, .14);
    color: var(--art-ink);
  }
  :global(body.theme-light .cyan-menu-toggle) {
    border-color: rgba(15, 110, 120, .26);
    background: rgba(15, 110, 120, .055);
    color: #25565c;
  }
  .cyan-nav-links {
    position: absolute;
    top: 73px;
    left: 0;
    right: 0;
    padding: 12px 22px 20px;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px 26px;
    background: #0e2023;
    border-bottom: 1px solid rgba(100, 155, 155, .15);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    /* 收起：整块上移淡出；展开时再滑下来 */
    transform: translateY(-12px);
    /* visibility 用 0s + 延迟：动画期间保持可见，结束后再隐藏，
       避开「离散属性插值 + 常驻合成层被拆除」在收起瞬间闪一下 */
    transition: opacity .22s ease, transform .26s cubic-bezier(.4, 0, .6, 1), visibility 0s linear .26s;
  }
  :global(body.theme-light .cyan-navbar .cyan-nav-links) { background: #eff8f6; }
  .cyan-nav-links.is-open {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    transition: opacity .3s ease, transform .38s cubic-bezier(.22, 1, .36, 1), visibility 0s;
  }
  .cyan-nav-links a { font-size: 13px; }
  /* 菜单项依次落下，比整块一起出现更有层次；动画只定义 from，终态仍交给原有样式 */
  .cyan-nav-links.is-open a { animation: nav-item-drop .38s cubic-bezier(.22, 1, .36, 1) backwards; }
  .cyan-nav-links.is-open a:nth-child(1) { animation-delay: .04s; }
  .cyan-nav-links.is-open a:nth-child(2) { animation-delay: .085s; }
  .cyan-nav-links.is-open a:nth-child(3) { animation-delay: .13s; }
  .cyan-nav-links.is-open a:nth-child(4) { animation-delay: .175s; }
  .cyan-nav-links.is-open a:nth-child(5) { animation-delay: .22s; }
  /* 汉堡按钮开合时转一下，和面板动效呼应 */
  .cyan-menu-toggle svg { transition: transform .32s cubic-bezier(.22, 1, .36, 1); }
  .cyan-menu-toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
}
@keyframes nav-item-drop {
  from { opacity: 0; transform: translateY(-8px); }
}
@media (prefers-reduced-motion: reduce) {
  .cyan-navbar, .cyan-navbar *, .cyan-navbar *::after,
  .nav-scrim-enter-active, .nav-scrim-leave-active { transition: none !important; animation: none !important; }
  .cyan-navbar a:hover, .cyan-navbar a:focus-visible, .cyan-navbar button:hover, .cyan-navbar button:focus-visible, .cyan-brand:hover span, .cyan-brand:focus-visible span, .cyan-nav-icon:hover svg { transform: none; }
}
</style>
