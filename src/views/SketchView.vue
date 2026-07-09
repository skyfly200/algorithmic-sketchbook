<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useViewerStore, QUALITY_OPTIONS } from '../stores/viewer'
import { useSceneStore } from '../stores/scenes'

const INPUT_SOURCES = ['beat.pulse', 'beat.level', 'mouse.x', 'mouse.y', 'time.sin']

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
const frameSrc = computed(() =>
  sketch.value?.type === 'local' ? sketch.value.url + viewer.sketchParams : sketch.value?.url,
)

const frame = ref(null)
const reloadKey = ref(0)
const showControls = ref(false)

// Populated when the sketch announces its params over postMessage.
const controls = ref(null) // { schema, values, mappings }
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
  controls.value.mappings.push({ source: 'beat.pulse', param: firstNumeric[0], amount: 0.5 })
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

function fullscreen() {
  frame.value?.requestFullscreen?.()
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  const fromQuery = route.query.scene && scenes.byId(route.query.scene)
  if (fromQuery) {
    pendingScene = fromQuery
    viewer.update({ ...fromQuery.viewer })
    showControls.value = true
  }
})
onUnmounted(() => window.removeEventListener('message', onMessage))
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
        <v-btn icon="mdi-refresh" variant="text" size="small" @click="reloadKey++" />
        <v-btn
          icon="mdi-projector-screen-outline"
          variant="text"
          size="small"
          title="Display mode — fullscreen, switch between effects"
          :to="{ name: 'present-slug', params: { slug: sketch.slug } }"
        />
        <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
      </template>
    </div>

    <p v-if="sketch.description" class="text-body-2 text-medium-emphasis mb-3">
      {{ sketch.description }}
    </p>

    <div class="d-flex ga-3 flex-grow-1" style="min-height: 0">
      <iframe
        v-if="sketch.embed && sketch.url"
        ref="frame"
        :key="reloadKey"
        :src="frameSrc"
        class="sketch-frame"
        allow="fullscreen; microphone; camera; accelerometer; gyroscope; xr-spatial-tracking"
      />
      <v-empty-state
        v-else
        icon="mdi-open-in-new"
        title="This project can't be embedded"
        :text="`Use the buttons above to open ${sketch.title} in its own tab.`"
      />

      <v-card v-if="showControls" class="controls-panel pa-4" variant="outlined">
        <template v-if="controls && Object.keys(controls.schema).length">
          <h2 class="text-subtitle-2 mb-2">Parameters</h2>
          <template v-for="(spec, name) in controls.schema" :key="name">
            <v-switch
              v-if="spec.type === 'bool'"
              :model-value="controls.values[name]"
              :label="spec.label ?? name"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="(v) => setParam(name, v)"
            />
            <v-slider
              v-else
              :model-value="controls.values[name]"
              :label="spec.label ?? name"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step ?? 0.01"
              density="compact"
              hide-details
              thumb-label
              class="mb-1"
              @update:model-value="(v) => setParam(name, v)"
            />
          </template>

          <div class="d-flex align-center mt-4 mb-2">
            <h2 class="text-subtitle-2 mr-auto">Input mappings</h2>
            <v-btn
              icon="mdi-plus"
              size="x-small"
              variant="tonal"
              title="Add mapping"
              @click="addMapping"
            />
          </div>
          <p class="text-caption text-medium-emphasis mb-2">
            Route beat, mouse, or time inputs into parameters.
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
          </v-card>
        </template>
        <p v-else class="text-caption text-medium-emphasis">
          This sketch doesn't expose parameters (see rt.params in
          sketches/_lib/runtime.js).
        </p>

        <h2 class="text-subtitle-2 mt-4 mb-2">Scenes</h2>
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
        </v-list>
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
.sketch-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: #000;
}
.controls-panel {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
}
</style>
