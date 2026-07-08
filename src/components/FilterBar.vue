<script setup>
import { useSketchStore } from '../stores/sketches'

const store = useSketchStore()
</script>

<template>
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <v-text-field
      v-model="store.search"
      label="Search sketches"
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="compact"
      hide-details
      clearable
      style="max-width: 320px"
    />

    <v-btn-toggle v-model="store.typeFilter" density="compact" mandatory variant="outlined" divided>
      <v-btn value="all" size="small">All</v-btn>
      <v-btn value="local" size="small">Embedded</v-btn>
      <v-btn value="external" size="small">External</v-btn>
    </v-btn-toggle>

    <div>
      <v-chip
        v-for="tag in store.allTags"
        :key="tag"
        size="small"
        class="mr-1 mb-1"
        :variant="store.selectedTags.includes(tag) ? 'flat' : 'outlined'"
        :color="store.selectedTags.includes(tag) ? 'primary' : undefined"
        @click="store.toggleTag(tag)"
      >
        {{ tag }}
      </v-chip>
    </div>
  </div>
</template>
