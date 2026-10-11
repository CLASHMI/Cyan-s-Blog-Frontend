/* 正文首行非空文本：没有标题时用它兜底展示 */
export function firstLine(text) {
  if (!text) return ''
  const line = String(text)
    .split('\n')
    .find((item) => item.trim())
  return (line || '').trim().slice(0, 30)
}
