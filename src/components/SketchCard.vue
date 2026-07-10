<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  sketch: { type: Object, required: true },
})

// Deterministic gradient per slug — the last-resort fallback when a sketch
// can't be previewed live and has no thumbnail.
const fallbackGradient = computed(() => {
  let hash = 0
  for (const c of props.sketch.slug) hash = (hash * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${hash}, 55%, 22%), hsl(${(hash + 60) % 360}, 65%, 40%))`
})

// A live preview runs the real sketch in the card. Embeddable sketches with a
// URL qualify; local ones get low quality so a wall of them stays smooth.
const canPreview = computed(() => props.sketch.embed && props.sketch.url)
const previewSrc = computed(() =>
  props.sketch.type === 'local' ? `${props.sketch.url}?quality=low` : props.sketch.url,
)

// Mount the iframe only once the card scrolls into view, so off-screen cards
// don't all animate at once.
const root = ref(null)
const inView = ref(false)
let observer = null

onMounted(() => {
  if (!canPreview.value || props.sketch.thumbnail) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        inView.value = true
        observer.disconnect()
      }
    },
    { rootMargin: '200px' },
  )
  const el = root.value?.$el ?? root.value
  if (el) observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <v-card
    ref="root"
    :to="{ name: 'sketch', params: { slug: sketch.slug } }"
    class="sketch-card"
    hover
  >
    <div
      class="card-preview"
      :style="sketch.thumbnail || (canPreview && inView) ? {} : { background: fallbackGradient }"
    >
      <v-img v-if="sketch.thumbnail" :src="sketch.thumbnail" cover height="160" />
      <iframe
        v-else-if="canPreview && inView"
        :src="previewSrc"
        class="preview-frame"
        loading="lazy"
        scrolling="no"
        tabindex="-1"
        aria-hidden="true"
      />
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
  overflow: hidden;
  background: #05060a;
}
.preview-frame {
  width: 100%;
  height: 100%;
  border: 0;
  /* Let clicks fall through to the card (which is the router link). */
  pointer-events: none;
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
