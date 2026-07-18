import { createRouter, createWebHashHistory } from 'vue-router'
import GalleryView from '../views/GalleryView.vue'
import SketchView from '../views/SketchView.vue'
import PresentView from '../views/PresentView.vue'
import MixerView from '../views/MixerView.vue'
import PatchView from '../views/PatchView.vue'
import DocsView from '../views/DocsView.vue'
import AutopilotView from '../views/AutopilotView.vue'

// Hash history keeps deep links working on static hosts (GitHub Pages etc.)
// without any server-side rewrite rules.
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryView },
    { path: '/sketch/:slug', name: 'sketch', component: SketchView, props: true },
    { path: '/present', name: 'present', component: PresentView },
    { path: '/present/:slug', name: 'present-slug', component: PresentView },
    { path: '/mix', name: 'mixer', component: MixerView },
    { path: '/patch', name: 'patch', component: PatchView },
    { path: '/docs', name: 'docs', component: DocsView },
    { path: '/auto', name: 'autopilot', component: AutopilotView },
  ],
})
