import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'

import App from './App.vue'
import router from './router'

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

// Register the offline service worker (built only in production). Scope is the
// deployment root so it covers the gallery, viewer and every iframed sketch.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || './'
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => {})
  })
}
