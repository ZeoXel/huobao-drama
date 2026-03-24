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
      const storedID = localStorage.getItem('standalone_user_id')
      const userID = storedID || crypto.randomUUID()
      if (!storedID) {
        localStorage.setItem('standalone_user_id', userID)
      }

      this.userId = userID
      this.token = null
      this.apiKey = null
      this.standaloneMode = true
      this.ready = true
    }
  }
})
