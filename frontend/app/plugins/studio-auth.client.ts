import { useAuth } from '~/composables/useAuth'

// Module-level state — survives HMR and plugin re-execution
const DEFAULT_STUDIO_ORIGIN = 'https://studio.lsaigc.com'
const allowedOrigins: string[] = []
let targetOrigin = DEFAULT_STUDIO_ORIGIN
let listenerInstalled = false

function isAllowed(origin: string): boolean {
  if (allowedOrigins.length === 0) return origin === DEFAULT_STUDIO_ORIGIN
  return allowedOrigins.includes(origin)
}

export default defineNuxtPlugin(() => {
  const { state, restoreFromCache, initFromMessage, refresh, initStandalone } = useAuth()
  const isInIframe = window.self !== window.top

  const envOrigins = (useRuntimeConfig().public.studioOrigin || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean)

  const inferredOrigin = (() => {
    if (!isInIframe || !document.referrer) return ''
    try { return new URL(document.referrer).origin } catch { return '' }
  })()

  // Merge origins (deduplicated, module-level persists across HMR)
  for (const o of [...envOrigins, inferredOrigin].filter(Boolean)) {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o)
  }
  targetOrigin = inferredOrigin || envOrigins[0] || DEFAULT_STUDIO_ORIGIN

  if (isInIframe) {
    document.documentElement.classList.add('iframe-mode')
    document.body.classList.add('iframe-mode')
    restoreFromCache()

    // Install listener only once (survives HMR)
    if (!listenerInstalled) {
      listenerInstalled = true
      window.addEventListener('message', (event) => {
        const msgType = event.data?.type

        if (!isAllowed(event.origin)) {
          // In dev, auto-trust any Studio-like message
          const isStudioMessage = msgType === 'STUDIO_AUTH' || msgType === 'STUDIO_AUTH_REFRESH' || msgType === 'STUDIO_THEME'
          if (import.meta.dev && isStudioMessage) {
            if (!allowedOrigins.includes(event.origin)) allowedOrigins.push(event.origin)
            targetOrigin = event.origin
          } else {
            return
          }
        }

        if (msgType === 'STUDIO_AUTH') {
          initFromMessage(event.data)
        } else if (msgType === 'STUDIO_AUTH_REFRESH' && state.ready) {
          refresh(event.data)
        } else if (msgType === 'STUDIO_THEME') {
          const theme = event.data?.theme as string
          if (theme === 'dark') {
            document.documentElement.classList.add('dark')
            localStorage.setItem('theme', 'dark')
          } else if (theme === 'light') {
            document.documentElement.classList.remove('dark')
            localStorage.setItem('theme', 'light')
          }
        }
      })
    }

    // Height sync — notify Studio parent when content height changes
    const syncIframeHeight = () => {
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
      )
      window.parent.postMessage({ type: 'DRAMA_RESIZE', height }, targetOrigin)
    }

    const router = useRouter()
    router.isReady().then(() => {
      window.parent.postMessage({ type: 'DRAMA_READY' }, targetOrigin)
      syncIframeHeight()
    })

    router.afterEach((to) => {
      window.parent.postMessage({ type: 'DRAMA_ROUTE', path: to.fullPath }, targetOrigin)
    })

    // Observe root element resize for dynamic height sync
    const rootEl = document.getElementById('__nuxt')
    if (rootEl && 'ResizeObserver' in window) {
      new ResizeObserver(() => syncIframeHeight()).observe(rootEl)
    }
    window.addEventListener('resize', syncIframeHeight)

    setTimeout(() => {
      if (!state.ready) {
        console.warn('[Auth] Studio auth timeout after 5s, falling back to standalone')
        initStandalone()
      }
    }, 5000)
  } else {
    initStandalone()
  }
})
