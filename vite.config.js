import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    /* meting-js 是运行时由 CDN 脚本注册的原生自定义元素：
       告诉编译器别当 Vue 组件解析，避免 "Failed to resolve component" 告警 */
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'meting-js',
        },
      },
    }),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
