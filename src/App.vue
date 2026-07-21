<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandLogo from './components/BrandLogo.vue'
import TourOverlay from './components/TourOverlay.vue'
import { useSettingsStore } from './stores/settings'

const router = useRouter()
const settings = useSettingsStore()
const tourActive = ref(false)

// The first-open walkthrough: points at the main tools and where they live.
const tourSteps = [
  {
    title: 'Welcome to Bright Waves',
    body: 'A gallery of interactive graphics experiments you can play, mix, and project. Here’s a 30-second tour of where everything lives — you can Skip anytime.',
  },
  {
    target: '[data-tour="gallery"]',
    title: 'The experiments',
    body: 'Click any card to open that sketch full-screen with live controls, audio reactivity, and saveable scenes. Use the search and tag filters above to narrow the grid.',
    pad: 8,
  },
  {
    target: '[data-tour="autopilot"]',
    title: 'Autopilot',
    body: 'A hands-free show: it evolves an ever-changing mix of effects on its own. The quickest way to get something on screen.',
  },
  {
    target: '[data-tour="patch"]',
    title: 'Patch — the studio',
    body: 'Wire effects into a node graph, add polygon masks for projection mapping (drag the corners onto a surface), and plan a cue-based show on a timeline. The deep end.',
  },
  {
    target: '[data-tour="mixer"]',
    title: 'Mixer',
    body: 'Blend several effects into one composite with per-layer blend modes and audio inputs — simpler than Patch when you just want to stack looks.',
  },
  {
    target: '[data-tour="present"]',
    title: 'Display mode',
    body: 'A clean, controls-free fullscreen output — point it at a projector or second screen for the show.',
  },
  {
    target: '[data-tour="library"]',
    title: 'Library',
    body: 'Your saved patches, mixes, and scenes live here. Patches and shows can also be exported to JSON files from Patch.',
  },
  {
    target: '[data-tour="settings"]',
    title: 'Settings',
    body: 'Turn tutorials on or off, pick which effects the random and Autopilot features draw from, and more.',
  },
  {
    target: '[data-tour="help"]',
    title: 'That’s the tour',
    body: 'Full details are in the Docs. Replay this walkthrough anytime from this ? button. Each studio view (Patch, Mixer, Autopilot) has its own quick tour too. Have fun.',
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
  if (settings.shouldAutoTour('app')) startTour()
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
      <v-btn
        data-tour="autopilot"
        prepend-icon="mdi-airplane"
        variant="tonal"
        size="small"
        class="mr-2"
        title="Autopilot — a hands-free tour through the effects"
        :to="{ name: 'autopilot' }"
      >
        Autopilot
      </v-btn>
      <v-btn
        data-tour="patch"
        prepend-icon="mdi-vector-polyline"
        variant="tonal"
        size="small"
        class="mr-2"
        title="Patch — wire effects into a live node graph"
        :to="{ name: 'patch' }"
      >
        Patch
      </v-btn>
      <v-btn
        data-tour="mixer"
        prepend-icon="mdi-layers-triple-outline"
        variant="tonal"
        size="small"
        class="mr-2"
        title="Mixer — blend multiple effects into one composite"
        :to="{ name: 'mixer' }"
      >
        Mixer
      </v-btn>
      <v-btn
        data-tour="present"
        prepend-icon="mdi-projector-screen-outline"
        variant="tonal"
        size="small"
        class="mr-2"
        title="Display mode — fullscreen projection view"
        :to="{ name: 'present' }"
      >
        Display mode
      </v-btn>
      <v-btn
        data-tour="library"
        prepend-icon="mdi-bookmark-multiple-outline"
        variant="text"
        size="small"
        class="mr-2"
        title="Library — your saved patches, mixes and scenes"
        :to="{ name: 'library' }"
      >
        Library
      </v-btn>
      <v-btn
        icon="mdi-book-open-variant"
        variant="text"
        title="Docs — how the sketchbook works"
        :to="{ name: 'docs' }"
      />
      <v-btn
        data-tour="settings"
        icon="mdi-cog-outline"
        variant="text"
        title="Settings — tutorials, effect pool and more"
        :to="{ name: 'settings' }"
      />
      <v-btn
        data-tour="help"
        icon="mdi-help-circle-outline"
        variant="text"
        title="Replay the walkthrough"
        @click="startTour"
      />
      <v-btn
        icon="mdi-github"
        variant="text"
        title="View the source on GitHub"
        href="https://github.com/skyfly200/algorithmic-sketchbook"
        target="_blank"
        rel="noopener"
      />
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>

    <TourOverlay v-model="tourActive" :steps="tourSteps" allow-disable-all @finish="finishTour" />
  </v-app>
</template>

<style>
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
