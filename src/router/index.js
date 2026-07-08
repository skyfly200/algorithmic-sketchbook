import { createRouter, createWebHashHistory } from 'vue-router'
import GalleryView from '../views/GalleryView.vue'
import SketchView from '../views/SketchView.vue'

// Hash history keeps deep links working on static hosts (GitHub Pages etc.)
// without any server-side rewrite rules.
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryView },
    { path: '/sketch/:slug', name: 'sketch', component: SketchView, props: true },
  ],
})
