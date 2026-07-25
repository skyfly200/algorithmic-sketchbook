import { reactive } from 'vue'
import { tlSnapshot, tlApply } from './timeline.js'
import { modSnapshot, modApply } from './modulation.js'
import { slideshow } from './slideshow.js'
import { DEFAULT_CUSTOM_EXPR, DEFAULT_SHAPE_EXPR, MAX_LAYERS } from './shaders/moire.js'

export { MAX_LAYERS }

export const PATTERN_GROUPS = [
  {
    label: 'Patterns',
    items: [
      { value: 0, label: 'Rings' },
      { value: 1, label: 'Lines' },
      { value: 2, label: 'Grid' },
      { value: 3, label: 'Spokes' },
      { value: 4, label: 'Spiral' },
      { value: 5, label: 'Checker' },
      { value: 6, label: 'Hex' },
      { value: 7, label: 'Waves' },
      { value: 8, label: 'Dots' },
      { value: 9, label: 'Custom pattern' },
    ],
  },
  {
    label: 'Shapes (great as masks)',
    items: [
      { value: 10, label: 'Circle' },
      { value: 11, label: 'Square' },
      { value: 12, label: 'Triangle' },
      { value: 13, label: 'Star' },
      { value: 14, label: 'Hexagon' },
      { value: 15, label: 'Custom shape (SDF)' },
    ],
  },
]

export const LAYER_OPS = [
  { value: 0, label: 'Multiply' },
  { value: 1, label: 'Difference' },
  { value: 2, label: 'Average' },
  { value: 3, label: 'Min' },
  { value: 4, label: 'Max' },
  { value: 5, label: 'Screen' },
  { value: 6, label: 'Add' },
  { value: 7, label: 'Subtract' },
  { value: 8, label: 'Mask' },
]

export const AA_MODES = [
  { value: 0, label: 'Off — aliased' },
  { value: 1, label: 'Smooth (fwidth)' },
  { value: 2, label: 'Supersample 4×' },
  { value: 3, label: 'Supersample 16×' },
]

export const COLOR_MODES = [
  { value: 0, label: 'Duotone' },
  { value: 1, label: 'Gradient' },
  { value: 2, label: 'Rainbow' },
  { value: 3, label: 'Per-layer' },
]

const LAYER_COLORS = [
  '#ff5c7a', '#5cc8ff', '#ffd166', '#9b5cff',
  '#5cffb0', '#ff9e5c', '#5c7aff', '#ff5cf0',
]

function makeLayer(freq = 140, rot = 0, x = 0, y = 0, pattern = 0, op = 0) {
  return { freq, rot, x, y, pattern, op }
}

export function defaultSettings() {
  return {
    aaMode: 0,
    resScale: 0, // 0 = auto (device pixel ratio), else a fixed multiplier
    showFps: false,
    layerCount: 2,
    zoom: 1,
    thickness: 0.5,
    animate: false,
    animSpeed: 1,
    drift: true,
    colorMode: 0,
    colorA: '#0b0b0f',
    colorB: '#f5f5f0',
    colorC: '#ff4d6d',
    customExpr: DEFAULT_CUSTOM_EXPR,
    customShapeExpr: DEFAULT_SHAPE_EXPR,
    activeLayer: 0,
    layers: [
      makeLayer(140, 0, -0.06, 0),
      makeLayer(143, 0, 0.06, 0),
      makeLayer(150, 0.5, 0, 0.1),
      makeLayer(160, -0.5, 0, -0.1),
      makeLayer(170, 0.3, 0.1, 0),
      makeLayer(180, -0.3, -0.1, 0),
      makeLayer(190, 0.6, 0, -0.1),
      makeLayer(200, -0.6, 0.05, 0.05),
    ].slice(0, MAX_LAYERS).map((l, i) => ({ ...l, color: LAYER_COLORS[i], alpha: 1 })),
  }
}

export const settings = reactive(defaultSettings())

// Compiled-shader status for the custom expression (written by MoireCanvas,
// read by the control panel).
export const shaderState = reactive({ error: '' })

export const PRESETS = [
  {
    name: 'Classic rings',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.5,
      layers: [makeLayer(140, 0, -0.06, 0), makeLayer(143, 0, 0.06, 0)],
    },
  },
  {
    name: 'Rotated lines',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.5,
      layers: [makeLayer(180, 0, 0, 0, 1), makeLayer(180, 0.07, 0, 0, 1, 1)],
    },
  },
  {
    name: 'Grid interference',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.55,
      layers: [makeLayer(120, 0, 0, 0, 2), makeLayer(121, 0.035, 0, 0, 2)],
    },
  },
  {
    name: 'Radial spokes',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.5,
      layers: [makeLayer(240, 0, -0.03, 0, 3), makeLayer(240, 0.02, 0.03, 0, 3, 1)],
    },
  },
  {
    name: 'Spiral beat',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.5,
      layers: [makeLayer(150, 0, -0.04, 0, 4), makeLayer(153, 0, 0.04, 0, 4, 1)],
    },
  },
  {
    name: 'Masked mix',
    apply: {
      aaMode: 0, layerCount: 3, zoom: 1, thickness: 0.5,
      layers: [
        makeLayer(200, 0, 0, 0, 1),        // lines below the mask
        makeLayer(30, 0, 0, 0, 0, 8),      // low-frequency rings as the mask
        makeLayer(260, 0.02, 0, 0, 3),     // spokes above the mask
      ],
    },
  },
  {
    name: 'Hex weave',
    apply: {
      aaMode: 0, layerCount: 2, zoom: 1, thickness: 0.55,
      layers: [makeLayer(110, 0, 0, 0, 6), makeLayer(112, 0.03, 0, 0, 6)],
    },
  },
  {
    name: 'Circle window',
    apply: {
      aaMode: 0, layerCount: 3, zoom: 1, thickness: 0.5,
      layers: [
        makeLayer(140, 0, -0.04, 0),          // rings outside the circle
        makeLayer(75, 0, 0, 0, 10, 8),        // circle shape as the mask
        makeLayer(200, 0.06, 0, 0, 1, 1),     // lines inside the circle
      ],
    },
  },
  {
    name: 'Star window',
    apply: {
      aaMode: 0, layerCount: 3, zoom: 1, thickness: 0.5,
      layers: [
        makeLayer(120, 0, 0, 0, 2),           // grid outside the star
        makeLayer(55, 0, 0, 0, 13, 8),        // star shape as the mask
        makeLayer(150, 0, 0, 0, 4),           // spiral inside the star
      ],
    },
  },
  {
    name: 'Aliasing demo',
    apply: {
      aaMode: 0, layerCount: 1, zoom: 1, thickness: 0.5,
      layers: [makeLayer(800, 0, 0, 0)],
    },
  },
]

export function applyPreset(preset) {
  const a = preset.apply
  settings.aaMode = a.aaMode
  settings.layerCount = a.layerCount
  settings.zoom = a.zoom
  settings.thickness = a.thickness
  settings.activeLayer = 0
  a.layers.forEach((l, i) => Object.assign(settings.layers[i], l))
}

const SNAP_KEYS = [
  'aaMode', 'resScale', 'layerCount', 'zoom', 'thickness', 'animate', 'animSpeed',
  'drift', 'colorMode', 'colorA', 'colorB', 'colorC', 'customExpr',
  'customShapeExpr', 'showFps',
]

export function snapshot() {
  const s = { v: 2 }
  for (const k of SNAP_KEYS) s[k] = settings[k]
  s.layers = settings.layers.map((l) => ({
    freq: +l.freq.toFixed(2),
    rot: +l.rot.toFixed(4),
    x: +l.x.toFixed(4),
    y: +l.y.toFixed(4),
    pattern: l.pattern,
    op: l.op,
    color: l.color,
    alpha: l.alpha ?? 1,
  }))
  s.tl = tlSnapshot()
  s.mods = modSnapshot()
  s.show = { m: slideshow.mode, i: slideshow.interval, r: slideshow.morphRate }
  return s
}

export function applySnapshot(s) {
  for (const k of SNAP_KEYS) if (s[k] !== undefined) settings[k] = s[k]
  if (Array.isArray(s.layers)) {
    s.layers.forEach((l, i) => {
      if (settings.layers[i]) Object.assign(settings.layers[i], l)
    })
  }
  // v1 snapshots had a single global pattern type and blend mode; the old
  // blend values map 1:1 onto per-layer op values.
  if (s.patternType !== undefined) {
    settings.layers.forEach((l) => (l.pattern = s.patternType))
  }
  if (s.blendMode !== undefined && s.layers?.[0]?.op === undefined) {
    settings.layers.forEach((l) => (l.op = s.blendMode))
  }
  settings.activeLayer = 0
  tlApply(s.tl)
  modApply(s.mods)
  if (s.show) {
    slideshow.mode = s.show.m || 'current'
    slideshow.interval = Math.min(60, Math.max(2, +s.show.i || 8))
    slideshow.morphRate = Math.min(60, Math.max(0.5, +s.show.r || 8))
  }
}

export function encodeSnapshot(s = snapshot()) {
  const bytes = new TextEncoder().encode(JSON.stringify(s))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeSnapshot(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function shareURL(snap) {
  return `${location.origin}${location.pathname}#s=${encodeSnapshot(snap)}`
}

export function loadFromHash() {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/)
  if (!m) return false
  try {
    applySnapshot(decodeSnapshot(m[1]))
    return true
  } catch {
    return false
  }
}

export function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

// What the main Randomize button (and the R key / on-beat randomize) touches.
export const randomizeOpts = reactive({
  patterns: true,
  ops: true,
  freqs: true,
  offsets: true,
  layerCount: true,
  thickness: true,
  colors: true,
})

const rnd = (min, max) => min + Math.random() * (max - min)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Undo/redo history for randomize, so a cool pattern skipped by accident can
// be recovered. Each manual randomize records the pre-change snapshot.
export const history = reactive({ past: [], future: [] })
const HISTORY_MAX = 80

function pushHistory() {
  history.past.push(snapshot())
  if (history.past.length > HISTORY_MAX) history.past.shift()
  history.future.length = 0
}

export function undoRandomize() {
  if (!history.past.length) return
  history.future.push(snapshot())
  applySnapshot(history.past.pop())
}

export function redoRandomize() {
  if (!history.future.length) return
  history.past.push(snapshot())
  applySnapshot(history.future.pop())
}

export function randomizeColors(record = true) {
  if (record) pushHistory()
  const hue = Math.random() * 360
  const h2 = (hue + 120 + Math.random() * 120) % 360
  settings.colorA = hslToHex(hue, 0.5, 0.06)
  if (settings.colorMode === 3) {
    settings.layers.forEach((l, i) => {
      l.color = hslToHex((hue + i * 137.5) % 360, 0.8, 0.6)
    })
  } else {
    settings.colorB = hslToHex(h2, 0.85, 0.62)
    settings.colorC = hslToHex((h2 + 80) % 360, 0.85, 0.55)
  }
}

export function randomizePattern(opts = null, record = true) {
  if (record) pushHistory()
  const o = opts || {
    patterns: true, ops: true, freqs: true, offsets: true,
    layerCount: true, thickness: true,
  }
  if (o.layerCount) settings.layerCount = 2 + Math.floor(rnd(0, 4))
  if (o.thickness) settings.thickness = rnd(0.35, 0.65)
  const baseFreq = rnd(60, 400)
  const basePattern = pick([0, 1, 2, 3, 4, 5, 6, 7, 8])
  settings.layers.forEach((l, i) => {
    if (o.freqs) l.freq = baseFreq * rnd(0.97, 1.03)
    if (o.offsets) {
      l.rot = rnd(-0.15, 0.15) * i
      l.x = rnd(-0.15, 0.15)
      l.y = rnd(-0.15, 0.15)
    }
    // Mostly keep layers on one pattern family (classic moiré), sometimes mix.
    if (o.patterns) {
      l.pattern = Math.random() < 0.75 ? basePattern : pick([0, 1, 2, 3, 4, 5, 6, 7, 8])
    }
    if (o.ops) l.op = pick([0, 0, 1, 1, 3, 4, 5])
  })
  // Occasionally drop a mask into the middle of the stack — sometimes a
  // low-frequency grating, sometimes a shape window.
  if (o.ops && settings.layerCount >= 3 && Math.random() < 0.4) {
    const m = settings.layers[1]
    m.op = 8
    if (Math.random() < 0.5) {
      m.pattern = pick([10, 11, 12, 13, 14])
      m.freq = rnd(45, 90)
      m.x = rnd(-0.3, 0.3)
      m.y = rnd(-0.3, 0.3)
    } else {
      m.freq = rnd(15, 60)
    }
  }
}

export function randomize(record = true) {
  if (record) pushHistory()
  randomizePattern(randomizeOpts, false)
  if (randomizeOpts.colors) randomizeColors(false)
}
