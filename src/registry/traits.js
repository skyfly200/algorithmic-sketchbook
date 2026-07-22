// Derived "vibe" traits for the gallery: which classical element a sketch
// evokes (fire / water / earth / air), whether it reads as calm or energetic,
// and how fast it runs. Speed comes straight from the measured perf score;
// element and energy are inferred from each sketch's slug + tags + title with
// keyword scoring, so we don't have to hand-annotate ~90 sketch.json files.
// A per-slug OVERRIDES map fixes any the heuristic gets wrong.
import { effectivePerf } from './localPerf'

export const ELEMENTS = [
  { key: 'fire', label: 'Fire', emoji: '🔥' },
  { key: 'water', label: 'Water', emoji: '💧' },
  { key: 'earth', label: 'Earth', emoji: '🌍' },
  { key: 'air', label: 'Air', emoji: '💨' },
]
export const ENERGIES = [
  { key: 'calm', label: 'Calm', emoji: '🍃' },
  { key: 'energetic', label: 'Energetic', emoji: '⚡' },
]
// Performance tiers by how much a sketch costs to run (measured on-device when
// available). "Light" is cheap/fast, "Heavy" is expensive/slow.
export const SPEEDS = [
  { key: 'light', label: 'Light' },
  { key: 'medium', label: 'Med' },
  { key: 'heavy', label: 'Heavy' },
]

const ELEMENT_KEYS = {
  fire: ['fire', 'flame', 'ember', 'coal', 'lava', 'spark', 'heat', 'rubens', 'lightning', 'plasma', 'neon', 'sun', 'solar', 'blaze', 'torch', 'candle', 'pyro', 'strobe', 'glow', 'uv', 'laser', 'burn', 'pulsar', 'bloom'],
  water: ['water', 'wave', 'ocean', 'ripple', 'droplet', 'drop', 'rain', 'fluid', 'caustic', 'foam', 'bubble', 'condensation', 'hydro', 'sea', 'liquid', 'marbling', 'marble', 'ferrofluid', 'tide', 'boil', 'wet', 'slime', 'ink'],
  earth: ['earth', 'sand', 'crystal', 'crystall', 'rock', 'stone', 'terrain', 'mineral', 'cellular', 'growth', 'mycelium', 'honeycomb', 'tessellation', 'tiling', 'geolog', 'garden', 'zen', 'lattice', 'automata', 'packing', 'moss', 'coral'],
  air: ['air', 'wind', 'cloud', 'sky', 'fog', 'mist', 'smoke', 'firefly', 'fireflies', 'murmuration', 'bird', 'flock', 'spider', 'web', 'nebula', 'star', 'dust', 'aurora', 'breeze', 'atmosphere', 'flow', 'wisp', 'balloon', 'kite'],
}
const ENERGY_KEYS = {
  energetic: ['audio-reactive', 'beat', 'strobe', 'lightning', 'fire', 'ember', 'explos', 'glitch', 'matrix', 'pulse', 'storm', 'chaos', 'energetic', 'neon', 'disco', 'plasma', 'spark', 'rave', 'laser', 'flash', 'fast', 'boil', 'flock', 'murmuration'],
  calm: ['zen', 'calm', 'drift', 'slow', 'gentle', 'fog', 'mist', 'cloud', 'condensation', 'breathe', 'ambient', 'meditat', 'garden', 'sky', 'float', 'soft', 'bloom', 'snow', 'star', 'dew', 'timelapse', 'flow-field'],
}

// Manual corrections where the keyword heuristic reads a sketch wrong.
const OVERRIDES = {
  'zen-garden': { element: 'earth', energy: 'calm' },
  'sky-timelapse': { element: 'air', energy: 'calm' },
  'spider-web': { element: 'air', energy: 'calm' },
  'sand-art': { element: 'earth', energy: 'calm' },
  'ocean-surface': { element: 'water', energy: 'calm' },
  'glowing-coals': { element: 'fire', energy: 'calm' },
  'rubens-tube': { element: 'fire', energy: 'energetic' },
}

function haystack(sketch) {
  return [sketch.slug, sketch.title, ...(sketch.tags ?? []), ...(sketch.tech ?? [])]
    .join(' ')
    .toLowerCase()
}
function scoreKeys(hay, map) {
  let best = null, bestN = 0
  for (const key in map) {
    let n = 0
    for (const w of map[key]) if (hay.includes(w)) n++
    if (n > bestN) { bestN = n; best = key }
  }
  return best
}

// Element/energy don't change; cache them. Speed is computed fresh each call so
// it reflects any on-device measurement recorded since.
const cache = new Map()
export function traitsOf(sketch) {
  let ee = cache.get(sketch.slug)
  if (!ee) {
    const ov = OVERRIDES[sketch.slug] ?? {}
    const hay = haystack(sketch)
    const element = ov.element ?? scoreKeys(hay, ELEMENT_KEYS)
    let energy = ov.energy ?? scoreKeys(hay, ENERGY_KEYS)
    if (!energy) energy = (sketch.tags ?? []).includes('audio-reactive') ? 'energetic' : 'calm'
    ee = { element, energy }
    cache.set(sketch.slug, ee)
  }
  return { ...ee, speed: speedTier(effectivePerf(sketch)) }
}

// Three-level performance tier from a 0-100 score: light / medium / heavy.
export function speedTier(perf) {
  if (perf == null) return null
  return perf >= 70 ? 'light' : perf >= 40 ? 'medium' : 'heavy'
}

export function elementMeta(key) { return ELEMENTS.find((e) => e.key === key) }
export function energyMeta(key) { return ENERGIES.find((e) => e.key === key) }
