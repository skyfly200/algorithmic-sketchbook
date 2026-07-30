import { defineStore } from 'pinia'
import { harmony, gradientStops } from '../lib/colorTheory'

// A master library of reusable colour palettes and gradients. Palettes are just
// lists of hex colours; gradients are lists of {pos,color} stops. The defaults
// are generated with colour-theory harmonies from a handful of base hues so the
// starter set is already balanced. Persisted to localStorage.
const KEY = 'sketchbook-palettes'
let seq = 1
const uid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

function makeDefaults() {
  const P = (name, base, type) => ({ id: uid(), name, colors: harmony(base, type), builtin: true })
  const palettes = [
    P('Sunset (triadic)', '#ff6b35', 'Triadic'),
    P('Ocean (analogous)', '#1ca9c9', 'Analogous'),
    P('Neon (tetradic)', '#ff2fd0', 'Tetradic'),
    P('Forest (analogous)', '#4a9d4a', 'Analogous'),
    P('Ember (mono)', '#e2571e', 'Monochromatic'),
    P('Berry (split)', '#8e2de2', 'Split-complementary'),
  ]
  const gradients = [
    { id: uid(), name: 'Sunset', stops: gradientStops(['#2b1055', '#c5299b', '#ff6b35', '#ffd166']), builtin: true },
    { id: uid(), name: 'Ocean', stops: gradientStops(['#0a1a40', '#1ca9c9', '#7ef0e0']), builtin: true },
    { id: uid(), name: 'Aurora', stops: gradientStops(['#04123b', '#1a9e6b', '#8be04e', '#c5f9d7']), builtin: true },
  ]
  return { palettes, gradients }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    if (s && Array.isArray(s.palettes)) return s
  } catch { /* fall through to defaults */ }
  return { ...makeDefaults(), activeId: null }
}

export const usePaletteStore = defineStore('palette', {
  state: () => {
    const s = load()
    return {
      palettes: s.palettes,
      gradients: s.gradients ?? [],
      activeId: s.activeId ?? (s.palettes[0]?.id ?? null),
    }
  },
  getters: {
    active: (s) => s.palettes.find((p) => p.id === s.activeId) || s.palettes[0] || null,
    // the flat set of swatches shown in pickers (the active palette's colours)
    swatches() { return this.active?.colors ?? [] },
  },
  actions: {
    persist() {
      localStorage.setItem(KEY, JSON.stringify({ palettes: this.palettes, gradients: this.gradients, activeId: this.activeId }))
    },
    setActive(id) { this.activeId = id; this.persist() },
    // Add a palette generated from a base colour via a colour-theory harmony.
    generate(base, type, name) {
      const p = { id: uid(), name: name || `${type} ${base}`, colors: harmony(base, type) }
      this.palettes.unshift(p); this.activeId = p.id; this.persist(); return p
    },
    addPalette(name, colors) {
      const p = { id: uid(), name: name || 'Palette', colors: colors.slice() }
      this.palettes.unshift(p); this.activeId = p.id; this.persist(); return p
    },
    renamePalette(id, name) { const p = this.palettes.find((p) => p.id === id); if (p) { p.name = name; this.persist() } },
    removePalette(id) {
      this.palettes = this.palettes.filter((p) => p.id !== id)
      if (this.activeId === id) this.activeId = this.palettes[0]?.id ?? null
      this.persist()
    },
    addColor(id, hex) { const p = this.palettes.find((p) => p.id === id); if (p) { p.colors.push(hex); this.persist() } },
    removeColor(id, idx) { const p = this.palettes.find((p) => p.id === id); if (p) { p.colors.splice(idx, 1); this.persist() } },
    addGradient(name, colors) {
      this.gradients.unshift({ id: uid(), name: name || 'Gradient', stops: gradientStops(colors) }); this.persist()
    },
    removeGradient(id) { this.gradients = this.gradients.filter((g) => g.id !== id); this.persist() },
    // Turn the active palette into a gradient in one click.
    gradientFromActive() {
      const a = this.active
      if (a && a.colors.length > 1) this.addGradient(a.name, a.colors)
    },
    resetDefaults() { const d = makeDefaults(); this.palettes = d.palettes; this.gradients = d.gradients; this.activeId = d.palettes[0].id; this.persist() },
  },
})
