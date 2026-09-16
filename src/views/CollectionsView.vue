<script setup>
/**
 * Collections — built-in libraries of public-domain reference imagery to build
 * on, plus a live keyword search across Wikimedia Commons and the Internet
 * Archive. The browse page lists curated sets and hosts the search box; opening
 * a set fetches its plates live (in the browser — the build has no egress). From
 * any plate you can open it at the source, pull it into a Patch Media node, or
 * trace it to polygon mattes. Nothing is downloaded ahead of time; the image
 * bytes only load when you view or use a plate.
 */
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { COLLECTIONS, collectionBySlug } from '../collections'
import { fetchCollectionItems } from '../lib/commons.js'
import { searchCollections, ensureFullUrl, PROVIDERS } from '../lib/collectionSearch.js'
import { handOffMediaToPatch, handOffTraceToPatch } from '../lib/collectionsHandoff.js'

const props = defineProps({ slug: { type: String, default: '' } })
const router = useRouter()

const collection = computed(() => (props.slug ? collectionBySlug(props.slug) : null))
const providerLabel = (id) => PROVIDERS.find((p) => p.id === id)?.label || id

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

// --- live search across sources -------------------------------------------
const query = ref('')
const sources = reactive({ commons: true, archive: true })
const searchItems = ref([])
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)
async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  const picked = PROVIDERS.map((p) => p.id).filter((id) => sources[id])
  if (!picked.length) { searchError.value = 'Pick at least one source.'; return }
  searching.value = true
  searchError.value = ''
  searched.value = true
  try {
    const { items: found, errors } = await searchCollections(q, picked, 40)
    searchItems.value = found
    if (!found.length) searchError.value = errors.length ? 'The source(s) could not be reached. Try again.' : 'No results for “' + q + '”.'
    else if (errors.length) searchError.value = errors.map(providerLabel).join(' & ') + ' could not be reached — showing the rest.'
  } catch (e) {
    searchError.value = 'Search failed (' + (e?.message || 'network error') + ').'
  } finally {
    searching.value = false
  }
}
function clearSearch() { query.value = ''; searchItems.value = []; searched.value = false; searchError.value = '' }

// Resolve an item's full-res URL (archive items resolve on demand), stash the
// handoff and jump to Patch. A brief overlay covers the resolve step.
const handoffBusy = ref(false)
async function withFullUrl(item) {
  handoffBusy.value = true
  try { return await ensureFullUrl(item) }
  finally { handoffBusy.value = false }
}
async function useInPatch(item) {
  const url = await withFullUrl(item)
  if (!url) { searchError.value = 'Could not resolve that image.'; return }
  handOffMediaToPatch(url, item.title || 'collection image')
  router.push({ name: 'patch' })
}
async function traceShapes(item) {
  const url = await withFullUrl(item)
  if (!url) { searchError.value = 'Could not resolve that image.'; return }
  handOffTraceToPatch(url, item.title || 'collection image')
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

      <!-- Live search across sources -->
      <v-card variant="tonal" class="mb-6 pa-3">
        <div class="d-flex flex-wrap align-center" style="gap: 10px">
          <v-text-field
            v-model="query"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Search public-domain imagery (e.g. “waves”, “botanical”, “star map”)"
            prepend-inner-icon="mdi-magnify"
            style="min-width: 260px; flex: 1 1 320px"
            @keyup.enter="runSearch"
            @click:clear="clearSearch"
          />
          <v-btn color="primary" :loading="searching" prepend-icon="mdi-magnify" @click="runSearch">Search</v-btn>
        </div>
        <div class="d-flex flex-wrap align-center mt-2" style="gap: 4px">
          <span class="text-caption text-medium-emphasis mr-1">Sources:</span>
          <v-checkbox
            v-for="p in PROVIDERS"
            :key="p.id"
            v-model="sources[p.id]"
            :label="p.label"
            density="compact"
            hide-details
            class="mr-2"
          />
        </div>
      </v-card>

      <!-- Search results -->
      <template v-if="searched">
        <div class="d-flex align-center mb-3">
          <h2 class="text-h6 mb-0">Results</h2>
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-close" @click="clearSearch">Clear</v-btn>
        </div>
        <div v-if="searching" class="d-flex justify-center py-12">
          <v-progress-circular indeterminate color="primary" size="42" />
        </div>
        <template v-else>
          <v-alert v-if="searchError" :type="searchItems.length ? 'info' : 'warning'" variant="tonal" class="mb-4">{{ searchError }}</v-alert>
          <div v-if="searchItems.length" class="plate-grid mb-6">
            <div v-for="it in searchItems" :key="it.id" class="plate">
              <div class="plate-img plate-img--dark" @click="lightbox = it">
                <img :src="it.thumb" :alt="it.title" loading="lazy" />
                <span class="provider-badge">{{ providerLabel(it.provider) }}</span>
              </div>
              <div class="plate-title" :title="it.title">{{ it.title }}</div>
              <div class="plate-actions">
                <v-btn size="x-small" variant="tonal" prepend-icon="mdi-vector-polyline" title="Add as a Media node in Patch" @click="useInPatch(it)">Patch</v-btn>
                <v-btn size="x-small" variant="tonal" prepend-icon="mdi-shape-plus" title="Trace this to polygon mattes" @click="traceShapes(it)">Trace</v-btn>
                <v-btn size="x-small" variant="text" icon="mdi-open-in-new" title="Open at source" @click="openSource(it)" />
              </div>
            </div>
          </div>
        </template>
        <v-divider class="mb-6" />
      </template>

      <h2 class="text-h6 mb-3">Curated sets</h2>
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

    <!-- Brief cover while an archive image URL resolves before jumping to Patch -->
    <v-overlay :model-value="handoffBusy" class="d-flex align-center justify-center" persistent>
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-overlay>
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
/* Search results are mixed media (photos, maps, plates) — a dark mat reads
   better than the light ink-on-paper mat used for the wave plates. */
.plate-img--dark { background: #0a0c12; position: relative; }
.provider-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #cfd6e6;
  pointer-events: none;
}
.plate-title {
  font-size: 12px;
  line-height: 1.3;
  padding: 6px 8px 0;
  color: #c7cede;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
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
