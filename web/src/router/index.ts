import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'DramaList',
    component: () => import('../views/drama/DramaList.vue')
  },
  {
    path: '/dramas/create',
    name: 'DramaCreate',
    component: () => import('../views/drama/DramaCreate.vue')
  },
  {
    path: '/dramas/:id',
    name: 'DramaManagement',
    component: () => import('../views/drama/DramaManagement.vue')
  },
  {
    path: '/dramas/:id/episode/:episodeNumber',
    name: 'EpisodeWorkflowNew',
    component: () => import('../views/drama/EpisodeWorkflow.vue')
  },
  {
    path: '/dramas/:id/characters',
    name: 'CharacterExtraction',
    component: () => import('../views/workflow/CharacterExtraction.vue')
  },
  {
    path: '/dramas/:id/images/characters',
    name: 'CharacterImages',
    component: () => import('../views/workflow/CharacterImages.vue')
  },
  {
    path: '/dramas/:id/settings',
    name: 'DramaSettings',
    component: () => import('../views/workflow/DramaSettings.vue')
  },
  {
    path: '/episodes/:id/edit',
    name: 'ScriptEdit',
    component: () => import('../views/script/ScriptEdit.vue')
  },
  {
    path: '/episodes/:id/storyboard',
    name: 'StoryboardEdit',
    component: () => import('../views/storyboard/StoryboardEdit.vue')
  },
  {
    path: '/episodes/:id/generate',
    name: 'Generation',
    component: () => import('../views/generation/ImageGeneration.vue')
  },
  {
    path: '/timeline/:id',
    name: 'TimelineEditor',
    component: () => import('../views/editor/TimelineEditor.vue')
  },
  {
    path: '/dramas/:dramaId/episode/:episodeNumber/professional',
    name: 'ProfessionalEditor',
    component: () => import('../views/drama/ProfessionalEditor.vue')
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

// --- Navigation progress bar ---
let progressBar: HTMLDivElement | null = null

function showProgress() {
  if (!progressBar) {
    progressBar = document.createElement('div')
    progressBar.id = 'nav-progress'
    progressBar.style.cssText =
      'position:fixed;top:0;left:0;height:2px;background:var(--accent,#2563eb);z-index:9999;' +
      'transition:width 0.4s ease;width:0;pointer-events:none;'
    document.body.appendChild(progressBar)
  }
  progressBar.style.width = '0'
  progressBar.style.opacity = '1'
  // Force reflow then animate
  void progressBar.offsetWidth
  progressBar.style.width = '70%'
}

function hideProgress() {
  if (!progressBar) return
  progressBar.style.width = '100%'
  window.setTimeout(() => {
    if (progressBar) {
      progressBar.style.opacity = '0'
    }
  }, 200)
}

// --- Auth guard ---
let hasWaitedForAuthReady = false

router.beforeEach(async () => {
  showProgress()

  const auth = useAuthStore()
  if (auth.ready || hasWaitedForAuthReady) {
    return true
  }
  hasWaitedForAuthReady = true

  await new Promise<void>((resolve) => {
    const stop = watch(
      () => auth.ready,
      (ready) => {
        if (ready) {
          stop()
          resolve()
        }
      }
    )

    window.setTimeout(() => {
      stop()
      resolve()
    }, 3000)
  })

  return true
})

router.afterEach(() => {
  hideProgress()
})

export default router
