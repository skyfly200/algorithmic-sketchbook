<script setup>
import { useSketchStore } from '../stores/sketches'
import { useSceneStore } from '../stores/scenes'
import SketchCard from '../components/SketchCard.vue'
import FilterBar from '../components/FilterBar.vue'
import BrandLogo from '../components/BrandLogo.vue'

const store = useSketchStore()
const scenes = useSceneStore()

function sketchTitle(slug) {
  return store.bySlug(slug)?.title ?? slug
}
</script>

<template>
  <v-container fluid class="pa-6" style="max-width: 1400px">
    <section class="hero mb-8">
      <BrandLogo :size="112" uid="hero" class="hero-logo" />
      <div>
        <h1 class="hero-title">Bright Waves</h1>
        <p class="hero-tagline">
          An algorithmic sketchbook — a curated gallery of interactive computer-graphics
          experiments. Explore each one live, remix its parameters, and save scenes.
        </p>
      </div>
    </section>

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

<style scoped>
.hero {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.hero-logo {
  flex-shrink: 0;
  box-shadow: 0 8px 40px rgba(215, 137, 215, 0.25);
}
.hero-title {
  font-size: 2.6rem;
  line-height: 1.1;
  font-weight: 800;
  letter-spacing: -0.01em;
  background: linear-gradient(90deg, #d789d7, #f2ad00 45%, #5bbcd6 85%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-tagline {
  max-width: 560px;
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.98rem;
}
</style>
