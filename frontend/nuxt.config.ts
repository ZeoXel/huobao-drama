export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false,
  },
  app: {
    head: {
      title: '火宝短剧',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'shortcut icon', type: 'image/png', href: '/favicon.png' },
      ],
      script: [
        {
          innerHTML: `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}if(window.self!==window.top){document.documentElement.classList.add('iframe-mode');document.body&&document.body.classList.add('iframe-mode')}})()`,
          type: 'text/javascript',
        },
      ],
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': { target: 'http://localhost:5678', changeOrigin: true },
        '/static': { target: 'http://localhost:5678', changeOrigin: true },
      },
    },
  },
  runtimeConfig: {
    public: {
      studioOrigin: process.env.NUXT_PUBLIC_STUDIO_ORIGIN || '',
    },
  },
  compatibilityDate: '2025-05-15',
})
