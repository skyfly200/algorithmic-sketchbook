<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'
// The "filter" sketches are effects that process another image, not standalone
// generators — they don't belong in the random/Autopilot source pool.
import { FILTER_SLUG_SET } from '../registry/filters'
import { exportBackup, readBackupFile, applyBackup } from '../lib/backup'

const router = useRouter()
const store = useSketchStore()
const settings = useSettingsStore()

const effects = computed(() =>
  store.sketches.filter((s) => s.embed && !s.standalone && !FILTER_SLUG_SET.has(s.slug) && s.slug !== 'bright-waves-logo'),
)
const allSlugs = computed(() => effects.value.map((s) => s.slug))
const enabledCount = computed(() => effects.value.filter((s) => settings.isEffectEnabled(s.slug)).length)

function replayAppTour() {
  router.push({ name: 'gallery' })
}
function clearSessionMemory() {
  if (!window.confirm('Clear the working state of the Patch, Mixer and Autopilot editors? Your saved routings, blocks and scenes are kept. The app will reload.')) return
  settings.clearSession()
  window.location.reload()
}

// --- backup & restore: whole library + settings to/from a JSON file ---------
const backupMsg = ref('')
const backupErr = ref(false)
const fileInput = ref(null)
function note(text, err = false) { backupMsg.value = text; backupErr.value = err }
function doExport() {
  try {
    const n = exportBackup()
    note(`Backup downloaded — ${n} item${n === 1 ? '' : 's'} saved.`)
  } catch (e) {
    note(`Export failed: ${e.message}`, true)
  }
}
async function onPickFile(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // let the same file be re-picked later
  if (!file) return
  let parsed
  try {
    parsed = await readBackupFile(file)
  } catch (err) {
    note(err.message, true)
    return
  }
  const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : 'unknown date'
  if (!window.confirm(
    `Restore this backup (${parsed.keys ?? Object.keys(parsed.data).length} items, saved ${when})?\n\n` +
    'This replaces your current settings, saved routings, blocks and scenes, then reloads the app.',
  )) return
  try {
    applyBackup(parsed, { replace: true })
    window.location.reload()
  } catch (err) {
    note(`Restore failed: ${err.message}`, true)
  }
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

    <!-- Session & memory -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-content-save-cog-outline" size="small" class="mr-2" />Session &amp; memory
      </v-card-title>
      <v-card-text>
        <v-switch
          :model-value="settings.persistEditors"
          color="primary"
          density="comfortable"
          hide-details
          label="Remember editor state across refreshes"
          @update:model-value="settings.setPersistEditors($event)"
        />
        <p class="text-caption text-medium-emphasis mt-1 mb-3">
          When on, the Patch graph, Mixer layers and Autopilot mix are saved in your browser and restored
          when you come back. Turn off to start each editor fresh every visit. Your saved routings, blocks
          and scenes are always kept regardless of this setting.
        </p>
        <v-btn
          size="small"
          variant="tonal"
          color="error"
          prepend-icon="mdi-broom"
          @click="clearSessionMemory"
        >
          Clear session memory
        </v-btn>
        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          Wipes the current Patch / Mixer / Autopilot working state and reloads. Saved routings, blocks and
          scenes are not affected.
        </p>
      </v-card-text>
    </v-card>

    <!-- Backup & restore -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-database-arrow-down-outline" size="small" class="mr-2" />Backup &amp; restore
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mb-3">
          Save everything stored in this browser — settings and favorites, saved routings and blocks,
          scenes, the Mixer / Autopilot / Patch working state, and on-device performance data — to a single
          file you can keep or move to another machine. Restoring replaces what's here now.
        </p>
        <div class="d-flex ga-2 flex-wrap">
          <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-download-outline" @click="doExport">
            Export backup
          </v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-upload-outline" @click="fileInput?.click()">
            Restore from file…
          </v-btn>
          <input ref="fileInput" type="file" accept="application/json,.json" class="d-none" @change="onPickFile" />
        </div>
        <p v-if="backupMsg" class="text-caption mt-3 mb-0" :class="backupErr ? 'text-error' : 'text-medium-emphasis'">
          {{ backupMsg }}
        </p>
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
          <v-btn size="small" variant="tonal" :disabled="!settings.isFilteringEffects" @click="settings.enableAllEffects()">
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
