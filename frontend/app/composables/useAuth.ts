interface StudioAuthPayload {
  token: string
  apiKey: string
  userId: string
}

const CACHE_KEY = 'drama_auth_cache'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

function persistToSession(payload: StudioAuthPayload) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, ts: Date.now() }))
  } catch { /* quota exceeded or private mode */ }
}

function loadFromSession(): StudioAuthPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (Date.now() - cached.ts > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    if (cached.token && cached.userId) return cached
  } catch {}
  return null
}

const state = reactive({
  token: null as string | null,
  apiKey: null as string | null,
  userId: null as string | null,
  ready: false,
  standaloneMode: false,
})

export function useAuth() {
  function restoreFromCache(): boolean {
    const cached = loadFromSession()
    if (!cached) return false
    state.token = cached.token
    state.apiKey = cached.apiKey
    state.userId = cached.userId
    state.ready = true
    state.standaloneMode = false
    return true
  }

  function initFromMessage(payload: StudioAuthPayload) {
    state.token = payload.token
    state.apiKey = payload.apiKey
    state.userId = payload.userId
    state.ready = true
    state.standaloneMode = false
    persistToSession(payload)
  }

  function refresh(payload: StudioAuthPayload) {
    state.token = payload.token
    state.apiKey = payload.apiKey
    state.userId = payload.userId
    state.ready = true
    persistToSession(payload)
  }

  function initStandalone() {
    state.userId = 'standalone'
    state.token = null
    state.apiKey = null
    state.standaloneMode = true
    state.ready = true
  }

  return {
    state: readonly(state),
    restoreFromCache,
    initFromMessage,
    refresh,
    initStandalone,
  }
}
