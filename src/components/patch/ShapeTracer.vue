<script setup>
/**
 * ShapeTracer — take (or upload) a picture and auto-trace its prominent shapes
 * into simple polygons you can drop in as Polygon matte nodes. The image never
 * leaves the browser: it's drawn to a small offscreen canvas and run through the
 * pure tracer in ../../lib/patch/traceShapes.js. Detected shapes are shown over
 * the photo; tap to keep/drop each, then Apply hands the chosen ones to the host.
 */
import { ref, reactive, computed, onBeforeUnmount, nextTick } from 'vue'
import { extractShapes } from '../../lib/patch/traceShapes.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 'add' → host makes a Polygon node per shape; 'fill' → replace one node's points
  mode: { type: String, default: 'add' },
})
const emit = defineEmits(['update:modelValue', 'apply'])

const WORK = 260 // longest side we trace at — plenty for silhouettes, stays fast
const fileInput = ref(null)
const video = ref(null)
const srcCanvas = document.createElement('canvas') // working-res copy of the photo
let stream = null
const cameraOn = ref(false)
const hasImage = ref(false)
const shapes = ref([])          // [{ points:[[x,y]…], area }]
const chosen = reactive(new Set())
const busy = ref(false)
const err = ref('')

const opts = reactive({ invert: false, smoothing: 1, maxShapes: 6 })
// A palette so each candidate reads as its own shape.
const HUES = [18, 200, 140, 320, 50, 265]
const colorAt = (i) => `hsl(${HUES[i % HUES.length]} 90% 60%)`

function close() { stopCamera(); emit('update:modelValue', false) }

// --- image intake ----------------------------------------------------------
function drawToWork(src, w, h) {
  const scale = Math.min(1, WORK / Math.max(w, h))
  srcCanvas.width = Math.max(1, Math.round(w * scale))
  srcCanvas.height = Math.max(1, Math.round(h * scale))
  srcCanvas.getContext('2d').drawImage(src, 0, 0, srcCanvas.width, srcCanvas.height)
  hasImage.value = true
  rescan()
}
function onFile(e) {
  const file = e.target.files?.[0]; if (!file) return
  err.value = ''
  const img = new Image()
  img.onload = () => { drawToWork(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(img.src) }
  img.onerror = () => { err.value = 'Could not read that image.'; URL.revokeObjectURL(img.src) }
  img.src = URL.createObjectURL(file)
  e.target.value = '' // allow re-picking the same file
}
async function startCamera() {
  err.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    cameraOn.value = true
    await nextTick()
    if (video.value) { video.value.srcObject = stream; await video.value.play().catch(() => {}) }
  } catch { err.value = 'Camera unavailable — check permissions, or upload a photo.'; cameraOn.value = false }
}
function stopCamera() {
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null }
  cameraOn.value = false
}
function snap() {
  const v = video.value; if (!v || !v.videoWidth) return
  drawToWork(v, v.videoWidth, v.videoHeight)
  stopCamera()
}

// --- tracing ---------------------------------------------------------------
function rescan() {
  if (!hasImage.value) return
  busy.value = true
  try {
    const ctx = srcCanvas.getContext('2d')
    const data = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
    shapes.value = extractShapes(data, { invert: opts.invert, smoothing: opts.smoothing, maxShapes: opts.maxShapes })
    chosen.clear()
    shapes.value.forEach((_, i) => chosen.add(i)) // keep everything by default
  } finally { busy.value = false }
}
function toggle(i) { chosen.has(i) ? chosen.delete(i) : chosen.add(i) }
const previewSrc = computed(() => (hasImage.value ? srcCanvas.toDataURL('image/png') : ''))
const pointsAttr = (pts) => pts.map((p) => `${(p[0] * 100).toFixed(2)},${(p[1] * 100).toFixed(2)}`).join(' ')
const chosenCount = computed(() => chosen.size)

function apply() {
  const picks = shapes.value.filter((_, i) => chosen.has(i)).map((s) => ({ points: s.points.map((p) => [...p]) }))
  if (!picks.length) return
  emit('apply', props.mode === 'fill' ? picks.slice(0, 1) : picks)
  close()
}

onBeforeUnmount(stopCamera)
</script>

<template>
  <div v-if="modelValue" class="st-backdrop" @pointerdown.self="close">
    <div class="st" @pointerdown.stop>
      <div class="st-head">
        <v-icon icon="mdi-shape-plus" size="18" class="mr-2" />
        <span class="st-title">Trace shapes from a photo</span>
        <span class="st-spacer" />
        <v-btn icon="mdi-close" size="x-small" variant="text" @click="close" />
      </div>

      <div class="st-body">
        <!-- stage: camera preview, or the photo with detected polygons over it -->
        <div class="st-stage">
          <template v-if="cameraOn">
            <video ref="video" class="st-media" playsinline muted />
            <button class="st-snap" @click="snap"><v-icon icon="mdi-camera-iris" size="20" /> Snap</button>
          </template>
          <template v-else-if="hasImage">
            <img class="st-media" :src="previewSrc" alt="source photo" />
            <svg class="st-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon
                v-for="(s, i) in shapes" :key="i"
                :points="pointsAttr(s.points)"
                :class="{ off: !chosen.has(i) }"
                :style="{ '--c': colorAt(i) }"
                @click="toggle(i)"
              />
            </svg>
            <div v-if="!shapes.length && !busy" class="st-none">No clear shapes found — try Invert, or a photo with a bolder subject on a plainer background.</div>
          </template>
          <div v-else class="st-empty">
            <v-icon icon="mdi-image-search-outline" size="40" />
            <p>Take or upload a photo. Bold shapes on a plain background trace best.</p>
          </div>
        </div>

        <!-- controls -->
        <div class="st-side">
          <div class="st-sources">
            <v-btn size="small" variant="tonal" prepend-icon="mdi-upload" @click="fileInput.click()">Upload</v-btn>
            <v-btn v-if="!cameraOn" size="small" variant="tonal" prepend-icon="mdi-camera" @click="startCamera">Camera</v-btn>
            <v-btn v-else size="small" variant="tonal" prepend-icon="mdi-camera-off" @click="stopCamera">Stop</v-btn>
            <input ref="fileInput" type="file" accept="image/*" capture="environment" hidden @change="onFile" />
          </div>

          <template v-if="hasImage && !cameraOn">
            <label class="st-row"><input type="checkbox" v-model="opts.invert" @change="rescan" /> Invert (subject ↔ background)</label>
            <div class="st-row">Simplify — fewer corners
              <v-slider v-model="opts.smoothing" :min="0.4" :max="3" :step="0.1" hide-details density="compact" @update:model-value="rescan" />
            </div>
            <div class="st-row">Max shapes: {{ opts.maxShapes }}
              <v-slider v-model="opts.maxShapes" :min="1" :max="12" :step="1" hide-details density="compact" @update:model-value="rescan" />
            </div>
            <p class="st-hint">Found {{ shapes.length }} shape{{ shapes.length === 1 ? '' : 's' }} — tap one on the photo to keep or drop it.</p>
          </template>
          <p v-if="err" class="st-err">{{ err }}</p>

          <span class="st-grow" />
          <v-btn block color="primary" :disabled="!chosenCount" prepend-icon="mdi-vector-polygon" @click="apply">
            {{ mode === 'fill' ? 'Use this shape' : `Add ${chosenCount} polygon${chosenCount === 1 ? '' : 's'}` }}
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.st-backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(2px); }
.st { width: min(880px, 94vw); max-height: 92vh; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; background: rgba(14, 16, 22, 0.98); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); color: #cdd3e0; font: 13px system-ui, sans-serif; }
.st-head { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.st-title { font-weight: 600; color: #e8ecf5; }
.st-spacer { flex: 1; }
.st-body { display: flex; gap: 12px; padding: 12px; min-height: 0; }
.st-stage { position: relative; flex: 1; min-width: 0; aspect-ratio: 4 / 3; display: grid; place-items: center; background: #0a0b0f; border: 1px solid #262b38; border-radius: 8px; overflow: hidden; }
.st-media { max-width: 100%; max-height: 56vh; display: block; }
.st-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.st-overlay polygon { fill: color-mix(in srgb, var(--c) 30%, transparent); stroke: var(--c); stroke-width: 0.6; vector-effect: non-scaling-stroke; cursor: pointer; transition: fill 0.12s; }
.st-overlay polygon.off { fill: transparent; stroke-dasharray: 2 2; opacity: 0.5; }
.st-snap { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 0; border-radius: 999px; background: #fff; color: #111; font: 600 13px system-ui; cursor: pointer; }
.st-empty, .st-none { color: #8a90a0; text-align: center; padding: 20px; line-height: 1.5; }
.st-none { position: absolute; bottom: 8px; left: 8px; right: 8px; padding: 8px; font-size: 11px; background: rgba(0, 0, 0, 0.5); border-radius: 6px; }
.st-empty p { margin: 10px 0 0; max-width: 260px; }
.st-side { width: 240px; display: flex; flex-direction: column; gap: 10px; }
.st-sources { display: flex; gap: 6px; }
.st-row { display: block; font: 12px system-ui; color: #9aa4c0; }
.st-row input[type=checkbox] { vertical-align: middle; margin-right: 4px; }
.st-hint { font: 11px system-ui; color: #8a90a0; line-height: 1.4; margin: 0; }
.st-err { font: 12px system-ui; color: #ff8a6a; margin: 0; }
.st-grow { flex: 1; }
@media (max-width: 680px) {
  .st-body { flex-direction: column; }
  .st-side { width: auto; }
}
</style>
