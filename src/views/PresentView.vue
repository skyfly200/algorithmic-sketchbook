<script setup>
/**
 * Display / projection mode: one sketch fullscreen with no gallery chrome,
 * plus live switching between effects. Built for VJ sets, installations, and
 * projection — keyboard driven, with an auto-hiding control bar and an
 * optional auto-advance timer.
 *
 * Route: /#/present            → starts on the first embeddable sketch
 *        /#/present/:slug       → starts on a specific one
 * Keys:  ← / →  switch effect   Space  play/pause auto-advance
 *        F      browser fullscreen      Esc exits (browser) / leaves mode
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useViewerStore, QUALITY_OPTIONS } from '../stores/viewer'

const route = useRoute()
const router = useRouter()
const store = useSketchStore()
const viewer = useViewerStore()

// Display mode can project two kinds of source: the built-in effects, or the
// Patch routings the user has saved. A selector switches between the two pools.
const source = ref('effects') // 'effects' | 'patches'
function loadSavedPatches() {
  try { return JSON.parse(localStorage.getItem('sketchbook-patch-saved')) || [] } catch { return [] }
}
const savedPatches = ref(loadSavedPatches())

const playlist = computed(() => {
  if (source.value === 'patches') {
    return savedPatches.value.map((p) => ({ kind: 'patch', id: p.id, title: p.name || 'Patch' }))
  }
  // Only effects we can actually embed can be projected.
  return store.sketches
    .filter((s) => s.embed && s.url)
    .map((s) => ({ kind: 'effect', slug: s.slug, title: s.title, url: s.url, standalone: s.standalone }))
})

const index = ref(0)
const stage = ref(null)
const isFullscreen = ref(false)
const controlsVisible = ref(true)
let hideTimer = null

const current = computed(() => playlist.value[index.value] ?? null)

const frameSrc = computed(() => {
  const c = current.value
  if (!c) return ''
  if (c.kind === 'patch') return `${import.meta.env.BASE_URL}#/patch?load=${encodeURIComponent(c.id)}&output=1`
  return c.standalone ? c.url : c.url + viewer.sketchParams
})

// Switching source pool restarts the playlist and re-reads saved patches.
function setSource(s) {
  if (s === source.value) return
  if (s === 'patches') savedPatches.value = loadSavedPatches()
  source.value = s
  index.value = 0
}

// --- switching ----------------------------------------------------------
function goTo(i) {
  const n = playlist.value.length
  if (!n) return
  index.value = ((i % n) + n) % n
  const slug = current.value?.kind === 'effect' ? current.value?.slug : null
  if (slug && route.params.slug !== slug) {
    router.replace({ name: 'present-slug', params: { slug } })
  }
}
const next = () => goTo(index.value + 1)
const prev = () => goTo(index.value - 1)

// --- auto-advance -------------------------------------------------------
const playing = ref(false)
const intervalSec = ref(15)
let advanceTimer = null

function restartAdvance() {
  clearInterval(advanceTimer)
  if (playing.value) advanceTimer = setInterval(next, intervalSec.value * 1000)
}
watch([playing, intervalSec], restartAdvance)

// --- fullscreen ---------------------------------------------------------
async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await stage.value?.requestFullscreen?.()
}
function onFsChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

// --- auto-hiding controls ----------------------------------------------
function revealControls() {
  controlsVisible.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (playing.value || isFullscreen.value) controlsVisible.value = false
  }, 2800)
}

function onKey(e) {
  switch (e.key) {
    case 'ArrowRight': next(); revealControls(); break
    case 'ArrowLeft': prev(); revealControls(); break
    case ' ': playing.value = !playing.value; revealControls(); e.preventDefault(); break
    case 'f': case 'F': toggleFullscreen(); break
  }
}

function leave() {
  if (document.fullscreenElement) document.exitFullscreen()
  router.push({ name: 'gallery' })
}

onMounted(() => {
  const startSlug = route.params.slug
  const found = playlist.value.findIndex((s) => s.slug === startSlug)
  index.value = found >= 0 ? found : 0
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  revealControls()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  clearInterval(advanceTimer)
  clearTimeout(hideTimer)
})
</script>

<template>
  <div
    ref="stage"
    class="present-stage"
    :class="{ 'cursor-hidden': !controlsVisible }"
    @mousemove="revealControls"
  >
    <transition name="fade" mode="default">
      <iframe
        v-if="current"
        :key="frameSrc"
        :src="frameSrc"
        class="present-frame"
        allow="fullscreen; microphone; camera; accelerometer; gyroscope; xr-spatial-tracking"
      />
    </transition>

    <v-empty-state
      v-if="!playlist.length"
      class="present-empty"
      icon="mdi-monitor-off"
      title="Nothing to project"
      :text="source === 'patches' ? 'No saved patches yet — build and save one in the Patch editor.' : 'No embeddable effects are available yet.'"
    />

    <!-- Edge tap zones for click-to-switch (touchscreens / kiosks) -->
    <button class="edge edge-left" title="Previous (←)" @click="prev" />
    <button class="edge edge-right" title="Next (→)" @click="next" />

    <transition name="bar">
      <div v-show="controlsVisible && current" class="control-bar">
        <v-btn icon="mdi-close" variant="text" size="small" title="Exit display mode" @click="leave" />

        <v-btn-toggle
          :model-value="source"
          density="compact"
          variant="outlined"
          divided
          mandatory
          class="source-toggle"
          @update:model-value="setSource"
        >
          <v-btn value="effects" size="small" prepend-icon="mdi-shape">Effects</v-btn>
          <v-btn value="patches" size="small" prepend-icon="mdi-vector-polyline">Patches</v-btn>
        </v-btn-toggle>

        <v-btn icon="mdi-skip-previous" variant="text" @click="prev" />
        <v-btn
          :icon="playing ? 'mdi-pause' : 'mdi-play'"
          variant="tonal"
          :color="playing ? 'primary' : undefined"
          :title="playing ? 'Pause auto-advance (Space)' : 'Auto-advance (Space)'"
          @click="playing = !playing"
        />
        <v-btn icon="mdi-skip-next" @click="next" variant="text" />

        <div class="now-playing">
          <div class="text-body-2 font-weight-medium">{{ current.title }}</div>
          <div class="text-caption text-medium-emphasis">
            {{ index + 1 }} / {{ playlist.length }}
          </div>
        </div>

        <v-select
          v-model="intervalSec"
          :items="[5, 10, 15, 30, 60]"
          :item-title="(v) => `${v}s`"
          :item-value="(v) => v"
          density="compact"
          variant="outlined"
          hide-details
          label="every"
          class="interval-select"
        />

        <v-btn
          icon="mdi-speedometer"
          variant="text"
          size="small"
          :color="viewer.showFps ? 'primary' : undefined"
          title="Toggle FPS counter"
          @click="viewer.update({ showFps: !viewer.showFps })"
        />
        <v-menu location="top">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon="mdi-quality-high"
              variant="text"
              size="small"
              :color="viewer.quality !== 'native' ? 'primary' : undefined"
              title="Graphics quality"
            />
          </template>
          <v-list density="compact">
            <v-list-subheader>Graphics quality</v-list-subheader>
            <v-list-item
              v-for="opt in QUALITY_OPTIONS"
              :key="opt.value"
              :title="opt.title"
              :active="viewer.quality === opt.value"
              @click="viewer.update({ quality: opt.value })"
            />
          </v-list>
        </v-menu>

        <v-btn
          :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
          variant="text"
          size="small"
          title="Fullscreen (F)"
          @click="toggleFullscreen"
        />
      </div>
    </transition>
  </div>
</template>

<style scoped>
.present-stage {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 2000;
  overflow: hidden;
}
.cursor-hidden {
  cursor: none;
}
.present-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.present-empty {
  position: relative;
  z-index: 1;
  height: 100%;
}
.edge {
  position: absolute;
  top: 0;
  bottom: 70px;
  width: 12%;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 3;
}
.edge-left { left: 0; }
.edge-right { right: 0; }

.control-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0));
}
.now-playing {
  margin: 0 auto 0 8px;
  line-height: 1.2;
}
.interval-select {
  max-width: 96px;
}
.source-toggle {
  height: 32px;
}
.source-toggle :deep(.v-btn) {
  height: 32px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.6s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.bar-enter-active,
.bar-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
