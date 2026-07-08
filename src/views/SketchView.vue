<script setup>
import { computed, ref } from 'vue'
import { useSketchStore } from '../stores/sketches'

const props = defineProps({
  slug: { type: String, required: true },
})

const store = useSketchStore()
const sketch = computed(() => store.bySlug(props.slug))

const frame = ref(null)
const reloadKey = ref(0)

function fullscreen() {
  frame.value?.requestFullscreen?.()
}
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
        <v-btn icon="mdi-refresh" variant="text" size="small" @click="reloadKey++" />
        <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
      </template>
    </div>

    <p v-if="sketch.description" class="text-body-2 text-medium-emphasis mb-3">
      {{ sketch.description }}
    </p>

    <iframe
      v-if="sketch.embed && sketch.url"
      ref="frame"
      :key="reloadKey"
      :src="sketch.url"
      class="sketch-frame"
      allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
    />
    <v-empty-state
      v-else
      icon="mdi-open-in-new"
      title="This project can't be embedded"
      :text="`Use the buttons above to open ${sketch.title} in its own tab.`"
    />
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
</style>
