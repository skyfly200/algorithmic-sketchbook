<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'
import { usePaletteStore } from '../stores/palette'
import { HARMONIES, gradientCss } from '../lib/colorTheory'
// The "filter" sketches are effects that process another image, not standalone
// generators — they don't belong in the random/Autopilot source pool.
import { FILTER_SLUG_SET } from '../registry/filters'
import { exportBackup, readBackupFile, applyBackup } from '../lib/backup'

const router = useRouter()
const store = useSketchStore()
const settings = useSettingsStore()
const palettes = usePaletteStore()

// Models offered for AI smart mode (Patch designer). Sonnet is the balanced
// default; Haiku is cheaper/faster; Opus is the most capable.
const AI_MODELS = [
  { title: 'Claude Sonnet 5 (balanced)', value: 'claude-sonnet-5' },
  { title: 'Claude Haiku 4.5 (fast & cheap)', value: 'claude-haiku-4-5-20251001' },
  { title: 'Claude Opus 5 (most capable)', value: 'claude-opus-5' },
]

// --- colour palettes ---------------------------------------------------------
const paletteBase = ref('#ff6b35')
const paletteHarmony = ref('Triadic')
function generatePalette() {
  palettes.generate(paletteBase.value, paletteHarmony.value, `${paletteHarmony.value} palette`)
}
const gradCss = (stops) => gradientCss(stops, 90)

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

// --- audio input device ------------------------------------------------------
const audioDevices = ref([]) // { deviceId, label }
const audioMsg = ref('')
async function loadAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) { audioMsg.value = 'Audio device selection needs a secure context (https or localhost).'; return }
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    audioDevices.value = list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    // Labels are blank until the user has granted mic permission at least once.
    if (audioDevices.value.some((d) => !d.label || /^Microphone \d+$/.test(d.label))) audioMsg.value = 'Allow the mic once to see device names.'
    else audioMsg.value = ''
  } catch { audioMsg.value = 'Could not list audio devices.' }
}
async function grantMicThenList() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop()) // just needed the permission
  } catch { /* denied */ }
  loadAudioDevices()
}
const audioItems = computed(() => [{ deviceId: '', label: 'System default' }, ...audioDevices.value])

// --- MIDI setup --------------------------------------------------------------
const midiMsg = ref('')
const midiChannels = [{ v: 0, t: 'All channels' }, ...Array.from({ length: 16 }, (_, i) => ({ v: i + 1, t: `Channel ${i + 1}` }))]
async function enableMidi() {
  if (!navigator.requestMIDIAccess) { midiMsg.value = 'This browser has no Web MIDI support (try Chrome).'; return }
  try {
    const access = await navigator.requestMIDIAccess()
    const names = [...access.inputs.values()].map((i) => i.name).filter(Boolean)
    settings.setMidiEnabled(true)
    midiMsg.value = names.length ? `MIDI ready — ${names.join(', ')}` : 'MIDI ready — no devices detected yet (plug one in).'
  } catch { midiMsg.value = 'MIDI access was blocked.' }
}
function disableMidi() { settings.setMidiEnabled(false); midiMsg.value = '' }

onMounted(loadAudioDevices)

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

    <!-- Graphics -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-expansion-card-variant" size="small" class="mr-2" />Graphics
      </v-card-title>
      <v-card-text>
        <v-switch
          :model-value="settings.highPerformance"
          color="primary"
          density="comfortable"
          hide-details
          label="High performance GPU"
          @update:model-value="settings.setHighPerformance($event)"
        />
        <p class="text-caption text-medium-emphasis mt-1 mb-0">
          Asks the browser to render WebGL sketches on the dedicated graphics card rather than the
          integrated one — smoother, at the cost of more power. On laptops this can spin up the discrete
          GPU and drain the battery faster. Takes effect the next time a sketch loads.
        </p>
      </v-card-text>
    </v-card>

    <!-- AI smart mode for the natural-language patch designer -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-creation" size="small" class="mr-2" />AI smart mode (Patch designer)
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mt-0 mb-3">
          The Patch “Describe a patch” tool works fully offline by default. With your own Claude API key you
          can turn on <strong>smart mode</strong>, which sends your description (plus the list of available
          effects/filters) to the Anthropic API and builds the whole graph it returns — better at free-form,
          relational descriptions. The key is stored only in this browser and sent directly to Anthropic from
          your machine; nothing goes through this site’s server.
        </p>
        <v-text-field
          :model-value="settings.aiKey"
          type="password"
          autocomplete="off"
          label="Claude API key (sk-ant-…)"
          density="comfortable"
          hide-details
          prepend-inner-icon="mdi-key-variant"
          class="mb-3"
          @update:model-value="settings.setAiKey($event)"
        />
        <v-select
          :model-value="settings.aiModel"
          :items="AI_MODELS"
          label="Model"
          density="comfortable"
          hide-details
          class="mb-1"
          style="max-width: 320px"
          @update:model-value="settings.setAiModel($event)"
        />
        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          Get a key at <span class="text-primary">console.anthropic.com</span>. Each smart build is one API
          request billed to your account. Leave the key blank to keep using the offline parser.
        </p>
      </v-card-text>
    </v-card>

    <!-- Geodata / map provider -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-earth" size="small" class="mr-2" />Geodata (maps &amp; terrain)
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mt-0 mb-3">
          The Geodata node and the Geometry node's Terrain source pull map, satellite and elevation tiles.
          They work out of the box with <strong>free public tiles</strong> (OpenStreetMap, Esri World Imagery,
          AWS Terrarium elevation). Add a <strong>MapTiler</strong> or <strong>Mapbox</strong> key for
          higher-quality imagery and terrain; the key is stored only in this browser.
        </p>
        <v-select
          :model-value="settings.mapProvider"
          :items="[{ title: 'MapTiler', value: 'maptiler' }, { title: 'Mapbox', value: 'mapbox' }]"
          label="Provider (when a key is set)"
          density="comfortable" hide-details style="max-width: 320px" class="mb-3"
          @update:model-value="settings.setMapProvider($event)"
        />
        <v-text-field
          :model-value="settings.mapKey"
          type="password" autocomplete="off"
          label="Map provider key (optional)"
          density="comfortable" hide-details prepend-inner-icon="mdi-key-variant"
          @update:model-value="settings.setMapKey($event)"
        />
        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          Free keys at <span class="text-primary">maptiler.com</span> or <span class="text-primary">mapbox.com</span>.
          Leave blank to use the free public tiles. Please respect each provider's attribution and usage limits.
        </p>
      </v-card-text>
    </v-card>

    <!-- Google Photos -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-google-photos" size="small" class="mr-2" />Google Photos import
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mt-0 mb-3">
          Import photos and videos from your Google Photos library (via the official Photos Picker). Needs a
          Google OAuth <strong>client ID</strong>: create one at <span class="text-primary">console.cloud.google.com</span>
          (OAuth client, type “Web application”), enable the Photos Picker API, and add this site's origin to the
          authorized JavaScript origins. Paste the client ID here — it's stored only in this browser.
        </p>
        <v-text-field
          :model-value="settings.googleClientId"
          type="password" autocomplete="off"
          label="Google OAuth client ID (…apps.googleusercontent.com)"
          density="comfortable" hide-details prepend-inner-icon="mdi-key-variant"
          @update:model-value="settings.setGoogleClientId($event)"
        />
      </v-card-text>
    </v-card>

    <!-- Colour palettes -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-palette-swatch" size="small" class="mr-2" />Colour palettes
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-medium-emphasis mt-0 mb-3">
          A shared library of favourite colours you can reuse anywhere a colour picker appears (the active
          palette's swatches show under each picker). Generate balanced palettes from a base colour using
          colour-theory harmonies.
        </p>

        <!-- generator -->
        <div class="d-flex ga-2 align-center flex-wrap mb-4">
          <input type="color" v-model="paletteBase" class="pal-swatch-in" title="Base colour" />
          <select class="pal-select" v-model="paletteHarmony">
            <option v-for="h in HARMONIES" :key="h" :value="h">{{ h }}</option>
          </select>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-auto-fix" @click="generatePalette">Generate</v-btn>
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-restore" @click="palettes.resetDefaults()">Reset defaults</v-btn>
        </div>

        <!-- palette list -->
        <div v-for="p in palettes.palettes" :key="p.id" class="pal-row" :class="{ active: p.id === palettes.activeId }">
          <button class="pal-pick" :title="p.id === palettes.activeId ? 'Active palette' : 'Make active'" @click="palettes.setActive(p.id)">
            <v-icon :icon="p.id === palettes.activeId ? 'mdi-check-circle' : 'mdi-circle-outline'" size="small" />
          </button>
          <span class="pal-name">{{ p.name }}</span>
          <span class="pal-chips">
            <span v-for="(c, i) in p.colors" :key="i" class="pal-chip" :style="{ background: c }" :title="c" />
          </span>
          <button class="pal-del" title="Delete palette" @click="palettes.removePalette(p.id)"><v-icon icon="mdi-close" size="x-small" /></button>
        </div>

        <div class="d-flex ga-2 mt-3">
          <v-btn size="small" variant="tonal" prepend-icon="mdi-gradient-horizontal" @click="palettes.gradientFromActive()">Save active as gradient</v-btn>
        </div>

        <!-- gradients -->
        <div class="panel-sub mt-4 mb-1 text-caption text-medium-emphasis">Gradients</div>
        <div v-for="g in palettes.gradients" :key="g.id" class="pal-row">
          <span class="pal-name">{{ g.name }}</span>
          <span class="pal-grad" :style="{ background: gradCss(g.stops) }" />
          <button class="pal-del" title="Delete gradient" @click="palettes.removeGradient(g.id)"><v-icon icon="mdi-close" size="x-small" /></button>
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

    <!-- Inputs: audio device + MIDI setup -->
    <v-card class="mb-6" variant="tonal">
      <v-card-title class="text-subtitle-1">
        <v-icon icon="mdi-tune-vertical" size="small" class="mr-2" />Inputs
      </v-card-title>
      <v-card-text>
        <!-- Audio input device -->
        <div class="text-subtitle-2 mb-1">Audio input</div>
        <p class="text-caption text-medium-emphasis mb-2">Which microphone / input the audio-reactive effects listen to.</p>
        <div class="d-flex ga-2 align-center flex-wrap">
          <v-select
            :model-value="settings.audioDeviceId"
            :items="audioItems"
            item-title="label"
            item-value="deviceId"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 340px"
            @update:model-value="settings.setAudioDevice($event)"
          />
          <v-btn size="small" variant="tonal" prepend-icon="mdi-microphone" @click="grantMicThenList">Detect devices</v-btn>
        </div>
        <p v-if="audioMsg" class="text-caption text-medium-emphasis mt-2 mb-0">{{ audioMsg }}</p>

        <v-divider class="my-4" />

        <!-- MIDI setup -->
        <div class="text-subtitle-2 mb-1">MIDI</div>
        <p class="text-caption text-medium-emphasis mb-2">
          Set MIDI up to control effects from a controller. Until it's set up, MIDI is hidden from the input lists.
        </p>
        <div v-if="!settings.midiEnabled" class="d-flex ga-2 align-center">
          <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-midi-port" @click="enableMidi">Set up MIDI</v-btn>
        </div>
        <div v-else class="d-flex ga-2 align-center flex-wrap">
          <v-select
            :model-value="settings.midiChannel"
            :items="midiChannels"
            item-title="t"
            item-value="v"
            label="Channel"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 200px"
            @update:model-value="settings.setMidiChannel($event)"
          />
          <v-btn size="small" variant="text" prepend-icon="mdi-midi-port" @click="enableMidi">Re-scan</v-btn>
          <v-btn size="small" variant="text" color="error" @click="disableMidi">Turn off MIDI</v-btn>
        </div>
        <p v-if="midiMsg" class="text-caption text-medium-emphasis mt-2 mb-0">{{ midiMsg }}</p>
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

/* colour palettes */
.pal-swatch-in { width: 40px; height: 32px; border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; background: none; cursor: pointer; padding: 0; }
.pal-select { background: rgba(255,255,255,0.06); color: inherit; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 5px 8px; font: inherit; }
.pal-select option { color: #000; }
.pal-row { display: flex; align-items: center; gap: 10px; padding: 5px 4px; border-radius: 6px; }
.pal-row.active { background: rgba(255,255,255,0.06); }
.pal-pick { background: none; border: none; color: inherit; cursor: pointer; opacity: 0.85; display: flex; }
.pal-name { flex: 0 0 8.5rem; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pal-chips { flex: 1 1 auto; display: flex; gap: 3px; flex-wrap: wrap; }
.pal-chip { width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.35); }
.pal-grad { flex: 1 1 auto; height: 18px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.35); }
.pal-del { background: none; border: none; color: rgba(255,255,255,0.6); cursor: pointer; display: flex; }
.pal-del:hover { color: #fff; }
</style>
