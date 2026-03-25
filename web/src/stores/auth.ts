import { defineStore } from 'pinia'

interface StudioAuthPayload {
  token: string
  apiKey: string
  userId: string
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
    initFromMessage(payload: StudioAuthPayload) {
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId
      this.ready = true
      this.standaloneMode = false
    },
    refresh(payload: StudioAuthPayload) {
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId
      this.ready = true
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
