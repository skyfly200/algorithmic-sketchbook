<script setup>
import { useSketchStore } from '../stores/sketches'
import { useSceneStore } from '../stores/scenes'
import SketchCard from '../components/SketchCard.vue'
import FilterBar from '../components/FilterBar.vue'

const store = useSketchStore()
const scenes = useSceneStore()

function sketchTitle(slug) {
  return store.bySlug(slug)?.title ?? slug
}
</script>

<template>
  <v-container fluid class="pa-6" style="max-width: 1400px">
    <FilterBar />

    <template v-if="scenes.scenes.length">
      <h2 class="text-subtitle-1 mb-2">
        <v-icon icon="mdi-movie-open-star-outline" size="small" class="mr-1" />
        Saved scenes
      </h2>
      <div class="mb-6">
        <v-chip
          v-for="scene in scenes.scenes"
          :key="scene.id"
          class="mr-2 mb-2"
          color="secondary"
          variant="tonal"
          closable
          :to="{ name: 'sketch', params: { slug: scene.slug }, query: { scene: scene.id } }"
          @click:close="scenes.remove(scene.id)"
        >
          {{ scene.name }} — {{ sketchTitle(scene.slug) }}
        </v-chip>
      </div>
    </template>

    <v-row v-if="store.filtered.length">
      <v-col
        v-for="sketch in store.filtered"
        :key="sketch.slug"
        cols="12"
        sm="6"
        md="4"
        lg="3"
      >
        <SketchCard :sketch="sketch" />
      </v-col>
    </v-row>

    <v-empty-state
      v-else
      icon="mdi-flask-empty-outline"
      title="No sketches match"
      text="Try clearing the search or tag filters — or add a new sketch with `npm run new <slug>`."
    />
  </v-container>
</template>
