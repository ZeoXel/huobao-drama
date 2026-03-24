import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './assets/styles/element/index.scss'

import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import i18n from './locales'
import './assets/styles/main.css'
import { useAuthStore } from '@/stores/auth'

// Apply theme before app mounts to prevent flash
// 在应用挂载前应用主题，防止闪烁
const savedTheme = localStorage.getItem('theme')
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark')
}

const app = createApp(App)
const pinia = createPinia()
const authStore = useAuthStore(pinia)
const STUDIO_ORIGIN = import.meta.env.VITE_STUDIO_ORIGIN || 'https://studio.lsaigc.com'
const isInIframe = window.self !== window.top

if (isInIframe) {
  document.documentElement.classList.add('iframe-mode')
  document.body.classList.add('iframe-mode')

  // Register listener before sending DRAMA_READY to avoid race conditions.
  window.addEventListener('message', (event) => {
    if (event.origin !== STUDIO_ORIGIN) {
      return
    }

    if (event.data?.type === 'STUDIO_AUTH') {
      authStore.initFromMessage(event.data)
      return
    }

    if (event.data?.type === 'STUDIO_AUTH_REFRESH' && authStore.ready) {
      authStore.refresh(event.data)
    }
  })
} else {
  authStore.initStandalone()
}

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(ElementPlus)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')

if (isInIframe) {
  const syncIframeHeight = () => {
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight
    )
    window.parent.postMessage({ type: 'DRAMA_RESIZE', height }, STUDIO_ORIGIN)
  }

  router.isReady().then(() => {
    window.parent.postMessage({ type: 'DRAMA_READY' }, STUDIO_ORIGIN)
    syncIframeHeight()
  })

  const rootEl = document.getElementById('app')
  if (rootEl && 'ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      syncIframeHeight()
    })
    observer.observe(rootEl)
  }

  window.addEventListener('resize', syncIframeHeight)

  window.setTimeout(() => {
    if (!authStore.ready) {
      console.error('[Auth] Studio auth timeout after 5s')
    }
  }, 5000)
}
