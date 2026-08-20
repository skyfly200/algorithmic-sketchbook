import { createRouter, createWebHashHistory } from 'vue-router'
import GalleryView from '../views/GalleryView.vue'

// The gallery is the landing page, so it's bundled into the main chunk. Every
// other view is loaded on demand — the heavy compositors (Patch, Autopilot,
// Mixer, Present) each pull in three.js and thousands of lines of editor logic,
// so keeping them out of the initial bundle makes the gallery paint far sooner.
// Hash history keeps deep links working on static hosts (GitHub Pages etc.)
// without any server-side rewrite rules.
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryView },
    { path: '/sketch/:slug', name: 'sketch', component: () => import('../views/SketchView.vue'), props: true },
    { path: '/present', name: 'present', component: () => import('../views/PresentView.vue') },
    { path: '/present/:slug', name: 'present-slug', component: () => import('../views/PresentView.vue') },
    { path: '/mix', name: 'mixer', component: () => import('../views/MixerView.vue') },
    { path: '/patch', name: 'patch', component: () => import('../views/PatchView.vue') },
    { path: '/docs/:page?', name: 'docs', component: () => import('../views/DocsView.vue'), props: true },
    { path: '/auto', name: 'autopilot', component: () => import('../views/AutopilotView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
  ],
})
