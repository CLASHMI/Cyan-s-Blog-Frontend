/* 媒体 404 兜底：内联 base64 SVG（深灰底 + 破损相片图标），无额外请求 */

export const MEDIA_FALLBACK_SRC =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMjAgMjAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBzbGljZSI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMTYxZDIyIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMGEwZjEzIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyMDAiIGZpbGw9InVybCgjZykiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNjAgMTAwKSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOWZiM2MwIiBzdHJva2Utb3BhY2l0eT0iMC40MiIgc3Ryb2tlLXdpZHRoPSIyLjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iLTI3IiB5PSItMjEiIHdpZHRoPSI1NCIgaGVpZ2h0PSI0MiIgcng9IjYiLz48Y2lyY2xlIGN4PSItMTMiIGN5PSItOSIgcj0iMy42Ii8+PHBhdGggZD0iTS0yNyAxNWwxNC0xNCA5IDkgOC04IDIzIDIwIi8+PHBhdGggZD0iTTMgLTIxbC04IDEyIDkgNi0xMSAxNSIgc3Ryb2tlPSIjN2RkM2ZjIiBzdHJva2Utb3BhY2l0eT0iMC41Ii8+PC9nPjwvc3ZnPg=='

/* 每张图独立兜底，互不影响 */
export function handleMediaError(event) {
  const el = event && event.target
  if (!el) return
  /* video 不能用图片 src，兜底图挂到 poster */
  if (el.tagName === 'VIDEO') {
    if (el.poster === MEDIA_FALLBACK_SRC) return
    el.poster = MEDIA_FALLBACK_SRC
    return
  }
  if (el.src === MEDIA_FALLBACK_SRC) return
  el.src = MEDIA_FALLBACK_SRC
}
