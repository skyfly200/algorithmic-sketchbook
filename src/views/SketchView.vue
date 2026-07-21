<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useViewerStore, QUALITY_OPTIONS } from '../stores/viewer'
import { useSceneStore } from '../stores/scenes'

// Single source of truth for mapping sources (audio/mouse/tilt/midi/leap/artnet).
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'

const props = defineProps({
  slug: { type: String, required: true },
})

const route = useRoute()
const store = useSketchStore()
const viewer = useViewerStore()
const scenes = useSceneStore()
const sketch = computed(() => store.bySlug(props.slug))

// Local sketches understand the runtime's display params; external URLs are
// left untouched. Changing a setting changes the src, which reloads the frame.
const seed = ref(null)
const frameSrc = computed(() => {
  if (sketch.value?.type !== 'local') return sketch.value?.url
  let s = sketch.value.url + viewer.sketchParams
  if (seed.value != null) s += (s.includes('?') ? '&' : '?') + 'seed=' + seed.value
  return s
})
function randomize() {
  seed.value = Math.floor(Math.random() * 1e9).toString(36)
}

const frame = ref(null)
const reloadKey = ref(0)
const showControls = ref(false)

// Populated when the sketch announces its params over postMessage.
const controls = ref(null) // { schema, values, mappings }
const openPanels = ref(['params']) // which controls sections are expanded
let pendingScene = null

const savedScenes = computed(() => scenes.forSlug(props.slug))
const sceneName = ref('')

function post(msg) {
  frame.value?.contentWindow?.postMessage(msg, '*')
}

function onMessage(e) {
  if (e.source !== frame.value?.contentWindow) return
  if (e.data?.type !== 'sketch:ready') return
  controls.value = {
    schema: e.data.schema ?? {},
    values: { ...e.data.values },
    mappings: [...(e.data.mappings ?? [])],
  }
  if (pendingScene) {
    const scene = pendingScene
    pendingScene = null
    applyScene(scene)
  }
}

function setParam(name, value) {
  controls.value.values[name] = value
  post({ type: 'sketch:set-param', name, value })
}

function syncMappings() {
  post({ type: 'sketch:set-mappings', mappings: controls.value.mappings })
}

function addMapping() {
  const firstNumeric = Object.entries(controls.value.schema).find(
    ([, s]) => typeof s.min === 'number',
  )
  if (!firstNumeric) return
  controls.value.mappings.push({ source: 'audio.pulse', param: firstNumeric[0], amount: 0.5, smooth: 0.6 })
  syncMappings()
}

function removeMapping(i) {
  controls.value.mappings.splice(i, 1)
  syncMappings()
}

const numericParams = computed(() =>
  Object.keys(controls.value?.schema ?? {}).filter(
    (k) => typeof controls.value.schema[k].min === 'number',
  ),
)

function saveScene() {
  if (!controls.value) return
  scenes.save({
    slug: props.slug,
    name: sceneName.value.trim() || `Scene ${savedScenes.value.length + 1}`,
    viewer: { showFps: viewer.showFps, quality: viewer.quality },
    values: { ...controls.value.values },
    mappings: controls.value.mappings.map((m) => ({ ...m })),
  })
  sceneName.value = ''
}

function applyScene(scene) {
  // Display settings first — if they differ, the iframe reloads and the rest
  // of the scene is re-applied when the sketch announces itself again.
  const willReload =
    scene.viewer.showFps !== viewer.showFps || scene.viewer.quality !== viewer.quality
  if (willReload || !controls.value) pendingScene = scene
  viewer.update({ ...scene.viewer })
  if (controls.value) {
    controls.value.values = { ...controls.value.values, ...scene.values }
    controls.value.mappings = scene.mappings.map((m) => ({ ...m }))
    post({ type: 'sketch:apply-scene', values: scene.values, mappings: scene.mappings })
  }
}

// Toggle rather than enter-only: mobile has no Esc key, so an enter-only
// button strands the user in fullscreen with no way back.
const isFullscreen = ref(false)
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function fullscreen() {
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
  else (frame.value?.requestFullscreen || frame.value?.webkitRequestFullscreen)?.call(frame.value)
}
function onFsChange() {
  isFullscreen.value = !!fsElement()
}

// Space toggles rendering — the runtime freezes its rAF loop on pause.
const paused = ref(false)
function onKey(e) {
  if (e.code !== 'Space' || e.target.matches('input, textarea, select, [contenteditable]')) return
  e.preventDefault()
  paused.value = !paused.value
  post({ type: 'sketch:pause', paused: paused.value })
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  const fromQuery = route.query.scene && scenes.byId(route.query.scene)
  if (fromQuery) {
    pendingScene = fromQuery
    viewer.update({ ...fromQuery.viewer })
    showControls.value = true
  }
})
onUnmounted(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
})
</script>

<template>
  <v-container v-if="sketch" fluid class="pa-4 sketch-page">
    <div class="d-flex align-center flex-wrap ga-2 mb-3">
      <v-btn icon="mdi-arrow-left" variant="text" :to="{ name: 'gallery' }" />
      <div class="mr-auto">
        <h1 class="text-h6">{{ sketch.title }}</h1>
        <span class="text-caption text-medium-emphasis">
          {{ sketch.created }}
          <template v-for="tag in [...sketch.tech, ...sketch.tags]" :key="tag">
            · {{ tag }}
          </template>
        </span>
      </div>

      <v-btn
        v-if="sketch.type === 'local'"
        prepend-icon="mdi-code-tags"
        variant="tonal"
        size="small"
        :href="`https://github.com/skyfly200/algorithmic-sketchbook/tree/main/sketches/${sketch.slug}`"
        target="_blank"
        rel="noopener"
      >
        Source
      </v-btn>
      <v-btn
        v-if="sketch.repo"
        prepend-icon="mdi-github"
        variant="tonal"
        size="small"
        :href="sketch.repo"
        target="_blank"
        rel="noopener"
      >
        Repo
      </v-btn>
      <v-btn
        v-if="sketch.url"
        prepend-icon="mdi-open-in-new"
        variant="tonal"
        size="small"
        :href="sketch.url"
        target="_blank"
        rel="noopener"
      >
        Open
      </v-btn>

      <template v-if="sketch.embed && sketch.url">
        <template v-if="sketch.type === 'local'">
          <v-btn
            icon="mdi-speedometer"
            variant="text"
            size="small"
            :color="viewer.showFps ? 'primary' : undefined"
            :title="viewer.showFps ? 'Hide FPS counter' : 'Show FPS counter'"
            @click="viewer.update({ showFps: !viewer.showFps })"
          />
          <v-menu>
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon="mdi-quality-high"
                variant="text"
                size="small"
                :color="viewer.quality !== 'native' ? 'primary' : undefined"
                title="Graphics quality (lower = smoother)"
              />
            </template>
            <v-list density="compact">
              <v-list-subheader>Graphics quality</v-list-subheader>
              <v-list-item
                v-for="opt in QUALITY_OPTIONS"
                :key="opt.value"
                :title="opt.title"
                :subtitle="opt.subtitle || undefined"
                :active="viewer.quality === opt.value"
                @click="viewer.update({ quality: opt.value })"
              />
            </v-list>
          </v-menu>
          <v-btn
            v-if="controls || savedScenes.length"
            icon="mdi-tune-variant"
            variant="text"
            size="small"
            :color="showControls ? 'primary' : undefined"
            title="Controls & scenes"
            @click="showControls = !showControls"
          />
        </template>
        <v-btn
          icon="mdi-dice-5-outline"
          variant="text"
          size="small"
          title="Randomize — new generative variation"
          @click="randomize"
        />
        <v-btn icon="mdi-refresh" variant="text" size="small" title="Reload the sketch" @click="reloadKey++" />
        <v-btn
          icon="mdi-projector-screen-outline"
          variant="text"
          size="small"
          title="Display mode — fullscreen, switch between effects"
          :to="{ name: 'present-slug', params: { slug: sketch.slug } }"
        />
        <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" variant="text" size="small" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="fullscreen" />
      </template>
    </div>

    <p v-if="sketch.description" class="text-body-2 text-medium-emphasis mb-3">
      {{ sketch.description }}
    </p>

    <div class="d-flex ga-3 flex-grow-1" style="min-height: 0">
      <div v-if="sketch.embed && sketch.url" class="frame-wrap">
        <iframe
          ref="frame"
          :key="reloadKey"
          :src="frameSrc"
          class="sketch-frame"
          allow="fullscreen; microphone; camera; midi; accelerometer; gyroscope; xr-spatial-tracking"
        />
        <div v-if="paused" class="paused-badge" title="Press Space to resume">
          <v-icon icon="mdi-pause" size="16" /> paused · Space to resume
        </div>
      </div>
      <v-empty-state
        v-else
        icon="mdi-open-in-new"
        title="This project can't be embedded"
        :text="`Use the buttons above to open ${sketch.title} in its own tab.`"
      />

      <v-card v-if="showControls" class="controls-panel pa-2" variant="outlined">
        <v-expansion-panels v-model="openPanels" multiple variant="accordion">
          <!-- Parameters -->
          <v-expansion-panel v-if="controls && Object.keys(controls.schema).length" value="params">
            <v-expansion-panel-title class="text-subtitle-2">Parameters</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div v-for="(spec, name) in controls.schema" :key="name" class="param">
                <v-switch
                  v-if="spec.type === 'bool'"
                  :model-value="controls.values[name]"
                  :label="spec.label ?? name"
                  density="compact"
                  hide-details
                  color="primary"
                  @update:model-value="(v) => setParam(name, v)"
                />
                <template v-else-if="spec.type === 'select'">
                  <span class="param-label">{{ spec.label ?? name }}</span>
                  <v-select
                    :model-value="controls.values[name]"
                    :items="spec.options"
                    density="compact"
                    hide-details
                    @update:model-value="(v) => setParam(name, v)"
                  />
                </template>
                <template v-else>
                  <span class="param-label">{{ spec.label ?? name }}</span>
                  <v-slider
                    :model-value="controls.values[name]"
                    :min="spec.min"
                    :max="spec.max"
                    :step="spec.step ?? 0.01"
                    density="compact"
                    hide-details
                    thumb-label
                    @update:model-value="(v) => setParam(name, v)"
                  />
                </template>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- Input mappings (its own section) -->
          <v-expansion-panel v-if="controls && Object.keys(controls.schema).length" value="mappings">
            <v-expansion-panel-title class="text-subtitle-2">
              Input mappings
              <v-spacer />
              <v-btn
                icon="mdi-plus"
                size="x-small"
                variant="tonal"
                title="Add mapping"
                class="mr-2"
                @click.stop="addMapping"
              />
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <p class="text-caption text-medium-emphasis mb-2">
                Route beat, mouse, tilt, or time inputs into parameters. With no
                mappings a parameter just holds its slider value.
              </p>
              <p v-if="!controls.mappings.length" class="text-caption text-disabled mb-1">
                No mappings yet — add one to drive a parameter from an input.
              </p>
              <v-card
                v-for="(m, i) in controls.mappings"
                :key="i"
                variant="tonal"
                class="pa-2 mb-2"
              >
                <div class="d-flex ga-2 align-center">
                  <v-select
                    v-model="m.source"
                    :items="INPUT_SOURCES"
                    density="compact"
                    hide-details
                    @update:model-value="syncMappings"
                  />
                  <v-icon icon="mdi-arrow-right" size="small" />
                  <v-select
                    v-model="m.param"
                    :items="numericParams"
                    density="compact"
                    hide-details
                    @update:model-value="syncMappings"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    @click="removeMapping(i)"
                  />
                </div>
                <v-slider
                  v-model="m.amount"
                  :min="-1"
                  :max="1"
                  :step="0.05"
                  density="compact"
                  hide-details
                  thumb-label
                  label="amount"
                  @update:model-value="syncMappings"
                />
                <v-slider
                  :model-value="m.smooth ?? 0"
                  :min="0"
                  :max="0.98"
                  :step="0.02"
                  density="compact"
                  hide-details
                  thumb-label
                  label="smooth"
                  @update:model-value="(v) => { m.smooth = v; syncMappings() }"
                />
              </v-card>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- Scenes -->
          <v-expansion-panel value="scenes">
            <v-expansion-panel-title class="text-subtitle-2">Scenes</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div v-if="controls" class="d-flex ga-2 align-center mb-2">
                <v-text-field
                  v-model="sceneName"
                  placeholder="Scene name"
                  density="compact"
                  hide-details
                  @keyup.enter="saveScene"
                />
                <v-btn size="small" color="primary" variant="tonal" @click="saveScene">Save</v-btn>
              </div>
              <p class="text-caption text-medium-emphasis mb-2">
                A scene snapshots parameter values, input mappings, and display
                settings.
              </p>
              <v-list density="compact" class="bg-transparent">
                <v-list-item
                  v-for="scene in savedScenes"
                  :key="scene.id"
                  :title="scene.name"
                  :subtitle="scene.created"
                  class="px-1"
                  @click="applyScene(scene)"
                >
                  <template #append>
                    <v-btn
                      icon="mdi-delete-outline"
                      size="x-small"
                      variant="text"
                      @click.stop="scenes.remove(scene.id)"
                    />
                  </template>
                </v-list-item>
                <v-list-item
                  v-if="!savedScenes.length"
                  title="No saved scenes"
                  class="px-1 text-disabled"
                />
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <p
          v-if="controls && !Object.keys(controls.schema).length"
          class="text-caption text-medium-emphasis pa-2"
        >
          This sketch doesn't expose parameters (see rt.params in
          sketches/_lib/runtime.js).
        </p>
      </v-card>
    </div>
  </v-container>

  <v-container v-else class="pa-6">
    <v-empty-state
      icon="mdi-help-circle-outline"
      title="Sketch not found"
      :text="`No sketch is registered under the slug “${slug}”.`"
    >
      <template #actions>
        <v-btn :to="{ name: 'gallery' }" color="primary">Back to gallery</v-btn>
      </template>
    </v-empty-state>
  </v-container>
</template>

<style scoped>
.sketch-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px);
}
.frame-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
}
.sketch-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: #000;
}
.paused-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  font: 12px system-ui, sans-serif;
  color: #ffd9a0;
  background: rgba(20, 16, 10, 0.82);
  border: 1px solid rgba(255, 200, 130, 0.4);
  pointer-events: none;
}
.controls-panel {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
}
.param {
  margin-bottom: 10px;
}
.param-label {
  display: block;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 2px;
}
/* tighten the accordion so more controls fit */
.controls-panel :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 12px 12px;
}
</style>
