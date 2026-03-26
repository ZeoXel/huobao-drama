import { defineStore } from 'pinia'

interface StudioAuthPayload {
  token: string
  apiKey: string
  userId: string
}

const CACHE_KEY = 'drama_auth_cache'

function persistToSession(payload: { token: string | null; apiKey: string | null; userId: string | null }) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      token: payload.token,
      apiKey: payload.apiKey,
      userId: payload.userId,
      ts: Date.now(),
    }))
  } catch { /* quota exceeded or private mode */ }
}

function loadFromSession(): StudioAuthPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    // Expire after 30 min to avoid stale tokens
    if (Date.now() - cached.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    if (cached.token && cached.userId) return cached
  } catch { /* parse error */ }
  return null
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    apiKey: null as string | null,
    userId: null as string | null,
    ready: false,
    standaloneMode: false
  }),
  actions: {
    /** Restore from sessionStorage if available (instant, no postMessage needed) */
    restoreFromCache(): boolean {
      const cached = loadFromSession()
      if (!cached) return false
      this.token = cached.token
      this.apiKey = cached.apiKey
      this.userId = cached.userId
      this.ready = true
      this.standaloneMode = false
      return true
    },
    initFromMessage(payload: StudioAuthPayload) {
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId
      this.ready = true
      this.standaloneMode = false
      persistToSession(payload)
    },
    refresh(payload: StudioAuthPayload) {
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId
      this.ready = true
      persistToSession(payload)
    },
    initStandalone() {
      // Use fixed "standalone" to match the database backfill default value.
      // All pre-existing data has user_id = 'standalone', so we must use the
      // same value to ensure queries like WHERE user_id = ? can find them.
      this.userId = 'standalone'
      this.token = null
      this.apiKey = null
      this.standaloneMode = true
      this.ready = true
    }
  }
})
