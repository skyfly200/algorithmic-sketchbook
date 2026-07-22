<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { traitsOf, elementMeta, energyMeta } from '../registry/traits'

const props = defineProps({
  sketch: { type: Object, required: true },
})

// Derived "vibe" traits: element (fire/water/earth/air) + calm/energetic.
const traits = computed(() => traitsOf(props.sketch))
const element = computed(() => elementMeta(traits.value.element))
const energy = computed(() => energyMeta(traits.value.energy))

// Deterministic gradient per slug — the last-resort fallback when a sketch
// can't be previewed live and has no thumbnail.
const fallbackGradient = computed(() => {
  let hash = 0
  for (const c of props.sketch.slug) hash = (hash * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${hash}, 55%, 22%), hsl(${(hash + 60) % 360}, 65%, 40%))`
})

// A live preview runs the real sketch in the card — but only while the card
// is hovered, so the gallery itself stays smooth. At rest each local sketch
// shows a poster: a single frame captured from a short offscreen warm-up run
// and cached for the session. External sites can't be captured (cross-
// origin), so they rest on their cover gradient and come alive on hover.
const canPreview = computed(() => props.sketch.embed && props.sketch.url)
const isLocal = computed(() => props.sketch.type === 'local')
const previewSrc = computed(() =>
  isLocal.value ? `${props.sketch.url}?quality=low&preview=1` : props.sketch.url,
)

const hovering = ref(false)
const poster = ref(null)
const root = ref(null)
const inView = ref(false)
let observer = null
let cancelled = false

const POSTER_W = 480
const POSTER_H = 270

function posterKey(slug) {
  return `sketchbook-poster-${slug}`
}

// A near-black frame means the sketch hasn't drawn yet — sample a grid and
// treat it as blank if almost every pixel is black.
function frameIsBlank(ctx) {
  const { data } = ctx.getImageData(0, 0, POSTER_W, POSTER_H)
  let lit = 0
  const step = 40 * 4 // sample sparsely
  let total = 0
  for (let i = 0; i < data.length; i += step) {
    total++
    if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) lit++
  }
  return lit / total < 0.02
}

// Capture posters two at a time so a fresh visit doesn't boot every sketch
// at once — each card takes a turn, runs ~2s hidden, gets snapshotted.
let capturing = 0
const waiters = []
async function slot() {
  if (capturing >= 2) await new Promise((r) => waiters.push(r))
  capturing++
}
function release() {
  capturing--
  waiters.shift()?.()
}

async function capturePoster() {
  try {
    const cached = sessionStorage.getItem(posterKey(props.sketch.slug))
    if (cached) {
      poster.value = cached
      return
    }
  } catch {}
  await slot()
  if (cancelled) {
    release()
    return
  }
  const frame = document.createElement('iframe')
  frame.src = `${props.sketch.url}?quality=low&preview=1&capture=1`
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${POSTER_W}px;height:${POSTER_H}px;border:0;`
  document.body.appendChild(frame)
  try {
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true })
      setTimeout(resolve, 4000)
    })
    // Retry until the sketch has actually drawn something — a black frame
    // means it hasn't rendered yet (or a WebGL buffer wasn't ready), so we
    // wait rather than caching a black square. If it never lights up we bail
    // and leave the card on its fallback gradient.
    let url = null
    for (let attempt = 0; attempt < 4 && !url; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 2200 : 1200))
      const canvas = frame.contentDocument?.querySelector('canvas')
      if (!canvas || !canvas.width) continue
      const out = document.createElement('canvas')
      out.width = POSTER_W
      out.height = POSTER_H
      const ctx = out.getContext('2d')
      const s = Math.max(POSTER_W / canvas.width, POSTER_H / canvas.height)
      const dw = canvas.width * s
      const dh = canvas.height * s
      try {
        ctx.drawImage(canvas, (POSTER_W - dw) / 2, (POSTER_H - dh) / 2, dw, dh)
      } catch {
        continue
      }
      if (!frameIsBlank(ctx)) url = out.toDataURL('image/jpeg', 0.72)
    }
    if (url) {
      poster.value = url
      try {
        sessionStorage.setItem(posterKey(props.sketch.slug), url)
      } catch {}
    }
  } catch {
  } finally {
    frame.remove()
    release()
  }
}

onMounted(() => {
  if (!canPreview.value || props.sketch.thumbnail) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        inView.value = true
        observer.disconnect()
        if (isLocal.value) capturePoster()
      }
    },
    { rootMargin: '200px' },
  )
  const el = root.value?.$el ?? root.value
  if (el) observer.observe(el)
})
onBeforeUnmount(() => {
  cancelled = true
  observer?.disconnect()
})
</script>

<template>
  <v-card
    ref="root"
    :to="{ name: 'sketch', params: { slug: sketch.slug } }"
    class="sketch-card"
    hover
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <div
      class="card-preview"
      :style="sketch.thumbnail || poster || (canPreview && hovering) ? {} : { background: fallbackGradient }"
    >
      <v-img v-if="sketch.thumbnail" :src="sketch.thumbnail" cover height="160" />
      <template v-else-if="canPreview">
        <!-- resting state: a still frame; hover: the real sketch, live -->
        <img v-if="poster" :src="poster" class="poster" :class="{ 'poster-under': hovering }" alt="" />
        <iframe
          v-if="hovering && inView"
          :src="previewSrc"
          class="preview-frame"
          loading="lazy"
          scrolling="no"
          tabindex="-1"
          aria-hidden="true"
        />
        <v-icon v-else-if="!poster" icon="mdi-shimmer" size="42" class="preview-icon" />
      </template>
      <v-icon v-else icon="mdi-shimmer" size="42" class="preview-icon" />

      <v-chip
        size="x-small"
        class="type-chip"
        :color="sketch.type === 'local' ? 'primary' : 'secondary'"
        variant="flat"
      >
        {{ sketch.type === 'local' ? 'embedded' : 'external repo' }}
      </v-chip>
      <div
        v-if="sketch.perf"
        class="perf-bubble"
        :class="`perf-${sketch.perf >= 70 ? 'green' : sketch.perf >= 40 ? 'yellow' : 'red'}`"
        :title="`Performance ${sketch.perf}/100 — measured frame rate vs a 60fps target (npm run perf). ${traits.speed === 'fast' ? 'Fast' : 'Slow'}.`"
      >
        <span class="perf-bars" aria-hidden="true">
          <i :class="{ on: sketch.perf >= 20 }" />
          <i :class="{ on: sketch.perf >= 45 }" />
          <i :class="{ on: sketch.perf >= 70 }" />
        </span>
        {{ sketch.perf }}
      </div>

      <!-- vibe badges: element + energy -->
      <div class="trait-badges">
        <span v-if="element" class="trait-badge" :title="`Element: ${element.label}`">{{ element.emoji }}</span>
        <span v-if="energy" class="trait-badge" :title="`Feel: ${energy.label}`">{{ energy.emoji }}</span>
      </div>
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
.poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* keep the poster under the live frame so there's no flash while it boots */
.poster-under {
  z-index: 0;
}
.preview-frame {
  position: relative;
  z-index: 1;
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
  z-index: 2;
}
/* measured performance grade (1-100), bottom-left of the preview */
.perf-bubble {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 700 11px system-ui, sans-serif;
  color: #0b0d10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.perf-green { background: #4ade80; }
.perf-yellow { background: #facc15; }
.perf-red { background: #f87171; }
/* little speed meter inside the perf bubble */
.perf-bars { display: inline-flex; align-items: flex-end; gap: 1px; height: 11px; margin-right: 3px; }
.perf-bars i { width: 2.5px; background: rgba(11, 13, 16, 0.35); border-radius: 1px; }
.perf-bars i:nth-child(1) { height: 5px; }
.perf-bars i:nth-child(2) { height: 8px; }
.perf-bars i:nth-child(3) { height: 11px; }
.perf-bars i.on { background: #0b0d10; }
/* element + energy badges, bottom-right of the preview */
.trait-badges {
  position: absolute; bottom: 8px; right: 8px; z-index: 2;
  display: flex; gap: 4px;
}
.trait-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 999px; font-size: 13px;
  background: rgba(10, 12, 18, 0.72); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.description {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
