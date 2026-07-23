<script setup>
/**
 * Library — everything you've saved: Patch routings (including mixes saved
 * from Autopilot), and the named scenes for individual sketches. Open a
 * routing straight into the Patch board, or a scene into its sketch; delete
 * what you no longer need. Routings live in localStorage
 * (`sketchbook-patch-saved`); scenes come from the scenes store.
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useSceneStore } from '../stores/scenes'

const router = useRouter()
const store = useSketchStore()
const scenes = useSceneStore()

const SAVED_KEY = 'sketchbook-patch-saved'
const routings = ref(loadRoutings())
function loadRoutings() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || []
  } catch {
    return []
  }
}
function nodeSummary(r) {
  const counts = {}
  for (const n of r.nodes ?? []) counts[n.type] = (counts[n.type] ?? 0) + 1
  return Object.entries(counts).map(([t, c]) => `${c} ${t}`).join(' · ')
}
function openRouting(r) {
  router.push({ name: 'patch', query: { load: r.id } })
}
function deleteRouting(r) {
  routings.value = routings.value.filter((x) => x.id !== r.id)
  localStorage.setItem(SAVED_KEY, JSON.stringify(routings.value))
}

const sceneList = computed(() => scenes.scenes)
function sketchTitle(slug) {
  return store.bySlug(slug)?.title ?? slug
}
</script>

<template>
  <v-container class="library" max-width="960">
    <h1 class="text-h4 mb-1">Library</h1>
    <p class="lead">Your saved patch routings, mixes and scenes — open one to pick up where you left off.</p>

    <h2 class="text-h6 mt-8 mb-2">
      <v-icon icon="mdi-vector-polyline" size="small" class="mr-1" />
      Patch routings &amp; mixes
      <span class="count">{{ routings.length }}</span>
    </h2>
    <v-row v-if="routings.length">
      <v-col v-for="r in routings" :key="r.id" cols="12" sm="6" md="4">
        <v-card class="save-card" variant="outlined">
          <div class="routing-thumb">
            <img v-if="r.preview" :src="r.preview" :alt="r.name" />
            <v-icon v-else icon="mdi-vector-polyline" size="32" />
          </div>
          <v-card-title class="text-subtitle-1">{{ r.name }}</v-card-title>
          <v-card-subtitle>{{ nodeSummary(r) }}</v-card-subtitle>
          <v-card-actions>
            <v-btn size="small" variant="tonal" prepend-icon="mdi-pencil-box-outline" @click="openRouting(r)">Edit in Patch</v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" icon="mdi-delete" @click="deleteRouting(r)" />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
    <v-empty-state
      v-else
      icon="mdi-content-save-off-outline"
      title="No saved routings yet"
      text="Build a patch and hit Save, or save a mix from Autopilot — they'll collect here."
    />

    <h2 class="text-h6 mt-8 mb-2">
      <v-icon icon="mdi-movie-open-star-outline" size="small" class="mr-1" />
      Scenes
      <span class="count">{{ sceneList.length }}</span>
    </h2>
    <div v-if="sceneList.length" class="mb-6">
      <v-chip
        v-for="scene in sceneList"
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
    <p v-else class="empty-note">No saved scenes — open a sketch, tweak its params and mappings, and save a scene from the viewer.</p>
  </v-container>
</template>

<style scoped>
.library { padding-top: 32px; }
.lead { font-size: 1.04rem; opacity: 0.85; }
.count {
  display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.1); font-size: 0.7em; vertical-align: middle;
}
.save-card { height: 100%; display: flex; flex-direction: column; }
.save-card .v-card-actions { margin-top: auto; }
.routing-thumb {
  aspect-ratio: 16 / 9; background: #000; display: flex; align-items: center; justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; opacity: 0.55;
}
.routing-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.empty-note { opacity: 0.7; font-size: 0.92rem; }
</style>
