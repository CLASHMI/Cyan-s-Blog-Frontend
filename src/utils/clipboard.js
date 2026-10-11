/** Clipboard API with a fallback for non-secure deployments. */
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch { /* Permission denied: try the existing document-copy fallback. */ }
  }
  const previousFocus = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;top:-1000px;opacity:0'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    if (!document.execCommand('copy')) throw new Error('Copy failed')
  } finally {
    textarea.remove()
    previousFocus?.focus({ preventScroll: true })
  }
}
