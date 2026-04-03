import { useAuth } from '~/composables/useAuth'

export default defineNuxtPlugin(() => {
  const { state, restoreFromCache, initFromMessage, refresh, initStandalone } = useAuth()
  const isInIframe = window.self !== window.top

  const DEFAULT_STUDIO_ORIGIN = 'https://studio.lsaigc.com'
  const envOrigins = (useRuntimeConfig().public.studioOrigin || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean)

  const inferredOrigin = (() => {
    if (!isInIframe || !document.referrer) return ''
    try { return new URL(document.referrer).origin } catch { return '' }
  })()

  const allowedOrigins = [...new Set([...envOrigins, inferredOrigin].filter(Boolean))]
  const isDev = import.meta.dev
  let targetOrigin = inferredOrigin || envOrigins[0] || DEFAULT_STUDIO_ORIGIN

  const isAllowed = (origin: string) => {
    if (allowedOrigins.length === 0) return origin === DEFAULT_STUDIO_ORIGIN
    return allowedOrigins.includes(origin)
  }

  if (isInIframe) {
    document.documentElement.classList.add('iframe-mode')
    restoreFromCache()

    window.addEventListener('message', (event) => {
      const msgType = event.data?.type

      if (!isAllowed(event.origin)) {
        if (isDev && (msgType === 'STUDIO_AUTH' || msgType === 'STUDIO_AUTH_REFRESH')) {
          allowedOrigins.push(event.origin)
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
        } else if (theme === 'light') {
          document.documentElement.classList.remove('dark')
        }
      }
    })

    const router = useRouter()
    router.isReady().then(() => {
      window.parent.postMessage({ type: 'DRAMA_READY' }, targetOrigin)
    })

    router.afterEach((to) => {
      window.parent.postMessage({ type: 'DRAMA_ROUTE', path: to.fullPath }, targetOrigin)
    })

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
