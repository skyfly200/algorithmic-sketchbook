import { defineStore } from 'pinia'
import { allSketches } from '../registry'
import { traitsOf } from '../registry/traits'

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
    typeFilter: 'all', // 'all' | 'local' | 'external'
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
      return state.sketches.filter((s) => {
        if (state.typeFilter !== 'all' && s.type !== state.typeFilter) return false
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
