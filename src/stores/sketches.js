import { defineStore } from 'pinia'
import { allSketches } from '../registry'
import { traitsOf } from '../registry/traits'
import { isFilterSketch } from '../registry/filters'
import { useSettingsStore } from './settings'

// Curated theme filters. Raw tags+tech produced ~50 chips (most on a single
// project); instead each chip is a theme backed by a set of keywords matched
// against a project's tags + tech, so one chip reliably catches every project
// it should even when their tag wording differs. Order = display order.
export const CATEGORIES = [
  { label: '3D', keys: ['3d', 'three.js', 'phyllotaxis', 'holographic'] },
  { label: 'Shader', keys: ['shader', 'glsl'] },
  { label: 'Optics', keys: ['optics', 'diffraction', 'interference', 'moire', 'caustics', 'holographic', 'zone-plate'] },
  { label: 'Simulation', keys: ['simulation', 'boiling', 'bubbles', 'foam', 'condensation', 'droplets', 'fluid', 'water', 'packing', 'particles'] },
  { label: 'Fractal', keys: ['fractal', 'mandelbrot', 'julia', 'zoom', 'kaleidoscope', 'loop'] },
  { label: 'Geometric', keys: ['tessellation', 'grid', 'hexagons', 'token-art'] },
  { label: 'Motion', keys: ['motion', 'video', 'computer-vision', 'webcam', 'mask', 'compositing'] },
  { label: 'Audio-reactive', keys: ['audio-reactive', 'beat', 'web-audio'] },
]

function matchesCategory(sketch, label) {
  const cat = CATEGORIES.find((c) => c.label === label)
  if (!cat) return false
  const terms = [...sketch.tags, ...sketch.tech]
  return cat.keys.some((k) => terms.includes(k))
}

export const useSketchStore = defineStore('sketches', {
  state: () => ({
    sketches: allSketches,
    search: '',
    selectedCategories: [],
    selectedElements: [], // fire | water | earth | air
    selectedEnergy: [], // calm | energetic
    selectedSpeed: [], // fast | slow
    roleFilter: 'all', // 'all' | 'effect' | 'filter'
    sortBy: 'featured', // 'featured' | 'name' | 'newest' | 'performance'
  }),

  getters: {
    // Only show category chips that actually match at least one project.
    categories(state) {
      return CATEGORIES.filter((c) => state.sketches.some((s) => matchesCategory(s, c.label))).map(
        (c) => c.label,
      )
    },

    filtered(state) {
      // `clearable` on the search field sets the model to null — coerce so an
      // empty/cleared search shows every sketch instead of throwing.
      const q = (state.search ?? '').trim().toLowerCase()
      const list = state.sketches.filter((s) => {
        // Effect vs filter role split
        if (state.roleFilter === 'filter' && !isFilterSketch(s)) return false
        if (state.roleFilter === 'effect' && isFilterSketch(s)) return false
        // Union: a project shows if it matches ANY selected theme, so combining
        // chips broadens the view instead of narrowing it to nothing.
        if (
          state.selectedCategories.length &&
          !state.selectedCategories.some((c) => matchesCategory(s, c))
        )
          return false
        // Trait filters (element / energy / speed) — each is a union within the
        // group; the groups AND together.
        if (state.selectedElements.length || state.selectedEnergy.length || state.selectedSpeed.length) {
          const t = traitsOf(s)
          if (state.selectedElements.length && !state.selectedElements.includes(t.element)) return false
          if (state.selectedEnergy.length && !state.selectedEnergy.includes(t.energy)) return false
          if (state.selectedSpeed.length && !state.selectedSpeed.includes(t.speed)) return false
        }
        if (q) {
          const haystack = [s.title, s.description, ...s.tags, ...s.tech].join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      })
      // With an active search, rank by how well each result matches the query
      // — title hits first (exact → prefix → word-prefix → substring), then
      // tags/tech, then description — so typing an effect's name floats it to
      // the top instead of leaving it wherever the sort order puts it.
      if (q) {
        const score = (s) => {
          const title = (s.title || '').toLowerCase()
          if (title === q) return 100
          if (title.startsWith(q)) return 90
          if (title.split(/\s+/).some((w) => w.startsWith(q))) return 80
          if (title.includes(q)) return 70
          if (s.tags?.some((t) => t.toLowerCase() === q)) return 60
          if (s.tags?.some((t) => t.toLowerCase().includes(q))) return 50
          if (s.tech?.some((t) => t.toLowerCase().includes(q))) return 40
          if ((s.description || '').toLowerCase().includes(q)) return 20
          return 10
        }
        return list
          .map((s, i) => [s, i])
          .sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1])
          .map((x) => x[0])
      }
      // Sort — 'featured' keeps the registry's default (newest-first) order.
      const by = state.sortBy
      if (by === 'name') list.sort((a, b) => a.title.localeCompare(b.title))
      // 'newest' = most recently *updated* (last git commit touching the sketch),
      // falling back to its created date.
      else if (by === 'newest') list.sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || ''))
      else if (by === 'performance') list.sort((a, b) => (b.perf ?? -1) - (a.perf ?? -1))
      else if (by === 'featured') {
        // Starred favorites float to the top, otherwise keep the default order.
        // A stable partition so both groups keep their relative ordering.
        const fav = useSettingsStore().favoriteSet
        if (fav.size) {
          const stars = list.filter((s) => fav.has(s.slug))
          const rest = list.filter((s) => !fav.has(s.slug))
          return [...stars, ...rest]
        }
      }
      return list
    },
  },

  actions: {
    bySlug(slug) {
      return this.sketches.find((s) => s.slug === slug) ?? null
    },
    toggleCategory(label) {
      const i = this.selectedCategories.indexOf(label)
      i === -1 ? this.selectedCategories.push(label) : this.selectedCategories.splice(i, 1)
    },
    toggleTrait(group, key) {
      const arr = this[group]
      const i = arr.indexOf(key)
      i === -1 ? arr.push(key) : arr.splice(i, 1)
    },
  },
})
