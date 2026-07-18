<script setup>
/**
 * Autopilot — a hands-free tour that deals random *mixes*, not single
 * sketches: each scene is a small random composite in the spirit of the Patch
 * dice roll — 1–3 effect layers stacked with random blend modes and
 * opacities, often topped by a filter (pointillism, VHS, lens flare, …) that
 * receives the live composite of the layers below it as its source. Scenes
 * crossfade on a dwell timer, and if the frame rate stays under the floor for
 * five straight seconds the watchdog skips ahead early.
 *
 * Input mappings work like the solo viewer, per layer: every sketch in the
 * current scene announces its params/mappings into the side drawer, and one
 * shared mic feeds beat state into every running frame.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSketchStore } from '../stores/sketches'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'

const store = useSketchStore()
const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone',
  'channel-offset', 'delay', 'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope',
]
const BLENDS = [
  'screen', 'lighten', 'overlay', 'soft-light', 'hard-light',
  'color-dodge', 'difference', 'exclusion', 'hue', 'color', 'luminosity',
]
const effectPool = computed(() =>
  store.sketches.filter(
    (s) => s.type === 'local' && s.embed && !FILTER_SLUGS.includes(s.slug) && s.slug !== 'bright-waves-logo',
  ),
)
const filterPool = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && FILTER_SLUGS.includes(s.slug)),
)

// --- settings (persisted) ---------------------------------------------------
const SET_KEY = 'sketchbook-autopilot'
const savedSet = (() => {
  try {
    return JSON.parse(localStorage.getItem(SET_KEY)) ?? {}
  } catch {
    return {}
  }
})()
const dwell = ref(savedSet.dwell ?? 40)
const lowSkip = ref(savedSet.lowSkip ?? true)
const fpsFloor = ref(savedSet.fpsFloor ?? 24)
const playing = ref(true)
function persistSettings() {
  localStorage.setItem(SET_KEY, JSON.stringify({ dwell: dwell.value, lowSkip: lowSkip.value, fpsFloor: fpsFloor.value }))
}

// --- scenes: random layer stacks, dealt like the Patch dice ----------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const chance = (p) => Math.random() < p

function dealScene() {
  const layers = []
  const nEff = 1 + Math.floor(Math.random() * 3) // 1–3 effect layers
  const used = new Set()
  for (let i = 0; i < nEff; i++) {
    let s = pick(effectPool.value)
    for (let tries = 0; tries < 4 && used.has(s.slug); tries++) s = pick(effectPool.value)
    used.add(s.slug)
    layers.push({
      slug: s.slug,
      kind: 'effect',
      blend: i === 0 ? 'normal' : pick(BLENDS),
      opacity: i === 0 ? 1 : +(0.55 + Math.random() * 0.45).toFixed(2),
      seed: ((Math.random() * 4294967296) >>> 0).toString(36),
    })
  }
  // Often cap the stack with a filter fed by the composite below.
  if (chance(0.6)) {
    layers.push({
      slug: pick(filterPool.value)?.slug,
      kind: 'filter',
      blend: 'normal',
      opacity: 1,
      seed: ((Math.random() * 4294967296) >>> 0).toString(36),
    })
  }
  return { id: Date.now() + Math.random(), layers }
}

function srcFor(layer) {
  const s = store.bySlug(layer.slug)
  return s ? `${s.url}?preview=1&capture=1&quality=high&seed=${layer.seed}` : ''
}

// Two scene slots for crossfading.
const sceneA = ref(null)
const sceneB = ref(null)
const showA = ref(true)
const fading = ref(false)
const history = []
const current = ref(null)

// iframe elements per scene slot (index-aligned with the scene's layers).
const framesA = new Map()
const framesB = new Map()
function bindLayer(slot, idx, el) {
  const m = slot === 'a' ? framesA : framesB
  if (el) m.set(idx, el)
  else m.delete(idx)
}
function framesOf(scene) {
  return scene === sceneA.value ? framesA : scene === sceneB.value ? framesB : null
}

let dwellLeft = 0
function advance(entry) {
  const scene = entry ?? dealScene()
  if (!scene.layers?.length) return
  if (current.value) history.push(current.value)
  if (history.length > 30) history.shift()
  current.value = scene
  layerControls.splice(0) // the new scene's sketches will announce themselves
  dwellLeft = dwell.value
  lowStreak = 0
  const hidden = showA.value ? sceneB : sceneA
  hidden.value = scene
  fading.value = true
  setTimeout(() => {
    showA.value = !showA.value
    setTimeout(() => {
      const nowHidden = showA.value ? sceneB : sceneA
      nowHidden.value = null
      fading.value = false
    }, 1400)
  }, 500) // head start so the incoming stack has frames up
}
function back() {
  const prev = history.pop()
  if (prev) advance(prev)
}

// --- FPS watchdog -----------------------------------------------------------
const fps = ref(60)
let lowStreak = 0
let frames = 0
let winStart = 0
const skipped = ref(false)

// --- shared mic + beat broadcast -------------------------------------------
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

// --- filter feed: composite the layers below into a filter's source --------
const feed = new OffscreenCanvas(640, 360)
const feedCtx = feed.getContext('2d')
function canvasBlend(b) {
  if (b === 'add') return 'lighter'
  if (b === 'normal') return 'source-over'
  return b
}
function coverDraw(ctx, cv, sw, sh, tw, th) {
  const scale = Math.max(tw / sw, th / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(cv, (tw - w) / 2, (th - h) / 2, w, h)
}
function feedFilters(scene) {
  const m = framesOf(scene)
  if (!scene || !m) return
  const L = scene.layers
  for (let i = 0; i < L.length; i++) {
    if (L[i].kind !== 'filter') continue
    const el = m.get(i)
    if (!el?.contentWindow) continue
    feedCtx.globalCompositeOperation = 'source-over'
    feedCtx.globalAlpha = 1
    feedCtx.fillStyle = '#000'
    feedCtx.fillRect(0, 0, feed.width, feed.height)
    let drew = false
    let first = true
    for (let j = 0; j < i; j++) {
      let cv = null
      try {
        cv = m.get(j)?.contentDocument?.querySelector('canvas')
      } catch {
        cv = null
      }
      if (!cv || !cv.width) continue
      feedCtx.globalAlpha = L[j].opacity ?? 1
      feedCtx.globalCompositeOperation = first ? 'source-over' : canvasBlend(L[j].blend)
      coverDraw(feedCtx, cv, cv.width, cv.height, feed.width, feed.height)
      first = false
      drew = true
    }
    feedCtx.globalAlpha = 1
    feedCtx.globalCompositeOperation = 'source-over'
    if (drew) {
      const bmp = feed.transferToImageBitmap()
      el.contentWindow.postMessage({ type: 'mixer:frame', bitmap: bmp }, '*', [bmp])
    }
  }
}

// --- per-layer params + mappings (same protocol as the viewer) -------------
const layerControls = reactive([]) // [{ win, title, schema, values, mappings, open }]
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
function allFrames() {
  return [...framesA.values(), ...framesB.values()]
}
function titleForWindow(win) {
  for (const [m, scene] of [[framesA, sceneA.value], [framesB, sceneB.value]]) {
    if (!scene) continue
    for (const [idx, el] of m) {
      if (el.contentWindow === win) return store.bySlug(scene.layers[idx]?.slug)?.title ?? scene.layers[idx]?.slug
    }
  }
  return null
}
function onMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  const title = titleForWindow(e.source)
  if (!title) return
  const entry = {
    win: e.source,
    title,
    schema: e.data.schema ?? {},
    values: { ...e.data.values },
    mappings: (e.data.mappings ?? []).map((m) => ({ ...m })),
    open: layerControls.length === 0,
  }
  const i = layerControls.findIndex((c) => c.win === e.source)
  if (i >= 0) layerControls.splice(i, 1, entry)
  else layerControls.push(entry)
}
function setParam(c, name, value) {
  c.values[name] = value
  c.win.postMessage({ type: 'sketch:set-param', name, value }, '*')
}
function syncMappings(c) {
  c.win.postMessage({ type: 'sketch:set-mappings', mappings: c.mappings }, '*')
}
function addMapping(c) {
  const firstNumeric = Object.keys(c.schema).find((k) => typeof c.schema[k].min === 'number')
  if (!firstNumeric) return
  c.mappings.push({ source: 'audio.pulse', param: firstNumeric, amount: 0.5, smooth: 0.6 })
  syncMappings(c)
}
function removeMapping(c, i) {
  c.mappings.splice(i, 1)
  syncMappings(c)
}
function numericParams(c) {
  return Object.keys(c.schema).filter((k) => typeof c.schema[k].min === 'number')
}

// --- main loop --------------------------------------------------------------
let raf = 0
let lastSecond = 0
function loop(now) {
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
  for (const el of allFrames()) el.contentWindow?.postMessage(msg, '*')

  // Keep filters fed in both scenes (the incoming one needs frames mid-fade).
  feedFilters(sceneA.value)
  feedFilters(sceneB.value)

  frames++
  if (!winStart) winStart = now
  if (now - winStart >= 500) {
    fps.value = Math.round((frames * 1000) / (now - winStart))
    frames = 0
    winStart = now
  }

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
  beat.stop()
})
</script>

<template>
  <div class="autopilot">
    <!-- two scene slots, crossfaded; each is a blend-stacked layer pile -->
    <div class="scene" :class="{ top: showA, visible: !!sceneA }">
      <iframe
        v-for="(l, i) in sceneA?.layers ?? []"
        :key="sceneA.id + '-' + i"
        :ref="(el) => bindLayer('a', i, el)"
        class="layer"
        :style="{ mixBlendMode: l.blend === 'add' ? 'plus-lighter' : l.blend, opacity: l.opacity }"
        :src="srcFor(l)"
        allow="microphone; camera; midi; accelerometer; gyroscope"
      />
    </div>
    <div class="scene" :class="{ top: !showA, visible: !!sceneB }">
      <iframe
        v-for="(l, i) in sceneB?.layers ?? []"
        :key="sceneB.id + '-' + i"
        :ref="(el) => bindLayer('b', i, el)"
        class="layer"
        :style="{ mixBlendMode: l.blend === 'add' ? 'plus-lighter' : l.blend, opacity: l.opacity }"
        :src="srcFor(l)"
        allow="microphone; camera; midi; accelerometer; gyroscope"
      />
    </div>

    <div v-if="skipped" class="skip-note">low fps — skipping ahead</div>

    <!-- transport -->
    <div class="bar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-1">Autopilot</span>
      <v-btn icon="mdi-skip-previous" variant="text" size="small" title="Back" :disabled="!history.length" @click="back" />
      <v-btn :icon="playing ? 'mdi-pause' : 'mdi-play'" variant="text" size="small" :title="playing ? 'Pause the tour' : 'Resume'" @click="playing = !playing" />
      <v-btn icon="mdi-skip-next" variant="text" size="small" title="Next mix now" @click="advance()" />
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
        title="Mic — every layer's audio mappings react"
        @click="toggleMic"
      />
      <v-btn
        icon="mdi-tune-variant" variant="text" size="small"
        :color="drawer ? 'primary' : undefined"
        title="Params & input mappings for the current mix"
        @click="drawer = !drawer"
      />
      <span class="fps" :class="{ low: fps < fpsFloor }">{{ fps }} fps</span>
      <span class="countdown">{{ playing ? Math.max(0, dwellLeft) + 's' : 'paused' }}</span>
      <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
    </div>

    <!-- per-layer params + mappings drawer -->
    <div v-if="drawer" class="drawer" @pointerdown.stop>
      <template v-if="layerControls.length">
        <div v-for="c in layerControls" :key="c.title + layerControls.indexOf(c)" class="layer-sec">
          <button class="sec-head" @click="c.open = !c.open">
            <span>{{ c.title }}</span><span>{{ c.open ? '▾' : '▸' }}</span>
          </button>
          <div v-if="c.open" class="sec-body">
            <template v-for="(spec, name) in c.schema" :key="name">
              <label v-if="spec.type === 'bool'" class="chk">
                <input type="checkbox" :checked="c.values[name]" @change="setParam(c, name, $event.target.checked)" /> {{ spec.label ?? name }}
              </label>
              <label v-else-if="spec.type === 'select'">
                {{ spec.label ?? name }}
                <select :value="c.values[name]" @change="setParam(c, name, $event.target.value)">
                  <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                </select>
              </label>
              <label v-else>
                {{ spec.label ?? name }}
                <input type="range" :min="spec.min" :max="spec.max" :step="spec.step ?? 0.01" :value="c.values[name]" @input="setParam(c, name, +$event.target.value)" />
              </label>
            </template>
            <div class="map-head">
              <span>Mappings</span>
              <button class="mini" title="Add mapping" @click="addMapping(c)">+</button>
            </div>
            <div v-for="(m, mi) in c.mappings" :key="mi" class="map-row">
              <select v-model="m.source" @change="syncMappings(c)">
                <optgroup v-for="[g, list] in INPUT_GROUPS" :key="g" :label="g">
                  <option v-for="src in list" :key="src" :value="src">{{ src }}</option>
                </optgroup>
              </select>
              <span>→</span>
              <select v-model="m.param" @change="syncMappings(c)">
                <option v-for="pn in numericParams(c)" :key="pn" :value="pn">{{ pn }}</option>
              </select>
              <input type="range" min="-1" max="1" step="0.05" v-model.number="m.amount" title="amount" @input="syncMappings(c)" />
              <input type="range" min="0" max="0.98" step="0.02" :value="m.smooth ?? 0" title="smoothing" @input="m.smooth = +$event.target.value; syncMappings(c)" />
              <button class="mini" title="Remove" @click="removeMapping(c, mi)">×</button>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="waiting">waiting for the mix…</div>
    </div>
  </div>
</template>

<style scoped>
.autopilot { position: fixed; inset: 0; background: #05060a; z-index: 2000; overflow: hidden; }
.scene {
  position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s ease;
  pointer-events: none; isolation: isolate; background: #05060a;
}
.scene.top.visible { opacity: 1; pointer-events: auto; z-index: 1; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
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
  position: absolute; top: 52px; right: 10px; bottom: 60px; width: 290px; z-index: 20;
  overflow-y: auto; padding: 10px; border-radius: 10px;
  background: rgba(16, 18, 26, 0.92); border: 1px solid rgba(255, 255, 255, 0.12);
  display: flex; flex-direction: column; gap: 6px;
}
.layer-sec { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; overflow: hidden; }
.sec-head {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  padding: 6px 10px; background: rgba(255, 255, 255, 0.06); border: 0; cursor: pointer;
  font: 600 12px system-ui, sans-serif; color: #e8ecf5;
}
.sec-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.drawer label { display: flex; flex-direction: column; gap: 2px; font: 11px system-ui, sans-serif; color: #cdd3e0; }
.drawer .chk { flex-direction: row; align-items: center; gap: 6px; }
.drawer select { background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; font-size: 11px; }
.drawer input[type=range] { width: 100%; }
.map-head { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; }
.map-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 3px; align-items: center; font-size: 10px; color: #cdd3e0; }
.map-row input[type=range] { grid-column: 1 / -1; }
.mini { width: 18px; height: 18px; border-radius: 3px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 12px; line-height: 1; }
.waiting { font: 12px system-ui, sans-serif; color: #9aa4c0; }
</style>
