import { defineStore } from "pinia";
import { ref } from "vue";

let toastSeq = 0;
const MAX_TOASTS = 3;
/* 回调放模块作用域，不进 state */
let pendingConfirmAction = null;

/* 清爽模式：偏好存 localStorage，切换时给 <body> 挂 .theme-light */
const THEME_KEY = "anim_theme";
/* 薄雾过渡节奏，对应 style.css 里 .art-theme-veil / .art-theme-halo 的时长 */
const VEIL_IN_MS = 286;
const VEIL_OUT_MS = 340;
const HALO_MS = 580;
/* 进行中的那一段过渡：下一次切换先收掉它，连点也不会被卡住 */
let cancelThemeRun = null;

export function readLightMode() {
  try {
    /* 默认走清爽模式：只有显式选过深色才保持深色 */
    return localStorage.getItem(THEME_KEY) !== "dark";
  } catch (e) {
    return true;
  }
}

/* 页面真正换肤的那一刻才翻转：md-editor 等第三方主题绑它，避免比整页提前换色 */
export const appliedLightMode = ref(readLightMode());

function setThemeClass(on) {
  appliedLightMode.value = on;
  document.body.classList.toggle("theme-light", on);
  try {
    localStorage.setItem(THEME_KEY, on ? "light" : "dark");
  } catch (e) {}
}

function stopThemeRun() {
  if (cancelThemeRun) {
    cancelThemeRun();
    cancelThemeRun = null;
  }
  document.body.classList.remove("theme-switching");
}

/* 切主题：animate=true 时薄雾从按钮晕开铺满整屏 → 换肤 → 化开 */
export function applyLightMode(isLight, animate = false, originEl = null) {
  const on = !!isLight;
  /* 先接管上一段，动画没播完也允许立刻再切 */
  stopThemeRun();
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setThemeClass(on);
    return;
  }
  /* 冻结各元素自身的颜色补间，避免热力图这类色块换肤时"慢半拍" */
  document.body.classList.add("theme-switching");

  /* 光晕从按钮位置晕开，拿不到按钮时退回顶部中间 */
  const rect = originEl && originEl.getBoundingClientRect ? originEl.getBoundingClientRect() : null;
  const x = rect && rect.width ? Math.round(rect.left + rect.width / 2) : Math.round(window.innerWidth / 2);
  const y = rect && rect.height ? Math.round(rect.top + rect.height / 2) : Math.round(window.innerHeight * 0.18);

  const veil = document.createElement("div");
  veil.className = "art-theme-veil" + (on ? " is-to-light" : "");
  const halo = document.createElement("div");
  halo.className = "art-theme-halo";
  [veil, halo].forEach((el) => {
    el.style.setProperty("--art-theme-x", x + "px");
    el.style.setProperty("--art-theme-y", y + "px");
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  });
  if (originEl && originEl.classList) originEl.classList.add("is-switching");

  const timers = [];
  cancelThemeRun = () => {
    timers.forEach((id) => window.clearTimeout(id));
    veil.remove();
    halo.remove();
    if (originEl && originEl.classList) originEl.classList.remove("is-switching");
    document.body.classList.remove("theme-switching");
  };

  /* 下一帧再上状态，保证 transition / animation 从初始态起步 */
  requestAnimationFrame(() => {
    veil.classList.add("is-on");
    halo.classList.add("is-run");
    timers.push(window.setTimeout(() => {
      /* 薄雾铺满时才换肤，随后化开就是新皮肤 */
      setThemeClass(on);
      veil.classList.replace("is-on", "is-off");
      timers.push(window.setTimeout(() => {
        veil.remove();
        cancelThemeRun = null;
        document.body.classList.remove("theme-switching");
      }, VEIL_OUT_MS));
      timers.push(window.setTimeout(() => {
        halo.remove();
        if (originEl && originEl.classList) originEl.classList.remove("is-switching");
      }, HALO_MS));
    }, VEIL_IN_MS));
  });
}

export const useUiStore = defineStore("ui", {
  state: () => ({
    dialogs: { setting: false, confirm: false },
    postEditDraft: null,
    resourceEditDraft: null,
    /* 点赞/评论/发布/删除后自增，首页据此重拉统计 */
    statsRevision: 0,
    /* 评分变化后自增，首页据此重拉随笔列表 */
    postsRevision: 0,
    /* 增删随笔后自增，首页据此重拉活跃度热力图 */
    heatmapRevision: 0,
    /* 站长头像更换后自增，首页据此重拉站长当前头像 */
    avatarRevision: 0,
    /* 沉浸写作全屏层打开中：App.vue 据此临时收起看板娘，避免遮挡写作区 */
    immersiveWriting: false,
    /* 清爽模式（Light / Zen）：纯白浅灰底，关闭毛玻璃与背景视频 */
    isLightMode: readLightMode(),
    confirmMessage: "您确定要执行此操作吗？",
    toasts: [],
  }),

  actions: {
    startPostEdit(post) {
      this.postEditDraft = post;
    },

    consumePostEditDraft() {
      const draft = this.postEditDraft;
      this.postEditDraft = null;
      return draft;
    },

    startResourceEdit(resource) {
      this.resourceEditDraft = resource;
    },

    consumeResourceEditDraft() {
      const draft = this.resourceEditDraft;
      this.resourceEditDraft = null;
      return draft;
    },

    openConfirm(message, action) {
      this.confirmMessage = message;
      pendingConfirmAction = action;
      this.openDialog("confirm");
    },

    closeConfirm() {
      this.closeDialog("confirm");
      pendingConfirmAction = null;
    },

    runConfirm() {
      const action = pendingConfirmAction;
      this.closeConfirm();
      if (action) action();
    },

    refreshStats() {
      this.statsRevision++
    },

    refreshPosts() {
      this.postsRevision++
    },

    refreshHeatmap() {
      this.heatmapRevision++
    },

    refreshAvatar() {
      this.avatarRevision++
    },

    setImmersiveWriting(on) {
      this.immersiveWriting = !!on;
    },

    setLightMode(on, originEl = null) {
      const next = !!on;
      /* 上一段动画没播完也能再点：applyLightMode 会接管它 */
      if (next === this.isLightMode) return;
      this.isLightMode = next;
      applyLightMode(next, true, originEl);
    },

    toggleLightMode(originEl = null) {
      this.setLightMode(!this.isLightMode, originEl);
    },

    openDialog(name) {
      this.dialogs[name] = true;
      this.syncScrollLock();
    },

    closeDialog(name) {
      this.dialogs[name] = false;
      this.syncScrollLock();
    },

    syncScrollLock() {
      document.body.classList.toggle("art-scroll-lock", Object.values(this.dialogs).some(Boolean));
    },

    showToast(msg, isSuccess = true) {
      const id = ++toastSeq;
      this.toasts.push({ id, msg, isSuccess });
      if (this.toasts.length > MAX_TOASTS) this.toasts.splice(0, this.toasts.length - MAX_TOASTS);
      setTimeout(() => this.dismissToast(id), 3000);
    },

    dismissToast(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});
