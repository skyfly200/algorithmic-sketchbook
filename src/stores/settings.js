import { defineStore } from 'pinia'

// App-wide preferences that outlive any single view: whether the guided tours
// run, which of them have been seen, and the shared pool of effects the random
// / Autopilot features draw from. Persisted to localStorage.
const KEY = 'sketchbook-settings'
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}

// The transient "working state" of the editors — the current Patch graph, Mixer
// layers, Autopilot mix settings, and per-editor view prefs. These are what the
// "Remember editor state" toggle governs and what "Clear session memory" wipes.
// Deliberately excludes your saved library (routings, blocks, scenes, viewer
// settings) so clearing the session never throws away named/saved work.
export const SESSION_KEYS = [
  'sketchbook-patch', 'sketchbook-patch-res', 'sketchbook-patch-fps', 'sketchbook-patch-show',
  'sketchbook-mixer', 'sketchbook-autopilot', 'sketchbook-autopilot-interest',
]

export const useSettingsStore = defineStore('settings', {
  state: () => {
    const s = load()
    return {
      tutorials: s.tutorials ?? true, // master on/off for all guided tours
      seen: s.seen ?? {}, // { app: true, patch: true, ... } — which tours have auto-run
      effectPool: s.effectPool ?? [], // enabled effect slugs; [] means "all effects"
      persistEditors: s.persistEditors ?? true, // remember editor working state across refreshes
    }
  },
  getters: {
    // A set of the enabled slugs, or null when everything is enabled.
    effectPoolSet: (s) => (s.effectPool.length ? new Set(s.effectPool) : null),
  },
  actions: {
    persist() {
      localStorage.setItem(KEY, JSON.stringify({ tutorials: this.tutorials, seen: this.seen, effectPool: this.effectPool, persistEditors: this.persistEditors }))
    },
    setPersistEditors(on) { this.persistEditors = !!on; this.persist() },
    // Wipe the editors' working state (but not the saved library). The editors
    // read their state at mount, so a reload gives them a clean slate.
    clearSession() {
      for (const k of SESSION_KEYS) localStorage.removeItem(k)
    },
    setTutorials(on) { this.tutorials = !!on; this.persist() },
    hasSeen(view) { return !!this.seen[view] },
    markSeen(view) { this.seen = { ...this.seen, [view]: true }; this.persist() },
    resetTours() { this.seen = {}; this.persist() },
    // Should a view auto-start its tour? Only when tutorials are on and it
    // hasn't been shown before.
    shouldAutoTour(view) { return this.tutorials && !this.seen[view] },

    // Effect pool: an empty list is the "all effects on" sentinel.
    isEffectEnabled(slug) { return !this.effectPool.length || this.effectPool.includes(slug) },
    toggleEffect(slug, allSlugs) {
      const set = this.effectPool.length ? new Set(this.effectPool) : new Set(allSlugs)
      set.has(slug) ? set.delete(slug) : set.add(slug)
      // collapse back to the "all" sentinel when everything ends up enabled
      this.effectPool = set.size >= allSlugs.length ? [] : [...set]
      this.persist()
    },
    enableAllEffects() { this.effectPool = []; this.persist() },
    // Filter a list of {slug} to the enabled pool (all when the pool is empty).
    filterToPool(list) {
      if (!this.effectPool.length) return list
      const set = new Set(this.effectPool)
      const kept = list.filter((s) => set.has(s.slug))
      return kept.length ? kept : list // never strand the feature with nothing
    },
  },
})
