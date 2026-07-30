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
    // Effect pool is stored as a *disabled* set (`effectOff`): [] means "all on",
    // and any effect not explicitly disabled is included — so newly-added effects
    // always join the pool by default. `legacyIn` holds a pre-migration inclusion
    // list until we know the full effect list and can convert it (ensureMigrated).
    let effectOff = null, legacyIn = null
    if (Array.isArray(s.effectOff)) effectOff = s.effectOff
    else if (Array.isArray(s.effectPool) && s.effectPool.length) legacyIn = s.effectPool
    else effectOff = []
    return {
      tutorials: s.tutorials ?? true, // master on/off for all guided tours
      seen: s.seen ?? {}, // { app: true, patch: true, ... } — which tours have auto-run
      effectOff, // disabled effect slugs; [] means "all effects on"
      legacyIn, // legacy inclusion list awaiting migration (null once migrated)
      favorites: s.favorites ?? [], // starred effect slugs — surfaced first in Featured
      persistEditors: s.persistEditors ?? true, // remember editor working state across refreshes
      audioDeviceId: s.audioDeviceId ?? '', // preferred mic ('' = system default)
      midiEnabled: s.midiEnabled ?? false, // has the user set MIDI up? (hides it in input lists until then)
      midiChannel: s.midiChannel ?? 0, // 0 = all channels, 1..16 = a specific channel
      highPerformance: s.highPerformance ?? false, // hint WebGL toward the dedicated GPU
    }
  },
  getters: {
    favoriteSet: (s) => new Set(s.favorites),
    // Whether the pool is narrowed at all (used to enable/disable the "all" reset).
    isFilteringEffects: (s) => (s.effectOff ? s.effectOff.length > 0 : !!s.legacyIn),
  },
  actions: {
    persist() {
      const data = {
        tutorials: this.tutorials, seen: this.seen, favorites: this.favorites, persistEditors: this.persistEditors,
        audioDeviceId: this.audioDeviceId, midiEnabled: this.midiEnabled, midiChannel: this.midiChannel,
        highPerformance: this.highPerformance,
      }
      if (this.effectOff !== null) data.effectOff = this.effectOff
      else if (this.legacyIn) data.effectPool = this.legacyIn // keep legacy until migrated
      localStorage.setItem(KEY, JSON.stringify(data))
    },
    // Favorites: starred sketches float to the top of the Featured sort and get
    // their own section in the effect pickers.
    isFavorite(slug) { return this.favoriteSet.has(slug) },
    toggleFavorite(slug) {
      const i = this.favorites.indexOf(slug)
      i === -1 ? this.favorites.push(slug) : this.favorites.splice(i, 1)
      this.persist()
    },
    setPersistEditors(on) { this.persistEditors = !!on; this.persist() },
    // Audio + MIDI input setup (shared across the viewer and the compositors,
    // threaded into sketches via URL params).
    setAudioDevice(id) { this.audioDeviceId = id || ''; this.persist() },
    setMidiEnabled(on) { this.midiEnabled = !!on; this.persist() },
    setMidiChannel(ch) { this.midiChannel = Math.max(0, Math.min(16, ch | 0)); this.persist() },
    // Ask the browser to run WebGL sketches on the dedicated GPU rather than the
    // integrated one. Threaded into sketches as ?gpu=high; takes effect on reload.
    setHighPerformance(on) { this.highPerformance = !!on; this.persist() },
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

    // One-time conversion of a legacy inclusion list into the disabled-set model,
    // once the full set of effect slugs is known. Anything the user had NOT
    // enabled becomes disabled; any effect added later isn't in that frozen set,
    // so it's enabled by default. Idempotent.
    ensureMigrated(allSlugs) {
      if (this.effectOff !== null) return
      if (this.legacyIn && allSlugs && allSlugs.length) {
        const inc = new Set(this.legacyIn)
        this.effectOff = allSlugs.filter((sl) => !inc.has(sl))
      } else {
        this.effectOff = []
      }
      this.legacyIn = null
      this.persist()
    },
    // An effect is on unless it's explicitly in the disabled set (or, pre-
    // migration, unless the legacy inclusion list omits it).
    isEffectEnabled(slug) {
      if (this.effectOff) return !this.effectOff.includes(slug)
      if (this.legacyIn) return this.legacyIn.includes(slug)
      return true
    },
    toggleEffect(slug, allSlugs) {
      if (this.effectOff === null) this.ensureMigrated(allSlugs)
      const off = new Set(this.effectOff || [])
      off.has(slug) ? off.delete(slug) : off.add(slug)
      this.effectOff = [...off]
      this.persist()
    },
    enableAllEffects() { this.effectOff = []; this.legacyIn = null; this.persist() },
    // Drop disabled-set entries for effects that no longer exist (renamed or
    // removed sketches) so their options don't linger. `validSlugs` is the set
    // of slugs that currently exist.
    pruneEffectOff(validSlugs) {
      if (!this.effectOff || !this.effectOff.length) return
      const valid = validSlugs instanceof Set ? validSlugs : new Set(validSlugs)
      const kept = this.effectOff.filter((s) => valid.has(s))
      if (kept.length !== this.effectOff.length) { this.effectOff = kept; this.persist() }
    },
    // Filter a list of {slug} to the enabled pool. Disabled slugs are dropped;
    // everything else (including brand-new effects) is kept. Never strand the
    // feature with an empty list.
    filterToPool(list) {
      if (this.effectOff) {
        if (!this.effectOff.length) return list
        const off = new Set(this.effectOff)
        const kept = list.filter((s) => !off.has(s.slug))
        return kept.length ? kept : list
      }
      if (this.legacyIn) {
        const inc = new Set(this.legacyIn)
        const kept = list.filter((s) => inc.has(s.slug))
        return kept.length ? kept : list
      }
      return list
    },
  },
})
