<script setup>
import { useSketchStore } from '../stores/sketches'
import { ELEMENTS, ENERGIES, SPEEDS } from '../registry/traits'

const store = useSketchStore()
</script>

<template>
  <div class="filter-bar mb-6">
    <div class="d-flex flex-wrap align-center ga-4 mb-3">
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
          v-for="cat in store.categories"
          :key="cat"
          size="small"
          class="mr-1 mb-1"
          :variant="store.selectedCategories.includes(cat) ? 'flat' : 'outlined'"
          :color="store.selectedCategories.includes(cat) ? 'primary' : undefined"
          @click="store.toggleCategory(cat)"
        >
          {{ cat }}
        </v-chip>
      </div>
    </div>

    <!-- Vibe filters: element, energy, speed -->
    <div class="d-flex flex-wrap align-center ga-2 trait-row">
      <span class="trait-label">Element</span>
      <v-chip
        v-for="e in ELEMENTS"
        :key="e.key"
        size="small"
        class="trait-chip"
        :variant="store.selectedElements.includes(e.key) ? 'flat' : 'outlined'"
        :color="store.selectedElements.includes(e.key) ? 'primary' : undefined"
        @click="store.toggleTrait('selectedElements', e.key)"
      >
        {{ e.emoji }} {{ e.label }}
      </v-chip>

      <span class="trait-label ml-3">Energy</span>
      <v-chip
        v-for="en in ENERGIES"
        :key="en.key"
        size="small"
        class="trait-chip"
        :variant="store.selectedEnergy.includes(en.key) ? 'flat' : 'outlined'"
        :color="store.selectedEnergy.includes(en.key) ? 'primary' : undefined"
        @click="store.toggleTrait('selectedEnergy', en.key)"
      >
        {{ en.emoji }} {{ en.label }}
      </v-chip>

      <span class="trait-label ml-3">Performance</span>
      <v-chip
        v-for="sp in SPEEDS"
        :key="sp.key"
        size="small"
        class="trait-chip"
        :variant="store.selectedSpeed.includes(sp.key) ? 'flat' : 'outlined'"
        :color="store.selectedSpeed.includes(sp.key) ? 'primary' : undefined"
        @click="store.toggleTrait('selectedSpeed', sp.key)"
      >
        <v-icon :icon="sp.key === 'light' ? 'mdi-speedometer' : sp.key === 'medium' ? 'mdi-speedometer-medium' : 'mdi-speedometer-slow'" size="14" class="mr-1" />
        {{ sp.label }}
      </v-chip>
    </div>
  </div>
</template>

<style scoped>
.trait-label {
  font: 600 11px system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.5);
}
.trait-chip { margin-bottom: 4px; }
</style>
