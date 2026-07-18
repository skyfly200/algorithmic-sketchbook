<script setup>
/**
 * Autopilot — a hands-free tour through the effects. It plays one sketch
 * fullscreen at a time, each with a fresh random seed, crossfades to a random
 * next one when the dwell timer runs out — and if rendering drops below the
 * FPS floor for five straight seconds, it skips ahead early (the current
 * effect is too heavy for this machine, so move on).
 *
 * Input mappings work exactly like the solo viewer: the current sketch's
 * params and mappings appear in a side drawer (same postMessage protocol),
 * and one shared mic feeds beat/level state into the running sketch so its
 * audio mappings react.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSketchStore } from '../stores/sketches'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'

const store = useSketchStore()
// Everything embeddable rides the carousel, except the brand logo card.
const pool = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && s.slug !== 'bright-waves-logo'),
)

// --- settings (persisted) ---------------------------------------------------
const SET_KEY = 'sketchbook-autopilot'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(SET_KEY)) ?? {}
  } catch {
    return {}
  }
})()
const dwell = ref(saved.dwell ?? 40) // seconds per effect
const lowSkip = ref(saved.lowSkip ?? true) // skip early on sustained low FPS
const fpsFloor = ref(saved.fpsFloor ?? 24)
const playing = ref(true)
function persistSettings() {
  localStorage.setItem(SET_KEY, JSON.stringify({ dwell: dwell.value, lowSkip: lowSkip.value, fpsFloor: fpsFloor.value }))
}

// --- the two stacked iframes (A/B) for crossfading --------------------------
const frameA = ref(null)
const frameB = ref(null)
const srcA = ref('')
const srcB = ref('')
const showA = ref(true) // which frame is on top / active
const fading = ref(false)
const current = ref(null) // current sketch entry
const history = []
let shuffle = []

function nextSlug() {
  if (!shuffle.length) {
    shuffle = [...pool.value].sort(() => Math.random() - 0.5)
    // Don't repeat the current one back-to-back after a reshuffle.
    if (shuffle[0]?.slug === current.value?.slug && shuffle.length > 1) shuffle.push(shuffle.shift())
  }
  return shuffle.shift()
}
function srcFor(s) {
  const seed = ((Math.random() * 4294967296) >>> 0).toString(36)
  return `${s.url}?preview=1&quality=high&seed=${seed}`
}

let dwellLeft = 0
function advance(entry) {
  const s = entry ?? nextSlug()
  if (!s) return
  if (current.value) history.push(current.value)
  if (history.length > 30) history.shift()
  current.value = s
  controls.value = null // the new sketch will announce its own schema
  dwellLeft = dwell.value
  lowStreak = 0
  // Load into the hidden frame, then fade it in over the old one.
  const hiddenSrc = showA.value ? srcB : srcA
  hiddenSrc.value = srcFor(s)
  fading.value = true
  setTimeout(() => {
    showA.value = !showA.value
    // After the fade completes, unload the now-hidden frame to free its GPU.
    setTimeout(() => {
      const nowHidden = showA.value ? srcB : srcA
      nowHidden.value = ''
      fading.value = false
    }, 1400)
  }, 350) // small head start so the incoming sketch has frames up
  titleFlash.value = true
  clearTimeout(titleTimer)
  titleTimer = setTimeout(() => (titleFlash.value = false), 3500)
}
function back() {
  const prev = history.pop()
  if (prev) advance(prev)
}
let titleTimer = 0
const titleFlash = ref(true)

// --- FPS watchdog: skip ahead early when rendering bogs down ---------------
// Same-origin iframes share the page's main thread, so the parent's own rAF
// rate is an honest proxy for how hard the current sketch is struggling.
const fps = ref(60)
let lowStreak = 0 // seconds below the floor, consecutive
let frames = 0
let winStart = 0
const skipped = ref(false) // flashes a note when the watchdog fired

// --- shared mic + beat broadcast (audio mappings react in-sketch) ----------
const beat = createBeatDetector()
const micOn = ref(false)
let pendingBeat = false
beat.onBeat(() => (pendingBeat = true))
async function toggleMic() {
  if (micOn.value) {
    beat.stop()
    micOn.value = false
    return
  }
  try {
    await beat.start()
    micOn.value = true
  } catch {
    /* no mic */
  }
}

// --- current sketch's params + mappings (same protocol as the viewer) ------
const controls = ref(null) // { schema, values, mappings }
const drawer = ref(false)
const INPUT_GROUPS = computed(() => {
  const groups = { audio: [], midi: [], mouse: [], touch: [], tilt: [], time: [], leap: [], artnet: [] }
  for (const s of INPUT_SOURCES) {
    const head = s.split('.')[0]
    const g = head === 'shake' ? 'tilt' : head
    ;(groups[g] ?? (groups[g] = [])).push(s)
  }
  return Object.entries(groups).filter(([, list]) => list.length)
})
// The incoming sketch announces its schema while its frame is still the
// hidden one (mid-crossfade), so accept sketch:ready from either frame and
// remember which window to talk back to.
let controlsWin = null
function onMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  if (e.source !== frameA.value?.contentWindow && e.source !== frameB.value?.contentWindow) return
  controlsWin = e.source
  controls.value = {
    schema: e.data.schema ?? {},
    values: { ...e.data.values },
    mappings: (e.data.mappings ?? []).map((m) => ({ ...m })),
  }
}
function post(msg) {
  controlsWin?.postMessage(msg, '*')
}
function setParam(name, value) {
  controls.value.values[name] = value
  post({ type: 'sketch:set-param', name, value })
}
function syncMappings() {
  post({ type: 'sketch:set-mappings', mappings: controls.value.mappings })
}
function addMapping() {
  const c = controls.value
  const firstNumeric = Object.keys(c.schema).find((k) => typeof c.schema[k].min === 'number')
  if (!firstNumeric) return
  c.mappings.push({ source: 'audio.pulse', param: firstNumeric, amount: 0.5, smooth: 0.6 })
  syncMappings()
}
function removeMapping(i) {
  controls.value.mappings.splice(i, 1)
  syncMappings()
}
function numericParams() {
  const c = controls.value
  return c ? Object.keys(c.schema).filter((k) => typeof c.schema[k].min === 'number') : []
}

// --- main loop --------------------------------------------------------------
let raf = 0
let lastSecond = 0
function loop(now) {
  // Beat broadcast into the live frames.
  beat.update(now)
  const bs = beat.state
  const msg = {
    type: 'input:beat',
    state: {
      level: bs.level, low: bs.low, mid: bs.mid, high: bs.high, volume: bs.volume,
      centroid: bs.centroid, flux: bs.flux, interval: bs.interval, bpm: bs.bpm,
    },
    beat: pendingBeat,
    energy: 1,
  }
  pendingBeat = false
  frameA.value?.contentWindow?.postMessage(msg, '*')
  frameB.value?.contentWindow?.postMessage(msg, '*')

  // FPS measurement (0.5 s windows).
  frames++
  if (!winStart) winStart = now
  if (now - winStart >= 500) {
    fps.value = Math.round((frames * 1000) / (now - winStart))
    frames = 0
    winStart = now
  }

  // Once a second: dwell countdown + low-FPS watchdog.
  if (now - lastSecond >= 1000) {
    lastSecond = now
    if (playing.value && !fading.value) {
      dwellLeft--
      if (fps.value < fpsFloor.value) lowStreak++
      else lowStreak = 0
      if (lowSkip.value && lowStreak >= 5) {
        skipped.value = true
        setTimeout(() => (skipped.value = false), 3000)
        advance()
      } else if (dwellLeft <= 0) {
        advance()
      }
    }
  }
  raf = requestAnimationFrame(loop)
}

function fullscreen() {
  document.querySelector('.autopilot')?.requestFullscreen?.()
}

onMounted(() => {
  advance()
  window.addEventListener('message', onMessage)
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('message', onMessage)
  clearTimeout(titleTimer)
  beat.stop()
})
</script>

<template>
  <div class="autopilot">
    <iframe
      ref="frameA"
      class="stage-frame"
      :class="{ top: showA, visible: srcA }"
      :src="srcA || undefined"
      allow="microphone; camera; midi; accelerometer; gyroscope"
    />
    <iframe
      ref="frameB"
      class="stage-frame"
      :class="{ top: !showA, visible: srcB }"
      :src="srcB || undefined"
      allow="microphone; camera; midi; accelerometer; gyroscope"
    />

    <!-- current title, flashed on each advance -->
    <div class="title" :class="{ on: titleFlash }">{{ current?.title }}</div>
    <div v-if="skipped" class="skip-note">low fps — skipping ahead</div>

    <!-- transport -->
    <div class="bar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-1">Autopilot</span>
      <v-btn icon="mdi-skip-previous" variant="text" size="small" title="Back" :disabled="!history.length" @click="back" />
      <v-btn :icon="playing ? 'mdi-pause' : 'mdi-play'" variant="text" size="small" :title="playing ? 'Pause the tour' : 'Resume'" @click="playing = !playing" />
      <v-btn icon="mdi-skip-next" variant="text" size="small" title="Next effect now" @click="advance()" />
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-cog-outline" variant="text" size="small" title="Autopilot settings" />
        </template>
        <v-card class="pa-3" min-width="260">
          <div class="set-row">Dwell: {{ dwell }}s</div>
          <v-slider v-model="dwell" density="compact" hide-details :min="8" :max="180" :step="1" @end="persistSettings" />
          <v-checkbox v-model="lowSkip" density="compact" hide-details label="Skip early after 5 s of low FPS" @change="persistSettings" />
          <div v-if="lowSkip" class="set-row">FPS floor: {{ fpsFloor }}</div>
          <v-slider v-if="lowSkip" v-model="fpsFloor" density="compact" hide-details :min="10" :max="50" :step="1" @end="persistSettings" />
        </v-card>
      </v-menu>
      <v-btn
        :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
        variant="text" size="small"
        :color="micOn ? 'primary' : undefined"
        title="Mic — the running effect's audio mappings react"
        @click="toggleMic"
      />
      <v-btn
        icon="mdi-tune-variant" variant="text" size="small"
        :color="drawer ? 'primary' : undefined"
        title="Params & input mappings for the current effect"
        @click="drawer = !drawer"
      />
      <span class="fps" :class="{ low: fps < fpsFloor }">{{ fps }} fps</span>
      <span class="countdown">{{ playing ? Math.max(0, dwellLeft) + 's' : 'paused' }}</span>
      <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
    </div>

    <!-- params + mappings drawer for the current effect -->
    <div v-if="drawer" class="drawer" @pointerdown.stop>
      <div class="drawer-head">{{ current?.title }}</div>
      <template v-if="controls">
        <template v-for="(spec, name) in controls.schema" :key="name">
          <label v-if="spec.type === 'bool'" class="chk">
            <input type="checkbox" :checked="controls.values[name]" @change="setParam(name, $event.target.checked)" /> {{ spec.label ?? name }}
          </label>
          <label v-else-if="spec.type === 'select'">
            {{ spec.label ?? name }}
            <select :value="controls.values[name]" @change="setParam(name, $event.target.value)">
              <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
            </select>
          </label>
          <label v-else>
            {{ spec.label ?? name }}
            <input type="range" :min="spec.min" :max="spec.max" :step="spec.step ?? 0.01" :value="controls.values[name]" @input="setParam(name, +$event.target.value)" />
          </label>
        </template>

        <div class="map-head">
          <span>Mappings</span>
          <button class="mini" title="Add mapping" @click="addMapping">+</button>
        </div>
        <div v-for="(m, mi) in controls.mappings" :key="mi" class="map-row">
          <select v-model="m.source" @change="syncMappings">
            <optgroup v-for="[g, list] in INPUT_GROUPS" :key="g" :label="g">
              <option v-for="src in list" :key="src" :value="src">{{ src }}</option>
            </optgroup>
          </select>
          <span>→</span>
          <select v-model="m.param" @change="syncMappings">
            <option v-for="pn in numericParams()" :key="pn" :value="pn">{{ pn }}</option>
          </select>
          <input type="range" min="-1" max="1" step="0.05" v-model.number="m.amount" title="amount" @input="syncMappings" />
          <input type="range" min="0" max="0.98" step="0.02" :value="m.smooth ?? 0" title="smoothing" @input="m.smooth = +$event.target.value; syncMappings()" />
          <button class="mini" title="Remove" @click="removeMapping(mi)">×</button>
        </div>
      </template>
      <div v-else class="waiting">waiting for the effect…</div>
    </div>
  </div>
</template>

<style scoped>
.autopilot { position: fixed; inset: 0; background: #05060a; z-index: 2000; overflow: hidden; }
.stage-frame {
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
  opacity: 0; transition: opacity 1.2s ease; pointer-events: none;
}
.stage-frame.visible { opacity: 0; }
.stage-frame.top.visible { opacity: 1; pointer-events: auto; z-index: 1; }
.title {
  position: absolute; left: 24px; bottom: 64px; z-index: 10; pointer-events: none;
  font: 600 26px system-ui, sans-serif; color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
  opacity: 0; transition: opacity 0.8s;
}
.title.on { opacity: 1; }
.skip-note {
  position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 10;
  padding: 6px 14px; border-radius: 999px; pointer-events: none;
  font: 13px system-ui, sans-serif; color: #ffcf9a;
  background: rgba(30, 22, 12, 0.85); border: 1px solid rgba(255, 190, 120, 0.4);
}
.bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  display: flex; align-items: center; gap: 4px; padding: 6px 12px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0));
  opacity: 0.35; transition: opacity 0.25s;
}
.bar:hover { opacity: 1; }
.fps { margin-left: auto; font: 12px ui-monospace, monospace; color: #8f8; }
.fps.low { color: #f88; }
.countdown { font: 12px ui-monospace, monospace; color: #9aa4c0; min-width: 48px; text-align: right; }
.set-row { font: 12px system-ui, sans-serif; color: #cdd3e0; margin-top: 4px; }
.drawer {
  position: absolute; top: 52px; right: 10px; bottom: 60px; width: 280px; z-index: 20;
  overflow-y: auto; padding: 12px; border-radius: 10px;
  background: rgba(16, 18, 26, 0.92); border: 1px solid rgba(255, 255, 255, 0.12);
  display: flex; flex-direction: column; gap: 5px;
}
.drawer-head { font: 600 13px system-ui, sans-serif; color: #e8ecf5; margin-bottom: 4px; }
.drawer label { display: flex; flex-direction: column; gap: 2px; font: 11px system-ui, sans-serif; color: #cdd3e0; }
.drawer .chk { flex-direction: row; align-items: center; gap: 6px; }
.drawer select { background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; font-size: 11px; }
.drawer input[type=range] { width: 100%; }
.map-head { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; }
.map-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 3px; align-items: center; font-size: 10px; color: #cdd3e0; }
.map-row input[type=range] { grid-column: 1 / -1; }
.mini { width: 18px; height: 18px; border-radius: 3px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 12px; line-height: 1; }
.waiting { font: 12px system-ui, sans-serif; color: #9aa4c0; }
</style>
