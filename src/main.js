import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { applyLightMode, useUiStore } from './stores/useUiStore'
import { installMdImageFallback } from './utils/mdImageFallback'
import './assets/style.css'
import './assets/home-fx.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

/* 首屏渲染前先套上本地主题偏好，避免闪一下深色 */
applyLightMode(useUiStore(pinia).isLightMode)

/* Markdown 图片加载失败时给个可见的占位 */
installMdImageFallback()

app.mount('#app')
