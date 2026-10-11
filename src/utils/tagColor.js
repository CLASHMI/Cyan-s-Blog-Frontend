/* 标签颜色：按名称散列出一个稳定色相，和分类的灰底标签区分开 */
export function tagHue(name) {
  const text = String(name || '')
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash % 360
}
