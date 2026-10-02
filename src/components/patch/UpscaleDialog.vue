<script setup>
/**
 * UpscaleDialog — the "AI upscale" step of the media ingest wizard. Pick images (files, or ones
 * already in the media library), pick a model, and each is enlarged 2-4x by a neural
 * super-resolution model running in a Web Worker (../../lib/upscale/). Every finished image is
 * handed to the host as a PNG File through `result`; the host adds it to the library and a Media
 * node. Images only: running a model per video frame is far too slow.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { MODELS, modelById, upscaleImage, imageSize, TILE, OVERLAP } from '../../lib/upscale/neural.js'
import { planTiles, checkOutput } from '../../lib/upscale/tiles.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  library: { type: Array, default: () => [] }, // media library items ({ id, name, kind, url, thumb })
})
const emit = defineEmits(['update:modelValue', 'result'])

const model = ref('fast')
const items = ref([]) // { key, name, blob, thumb, width, height, state: 'ready'|'working'|'done'|'error', error, outUrl, outSize }
const running = ref(false)
const status = ref(null) // latest onStatus payload
const note = ref('')
let abort = null
let startedAt = 0
let seq = 0
const fileInput = ref(null)

const m = computed(() => modelById(model.value))
const libraryImages = computed(() => props.library.filter((x) => x.kind === 'image'))

function close() {
  cancel()
  emit('update:modelValue', false)
}
function cancel() { abort?.abort() }
onBeforeUnmount(cancel)
watch(() => props.modelValue, (open) => { if (!open) cancel() })

async function addBlob(blob, name) {
  try {
    const { width, height } = await imageSize(blob)
    items.value.push({ key: ++seq, name, blob, thumb: URL.createObjectURL(blob), width, height, state: 'ready', error: '' })
  } catch {
    note.value = `Could not read “${name}” as an image.`
  }
}
async function onFiles(e) {
  note.value = ''
  for (const f of e.target.files) if (f.type.startsWith('image/')) await addBlob(f, f.name)
  e.target.value = ''
}
async function addLibrary(it) {
  note.value = ''
  try { await addBlob(await (await fetch(it.url)).blob(), it.name) }
  catch { note.value = 'Could not read that library image.' }
}
function removeItem(it) {
  URL.revokeObjectURL(it.thumb)
  if (it.outUrl) URL.revokeObjectURL(it.outUrl)
  items.value = items.value.filter((x) => x !== it)
}
function clearItems() { for (const it of [...items.value]) removeItem(it) }
watch(() => props.modelValue, (open) => { if (!open) clearItems() })

// What running this image with the chosen model would produce.
function plan(it) {
  const c = checkOutput(it.width, it.height, m.value.scale)
  return { ...c, tiles: planTiles(it.width, it.height, { tile: TILE, overlap: OVERLAP }).length }
}
const totalTiles = computed(() => items.value.filter((i) => i.state === 'ready' && plan(i).ok).reduce((n, i) => n + plan(i).tiles, 0))
const runnable = computed(() => items.value.some((i) => i.state === 'ready' && plan(i).ok))

const fmtTime = (ms) => {
  if (ms == null) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? (s % 60) + ' s' : ''}`.trim()
}
const progress = computed(() => {
  const s = status.value
  if (!s) return { label: '', value: null }
  if (s.phase === 'load') {
    const p = s.loadProgress
    return { label: p == null || p === 0 ? 'Loading the model…' : `Downloading the model… ${Math.round(p)}%`, value: p ? Math.round(p) : null }
  }
  if (s.phase === 'finish') return { label: 'Encoding the result…', value: 100 }
  const eta = s.etaMs != null ? ` · about ${fmtTime(s.etaMs)} left` : ''
  return { label: `Tile ${Math.min(s.tilesDone + 1, s.tilesTotal)} of ${s.tilesTotal}${eta}`, value: Math.round((s.tilesDone / Math.max(1, s.tilesTotal)) * 100) }
})
const deviceLabel = computed(() => (status.value?.device === 'webgpu' ? 'GPU (WebGPU)' : status.value ? 'CPU (WASM): slow' : ''))

async function run() {
  if (running.value) return
  running.value = true
  note.value = ''
  abort = new AbortController()
  startedAt = performance.now()
  for (const it of items.value) {
    if (it.state !== 'ready' || !plan(it).ok) continue
    it.state = 'working'
    try {
      const res = await upscaleImage(it.blob, { model: model.value, signal: abort.signal, onStatus: (s) => { status.value = s } })
      const base = it.name.replace(/\.[^.]+$/, '')
      const file = new File([res.blob], `${base}-x${m.value.scale}.png`, { type: 'image/png' })
      it.state = 'done'
      it.outSize = `${res.width} × ${res.height}`
      it.outUrl = URL.createObjectURL(res.blob)
      emit('result', file)
    } catch (e) {
      if (e?.name === 'AbortError') { it.state = 'ready'; note.value = 'Cancelled.'; break }
      it.state = 'error'
      it.error = e?.message || 'Upscaling failed'
      if (/fetch|network|Failed to load|Load failed/i.test(it.error)) note.value = 'The model could not be downloaded. The upscaler needs an internet connection the first time.'
    }
  }
  running.value = false
  status.value = null
  abort = null
}
</script>

<template>
  <div v-if="modelValue" class="up-backdrop" @pointerdown.self="close">
    <div class="up" @pointerdown.stop>
      <div class="up-head">
        <v-icon icon="mdi-image-auto-adjust" size="18" class="mr-2" />
        <span class="up-title">AI upscale</span>
        <span class="up-spacer" />
        <v-btn icon="mdi-close" size="x-small" variant="text" @click="close" />
      </div>

      <div class="up-body">
        <div class="up-label">Model</div>
        <div class="up-models">
          <button v-for="mod in MODELS" :key="mod.id" class="up-model" :class="{ on: model === mod.id }" :disabled="running" @click="model = mod.id">
            <b>{{ mod.label }}</b><small>{{ mod.note }}</small><small class="dim">{{ mod.size }} download</small>
          </button>
        </div>

        <div class="up-label">Images</div>
        <div class="up-add">
          <button class="up-btn" :disabled="running" @click="fileInput.click()"><v-icon icon="mdi-file-image-outline" size="16" /> Add files…</button>
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />
          <span v-if="libraryImages.length" class="up-hint">or from your library:</span>
          <div v-if="libraryImages.length" class="up-lib">
            <button v-for="l in libraryImages" :key="l.id" class="up-libthumb" :disabled="running" :title="l.name" @click="addLibrary(l)">
              <img :src="l.thumb || l.url" :alt="l.name" />
            </button>
          </div>
        </div>

        <div v-if="items.length" class="up-list">
          <div v-for="it in items" :key="it.key" class="up-item" :class="it.state">
            <img :src="it.outUrl || it.thumb" class="up-thumb" :alt="it.name" />
            <div class="up-meta">
              <div class="up-name">{{ it.name }}</div>
              <div class="up-sub">
                <template v-if="it.state === 'done'">{{ it.width }} × {{ it.height }} → {{ it.outSize }} · added to library</template>
                <template v-else-if="it.state === 'error'">{{ it.error }}</template>
                <template v-else-if="!plan(it).ok">{{ plan(it).reason }}</template>
                <template v-else>{{ it.width }} × {{ it.height }} → {{ plan(it).width }} × {{ plan(it).height }} · {{ plan(it).tiles }} tile{{ plan(it).tiles === 1 ? '' : 's' }}</template>
              </div>
            </div>
            <v-btn v-if="!running" icon="mdi-close" size="x-small" variant="text" @click="removeItem(it)" />
          </div>
        </div>

        <div v-if="running && progress.label" class="up-progress">
          <div class="up-bar"><div class="up-fill" :class="{ indet: progress.value == null }" :style="{ width: (progress.value ?? 100) + '%' }" /></div>
          <div class="up-sub">{{ progress.label }}<span v-if="deviceLabel"> · {{ deviceLabel }}</span></div>
        </div>
        <div v-if="note" class="up-note">{{ note }}</div>
      </div>

      <div class="up-foot">
        <div class="up-fine">Images only: running a neural model per video frame is too slow. The model downloads from Hugging Face the first time and is cached after that. It runs on your GPU where the browser allows it; otherwise on the CPU, which can take minutes for a large image.</div>
        <div class="up-actions">
          <v-btn v-if="running" size="small" variant="tonal" @click="cancel">Cancel</v-btn>
          <v-btn v-else size="small" color="primary" :disabled="!runnable" @click="run">
            Upscale<span v-if="totalTiles"> · {{ totalTiles }} tile{{ totalTiles === 1 ? '' : 's' }}</span>
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.up-backdrop { position: fixed; inset: 0; z-index: 4100; background: rgba(5,6,10,0.6); display: flex; align-items: center; justify-content: center; }
.up { width: min(620px, 94vw); max-height: 90vh; display: flex; flex-direction: column; background: #14161e; border: 1px solid #2a2f40; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); overflow: hidden; color: #cdd3e6; }
.up-head { display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.up-title { font-weight: 600; font-size: 0.9rem; }
.up-spacer { flex: 1; }
.up-body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.up-label { font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: #8a90a0; }
.up-models { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
.up-model { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px; border-radius: 10px; cursor: pointer; color: inherit; background: #1a1d28; border: 1px solid #2a2f40; }
.up-model:hover:not(:disabled) { border-color: #7c8cff; }
.up-model.on { border-color: #7c8cff; background: rgba(124,140,255,0.12); }
.up-model b { font-size: 0.8rem; }
.up-model small { font-size: 0.66rem; color: #aab0c4; }
.up-model small.dim { color: #737b93; }
.up-add { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.up-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; cursor: pointer; color: inherit; background: #1a1d28; border: 1px solid #2a2f40; font-size: 0.78rem; }
.up-btn:hover:not(:disabled) { border-color: #7c8cff; }
.up-hint { font-size: 0.7rem; color: #8a90a0; }
.up-lib { display: flex; gap: 4px; flex-wrap: wrap; }
.up-libthumb { width: 38px; height: 38px; padding: 0; border-radius: 6px; overflow: hidden; cursor: pointer; background: #000; border: 1px solid #2a2f40; }
.up-libthumb:hover:not(:disabled) { border-color: #7c8cff; }
.up-libthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.up-list { display: flex; flex-direction: column; gap: 6px; }
.up-item { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 8px; background: #1a1d28; border: 1px solid #2a2f40; }
.up-item.done { border-color: rgba(96,200,130,0.5); }
.up-item.error { border-color: rgba(240,100,100,0.6); }
.up-item.working { border-color: #7c8cff; }
.up-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; background: #000; flex: none; }
.up-meta { flex: 1; min-width: 0; }
.up-name { font-size: 0.78rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-sub { font-size: 0.68rem; color: #8a90a0; }
.up-progress { display: flex; flex-direction: column; gap: 4px; }
.up-bar { height: 6px; border-radius: 3px; background: #1f2331; overflow: hidden; }
.up-fill { height: 100%; background: #7c8cff; transition: width 0.3s; }
.up-fill.indet { animation: up-pulse 1.1s ease-in-out infinite; opacity: 0.6; }
@keyframes up-pulse { 50% { opacity: 0.25; } }
.up-note { font-size: 0.72rem; color: #f0a860; }
.up-foot { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.07); }
.up-fine { flex: 1; font-size: 0.64rem; color: #737b93; line-height: 1.35; }
.up-actions { flex: none; }
</style>
