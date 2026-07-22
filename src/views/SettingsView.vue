<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const store = useSketchStore()
const settings = useSettingsStore()

// The "filter" sketches are effects that process another image, not standalone
// generators — they don't belong in the random/Autopilot source pool.
const FILTER_SLUGS = new Set([
  'pointillism', 'camera-lens', 'rain-window', 'halftone', 'channel-offset', 'delay',
  'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope', 'fog', 'mist', 'glow', 'nebula-gasses',
  'strobe', 'color-filter', 'crt', 'uv-light', 'polarization', 'light-leaves', 'warp', 'rolling-shutter', 'feedback', 'interlace', 'painterly',
])
const effects = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && !FILTER_SLUGS.has(s.slug) && s.slug !== 'bright-waves-logo'),
)
const allSlugs = computed(() => effects.value.map((s) => s.slug))
const enabledCount = computed(() => effects.value.filter((s) => settings.isEffectEnabled(s.slug)).length)

function replayAppTour() {
  router.push({ name: 'gallery' })
}
</script>

<template>
  <v-container class="settings-page py-8" style="max-width: 820px">
    <div class="d-flex align-center mb-6">
      <v-btn icon="mdi-arrow-left" variant="text" :to="{ name: 'gallery' }" class="mr-2" />
      <h1 class="text-h5">Settings</h1>
    </div>

    <!-- Tutorials -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-school-outline" size="small" class="mr-2" />Tutorials
      </v-card-title>
      <v-card-text>
        <v-switch
          :model-value="settings.tutorials"
          color="primary"
          density="comfortable"
          hide-details
          label="Show guided tutorials"
          @update:model-value="settings.setTutorials($event)"
        />
        <p class="text-caption text-medium-emphasis mt-1 mb-3">
          When on, a short walkthrough runs the first time you open the gallery and each studio view
          (Patch, Mixer, Autopilot).
        </p>
        <div class="d-flex ga-2 flex-wrap">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-restart"
            @click="settings.resetTours()"
          >
            Show all tours again
          </v-btn>
          <v-btn size="small" variant="text" prepend-icon="mdi-play-circle-outline" @click="replayAppTour">
            Go to gallery to replay
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- Effect pool -->
    <v-card variant="tonal">
      <v-card-title class="text-subtitle-1 d-flex align-center">
        <v-icon icon="mdi-shuffle-variant" size="small" class="mr-2" />
        Effects for Random &amp; Autopilot
        <v-spacer />
        <span class="text-caption text-medium-emphasis">{{ enabledCount }} / {{ effects.length }} on</span>
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mb-3">
          Choose which generator effects the “Randomize” patch button and Autopilot are allowed to pick from.
          Everything on by default.
        </p>
        <div class="mb-3">
          <v-btn size="small" variant="tonal" :disabled="!settings.effectPool.length" @click="settings.enableAllEffects()">
            Enable all
          </v-btn>
        </div>
        <div class="eff-grid">
          <label v-for="s in effects" :key="s.slug" class="eff-item">
            <input
              type="checkbox"
              :checked="settings.isEffectEnabled(s.slug)"
              @change="settings.toggleEffect(s.slug, allSlugs)"
            />
            {{ s.title }}
          </label>
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.eff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px 16px;
}
.eff-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 13px system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}
.eff-item input { cursor: pointer; }
</style>
