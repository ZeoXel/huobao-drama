<template>
  <div v-if="!authReady" class="app-loading">
    <div class="app-loading-spinner" />
    <p class="app-loading-text">正在初始化...</p>
  </div>
  <router-view v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const authReady = computed(() => auth.ready)
</script>

<style>
#app {
  width: 100%;
  height: 100%;
}

.app-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 1rem;
  background: var(--bg-primary);
}

.app-loading-spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--border-primary, #e2e8f0);
  border-top-color: var(--accent, #2563eb);
  border-radius: 50%;
  animation: app-spin 0.8s linear infinite;
}

.app-loading-text {
  font-size: 0.875rem;
  color: var(--text-muted, #94a3b8);
}

@keyframes app-spin {
  to { transform: rotate(360deg); }
}
</style>
