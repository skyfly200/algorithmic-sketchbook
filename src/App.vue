<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandLogo from './components/BrandLogo.vue'
import TourOverlay from './components/TourOverlay.vue'
import { useSettingsStore } from './stores/settings'
import { useSketchStore } from './stores/sketches'
import { FILTER_SLUG_SET } from './registry/filters'

const router = useRouter()
const settings = useSettingsStore()
const sketches = useSketchStore()
const tourActive = ref(false)

// The first-open walkthrough: points at the main tools and where they live.
const tourSteps = [
  {
    title: 'Welcome to Bright Waves',
    body: 'Live, interactive graphics you can play with, layer together and project onto a wall. Nothing to set up: the next few steps show where things are, and Skip works at any time.',
    cta: 'Show me around',
  },
  {
    target: '[data-tour="gallery"]',
    title: 'Start here: the experiments',
    body: 'Click any card to open it full-screen. Every sketch has sliders, can react to sound, and lets you save the look as a scene. Search and tags above narrow the grid.',
    pad: 8,
  },
  {
    target: '[data-tour="autopilot"]',
    title: 'Autopilot: fastest way to see something',
    body: 'Hands-free. It keeps blending effects into new looks on its own. Press it, sit back, and save anything you like.',
    fallback: 'Autopilot (in the menu, top right) is the fastest way to see something: it keeps blending effects into new looks on its own, hands-free.',
  },
  {
    target: '[data-tour="mixer"]',
    title: 'Mixer: stack a few looks',
    body: 'Layer several effects with blend modes and sound inputs. The easiest place to build your own look.',
    fallback: 'Mixer (in the menu) layers several effects with blend modes and sound inputs. The easiest place to build your own look.',
  },
  {
    target: '[data-tour="patch"]',
    title: 'Patch: the full studio',
    body: 'A node graph for serious work: filters, polygon masks for projection mapping (drag the corners onto a surface), and cue-based shows. Come back to it once the Mixer feels easy.',
    fallback: 'Patch (in the menu) is the full studio: a node graph with filters, polygon masks for projection mapping, and cue-based shows. Try it after the Mixer.',
  },
  {
    target: '[data-tour="present"]',
    title: 'Display mode: for the projector',
    body: 'A clean fullscreen output with no controls. Open it on the projector or second screen while you work elsewhere.',
    fallback: 'Display mode (in the menu) is a clean fullscreen output with no controls, for a projector or second screen.',
  },
  {
    target: '[data-tour="library"]',
    title: 'Library: your saved work',
    body: 'Saved patches, mixes and scenes live here, in this browser. Export a patch from Patch to keep a copy as a file.',
    fallback: 'Library (in the menu) holds your saved patches, mixes and scenes, stored in this browser. Export a patch from Patch to keep a file copy.',
  },
  {
    target: '[data-tour="help"]',
    title: 'You’re set',
    body: 'Replay this tour from the ? button any time; Patch, Mixer and Autopilot each have a short tour of their own. Settings can turn tutorials off. Handy keys:',
    fallback: 'Replay this tour from “Replay walkthrough” in the menu any time; Patch, Mixer and Autopilot each have a short tour of their own. Handy keys:',
    shortcuts: [
      { keys: 'Space', desc: 'Play / pause the current sketch' },
      { keys: 'F', desc: 'Toggle fullscreen' },
      { keys: 'D', desc: 'Cycle demo pictures in a sketch' },
      { keys: '←  →', desc: 'Autopilot: previous / next scene' },
      { keys: 'R', desc: 'Autopilot: reroll the whole show' },
      { keys: 'S', desc: 'Autopilot: save the current look as a patch' },
      { keys: 'M', desc: 'Autopilot: toggle the mic / audio reactivity' },
      { keys: 'Ctrl+Z', desc: 'Patch: undo (Shift to redo)' },
      { keys: 'Esc', desc: 'Close a tour / exit fullscreen' },
    ],
  },
]

function startTour() {
  if (router.currentRoute.value.name !== 'gallery') router.push({ name: 'gallery' })
  // let the gallery render before measuring targets
  setTimeout(() => (tourActive.value = true), 350)
}
function finishTour(payload) {
  settings.markSeen('app')
  if (payload?.disableAll) settings.setTutorials(false)
}

onMounted(() => {
  // Convert any legacy inclusion-list effect pool to the disabled-set model now
  // that the full effect list is known, so newly-added effects join by default.
  const effectSlugs = sketches.sketches
    .filter((s) => s.embed && !s.standalone && !FILTER_SLUG_SET.has(s.slug) && s.slug !== 'bright-waves-logo')
    .map((s) => s.slug)
  settings.ensureMigrated(effectSlugs)
  if (settings.shouldAutoTour('app')) startTour()

  // Warm the heavy chunks once the gallery is idle so the first navigation is
  // instant. Patch is prefetched eagerly (the user's main destination); the
  // single-sketch viewer is common too. Guarded by requestIdleCallback so it
  // never competes with the initial paint.
  const warm = () => {
    import('./views/SketchView.vue').catch(() => {})
    import('./views/PatchView.vue').catch(() => {})
  }
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 })
  else setTimeout(warm, 1500)
})
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" color="background">
      <v-app-bar-title>
        <router-link to="/" class="app-title">
          <BrandLogo :size="34" uid="bar" class="mr-3" />
          <span class="brand-name">Bright Waves</span>
        </router-link>
      </v-app-bar-title>

      <!-- full nav on tablet/desktop -->
      <div class="nav-full d-none d-md-flex align-center">
        <v-btn data-tour="autopilot" prepend-icon="mdi-airplane" variant="tonal" size="small" class="mr-2" title="Autopilot — a hands-free tour through the effects" :to="{ name: 'autopilot' }">Autopilot</v-btn>
        <v-btn data-tour="patch" prepend-icon="mdi-vector-polyline" variant="tonal" size="small" class="mr-2" title="Patch — wire effects into a live node graph" :to="{ name: 'patch' }">Patch</v-btn>
        <v-btn data-tour="mixer" prepend-icon="mdi-layers-triple-outline" variant="tonal" size="small" class="mr-2" title="Mixer — blend multiple effects into one composite" :to="{ name: 'mixer' }">Mixer</v-btn>
        <v-btn data-tour="present" prepend-icon="mdi-projector-screen-outline" variant="tonal" size="small" class="mr-2" title="Display mode — fullscreen projection view" :to="{ name: 'present' }">Display mode</v-btn>
        <v-btn prepend-icon="mdi-image-multiple-outline" variant="text" size="small" class="mr-2" title="Collections — public-domain imagery to build on" :to="{ name: 'collections' }">Collections</v-btn>
        <v-btn data-tour="library" prepend-icon="mdi-bookmark-multiple-outline" variant="text" size="small" class="mr-2" title="Library — your saved patches, mixes and scenes" :to="{ name: 'library' }">Library</v-btn>
        <v-btn icon="mdi-book-open-variant" variant="text" title="Docs — how the sketchbook works" :to="{ name: 'docs' }" />
        <v-btn data-tour="settings" icon="mdi-cog-outline" variant="text" title="Settings — tutorials, effect pool and more" :to="{ name: 'settings' }" />
        <v-btn data-tour="help" icon="mdi-help-circle-outline" variant="text" title="Replay the walkthrough" @click="startTour" />
        <v-btn icon="mdi-github" variant="text" title="View the source on GitHub" href="https://github.com/skyfly200/algorithmic-sketchbook" target="_blank" rel="noopener" />
      </div>

      <!-- collapsed nav on phones: everything in one menu -->
      <v-menu class="d-md-none">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-menu" variant="text" class="d-md-none" title="Menu" />
        </template>
        <v-list density="compact" min-width="200">
          <v-list-item prepend-icon="mdi-airplane" title="Autopilot" :to="{ name: 'autopilot' }" />
          <v-list-item prepend-icon="mdi-vector-polyline" title="Patch" :to="{ name: 'patch' }" />
          <v-list-item prepend-icon="mdi-layers-triple-outline" title="Mixer" :to="{ name: 'mixer' }" />
          <v-list-item prepend-icon="mdi-projector-screen-outline" title="Display mode" :to="{ name: 'present' }" />
          <v-list-item prepend-icon="mdi-image-multiple-outline" title="Collections" :to="{ name: 'collections' }" />
          <v-list-item prepend-icon="mdi-bookmark-multiple-outline" title="Library" :to="{ name: 'library' }" />
          <v-list-item prepend-icon="mdi-book-open-variant" title="Docs" :to="{ name: 'docs' }" />
          <v-list-item prepend-icon="mdi-cog-outline" title="Settings" :to="{ name: 'settings' }" />
          <v-list-item prepend-icon="mdi-help-circle-outline" title="Replay walkthrough" @click="startTour" />
          <v-list-item prepend-icon="mdi-github" title="Source on GitHub" href="https://github.com/skyfly200/algorithmic-sketchbook" target="_blank" rel="noopener" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <!-- Cross-fade between views, and show a light loader while a lazy route
           chunk (Patch/Mixer/Autopilot pull in three.js) downloads — instead of
           a blank flash. Suspense catches the async route component. -->
      <router-view v-slot="{ Component }">
        <transition name="view-fade" mode="out-in">
          <Suspense>
            <component :is="Component" />
            <template #fallback>
              <div class="view-loading"><v-progress-circular indeterminate color="primary" size="40" /></div>
            </template>
          </Suspense>
        </transition>
      </router-view>
    </v-main>

    <TourOverlay v-model="tourActive" :steps="tourSteps" allow-disable-all @finish="finishTour" />
  </v-app>
</template>

<style>
/* Route cross-fade — old view fades out, new fades in once it's ready. */
.view-fade-enter-active,
.view-fade-leave-active { transition: opacity 0.18s ease; }
.view-fade-enter-from,
.view-fade-leave-to { opacity: 0; }
/* Loader shown while a lazy route chunk is still downloading. */
.view-loading { display: grid; place-items: center; min-height: 70vh; }
.app-title {
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.brand-name {
  background: linear-gradient(90deg, #d789d7, #f2ad00 40%, #5bbcd6 80%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
</style>
