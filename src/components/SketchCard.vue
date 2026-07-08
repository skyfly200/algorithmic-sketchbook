<script setup>
import { computed } from 'vue'

const props = defineProps({
  sketch: { type: Object, required: true },
})

// Deterministic gradient per slug so cards without a thumbnail still look
// distinct and intentional.
const fallbackGradient = computed(() => {
  let hash = 0
  for (const c of props.sketch.slug) hash = (hash * 31 + c.charCodeAt(0)) % 360
  const h1 = hash
  const h2 = (hash + 60) % 360
  return `linear-gradient(135deg, hsl(${h1}, 55%, 22%), hsl(${h2}, 65%, 40%))`
})
</script>

<template>
  <v-card
    :to="{ name: 'sketch', params: { slug: sketch.slug } }"
    class="sketch-card"
    hover
  >
    <div
      class="card-preview"
      :style="sketch.thumbnail ? {} : { background: fallbackGradient }"
    >
      <v-img v-if="sketch.thumbnail" :src="sketch.thumbnail" cover height="160" />
      <v-icon v-else icon="mdi-shimmer" size="42" class="preview-icon" />
      <v-chip
        size="x-small"
        class="type-chip"
        :color="sketch.type === 'local' ? 'primary' : 'secondary'"
        variant="flat"
      >
        {{ sketch.type === 'local' ? 'embedded' : 'external repo' }}
      </v-chip>
    </div>

    <v-card-title class="text-subtitle-1">{{ sketch.title }}</v-card-title>
    <v-card-subtitle v-if="sketch.created">{{ sketch.created }}</v-card-subtitle>
    <v-card-text>
      <p class="text-body-2 mb-2 description">{{ sketch.description }}</p>
      <v-chip
        v-for="tag in [...sketch.tech, ...sketch.tags]"
        :key="tag"
        size="x-small"
        class="mr-1 mb-1"
        variant="tonal"
      >
        {{ tag }}
      </v-chip>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.sketch-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.card-preview {
  position: relative;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-icon {
  opacity: 0.5;
}
.type-chip {
  position: absolute;
  top: 8px;
  right: 8px;
}
.description {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
