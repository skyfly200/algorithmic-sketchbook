<script setup>
import { useSketchStore } from '../stores/sketches'
import SketchCard from '../components/SketchCard.vue'
import FilterBar from '../components/FilterBar.vue'

const store = useSketchStore()
</script>

<template>
  <v-container fluid class="pa-6" style="max-width: 1400px">
    <FilterBar />

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
