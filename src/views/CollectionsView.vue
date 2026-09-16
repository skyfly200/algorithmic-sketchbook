<script setup>
/**
 * Collections — built-in libraries of public-domain reference imagery to build
 * on. The browse page lists each collection; opening one fetches its plates live
 * from Wikimedia Commons (in the browser — the build has no egress) and shows a
 * grid. From a plate you can open it at the source, pull it into a Patch Media
 * node, or trace it to polygon mattes. Nothing is downloaded ahead of time; the
 * image bytes only load when you view or use a plate.
 */
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { COLLECTIONS, collectionBySlug } from '../collections'
import { fetchCollectionItems } from '../lib/commons.js'
import { handOffMediaToPatch, handOffTraceToPatch } from '../lib/collectionsHandoff.js'

const props = defineProps({ slug: { type: String, default: '' } })
const router = useRouter()

const collection = computed(() => (props.slug ? collectionBySlug(props.slug) : null))

// Cover thumbnails, fetched live (one plate per collection) for the browse grid.
const covers = reactive({})
watch(
  () => collection.value,
  (col) => {
    if (col) return // only on the browse page
    for (const c of COLLECTIONS) {
      if (covers[c.slug] !== undefined) continue
      covers[c.slug] = null
      fetchCollectionItems(c.source, 1)
        .then((list) => { covers[c.slug] = list[0]?.thumb || '' })
        .catch(() => { covers[c.slug] = '' })
    }
  },
  { immediate: true },
)

const items = ref([])
const loading = ref(false)
const error = ref('')
const lightbox = ref(null) // the item shown large, or null

// Fetch the plate list whenever we land on (or switch to) a detail page.
watch(
  () => collection.value,
  async (col) => {
    items.value = []
    error.value = ''
    if (!col) return
    loading.value = true
    try {
      const list = await fetchCollectionItems(col.source, 80)
      items.value = list
      if (!list.length) error.value = 'No plates came back from the source. It may be temporarily unavailable.'
    } catch (e) {
      error.value = 'Could not reach the source (' + (e?.message || 'network error') + '). Check your connection and try again.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function openCollection(slug) { router.push({ name: 'collection', params: { slug } }) }
function backToList() { router.push({ name: 'collections' }) }

function useInPatch(item) {
  handOffMediaToPatch(item.url, item.title || 'collection image')
  router.push({ name: 'patch' })
}
function traceShapes(item) {
  handOffTraceToPatch(item.url, item.title || 'collection image')
  router.push({ name: 'patch' })
}
function openSource(item) { window.open(item.descriptionUrl, '_blank', 'noopener') }

function stripName(a) { return (a || '').replace(/\s+/g, ' ').trim() }
</script>

<template>
  <v-container class="py-6" style="max-width: 1200px">
    <!-- ── Browse: all collections ─────────────────────────────────────── -->
    <template v-if="!collection">
      <div class="mb-4">
        <h1 class="text-h4 mb-1">Collections</h1>
        <p class="text-medium-emphasis mb-0">
          Built-in libraries of public-domain reference imagery to build on — browse a set,
          then pull a plate into Patch or trace it to shapes. Plates load live from the source.
        </p>
      </div>
      <v-row>
        <v-col v-for="c in COLLECTIONS" :key="c.slug" cols="12" sm="6" md="4">
          <v-card class="coll-card h-100" @click="openCollection(c.slug)">
            <div class="coll-cover">
              <img v-if="covers[c.slug]" :src="covers[c.slug]" :alt="c.title" loading="lazy" />
              <v-icon v-else icon="mdi-image-multiple-outline" size="42" class="text-medium-emphasis" />
            </div>
            <v-card-item>
              <v-card-title class="text-wrap">{{ c.title }}</v-card-title>
              <v-card-subtitle class="text-wrap">{{ c.subtitle }}</v-card-subtitle>
            </v-card-item>
            <v-card-text class="pt-0">
              <div class="text-medium-emphasis text-body-2">{{ c.author }} · {{ c.year }}</div>
              <div class="mt-2">
                <v-chip v-for="t in c.tags" :key="t" size="x-small" class="mr-1 mb-1" variant="tonal">{{ t }}</v-chip>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- ── Detail: one collection's plates ─────────────────────────────── -->
    <template v-else>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" class="mb-3" @click="backToList">All collections</v-btn>
      <div class="mb-4">
        <h1 class="text-h4 mb-1">{{ collection.title }}</h1>
        <div class="text-medium-emphasis mb-2">
          {{ collection.author }} · {{ collection.year }} ·
          <v-chip size="x-small" variant="tonal" class="ml-1">{{ collection.license }}</v-chip>
        </div>
        <p class="text-body-2" style="max-width: 70ch">{{ collection.blurb }}</p>
        <a :href="collection.sourceUrl" target="_blank" rel="noopener" class="text-primary text-body-2">
          Source: {{ collection.sourceName }} ↗
        </a>
      </div>

      <div v-if="loading" class="d-flex justify-center py-12">
        <v-progress-circular indeterminate color="primary" size="42" />
      </div>
      <v-alert v-else-if="error" type="warning" variant="tonal" class="my-4">
        {{ error }}
        <template #append>
          <v-btn size="small" variant="text" @click="openSource({ descriptionUrl: collection.sourceUrl })">Open source</v-btn>
        </template>
      </v-alert>

      <div v-else class="plate-grid">
        <div v-for="it in items" :key="it.id" class="plate">
          <div class="plate-img" @click="lightbox = it">
            <img :src="it.thumb" :alt="it.title" loading="lazy" />
          </div>
          <div class="plate-actions">
            <v-btn size="x-small" variant="tonal" prepend-icon="mdi-vector-polyline" title="Add as a Media node in Patch" @click="useInPatch(it)">Patch</v-btn>
            <v-btn size="x-small" variant="tonal" prepend-icon="mdi-shape-plus" title="Trace this to polygon mattes" @click="traceShapes(it)">Trace</v-btn>
            <v-btn size="x-small" variant="text" icon="mdi-open-in-new" title="Open at source" @click="openSource(it)" />
          </div>
        </div>
      </div>
    </template>

    <!-- ── Lightbox ────────────────────────────────────────────────────── -->
    <v-dialog :model-value="!!lightbox" max-width="960" @update:model-value="lightbox = null">
      <v-card v-if="lightbox">
        <div class="lb-img"><img :src="lightbox.thumb" :alt="lightbox.title" /></div>
        <v-card-item>
          <v-card-title class="text-wrap">{{ lightbox.title }}</v-card-title>
          <v-card-subtitle v-if="lightbox.artist" class="text-wrap">{{ stripName(lightbox.artist) }}</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-0">
          <div class="text-medium-emphasis text-body-2">
            {{ lightbox.license }}<span v-if="lightbox.date"> · {{ lightbox.date }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn prepend-icon="mdi-vector-polyline" @click="useInPatch(lightbox)">Use in Patch</v-btn>
          <v-btn prepend-icon="mdi-shape-plus" @click="traceShapes(lightbox)">Trace shapes</v-btn>
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-open-in-new" @click="openSource(lightbox)">Open at source</v-btn>
          <v-btn variant="text" @click="lightbox = null">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.coll-card { cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.coll-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.coll-cover {
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: #0a0c12;
  display: grid;
  place-items: center;
}
.coll-cover img { width: 100%; height: 100%; object-fit: cover; }

.plate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.plate {
  background: #10141d;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.plate-img {
  aspect-ratio: 1;
  background: #f6f3ea; /* light mat — these are ink-on-paper plates */
  cursor: zoom-in;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.plate-img img { width: 100%; height: 100%; object-fit: contain; }
.plate-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}
.lb-img {
  background: #f6f3ea;
  display: grid;
  place-items: center;
  max-height: 70vh;
  overflow: hidden;
}
.lb-img img { max-width: 100%; max-height: 70vh; object-fit: contain; }
</style>
