<script setup>
/**
 * Mixer — blend multiple effects into one composite. Each layer is a sketch
 * (or external project) stacked as an iframe with a CSS blend mode + opacity,
 * so effects combine (screen/lighten to add light, multiply/difference to have
 * one effect "process" another). Layers, blends, and opacities persist.
 *
 * Each layer keeps its own runtime, so its params/input-mappings still drive it
 * — the composite is therefore input-reactive through its layers.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSketchStore } from '../stores/sketches'
import { useViewerStore, QUALITY_OPTIONS } from '../stores/viewer'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
// Single source of truth for mapping sources (audio/mouse/tilt/midi/leap/artnet).
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'

const store = useSketchStore()
const viewer = useViewerStore()

const options = computed(() => store.sketches.filter((s) => s.embed && s.url))
const BLENDS = [
  'normal', 'screen', 'add', 'lighten', 'darken', 'multiply',
  'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]

const STORE_KEY = 'sketchbook-mixer'
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    return null
  }
}

const layers = ref(
  load() ?? [
    { slug: 'plasma-shader', blend: 'normal', opacity: 1, on: true },
    { slug: 'interference-rings', blend: 'screen', opacity: 0.85, on: true },
  ],
)
watch(layers, () => localStorage.setItem(STORE_KEY, JSON.stringify(layers.value)), { deep: true })

const showPanel = ref(true)
const stage = ref(null)

// Which layer receives the mouse. Layers are normally pointer-transparent so
// the stage is a pure output; selecting one lets you play with that sketch's
// own interactions (drag/zoom/click) — and its mouse.x/y mappings — live in
// the mix. Not persisted: interaction is a performance choice, not a patch.
const interactLayer = ref(null)
function toggleInteract(layer) {
  interactLayer.value = interactLayer.value === layer ? null : layer
}

// 'add' isn't a CSS blend mode — it maps to plus-lighter.
function cssBlend(b) {
  return b === 'add' ? 'plus-lighter' : b
}
function srcFor(slug) {
  const s = store.bySlug(slug)
  if (!s) return ''
  if (s.type !== 'local') return s.url
  const q = viewer.quality !== 'native' ? `&quality=${viewer.quality}` : ''
  // preview=1 hides each layer's overlay chrome; capture=1 makes WebGL layers'
  // buffers readable so a Motion Extraction layer can ingest the stack below it.
  return `${s.url}?preview=1&capture=1${q}`
}
function title(slug) {
  return store.bySlug(slug)?.title ?? slug
}

function addLayer() {
  layers.value.push({ slug: options.value[0]?.slug, blend: 'screen', opacity: 0.8, zoom: 1, on: true })
}
function removeLayer(i) {
  layers.value.splice(i, 1)
}
function move(i, d) {
  const j = i + d
  if (j < 0 || j >= layers.value.length) return
  const [x] = layers.value.splice(i, 1)
  layers.value.splice(j, 0, x)
}
// Toggle rather than enter-only: mobile has no Esc key, so an enter-only
// button strands the user in fullscreen with no way back.
const isFullscreen = ref(false)
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function fullscreen() {
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
  else (stage.value?.requestFullscreen || stage.value?.webkitRequestFullscreen)?.call(stage.value)
}
function onFsChange() {
  isFullscreen.value = !!fsElement()
}

// --- Motion Extraction feed ----------------------------------------------
// A Motion Extraction layer processes the layers stacked below it: each frame
// we composite those below (same-origin local canvases, with their blend +
// opacity) into an offscreen canvas and stream it into that layer's iframe,
// which uses it as its source in place of the webcam. Cross-origin (external)
// layers can't be read, so they're skipped — same limit as Patch.
const layerEls = new Map() // layer object -> iframe element
function bindLayerEl(layer, el) {
  if (el) layerEls.set(layer, el)
  else layerEls.delete(layer)
}

const feeds = new Map() // layer object -> { canvas, ctx }
function feedFor(layer) {
  let f = feeds.get(layer)
  if (!f) {
    const canvas = new OffscreenCanvas(480, 270)
    f = { canvas, ctx: canvas.getContext('2d') }
    feeds.set(layer, f)
  }
  return f
}
// Blend name -> canvas 2D composite op ('add' is additive 'lighter').
function canvasBlend(b) {
  if (b === 'add') return 'lighter'
  if (b === 'normal') return 'source-over'
  return b
}
function coverDraw(ctx, src, sw, sh, W, H) {
  const scale = Math.max(W / sw, H / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h)
}

// --- audio reactivity ------------------------------------------------------
// Layers run in preview mode (no per-layer mic button), so the Mixer runs ONE
// beat engine and feeds its state into every layer each frame; each layer's
// input mappings (audio.pulse → param, etc.) then react exactly as they do in
// the solo viewer. The pulse button fires a manual beat (no mic needed).
const beat = createBeatDetector()
const micOn = ref(false)
const micError = ref('')
let pendingBeat = false
let pendingEnergy = 1
beat.onBeat(({ energy }) => {
  pendingBeat = true
  pendingEnergy = energy
})
async function toggleMic() {
  micError.value = ''
  if (micOn.value) {
    beat.stop()
    micOn.value = false
    return
  }
  try {
    await beat.start()
    micOn.value = true
  } catch {
    micError.value = 'Microphone unavailable — use the pulse button instead.'
  }
}
function pulse() {
  beat.trigger()
  pendingBeat = true
  pendingEnergy = 1
}

// --- per-layer parameter & mapping controls --------------------------------
// Each local layer's runtime announces { schema, values, mappings } on load;
// edits post straight back into that iframe (sketch:set-param/set-mappings) —
// the exact protocol the solo viewer uses.
const layerControls = reactive(new Map()) // layer object -> { schema, values, mappings }
const openControls = reactive(new Map()) // layer object -> bool
function onMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  for (const [layer, el] of layerEls) {
    if (el.contentWindow === e.source) {
      layerControls.set(layer, {
        schema: e.data.schema,
        values: { ...e.data.values },
        mappings: (e.data.mappings ?? []).map((m) => ({ ...m })),
      })
      break
    }
  }
}
function postToLayer(layer, msg) {
  layerEls.get(layer)?.contentWindow?.postMessage(msg, '*')
}
function setLayerParam(layer, name, value) {
  const c = layerControls.get(layer)
  if (c) c.values[name] = value
  postToLayer(layer, { type: 'sketch:set-param', name, value })
}
function syncLayerMappings(layer) {
  const c = layerControls.get(layer)
  if (c) postToLayer(layer, { type: 'sketch:set-mappings', mappings: c.mappings })
}
function addLayerMapping(layer) {
  const c = layerControls.get(layer)
  if (!c) return
  const firstNumeric = Object.keys(c.schema).find((k) => typeof c.schema[k].min === 'number')
  if (!firstNumeric) return
  c.mappings.push({ source: 'audio.pulse', param: firstNumeric, amount: 0.5, smooth: 0.6 })
  syncLayerMappings(layer)
}
function removeLayerMapping(layer, i) {
  const c = layerControls.get(layer)
  if (!c) return
  c.mappings.splice(i, 1)
  syncLayerMappings(layer)
}
function numericParamsOf(layer) {
  const c = layerControls.get(layer)
  return c ? Object.keys(c.schema).filter((k) => typeof c.schema[k].min === 'number') : []
}

let raf = 0
function captureLoop(ts) {
  beat.update(ts)
  // Feed beat state to every live layer (pulse is derived per-layer from the
  // beat flag, so it is not sent).
  const bs = beat.state
  const beatMsg = {
    type: 'input:beat',
    state: {
      level: bs.level, low: bs.low, mid: bs.mid, high: bs.high, volume: bs.volume,
      centroid: bs.centroid, flux: bs.flux, interval: bs.interval, bpm: bs.bpm,
    },
    beat: pendingBeat,
    energy: pendingEnergy,
  }
  pendingBeat = false
  for (const el of layerEls.values()) el.contentWindow?.postMessage(beatMsg, '*')

  const L = layers.value
  for (let i = 0; i < L.length; i++) {
    const lay = L[i]
    if (!lay.on || lay.slug !== 'motion-extraction') continue
    const el = layerEls.get(lay)
    if (!el?.contentWindow) continue

    const { canvas, ctx } = feedFor(lay)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    let drew = false
    let first = true
    for (let j = 0; j < i; j++) {
      const below = L[j]
      if (!below.on || !below.slug) continue
      let cv = null
      try {
        cv = layerEls.get(below)?.contentDocument?.querySelector('canvas')
      } catch {
        cv = null // cross-origin layer — can't capture
      }
      if (!cv || !cv.width) continue
      ctx.globalAlpha = below.opacity ?? 1
      ctx.globalCompositeOperation = first ? 'source-over' : canvasBlend(below.blend)
      coverDraw(ctx, cv, cv.width, cv.height, canvas.width, canvas.height)
      first = false
      drew = true
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    if (drew) {
      const bmp = canvas.transferToImageBitmap()
      el.contentWindow.postMessage({ type: 'mixer:frame', bitmap: bmp }, '*', [bmp])
    }
  }
  raf = requestAnimationFrame(captureLoop)
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  raf = requestAnimationFrame(captureLoop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('message', onMessage)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  beat.stop()
})
</script>

<template>
  <div class="mixer">
    <div ref="stage" class="stage">
      <template v-for="(layer, i) in layers" :key="`${i}-${layer.slug}`">
        <iframe
          v-if="layer.on && layer.slug"
          :ref="(el) => bindLayerEl(layer, el)"
          :src="srcFor(layer.slug)"
          class="layer"
          :style="{
            zIndex: i,
            opacity: layer.opacity,
            mixBlendMode: cssBlend(layer.blend),
            transform: `scale(${layer.zoom ?? 1})`,
            pointerEvents: interactLayer === layer ? 'auto' : 'none',
          }"
          allow="fullscreen; microphone; camera; midi; accelerometer; gyroscope; xr-spatial-tracking"
        />
      </template>
      <v-empty-state
        v-if="!layers.some((l) => l.on && l.slug)"
        class="stage-empty"
        icon="mdi-layers-off"
        title="No layers"
        text="Add a layer in the panel to start mixing."
      />
    </div>

    <!-- top controls -->
    <div class="topbar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" title="Back to gallery" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-auto">Mixer</span>
      <v-btn
        :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
        variant="text"
        size="small"
        :color="micOn ? 'primary' : undefined"
        :title="micOn ? 'Mic on — layers react to sound' : 'Enable mic — feed music into every layer'"
        @click="toggleMic"
      />
      <v-btn
        icon="mdi-heart-pulse"
        variant="text"
        size="small"
        title="Fire a manual beat into all layers"
        @click="pulse"
      />
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-quality-high" variant="text" size="small" title="Quality" />
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="opt in QUALITY_OPTIONS"
            :key="opt.value"
            :title="opt.title"
            :active="viewer.quality === opt.value"
            @click="viewer.update({ quality: opt.value })"
          />
        </v-list>
      </v-menu>
      <v-btn icon="mdi-tune-variant" variant="text" size="small" title="Toggle layers panel" :color="showPanel ? 'primary' : undefined" @click="showPanel = !showPanel" />
      <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" variant="text" size="small" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="fullscreen" />
    </div>

    <!-- layer panel -->
    <v-card v-if="showPanel" class="panel pa-3" variant="outlined">
      <div class="d-flex align-center mb-2">
        <h2 class="text-subtitle-2 mr-auto">Layers</h2>
        <v-btn icon="mdi-plus" size="x-small" variant="tonal" title="Add layer" @click="addLayer" />
      </div>
      <p class="text-caption text-medium-emphasis mb-3">
        Top of the list is the back layer; each row below stacks in front of it.
        Screen/lighten/add combine light; multiply/difference let a layer process
        the one behind it. Enable the mic 🎤 in the top bar and every layer's
        beat mappings react to the music.
      </p>
      <v-alert v-if="micError" type="warning" density="compact" variant="tonal" class="mb-3 text-caption">
        {{ micError }}
      </v-alert>

      <v-card v-for="(layer, i) in layers" :key="i" variant="tonal" class="pa-2 mb-2">
        <div class="d-flex align-center ga-1 mb-1">
          <v-btn
            :icon="layer.on ? 'mdi-eye' : 'mdi-eye-off'"
            size="x-small"
            variant="text"
            :title="layer.on ? 'Hide layer' : 'Show layer'"
            @click="layer.on = !layer.on"
          />
          <v-select
            v-model="layer.slug"
            :items="options"
            item-title="title"
            item-value="slug"
            density="compact"
            hide-details
            class="flex-grow-1"
          />
          <v-btn
            icon="mdi-cursor-default-click"
            size="x-small"
            variant="text"
            :color="interactLayer === layer ? 'primary' : undefined"
            :title="interactLayer === layer ? 'Stop interacting with this layer' : 'Interact with this layer (mouse goes to it)'"
            @click="toggleInteract(layer)"
          />
          <v-btn
            v-if="layerControls.has(layer)"
            icon="mdi-knob"
            size="x-small"
            variant="text"
            :color="openControls.get(layer) ? 'primary' : undefined"
            title="Effect parameters & input mappings"
            @click="openControls.set(layer, !openControls.get(layer))"
          />
          <v-btn icon="mdi-chevron-up" size="x-small" variant="text" title="Move layer back" @click="move(i, -1)" />
          <v-btn icon="mdi-chevron-down" size="x-small" variant="text" title="Move layer forward" @click="move(i, 1)" />
          <v-btn icon="mdi-close" size="x-small" variant="text" title="Remove layer" @click="removeLayer(i)" />
        </div>
        <!-- Each control's label sits above a full-width input so blend,
             opacity, and zoom all line up at the same width. -->
        <div class="ctrl">
          <span class="ctrl-label">Blend</span>
          <v-select
            v-model="layer.blend"
            :items="BLENDS"
            density="compact"
            hide-details
          />
        </div>
        <div class="ctrl">
          <span class="ctrl-label">Opacity</span>
          <v-slider
            v-model="layer.opacity"
            :min="0"
            :max="1"
            :step="0.01"
            density="compact"
            hide-details
          />
        </div>
        <div class="ctrl">
          <div class="d-flex align-center">
            <span class="ctrl-label mr-auto">Zoom</span>
            <v-btn
              v-if="(layer.zoom ?? 1) !== 1"
              icon="mdi-backup-restore"
              size="x-small"
              variant="text"
              title="Reset zoom"
              @click="layer.zoom = 1"
            />
          </div>
          <v-slider
            :model-value="layer.zoom ?? 1"
            :min="0.5"
            :max="3"
            :step="0.05"
            density="compact"
            hide-details
            @update:model-value="layer.zoom = $event"
          />
        </div>

        <!-- effect params + input mappings, driven over the same postMessage
             protocol the solo viewer uses -->
        <template v-if="openControls.get(layer) && layerControls.get(layer)">
          <v-divider class="my-2" />
          <div
            v-for="(spec, name) in layerControls.get(layer).schema"
            :key="name"
            class="ctrl"
          >
            <v-switch
              v-if="spec.type === 'bool'"
              :model-value="layerControls.get(layer).values[name]"
              :label="spec.label ?? name"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="(v) => setLayerParam(layer, name, v)"
            />
            <template v-else-if="spec.type === 'select'">
              <span class="ctrl-label">{{ spec.label ?? name }}</span>
              <v-select
                :model-value="layerControls.get(layer).values[name]"
                :items="spec.options"
                density="compact"
                hide-details
                @update:model-value="(v) => setLayerParam(layer, name, v)"
              />
            </template>
            <template v-else>
              <span class="ctrl-label">{{ spec.label ?? name }}</span>
              <v-slider
                :model-value="layerControls.get(layer).values[name]"
                :min="spec.min"
                :max="spec.max"
                :step="spec.step ?? 0.01"
                density="compact"
                hide-details
                thumb-label
                @update:model-value="(v) => setLayerParam(layer, name, v)"
              />
            </template>
          </div>

          <div class="d-flex align-center mt-2 mb-1">
            <span class="ctrl-label mr-auto mb-0">Input mappings</span>
            <v-btn
              icon="mdi-plus"
              size="x-small"
              variant="tonal"
              title="Add input mapping"
              @click="addLayerMapping(layer)"
            />
          </div>
          <div
            v-for="(m, mi) in layerControls.get(layer).mappings"
            :key="mi"
            class="mb-2"
          >
            <div class="d-flex ga-1 align-center">
              <v-select
                v-model="m.source"
                :items="INPUT_SOURCES"
                density="compact"
                hide-details
                @update:model-value="syncLayerMappings(layer)"
              />
              <v-icon icon="mdi-arrow-right" size="x-small" />
              <v-select
                v-model="m.param"
                :items="numericParamsOf(layer)"
                density="compact"
                hide-details
                @update:model-value="syncLayerMappings(layer)"
              />
              <v-btn
                icon="mdi-close"
                size="x-small"
                variant="text"
                title="Remove mapping"
                @click="removeLayerMapping(layer, mi)"
              />
            </div>
            <div class="d-flex ga-2">
              <v-slider
                v-model="m.amount"
                :min="-1"
                :max="1"
                :step="0.05"
                density="compact"
                hide-details
                label="amt"
                @update:model-value="syncLayerMappings(layer)"
              />
              <v-slider
                :model-value="m.smooth ?? 0"
                :min="0"
                :max="0.98"
                :step="0.02"
                density="compact"
                hide-details
                label="smooth"
                @update:model-value="(v) => { m.smooth = v; syncLayerMappings(layer) }"
              />
            </div>
          </div>
        </template>
      </v-card>
    </v-card>
  </div>
</template>

<style scoped>
.mixer {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 2000;
}
.stage {
  position: absolute;
  inset: 0;
  background: #000;
  isolation: isolate; /* contain blend modes to the stage */
  overflow: hidden; /* clip zoomed-in (scaled) layers to the stage */
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none; /* the stage is a composite output */
}
.stage-empty {
  position: relative;
  z-index: 100;
  height: 100%;
}
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
}
.panel {
  position: absolute;
  top: 52px;
  right: 12px;
  bottom: 12px;
  z-index: 200;
  width: 320px;
  overflow-y: auto;
  background: rgba(16, 18, 24, 0.92) !important;
}
.ctrl {
  margin-top: 6px;
}
.ctrl-label {
  display: block;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 2px;
}
</style>
