/* Markdown 图片拉不到时预览区会整块留白：捕获失败给图片打标记，样式里出占位提示 */
const BROKEN_CLASS = "is-img-broken";

function isPreviewImage(target) {
  return !!target && target.tagName === "IMG" && !!target.closest(".md-editor-preview");
}

export function installMdImageFallback() {
  /* 图片的 error / load 不冒泡，只能挂在捕获阶段 */
  document.addEventListener(
    "error",
    (e) => {
      if (isPreviewImage(e.target)) e.target.classList.add(BROKEN_CLASS);
    },
    true,
  );

  document.addEventListener(
    "load",
    (e) => {
      /* 地址被改成能用的图之后要把标记摘掉，否则会留个虚线框 */
      if (isPreviewImage(e.target)) e.target.classList.remove(BROKEN_CLASS);
    },
    true,
  );
}
