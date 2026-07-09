import { defineStore } from 'pinia'

const STORAGE_KEY = 'sketchbook-scenes'

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []
  } catch {
    return []
  }
}

/**
 * Saved "scenes": named snapshots of a sketch's param values, its input
 * mappings (beat/mouse/time → param), and the viewer display settings.
 * Shown alongside the gallery and applied via /#/sketch/<slug>?scene=<id>.
 *
 * Shape: { id, slug, name, created, viewer: { showFps, quality },
 *          values: { param: value }, mappings: [{ source, param, amount }] }
 */
export const useSceneStore = defineStore('scenes', {
  state: () => ({
    scenes: load(),
  }),

  getters: {
    forSlug: (state) => (slug) => state.scenes.filter((s) => s.slug === slug),
    byId: (state) => (id) => state.scenes.find((s) => s.id === id) ?? null,
  },

  actions: {
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scenes))
    },
    save(scene) {
      this.scenes.push({
        id: crypto.randomUUID(),
        created: new Date().toISOString().slice(0, 10),
        ...scene,
      })
      this.persist()
    },
    remove(id) {
      this.scenes = this.scenes.filter((s) => s.id !== id)
      this.persist()
    },
  },
})
