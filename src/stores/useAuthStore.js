import { defineStore } from "pinia";

import { request, setUnauthorizedHandler } from "@/utils/request";
import { SystemConstant } from "@/utils/constants";

const { Role } = SystemConstant;

export function generateSvgAvatar(name, role) {
  /* 默认头像极简成纯色圆：不带字母，只靠底色区分；站长固定站点青色，一眼可辨 */
  /* 冷暖均衡、明度接近的一组耐看配色，深浅色主题下都不刺眼 */
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e"];
  const bg = role === Role.ADMIN ? "#00ffff" : colors[avatarColorIndex(name) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${bg}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* 用整串昵称散列出稳定底色：只看首字的话，"访客_xxxx" 这类自动昵称会全撞成同一种颜色 */
function avatarColorIndex(name) {
  const value = String(name || "U");
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/* 复用同一个初始化 Promise：视图挂载时等它落定，首个业务请求才会带上 Token */
let bootAuthPromise = null;

/* 最近一次已知头像：登出后要重新拿访客会话，中间态先沿用这张，
   否则会按空昵称散列出一个临时纯色头像，闪一下再跳到最终颜色 */
let lastKnownAvatar = "";

function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem("anim_user") || "null");
  } catch (e) {
    return null;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => {
    const token = localStorage.getItem("anim_token");
    const cachedUser = readCachedUser();
    const user = token && cachedUser ? cachedUser : null;
    return {
      token,
      user,
      isGlobalAdmin: user?.role === Role.ADMIN,
    };
  },

  getters: {
    nickname: (state) => state.user?.nickname || "",
    roleLabel: (state) => (state.isGlobalAdmin ? "Admin" : "游客"),
    /* user 已清空、新会话未到时沿用上一张头像，避免闪出与最终访客不一致的颜色 */
    avatar: (state) =>
      state.user
        ? state.user.avatar || generateSvgAvatar(state.user.nickname, state.user.role)
        : lastKnownAvatar || generateSvgAvatar(undefined, undefined),
    fallbackAvatar: (state) => generateSvgAvatar(state.user?.nickname, state.user?.role),
  },

  actions: {
    saveSession(token, userInfo) {
      this.token = token;
      this.user = userInfo;
      localStorage.setItem("anim_token", token);
      localStorage.setItem("anim_user", JSON.stringify(userInfo));
      if (userInfo.uuid) localStorage.setItem("anim_uuid", userInfo.uuid);
      this.checkIdentity();
    },

    checkIdentity() {
      this.isGlobalAdmin = this.user?.role === Role.ADMIN;
    },

    ensureAuth() {
      if (!bootAuthPromise) bootAuthPromise = this.initAuth();
      return bootAuthPromise;
    },

    clearSession() {
      /* 先留存当前头像，交给身份切换的中间态显示 */
      if (this.user) lastKnownAvatar = this.user.avatar || generateSvgAvatar(this.user.nickname, this.user.role);
      this.token = null;
      this.user = null;
      this.checkIdentity();
    },

    /* 彻底回到无权限的访客白板：清本地缓存、清 token / 账号 / 管理员标记，
       并丢弃上一张头像（否则登出后界面会继续沿用站长的青色头像） */
    resetToGuest() {
      localStorage.removeItem("anim_token");
      localStorage.removeItem("anim_user");
      localStorage.removeItem("anim_uuid");
      lastKnownAvatar = "";
      this.token = null;
      this.user = null;
      this.checkIdentity();
    },

    async initAuth(options = {}) {
      const silent = !!options.silent;
      setUnauthorizedHandler(async () => {
        this.clearSession();
        await this.initAuth();
      });
      try {
        const cachedUser = localStorage.getItem("anim_user");
        if (this.token && cachedUser) {
          this.user = JSON.parse(cachedUser);
          this.checkIdentity();
          return;
        }
        const uuid = localStorage.getItem("anim_uuid");
        const url = uuid ? `/user/init?uuid=${uuid}` : "/user/init";
        const data = await request(url, { method: "POST", silent });
        this.saveSession(data.token, data.userInfo);
      } catch (e) {
        /* 发号被限流说明该 IP 当日额度已满：保持访客白板即可，不弹错、不中断流程 */
        console.warn("[auth] 获取游客身份失败，保持访客状态：", e && e.message);
      }
    },

    async updateNickname(name) {
      await request(`/user/updateNickname?nickname=${encodeURIComponent(name)}`, { method: "PUT" });
      this.user.nickname = name;
      localStorage.setItem("anim_user", JSON.stringify(this.user));
      this.checkIdentity();
    },

    /* 仅站长可调用：上传新头像并在本地会话里即时生效 */
    async uploadAvatar(file) {
      const formData = new FormData();
      formData.append("file", file);
      const avatarUrl = await request("/user/uploadAvatar", { method: "POST", body: formData });
      this.user = { ...this.user, avatar: avatarUrl };
      localStorage.setItem("anim_user", JSON.stringify(this.user));
      return avatarUrl;
    },

    async loginAdmin(password) {
      const data = await request("/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      this.saveSession(data.token, data.userInfo);
    },

    /* 退出登录：先本地彻底重置为访客白板（不依赖网络），再尝试领取新的游客身份。
       即便 /user/init 被 429 拦截，重置也已经完成，绝不会卡在管理员中间态。 */
    async logout() {
      this.resetToGuest();
      /* 覆盖登出前的初始化 Promise：后续 ensureAuth() 复用本次结果，
         不会因视图重新挂载再打一遍 /user/init 而在限流时反复弹错 */
      bootAuthPromise = this.initAuth({ silent: true });
      try {
        await bootAuthPromise;
      } catch (e) {
        console.warn("[auth] 登出后未取得新游客身份，保持访客白板：", e && e.message);
      }
    },
  },
});
