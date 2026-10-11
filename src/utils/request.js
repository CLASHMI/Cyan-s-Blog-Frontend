import { useUiStore } from "@/stores/useUiStore";

export const apiBase =
  window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1")
    ? "http://localhost:8080/api"
    : "/api";

const TOKEN_KEY = "anim_token";
const USER_KEY = "anim_user";

let unauthorizedHandler = null;

/* auth store 注入 401 后的恢复逻辑，这里不反向依赖 store */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export async function request(endpoint, options = {}) {
  /* silent：可选增强类请求（如 AI 摘要）失败时不弹全局提示，交给调用方自行兜底 */
  const { silent, ...rest } = options;
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (rest.body instanceof FormData) delete headers["Content-Type"];
  try {
    const res = await fetch(`${apiBase}${endpoint}`, { ...rest, headers });
    const data = await res.json();
    if (res.status === 401 || data.code === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (unauthorizedHandler) await unauthorizedHandler();
      throw new Error("会话已过期，已恢复为游客身份。");
    }
    /* 限流：后端可能返回 HTTP 429，也可能返回 HTTP 200 + 业务码 429（ServiceException 统一走 200 响应） */
    if (res.status === 429 || data.code === 429) {
      const error = new Error(data.message || "操作过于频繁，请稍后再试");
      error.code = 429;
      throw error;
    }
    if (data.code !== 200 && data.code !== undefined) throw new Error(data.message || "Error");
    return data.data || data;
  } catch (err) {
    let msg = err.message;
    if (msg === "Failed to fetch") msg = "网络错误或文件体积过大。";
    if (!silent && msg !== "会话已过期，已恢复为游客身份。") useUiStore().showToast(msg, false);
    throw err;
  }
}
