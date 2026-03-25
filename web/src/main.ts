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
const isInIframe = window.self !== window.top
const DEFAULT_STUDIO_ORIGIN = 'https://studio.lsaigc.com'

const envStudioOrigins = (import.meta.env.VITE_STUDIO_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const inferredStudioOrigin = (() => {
  if (!isInIframe || !document.referrer) return ''
  try {
    return new URL(document.referrer).origin
  } catch {
    return ''
  }
})()

const allowedStudioOrigins = Array.from(new Set([
  ...envStudioOrigins,
  inferredStudioOrigin
].filter(Boolean)))

const canAutoDetectStudioOrigin = import.meta.env.DEV && allowedStudioOrigins.length === 0
let studioTargetOrigin = inferredStudioOrigin || envStudioOrigins[0] || DEFAULT_STUDIO_ORIGIN

const isAllowedStudioOrigin = (origin: string) => {
  if (allowedStudioOrigins.length === 0) {
    return origin === DEFAULT_STUDIO_ORIGIN
  }
  return allowedStudioOrigins.includes(origin)
}

if (isInIframe) {
  document.documentElement.classList.add('iframe-mode')
  document.body.classList.add('iframe-mode')

  // Register listener before sending DRAMA_READY to avoid race conditions.
  window.addEventListener('message', (event) => {
    const msgType = event.data?.type
    const isAuthMessage = msgType === 'STUDIO_AUTH' || msgType === 'STUDIO_AUTH_REFRESH'

    if (!isAllowedStudioOrigin(event.origin)) {
      if (canAutoDetectStudioOrigin && isAuthMessage) {
        allowedStudioOrigins.push(event.origin)
        studioTargetOrigin = event.origin
      } else {
        return
      }
    }

    if (event.data?.type === 'STUDIO_AUTH') {
      authStore.initFromMessage(event.data)
      return
    }

    if (event.data?.type === 'STUDIO_AUTH_REFRESH' && authStore.ready) {
      authStore.refresh(event.data)
      return
    }

    // Theme sync: studio parent tells us which theme to use
    if (event.data?.type === 'STUDIO_THEME') {
      const nextTheme = event.data?.theme as string
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark')
        localStorage.setItem('theme', 'dark')
      } else if (nextTheme === 'light') {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('theme', 'light')
      }
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
    window.parent.postMessage({ type: 'DRAMA_RESIZE', height }, studioTargetOrigin)
  }

  router.isReady().then(() => {
    window.parent.postMessage({ type: 'DRAMA_READY' }, studioTargetOrigin)
    syncIframeHeight()
  })

  // Sync route changes to studio so it can restore the path on refresh
  router.afterEach((to) => {
    window.parent.postMessage(
      { type: 'DRAMA_ROUTE', path: to.fullPath },
      studioTargetOrigin
    )
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
      console.warn('[Auth] Studio auth timeout after 5s, falling back to standalone mode')
      authStore.initStandalone()
    }
  }, 5000)
}
