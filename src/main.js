import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'

import App from './App.vue'
import router from './router'
import { hydrateMediaLibrary } from './stores/media.js'

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
          background: '#0d1017',
          surface: '#161b26',
          primary: '#7c8cff',
          secondary: '#4dd0c4',
        },
      },
    },
  },
})

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')

// Restore any media the user imported in a previous session (blobs live in
// IndexedDB; this mints fresh object URLs for them).
hydrateMediaLibrary()

// Register the offline service worker (built only in production). Scope is the
// deployment root so it covers the gallery, viewer and every iframed sketch.
// updateViaCache:'none' forces the browser to revalidate sw.js from the network
// on every check, so a fixed worker is never held back by an HTTP-cached script.
// When a new worker installs it skipWaiting()s and claims clients; we reload once
// on that handover so a returning visitor immediately runs the current build (and
// a clean cache) instead of a stale shell — the self-heal for a bad cached state.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const base = import.meta.env.BASE_URL || './'
    // Only reload for an *update* (there was already a controller), never for the
    // first install — and only once, so we can't loop.
    const hadController = !!navigator.serviceWorker.controller
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return
      reloading = true
      window.location.reload()
    })
    try {
      const reg = await navigator.serviceWorker.register(base + 'sw.js', { scope: base, updateViaCache: 'none' })
      reg.update().catch(() => {}) // check for a newer worker right away
    } catch { /* SW unsupported or blocked — the app still runs online */ }
  })
}
