# Cyan's Animation Log

个人动画作品展厅 / 随笔站，Vue 3 + Vite 单页应用，后端接口独立部署。

## 开发

```sh
npm install
npm run dev      # 开发服务器，接口默认指向 http://localhost:8080/api
npm run build    # 产物输出到 dist/
npm run preview  # 本地预览生产产物
```

## 上线要求

- **单页回退**：路由使用 HTML5 History 模式，服务器需把未匹配的路径（如 `/post/42`）回退到 `index.html`。
- **接口反向代理**：非 localhost 环境下前端请求 `/api`（见 `src/utils/request.js`），需把 `/api` 代理到后端服务。
- **静态资源与会话**：作品图/视频托管在自己的 COS（`media.cyanspace.work`），游客身份与主题偏好存在浏览器 `localStorage`。
- **外部 CDN 依赖**：图标（`unpkg.com` + `cdn.jsdelivr.net`）、网页字体（`cdn.jsdelivr.net` 的 fontsource）、Live2D 模型（`cdn.jsdelivr.net`）。任一不可达时会自动降级：图标隐藏、字体回落到系统字体、模型换成静态头像，页面功能不受影响；若要规避网络波动，可将这些资源自托管。
