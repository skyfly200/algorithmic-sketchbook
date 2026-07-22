<script setup>
/**
 * Patch — a TouchDesigner-style node compositor for live visuals. Drop operator
 * nodes, drag wires between their ports, and a per-frame compositor pipes each
 * node's rendered frame into the next:
 *
 *   Effect / Camera (sources) → Motion (extraction) → Mask / Blend → Output
 *
 * Every node renders into a small offscreen canvas (its thumbnail). Sources are
 * captured from same-origin sketch iframes (?capture=1) or the webcam; operators
 * run native canvas ops. The Output node blits to the fullscreen stage behind
 * the graph. Cycles are allowed — an upstream canvas simply holds last frame,
 * giving video-feedback loops. Graph persists in localStorage.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSketchStore } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'
import TourOverlay from '../components/TourOverlay.vue'
import perfScores from '../registry/perf.json'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'
import { createMidiInput, createLeapInput, createArtnetInput } from '../../sketches/_lib/inputs.js'
import { mediaLibrary, addMediaFile, addRecordedClip, removeMedia, mediaById, startSharedCamera, stopSharedCamera, sharedCameraOn, flipSharedCamera } from '../stores/media.js'

const store = useSketchStore()
const settings = useSettingsStore()
// Source-filter sketches (built on _lib/source.js): they accept a mixer:frame
// feed, so in the graph they live behind a dedicated Filter node type that
// pipes its video input straight into them.
const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone',
  'channel-offset', 'delay', 'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope',
  'fog', 'mist', 'glow', 'nebula-gasses', 'strobe', 'color-filter', 'crt', 'uv-light', 'polarization', 'light-leaves', 'warp', 'rolling-shutter', 'feedback', 'interlace',
]
// Only local, same-origin sketches can be captured for piping. Filters (and
// Motion Extraction, which has a native node) are organized under the Filter
// node type instead of the Effect source list.
const effectOptions = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && !FILTER_SLUGS.includes(s.slug)),
)
const filterOptions = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && FILTER_SLUGS.includes(s.slug)),
)

// Internal compositor resolution — a user setting (all node canvases and the
// ring buffers are sized to it). Higher = sharper piping, more GPU/CPU.
// `native` sizes the compositor to the actual screen (device pixels), capped so
// huge displays don't melt the GPU; its dimensions are resolved at apply time.
const RESOLUTIONS = [
  { label: '384 × 216', w: 384, h: 216 },
  { label: '640 × 360', w: 640, h: 360 },
  { label: '960 × 540', w: 960, h: 540 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: 'Native', native: true },
]
function resolveRes(r) {
  if (!r?.native) return { w: r.w, h: r.h }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const scale = Math.min(1, 2560 / (window.innerWidth * dpr)) // cap the long edge ~2560
  return {
    w: Math.round(window.innerWidth * dpr * scale),
    h: Math.round(window.innerHeight * dpr * scale),
  }
}
const RES_KEY = 'sketchbook-patch-res'
const resLabel = ref(localStorage.getItem(RES_KEY) || RESOLUTIONS[0].label)
let W = resolveRes(RESOLUTIONS.find((r) => r.label === resLabel.value) ?? RESOLUTIONS[0]).w
let H = resolveRes(RESOLUTIONS.find((r) => r.label === resLabel.value) ?? RESOLUTIONS[0]).h
function applyResolution(label) {
  const r = RESOLUTIONS.find((x) => x.label === label)
  if (!r) return
  const dim = resolveRes(r)
  W = dim.w
  H = dim.h
  resLabel.value = label
  localStorage.setItem(RES_KEY, label)
  // Resize every existing node canvas to the new resolution.
  for (const s of rtState.values()) {
    s.out.width = W
    s.out.height = H
  }
  // Source iframes are CSS-sized to the compositor, so their sketches actually
  // render this many pixels (they run quality=high → pixelRatio 1).
  frameSize.value = { w: W, h: H }
  geomVer.value++ // the mask overlay's cover-fit depends on W/H
}

const NODE_W = 190
const HEAD_H = 30
const THUMB_H = 107

const TYPES = {
  effect: { title: 'Effect', ins: 0, color: '#7c8cff' },
  filter: { title: 'Filter', ins: 1, color: '#c98cff' },
  media: { title: 'Media', ins: 0, color: '#4dd0c4' }, // camera / files / clips
  text: { title: 'Text', ins: 0, color: '#ff9ec4' },
  portal: { title: 'Portal', ins: 1, color: '#8ad0ff' }, // remap a region elsewhere
  mask: { title: 'Mask', ins: 2, color: '#f2ad00' },
  shape: { title: 'Polygon Mask', ins: 1, color: '#f2ad00' }, // clip to an editable polygon (projection mapping)
  blend: { title: 'Blend', ins: 2, color: '#a0e060' },
  output: { title: 'Output', ins: 1, color: '#ffffff' },
  // Control emitters (0..1 values, not video): their output jacks wire into the
  // parameter jacks of other nodes to modulate them live.
  input: { title: 'Input', ins: 0, color: '#e0a060' },
  xy: { title: 'XY Pad', ins: 0, color: '#e0a060' },
  tracker: { title: 'Tracker', ins: 1, color: '#e0a060' },
}
// How many control/video outputs a node exposes (xy: x,y · tracker: x,y,size).
function outCount(n) {
  if (n.type === 'output') return 0
  if (n.type === 'xy') return 2
  if (n.type === 'tracker') return 3
  return 1
}
const OUT_LABELS = { xy: ['x', 'y'], tracker: ['x', 'y', 'size'] }
// Numeric params a control wire can drive on the non-effect operator nodes
// (effect params come from the sketch's own schema over postMessage).
const PARAM_RANGES = {
  blend: { mix: [0, 1] },
  // Text's numeric font/layout controls are all control-mappable (drag an
  // Input/XY/Tracker output onto their ▣ jacks to animate the type).
  text: { size: [0.03, 0.6], weight: [100, 900], tracking: [-0.1, 0.5], x: [0, 1], y: [0, 1], hue: [0, 360], rotate: [-180, 180] },
  // Portal: a source region is remapped (copied/scaled) into a destination
  // region — all eight edges control-mappable so the portal can roam.
  portal: { srcX: [0, 1], srcY: [0, 1], srcW: [0.05, 1], srcH: [0.05, 1], dstX: [0, 1], dstY: [0, 1], dstW: [0.05, 1], dstH: [0.05, 1] },
  // Polygon Mask: only the edge softness is a scalar worth modulating; the
  // vertices are edited by dragging on the output.
  shape: { feather: [0, 0.5] },
}
const TEXT_FONTS = ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive']
// Portal destination shapes + aspect-ratio presets (for lock-proportions).
const PORTAL_SHAPES = ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'heart']
const ASPECTS = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '2:1': 2, '9:16': 9 / 16, '3:4': 3 / 4 }
// Build a path for a portal shape inscribed in the rect (x,y,w,h).
function portalShapePath(ctx, shape, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2
  ctx.beginPath()
  if (shape === 'ellipse') {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath()
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, y); ctx.lineTo(x + w, cy); ctx.lineTo(cx, y + h); ctx.lineTo(x, cy); ctx.closePath()
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3
      const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 ? 0.42 : 1
      const px = cx + Math.cos(a) * rx * r, py = cy + Math.sin(a) * ry * r
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape === 'heart') {
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2
      const hx = 16 * Math.pow(Math.sin(t), 3)
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      const px = cx + (hx / 17) * rx, py = cy - (hy / 17) * ry
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else {
    ctx.rect(x, y, w, h)
  }
}
const BLENDS = [
  'screen', 'add', 'lighten', 'darken', 'multiply', 'overlay', 'soft-light',
  'hard-light', 'color-dodge', 'color-burn', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
]
// Input sources grouped for the pickers (audio, midi, mouse, touch, tilt,
// time, leap, artnet — per-category optgroups instead of one long list).
const INPUT_GROUPS = computed(() => {
  const groups = { audio: [], midi: [], mouse: [], touch: [], tilt: [], time: [], leap: [], artnet: [] }
  for (const s of INPUT_SOURCES) {
    const head = s.split('.')[0]
    const g = head === 'shake' ? 'tilt' : head
    ;(groups[g] ?? (groups[g] = [])).push(s)
  }
  return Object.entries(groups).filter(([, list]) => list.length)
})

// --- persisted graph ---
const STORE_KEY = 'sketchbook-patch'
function loadGraph() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    return null
  }
}
// Migration: Motion Extract used to be its own node type; it's now just the
// motion-extraction sketch behind a Filter node, so legacy graphs convert.
function normalizeNodes(list) {
  for (const n of list ?? []) {
    if (!n.params) n.params = {} // guard malformed/legacy saves
    if (n.type === 'motion') {
      n.type = 'filter'
      n.params = { slug: 'motion-extraction' }
    }
    if (n.type === 'camera') {
      n.type = 'media'
      n.params = { mode: 'camera', mediaId: null }
    }
  }
  return list
}
const saved = loadGraph()
let nextId = 1
const nodes = reactive(normalizeNodes(saved?.nodes) ?? [])
const edges = reactive(saved?.edges ?? [])
// Control links: an Input node's value → a numeric param on another node.
const links = reactive(saved?.links ?? [])
if (nodes.length) nextId = Math.max(...nodes.map((n) => n.id)) + 1

// --- undo / redo: every persisted change pushes the previous graph state ----
const undoStack = reactive([])
const redoStack = reactive([])
let restoring = false
const snapshot = () => JSON.stringify({ nodes, edges, links })
let lastSnap = snapshot()

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ nodes, edges, links }))
  if (restoring) return
  const s = snapshot()
  if (s !== lastSnap) {
    undoStack.push(lastSnap)
    if (undoStack.length > 60) undoStack.shift()
    redoStack.splice(0)
    lastSnap = s
  }
}

function applySnap(s) {
  restoring = true
  const data = JSON.parse(s)
  nodes.splice(0, nodes.length, ...data.nodes.map((n) => reactive(n)))
  edges.splice(0, edges.length, ...data.edges)
  links.splice(0, links.length, ...(data.links ?? []))
  pruneOrphans()
  nextId = nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1
  const ids = new Set(nodes.map((n) => n.id))
  for (const id of [...rtState.keys()]) if (!ids.has(id)) rtState.delete(id)
  for (const n of nodes) st(n.id)
  localStorage.setItem(STORE_KEY, s)
  lastSnap = s
  restoring = false
  nextTick(() => layoutTick.value++)
}
function undo() {
  if (!undoStack.length) return
  redoStack.push(snapshot())
  applySnap(undoStack.pop())
}
function redo() {
  if (!redoStack.length) return
  undoStack.push(snapshot())
  applySnap(redoStack.pop())
}

// Non-reactive per-node runtime state (canvases, iframes, video, ring buffers).
const rtState = new Map()
function st(id) {
  let s = rtState.get(id)
  if (!s) {
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    s = { out, octx: out.getContext('2d'), iframe: null, video: null }
    rtState.set(id, s)
  }
  return s
}

function addNode(type) {
  const n = reactive({
    id: nextId++,
    type,
    x: 60 + (nodes.length % 4) * 60,
    y: 90 + (nodes.length % 4) * 40,
    params:
      type === 'blend'
        ? { mode: 'screen' }
        : type === 'effect'
          ? { slug: effectOptions.value[0]?.slug ?? '' }
          : type === 'filter'
            ? { slug: filterOptions.value[0]?.slug ?? '' }
            : type === 'input'
              ? { source: 'audio.volume', scale: 1, offset: 0, invert: false, curve: 'linear' }
              : type === 'xy'
                ? { x: 0.5, y: 0.5 }
                : type === 'tracker'
                  ? { thresh: 0.5, smooth: 0.7 }
                  : type === 'media'
                    ? { mode: 'camera', mediaId: null }
                    : type === 'text'
                      ? { text: 'BRIGHT WAVES', font: 'sans-serif', size: 0.18, weight: 700, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, rotate: 0, italic: false, glow: 0.4, bg: false }
                      : type === 'portal'
                        ? { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' }
                        : type === 'shape'
                          ? { points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], feather: 0, invert: false }
                          : {},
  })
  // Polygon Mask nodes lock by default so a mapped mask isn't nudged or
  // randomized by accident — its corners are still editable via "Edit masks".
  if (type === 'shape') n.locked = true
  nodes.push(n)
  st(n.id) // create runtime state
  persist()
  nextTick(() => layoutTick.value++)
}
function removeNode(id) {
  const i = nodes.findIndex((n) => n.id === id)
  if (i < 0 || nodes[i].locked) return // locked nodes are protected from removal
  nodes.splice(i, 1)
  selectedSet.delete(id)
  pruneOrphans()
  rtState.delete(id)
  persist()
}

// Drop any edge/link whose endpoints (or ports) no longer exist — a routing
// loaded after a node was deleted, or a control link whose source port
// disappeared when the node's type changed, would otherwise leave a wire
// pointing at nothing. Returns true if anything was removed.
function pruneOrphans() {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let changed = false
  for (let k = edges.length - 1; k >= 0; k--) {
    const e = edges[k]
    const to = byId.get(e.to)
    if (!byId.has(e.from) || !to || e.port >= (TYPES[to.type]?.ins ?? 0)) {
      edges.splice(k, 1)
      changed = true
    }
  }
  for (let k = links.length - 1; k >= 0; k--) {
    const l = links[k]
    const from = byId.get(l.from)
    const tgt = byId.get(l.node)
    if (!from || !tgt || (l.srcPort ?? 0) >= outCount(from)) {
      links.splice(k, 1)
      changed = true
    }
  }
  return changed
}

// --- randomize: deal out a whole new patch -------------------------------
// Builds a fresh random-but-sensible graph: 1–3 effect sources, each pushed
// through a random filter chain, the streams folded together with random
// blends (or the odd mask), an Output at the end, and a control node wired
// into a blend mix. Goes through persist(), so it's a single undo step.
function randomPatch() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const chance = (p) => Math.random() < p

  // Keep locked nodes (and any wiring purely among them); randomize the rest.
  const keptIds = new Set(nodes.filter((n) => n.locked).map((n) => n.id))
  const keptNodes = nodes.filter((n) => keptIds.has(n.id))
  const keptEdges = edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
  const keptLinks = links.filter((l) => keptIds.has(l.from) && keptIds.has(l.to))
  nodes.splice(0, nodes.length, ...keptNodes)
  edges.splice(0, edges.length, ...keptEdges)
  links.splice(0, links.length, ...keptLinks)
  for (const id of [...rtState.keys()]) if (!keptIds.has(id)) rtState.delete(id)
  if (keptIds.size) nextId = Math.max(nextId, ...keptIds) + 1

  const col = (c) => 60 + c * 240
  const mk = (type, params, c, y) => {
    const n = reactive({ id: nextId++, type, x: col(c) + Math.random() * 30, y, params })
    nodes.push(n)
    st(n.id)
    return n
  }

  // 1–3 source chains: effect → 0–2 filters.
  const nChains = 1 + Math.floor(Math.random() * 3)
  const heads = [] // last node of each chain
  let maxCol = 0
  const pooledEffects = settings.filterToPool(effectOptions.value) // app-wide effect selection
  for (let i = 0; i < nChains; i++) {
    const y = 90 + i * 230
    let prev = mk('effect', { slug: pick(pooledEffects)?.slug ?? '' }, 0, y)
    const nFilters = chance(0.75) ? 1 + (chance(0.3) ? 1 : 0) : 0
    for (let f = 0; f < nFilters; f++) {
      const filt = mk('filter', { slug: pick(filterOptions.value)?.slug ?? '' }, 1 + f, y + 20 * (f + 1))
      edges.push({ from: prev.id, to: filt.id, port: 0 })
      prev = filt
      maxCol = Math.max(maxCol, 1 + f)
    }
    heads.push(prev)
  }

  // Fold the chains together pairwise with blends (or the odd mask).
  let c = maxCol + 1
  const blends = []
  while (heads.length > 1) {
    const a = heads.shift()
    const b = heads.shift()
    const useMask = chance(0.2)
    const node = useMask
      ? mk('mask', {}, c, (a.y + b.y) / 2)
      : mk('blend', { mode: pick(BLENDS), mix: +(0.4 + Math.random() * 0.6).toFixed(2) }, c, (a.y + b.y) / 2)
    edges.push({ from: a.id, to: node.id, port: 0 })
    edges.push({ from: b.id, to: node.id, port: 1 })
    if (!useMask) blends.push(node)
    heads.unshift(node)
    c++
  }

  const outNode = mk('output', {}, c, heads[0].y + 10)
  edges.push({ from: heads[0].id, to: outNode.id, port: 0 })

  // A control node driving a blend's mix, when there is one.
  if (blends.length && chance(0.8)) {
    const tgt = pick(blends)
    if (chance(0.35)) {
      const xy = mk('xy', { x: Math.random(), y: Math.random() }, Math.max(0, tgt.x > 300 ? 1 : 0), tgt.y + 240)
      links.push({ from: xy.id, srcPort: Math.floor(Math.random() * 2), node: tgt.id, param: 'mix' })
    } else {
      const src = pick(['audio.volume', 'audio.pulse', 'audio.low', 'time.sin', 'mouse.x', 'mouse.y'])
      const inp = mk('input', { source: src, scale: 1, offset: 0 }, Math.max(0, 1), tgt.y + 240)
      links.push({ from: inp.id, srcPort: 0, node: tgt.id, param: 'mix' })
    }
  }

  selected.value = null
  persist()
  nextTick(() => layoutTick.value++)
}

// --- rename ---
const editingName = ref(null) // node id whose title is being edited
function startRename(n) {
  editingName.value = n.id
}
function commitRename(n, value) {
  const v = value.trim()
  n.name = v || undefined // empty falls back to the type's default title
  editingName.value = null
  persist()
}
function nodeTitle(n) {
  return n.name || TYPES[n.type].title
}

// --- copy / paste (Ctrl/Cmd+C / +V) ---
const clipboard = ref(null)
function copySelection() {
  if (selected.value == null) return
  const n = nodes.find((x) => x.id === selected.value)
  if (n) clipboard.value = JSON.parse(JSON.stringify({ type: n.type, name: n.name, params: n.params }))
}
function pasteClipboard() {
  if (!clipboard.value) return
  const c = clipboard.value
  const n = reactive({
    id: nextId++,
    type: c.type,
    name: c.name,
    x: 80 + (nodes.length % 5) * 30,
    y: 110 + (nodes.length % 5) * 30,
    params: JSON.parse(JSON.stringify(c.params)),
  })
  nodes.push(n)
  st(n.id)
  selected.value = n.id
  persist()
}
function onKey(e) {
  if (editingName.value != null) return // don't hijack typing in the name field
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key === 'c') copySelection()
  else if (mod && e.key === 'v') pasteClipboard()
  else if (mod && (e.key === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
  else if (mod && e.key === 'z') { e.preventDefault(); undo() }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value != null) {
    removeNode(selected.value)
    selected.value = null
  }
}
function clearAll() {
  nodes.splice(0)
  edges.splice(0)
  rtState.clear()
  persist()
}

// --- ports & wiring ---
const board = ref(null)
function outPortAt(n, i = 0) {
  const cnt = outCount(n) || 1
  return { x: n.x + NODE_W, y: n.y + HEAD_H + (THUMB_H * (i + 1)) / (cnt + 1) }
}
function outPort(n) {
  return outPortAt(n, 0)
}
function inPort(n, i) {
  const cnt = TYPES[n.type].ins
  return { x: n.x, y: n.y + HEAD_H + (THUMB_H * (i + 1)) / (cnt + 1) }
}
function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

// Connection data-role, so ports/wires can carry a shape per type: image
// streams are round, mattes/masks (a Motion output or a Mask's matte input)
// are diamonds. A wire is a matte if either end is a matte.
function inKind(node, port) {
  if (node.type === 'mask') return port === 1 ? 'matte' : 'image'
  return 'image'
}
function outKind(node) {
  if (node.type === 'input' || node.type === 'xy' || node.type === 'tracker') return 'control'
  return 'image'
}

// --- control input sources (mirror of the sketch runtime's resolver) -------
const cin = { midi: createMidiInput(), leap: createLeapInput(), artnet: createArtnetInput() }
const started = { midi: false, leap: false, artnet: false }
const mouseN = { x: 0.5, y: 0.5 }
const touchN = { x: 0.5, y: 0.5, down: 0 }
function ensureInput(src) {
  if (src.startsWith('midi.') && !started.midi) { started.midi = true; cin.midi.start() }
  else if (src.startsWith('leap.') && !started.leap) { started.leap = true; cin.leap.start() }
  else if (src.startsWith('artnet.') && !started.artnet) { started.artnet = true; cin.artnet.start() }
}
function sourceValue(src, now) {
  const s = src?.startsWith('beat.') ? 'audio.' + src.slice(5) : src
  if (!s) return 0
  if (s.startsWith('midi.cc')) return cin.midi.state.cc[parseInt(s.slice(7), 10)] ?? 0
  if (s.startsWith('artnet.ch')) return cin.artnet.state.ch[parseInt(s.slice(9), 10) - 1] ?? 0
  const b = beat.state
  switch (s) {
    case 'audio.pulse': return b.pulse
    case 'audio.level': return b.level
    case 'audio.low': return b.low
    case 'audio.mid': return b.mid
    case 'audio.high': return b.high
    case 'audio.volume': return b.volume
    case 'audio.centroid': return b.centroid
    case 'audio.flux': return b.flux
    case 'mouse.x': return mouseN.x
    case 'mouse.y': return mouseN.y
    case 'touch.x': return touchN.x
    case 'touch.y': return touchN.y
    case 'touch.down': return touchN.down
    case 'time.sin': return 0.5 + 0.5 * Math.sin(now * 0.001 * Math.PI * 0.2)
    case 'midi.note': return cin.midi.state.note
    case 'midi.velocity': return cin.midi.state.velocity
    case 'leap.x': return cin.leap.state.x
    case 'leap.y': return cin.leap.state.y
    case 'leap.z': return cin.leap.state.z
    case 'leap.pinch': return cin.leap.state.pinch
    case 'leap.grab': return cin.leap.state.grab
    default: return 0
  }
}
// Response curves reshape the 0..1 signal after scale/offset: exp favours the
// top, log/sqrt favours the bottom, s-curve steepens the middle, and step
// hard-gates at the halfway point.
function applyCurve(v, curve) {
  switch (curve) {
    case 'exp': return v * v
    case 'log': return Math.sqrt(v)
    case 's-curve': return v * v * (3 - 2 * v)
    case 'step': return v >= 0.5 ? 1 : 0
    default: return v
  }
}
function inputValue(node, now) {
  const p = node.params
  ensureInput(p.source)
  let v = sourceValue(p.source, now)
  if (p.invert) v = 1 - v
  v = clamp(v * (p.scale ?? 1) + (p.offset ?? 0), 0, 1)
  return applyCurve(v, p.curve ?? 'linear')
}
const INPUT_CURVES = ['linear', 'exp', 'log', 's-curve', 'step']
// Control value emitted by any control node's given output port.
function controlValue(node, port, now) {
  if (node.type === 'input') return inputValue(node, now)
  if (node.type === 'xy') return port === 1 ? node.params.y : node.params.x
  if (node.type === 'tracker') {
    const tr = rtState.get(node.id)?.track
    return tr ? (port === 0 ? tr.x : port === 1 ? tr.y : tr.z) : 0
  }
  return 0
}

const wires = computed(() =>
  edges.map((e, idx) => {
    const from = nodes.find((n) => n.id === e.from)
    const to = nodes.find((n) => n.id === e.to)
    if (!from || !to) return null
    const matte = outKind(from) === 'matte' || inKind(to, e.port) === 'matte'
    return {
      idx,
      d: wirePath(outPort(from), inPort(to, e.port)),
      color: TYPES[from.type].color,
      matte,
    }
  }).filter(Boolean),
)

// --- control links: Input node output → a param jack on another node -------
// Param-jack DOM elements register here so we can find their board position
// (their offset within the node is in the same unscaled space as node.x/y).
const jackEls = new Map()
const layoutTick = ref(0) // bump when a node's inner layout changes (panels, adds)
function bindJack(nodeId, param, el) {
  if (el) jackEls.set(nodeId + ':' + param, el)
  else jackEls.delete(nodeId + ':' + param) // panel closed → jack gone
}
// Left-edge control dots: linked params whose live jack isn't mounted (the
// node's settings panel is closed) get a small always-visible dot on the
// node's left side, so control wires never vanish when settings are hidden.
function nodeDots(n) {
  const linked = links.filter((l) => l.node === n.id)
  return linked
    .map((l, i) => ({ param: l.param, i }))
    .filter((d) => !jackEls.has(n.id + ':' + d.param))
}
function dotPos(n, param) {
  const dots = nodeDots(n)
  const d = dots.find((x) => x.param === param)
  if (!d) return null
  const di = dots.indexOf(d)
  return { x: n.x, y: n.y + HEAD_H + THUMB_H + 12 + di * 15 }
}
function jackPos(nodeId, param) {
  const n = nodes.find((x) => x.id === nodeId)
  if (!n) return null
  const el = jackEls.get(nodeId + ':' + param)
  if (el)
    return { x: n.x + el.offsetLeft + el.offsetWidth / 2, y: n.y + el.offsetTop + el.offsetHeight / 2 }
  return dotPos(n, param) // panel closed → the left-edge dot carries the wire
}
const linkWires = computed(() => {
  layoutTick.value // dependency: recompute when inner layout shifts
  return links
    .map((l, idx) => {
      const from = nodes.find((n) => n.id === l.from)
      const jp = jackPos(l.node, l.param)
      if (!from || !jp) return null
      return { idx, d: wirePath(outPortAt(from, l.srcPort ?? 0), jp) }
    })
    .filter(Boolean)
})
function endLink(node, param) {
  if (!wire.active || wire.kind !== 'control' || wire.from === node.id) return
  for (let k = links.length - 1; k >= 0; k--)
    if (links[k].node === node.id && links[k].param === param) links.splice(k, 1)
  links.push({ from: wire.from, srcPort: wire.fromPort ?? 0, node: node.id, param })
  wire.active = false
  persist()
}
function removeLink(idx) {
  links.splice(idx, 1)
  persist()
}
// Push each Input node's live value onto the params it's wired to.
function applyLinks(now) {
  for (const l of links) {
    const from = nodes.find((n) => n.id === l.from)
    const tgt = nodes.find((n) => n.id === l.node)
    if (!from || !tgt || outKind(from) !== 'control') continue
    const v = controlValue(from, l.srcPort ?? 0, now)
    if (tgt.type === 'effect' || tgt.type === 'filter') {
      const spec = effectControls.get(tgt.id)?.schema?.[l.param]
      if (spec && typeof spec.min === 'number') setEffectParam(tgt.id, l.param, spec.min + v * (spec.max - spec.min))
    } else {
      const rng = PARAM_RANGES[tgt.type]?.[l.param]
      if (rng) tgt.params[l.param] = rng[0] + v * (rng[1] - rng[0])
    }
  }
}

const drag = reactive({ node: null, dx: 0, dy: 0, ids: [], starts: null, px: 0, py: 0 })
const wire = reactive({ active: false, from: null, fromPort: 0, x: 0, y: 0, kind: 'video' })
const selected = ref(null) // node id last clicked — target for copy/delete
// Multi-selection (shift-click to add/remove). Moving any selected node moves
// the whole set; locking applies to all of them.
const selectedSet = reactive(new Set())
function selectSingle(id) { selectedSet.clear(); selectedSet.add(id); selected.value = id }
function toggleSel(id) {
  if (selectedSet.has(id)) selectedSet.delete(id); else selectedSet.add(id)
  selected.value = selectedSet.has(id) ? id : (selectedSet.size ? [...selectedSet].pop() : null)
}
function clearSelection() { selectedSet.clear(); selected.value = null }
function nodeById(id) { return nodes.find((x) => x.id === id) }
// Lock / unlock every selected node (locked nodes resist move, delete, edits
// and randomize).
function toggleLockSelection() {
  const ids = selectedSet.size ? [...selectedSet] : (selected.value != null ? [selected.value] : [])
  if (!ids.length) return
  const anyUnlocked = ids.some((id) => !nodeById(id)?.locked)
  for (const id of ids) { const n = nodeById(id); if (n) n.locked = anyUnlocked }
  persist()
}

// --- pan & zoom: the graph lives in a transformed "space" so it can be
// scrolled and scaled without moving any node's stored coordinates.
const view = reactive({ zoom: 1, panX: 0, panY: 0 })
const pan = reactive({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 })
const spaceStyle = computed(() => ({
  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
  transformOrigin: '0 0',
}))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function boardXY(e) {
  const r = board.value.getBoundingClientRect()
  // Screen point -> untransformed space coordinate.
  return {
    x: (e.clientX - r.left - view.panX) / view.zoom,
    y: (e.clientY - r.top - view.panY) / view.zoom,
  }
}
function zoomAround(cx, cy, factor) {
  const z = clamp(view.zoom * factor, 0.25, 2.5)
  view.panX = cx - ((cx - view.panX) / view.zoom) * z
  view.panY = cy - ((cy - view.panY) / view.zoom) * z
  view.zoom = z
}
function onWheel(e) {
  const r = board.value.getBoundingClientRect()
  zoomAround(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1)
}
function zoomStep(factor) {
  const r = board.value.getBoundingClientRect()
  zoomAround(r.width / 2, r.height / 2, factor)
}
function resetView() {
  view.zoom = 1
  view.panX = 0
  view.panY = 0
}
// Frame the whole graph: fit every node into the board with a little margin.
function fitToView() {
  if (!nodes.length || !board.value) return resetView()
  const br = board.value.getBoundingClientRect()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    // node left/top are in un-scaled "space" coordinates; height varies with
    // its open panels, so read the rendered element when we can.
    const el = board.value.querySelector(`[data-node-id="${n.id}"]`)
    const hgt = el ? el.offsetHeight : 200
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + hgt)
  }
  const pad = 60
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY)
  const z = clamp(Math.min((br.width - pad * 2) / bw, (br.height - pad * 2) / bh), 0.25, 2.5)
  view.zoom = z
  view.panX = (br.width - bw * z) / 2 - minX * z
  view.panY = (br.height - bh * z) / 2 - minY * z
}
// Two-finger pinch state (pointerId -> last client point).
const pinch = new Map()
function onBoardDown(e) {
  if (e.target.closest('.node')) return // let node/port handlers run
  if (!e.shiftKey) clearSelection() // click empty space to deselect
  try { e.target.releasePointerCapture?.(e.pointerId) } catch { /* not held */ }
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch.size >= 2) {
    pan.active = false // second finger down → pinch, not pan
    return
  }
  pan.active = true
  pan.sx = e.clientX
  pan.sy = e.clientY
  pan.ox = view.panX
  pan.oy = view.panY
}
function startDrag(n, e) {
  // Shift-click toggles the node in the multi-selection (no move).
  if (e.shiftKey) { toggleSel(n.id); return }
  // Plain click on a node outside the current selection selects just it.
  if (!selectedSet.has(n.id)) selectSingle(n.id)
  else selected.value = n.id
  if (n.locked) return // locked nodes don't move
  const p = boardXY(e)
  drag.node = n.id
  drag.px = p.x
  drag.py = p.y
  // Move every selected, unlocked node together.
  drag.ids = [...selectedSet].filter((id) => !nodeById(id)?.locked)
  if (!drag.ids.includes(n.id)) drag.ids.push(n.id)
  drag.starts = new Map(drag.ids.map((id) => { const nd = nodeById(id); return [id, { x: nd.x, y: nd.y }] }))
}

// XY Pad: dragging on the pad's thumbnail sets the node's x/y (y up = 1).
function xySet(n, e) {
  const r = e.currentTarget.getBoundingClientRect()
  n.params.x = clamp((e.clientX - r.left) / r.width, 0, 1)
  n.params.y = clamp(1 - (e.clientY - r.top) / r.height, 0, 1)
}
function xyDown(n, e) {
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)
  selected.value = n.id
  xySet(n, e)
}
function xyMove(n, e) {
  if (e.buttons) xySet(n, e)
}
function startWire(n, e, port = 0) {
  e.stopPropagation()
  // Touch pointers are implicitly captured by the origin port, which would
  // make pointerup fire back on this port instead of the drop target —
  // release the capture so wiring works with a finger.
  try { e.target.releasePointerCapture?.(e.pointerId) } catch { /* not held */ }
  const p = outPortAt(n, port)
  wire.active = true
  wire.from = n.id
  wire.fromPort = port
  wire.kind = outKind(n) === 'control' ? 'control' : 'video'
  wire.x = p.x
  wire.y = p.y
}
function endWire(n, port) {
  if (!wire.active || wire.from === n.id || wire.kind === 'control') return
  // one edge per input port
  for (let k = edges.length - 1; k >= 0; k--)
    if (edges[k].to === n.id && edges[k].port === port) edges.splice(k, 1)
  edges.push({ from: wire.from, to: n.id, port })
  wire.active = false
  persist()
}
function onMove(e) {
  // Pinch zoom: with two touch points down, scale about their midpoint.
  if (pinch.size >= 2 && pinch.has(e.pointerId)) {
    const prev = new Map(pinch)
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pinch.values()]
    const old = [...prev.values()]
    if (pts.length >= 2 && old.length >= 2) {
      const dNew = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const dOld = Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y)
      if (dOld > 0) {
        const r = board.value.getBoundingClientRect()
        const mx = (pts[0].x + pts[1].x) / 2 - r.left
        const my = (pts[0].y + pts[1].y) / 2 - r.top
        zoomAround(mx, my, dNew / dOld)
      }
    }
    return
  }
  if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pan.active) {
    view.panX = pan.ox + (e.clientX - pan.sx)
    view.panY = pan.oy + (e.clientY - pan.sy)
    return
  }
  const p = boardXY(e)
  if (drag.node != null) {
    const ddx = p.x - drag.px, ddy = p.y - drag.py
    for (const id of drag.ids) {
      const nd = nodeById(id), s = drag.starts?.get(id)
      if (nd && s) { nd.x = s.x + ddx; nd.y = s.y + ddy }
    }
  }
  if (wire.active) {
    wire.x = p.x
    wire.y = p.y
  }
}
function onUp(e) {
  if (drag.node != null) persist()
  drag.node = null
  drag.ids = []
  drag.starts = null
  // Belt and braces for touch: if a wire is in flight, resolve the drop
  // target by hit-testing the release point (data attributes on ports/jacks),
  // since touch event routing doesn't always land pointerup on the target.
  if (wire.active && e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const portEl = el?.closest?.('[data-in-node]')
    const jackEl = el?.closest?.('[data-jack-node]')
    if (portEl) {
      const n = nodes.find((x) => x.id === +portEl.dataset.inNode)
      if (n) endWire(n, +portEl.dataset.inPort)
    } else if (jackEl) {
      const n = nodes.find((x) => x.id === +jackEl.dataset.jackNode)
      if (n) endLink(n, jackEl.dataset.jackParam)
    }
  }
  wire.active = false
  pan.active = false
  pinch.clear()
}
function removeEdge(idx) {
  edges.splice(idx, 1)
  persist()
}

// --- source binding (iframes / video) ---
// Iframes render at quality=high (pixelRatio 1) and are CSS-sized to the
// compositor resolution, so a 1080p/native compositor really captures
// 1080p/native pixels — previously they ran 384×216 at quality=low (half
// pixel ratio), so "1080p" upscaled a 192×108 canvas.
const frameSize = ref({ w: W, h: H })
function effectSrc(n) {
  const s = store.bySlug(n.params.slug)
  // nomap=1: sketches start with their default audio/input mappings OFF in
  // Patch, so nodes react only to the wires you draw. The ⚡ button on the
  // node applies the sketch's own defaults on demand.
  return s ? `${s.url}?capture=1&preview=1&quality=high&nomap=1` : ''
}
function autoMap(n) {
  rtState.get(n.id)?.iframe?.contentWindow?.postMessage({ type: 'sketch:auto-map' }, '*')
}
function bindFrame(id, el) {
  if (el) st(id).iframe = el
}
// --- media node: shared camera + library playback -------------------------
const cameraOn = ref(sharedCameraOn())
async function toggleCamera() {
  if (cameraOn.value) {
    stopSharedCamera()
    cameraOn.value = false
    // detach the stream from every media element so the light goes off
    for (const s of rtState.values()) {
      if (s.mediaEl?.srcObject) { s.mediaEl.srcObject = null }
    }
  } else {
    try {
      await startSharedCamera()
      cameraOn.value = true
    } catch {
      cameraOn.value = false
    }
  }
}
// Flip front↔back; the shared stream is replaced, so re-point every camera
// media element at the new one.
async function flipCamera() {
  if (!cameraOn.value) return
  try {
    const stream = await flipSharedCamera()
    for (const s of rtState.values()) {
      if (s.mediaWant === 'camera' && s.mediaEl) { s.mediaEl.srcObject = stream; s.mediaEl.play().catch(() => {}) }
    }
  } catch { /* ignore */ }
}

// The live element (video/img/canvas) a media node should draw this frame. A
// per-node video/img is created lazily and reattached when the mode or the
// chosen library item changes — the camera path shares one global stream.
function mediaEl(node) {
  const s = st(node.id)
  const p = node.params
  const want = p.mode === 'camera' ? 'camera' : `media:${p.mediaId}`
  if (s.mediaWant !== want) {
    s.mediaWant = want
    if (s.mediaEl) { try { s.mediaEl.pause?.() } catch {}; s.mediaEl.srcObject = null; s.mediaEl.removeAttribute('src'); s.mediaEl = null }
    if (p.mode === 'camera') {
      const v = document.createElement('video')
      v.muted = true; v.playsInline = true; v.autoplay = true
      s.mediaEl = v
      if (cameraOn.value) startSharedCamera().then((stream) => { v.srcObject = stream; v.play().catch(() => {}) }).catch(() => {})
    } else {
      const item = mediaById(p.mediaId)
      if (item) {
        if (item.kind === 'video') {
          const v = document.createElement('video')
          v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true
          v.src = item.url; v.play().catch(() => {})
          s.mediaEl = v
        } else {
          const img = new Image()
          img.src = item.url
          s.mediaEl = img
        }
      }
    }
  }
  // camera turned on after the element was made in a prior frame
  if (p.mode === 'camera' && s.mediaEl && cameraOn.value && !s.mediaEl.srcObject) {
    startSharedCamera().then((stream) => { s.mediaEl.srcObject = stream; s.mediaEl.play().catch(() => {}) }).catch(() => {})
  }
  return s.mediaEl
}

function loadMediaFiles(node, e) {
  const files = [...(e.target.files ?? [])]
  let first = null
  for (const f of files) { const item = addMediaFile(f); if (!first) first = item }
  if (first) { node.params.mode = 'library'; node.params.mediaId = first.id; persist() }
  e.target.value = ''
}
function pickMedia(node, id) {
  node.params.mediaId = id
  node.params.mode = 'library'
  persist()
}

// --- recording / snapshot / prebake ----------------------------------------
// Record the fullscreen stage (the composited output) to a WebM the user can
// download AND add to the library as a clip — which is also how a slow,
// non-realtime effect is "prebaked": record its output once, then a Media
// node plays the clip back at full speed.
let recorder = null
const recording = ref(false)
const recElapsed = ref(0)
let recTimer = 0
function toggleRecord() {
  if (recording.value) { recorder?.stop(); return }
  const cnv = stage.value
  if (!cnv?.captureStream) return
  const stream = cnv.captureStream(30)
  const chunks = []
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    recording.value = false
    clearInterval(recTimer)
    const blob = new Blob(chunks, { type: 'video/webm' })
    addRecordedClip(blob, `recording ${new Date().toLocaleTimeString()}`)
    // also offer a download
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `patch-${Date.now()}.webm`
    a.click()
    recorder = null
  }
  recorder.start()
  recording.value = true
  recElapsed.value = 0
  recTimer = setInterval(() => (recElapsed.value += 1), 1000)
}
// Snapshot the current stage to a PNG (downloaded + added to the library).
function snapshotPng() {
  const cnv = stage.value
  if (!cnv) return
  cnv.toBlob((blob) => {
    if (!blob) return
    const file = new File([blob], `snapshot-${Date.now()}.png`, { type: 'image/png' })
    addMediaFile(file)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = file.name
    a.click()
  }, 'image/png')
}

// --- effect-node parameters + input mappings ------------------------------
// Same protocol as the solo viewer / Mixer: an effect iframe announces its
// { schema, values, mappings } on load; edits post straight back so an Effect
// node can be tuned and made audio/MIDI/etc. reactive right in the graph.
const effectControls = reactive(new Map()) // node id -> { schema, values, mappings }
const showParams = reactive(new Map()) // node id -> bool
// Opening/closing the params panel shifts the param jacks below it, so nudge
// the control-wire geometry to re-measure after the DOM settles.
function toggleParams(id) {
  showParams.set(id, !showParams.get(id))
  nextTick(() => layoutTick.value++)
}
function onEffectMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  for (const n of nodes) {
    if (n.type !== 'effect' && n.type !== 'filter') continue
    if (rtState.get(n.id)?.iframe?.contentWindow === e.source) {
      effectControls.set(n.id, {
        schema: e.data.schema ?? {},
        values: { ...e.data.values },
        mappings: (e.data.mappings ?? []).map((m) => ({ ...m })),
      })
      // A cue being applied may be waiting to push this effect's saved params.
      if (pendingEffects) applyPendingEffects()
      break
    }
  }
}
function postToEffect(id, msg) {
  rtState.get(id)?.iframe?.contentWindow?.postMessage(msg, '*')
}
function setEffectParam(id, name, value) {
  effectControls.get(id).values[name] = value
  postToEffect(id, { type: 'sketch:set-param', name, value })
}
function syncEffectMappings(id) {
  postToEffect(id, { type: 'sketch:set-mappings', mappings: effectControls.get(id).mappings })
}
function addEffectMapping(id) {
  const c = effectControls.get(id)
  const firstNumeric = Object.keys(c.schema).find((k) => typeof c.schema[k].min === 'number')
  if (!firstNumeric) return
  c.mappings.push({ source: 'audio.pulse', param: firstNumeric, amount: 0.5, smooth: 0.6 })
  syncEffectMappings(id)
}
function removeEffectMapping(id, i) {
  effectControls.get(id).mappings.splice(i, 1)
  syncEffectMappings(id)
}
function numericParamsOfEffect(id) {
  const c = effectControls.get(id)
  return c ? Object.keys(c.schema).filter((k) => typeof c.schema[k].min === 'number') : []
}

// One beat engine for the whole graph, broadcast into every effect iframe each
// frame (they run in preview mode without their own mic button) — so effect
// mappings react to the music, just like in the Mixer.
const beat = createBeatDetector()
const micOn = ref(false)
let pendingBeat = false
beat.onBeat(() => (pendingBeat = true))
async function toggleMic() {
  if (micOn.value) {
    beat.stop()
    micOn.value = false
    return
  }
  try {
    await beat.start()
    micOn.value = true
  } catch {
    /* no mic */
  }
}
function broadcastBeat(ts) {
  beat.update(ts)
  const bs = beat.state
  const msg = {
    type: 'input:beat',
    state: {
      level: bs.level, low: bs.low, mid: bs.mid, high: bs.high, volume: bs.volume,
      centroid: bs.centroid, flux: bs.flux, interval: bs.interval, bpm: bs.bpm,
    },
    beat: pendingBeat,
    energy: 1,
  }
  pendingBeat = false
  for (const s of rtState.values()) s.iframe?.contentWindow?.postMessage(msg, '*')
}

// --- thumbnails: mount each node's output canvas into its card ---
function bindThumb(id, el) {
  if (el && !el.contains(st(id).out)) {
    el.innerHTML = ''
    el.appendChild(st(id).out)
  }
}

// --- compositor ---
const stage = ref(null)

function cover(octx, src, sw, sh) {
  if (!src || !sw || !sh) return false
  const scale = Math.max(W / sw, H / sh)
  const w = sw * scale
  const h = sh * scale
  octx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h)
  return true
}
function inputCanvas(node, port) {
  const e = edges.find((e) => e.to === node.id && e.port === port)
  if (!e) return null
  return rtState.get(e.from)?.out ?? null
}

// Trace a normalized polygon into the compositor space. When inverted we wrap
// the whole frame first so an even-odd fill punches the polygon out as a hole.
function polyPath(cx, pts, invert) {
  cx.beginPath()
  if (invert) { cx.rect(0, 0, W, H) }
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] * W, y = pts[i][1] * H
    if (i === 0) cx.moveTo(x, y)
    else cx.lineTo(x, y)
  }
  cx.closePath()
}

function evalNode(node) {
  const s = st(node.id)
  const octx = s.octx
  octx.globalCompositeOperation = 'source-over'
  octx.globalAlpha = 1
  octx.filter = 'none'
  octx.fillStyle = '#000'
  octx.fillRect(0, 0, W, H)

  if (node.type === 'effect') {
    try {
      const cv = s.iframe?.contentDocument?.querySelector('canvas')
      if (cv && cv.width) cover(octx, cv, cv.width, cv.height)
    } catch {
      /* cross-origin / not ready */
    }
  } else if (node.type === 'filter') {
    // Feed the upstream frame into the filter sketch as its mixer:frame source
    // (the shared source pipeline auto-selects it), then capture its canvas.
    const input = inputCanvas(node, 0)
    if (input && s.iframe?.contentWindow && !s.feeding) {
      s.feeding = true
      createImageBitmap(input)
        .then((bmp) => {
          s.iframe?.contentWindow?.postMessage({ type: 'mixer:frame', bitmap: bmp }, '*', [bmp])
        })
        .catch(() => {})
        .finally(() => (s.feeding = false))
    }
    try {
      const cv = s.iframe?.contentDocument?.querySelector('canvas')
      if (cv && cv.width) cover(octx, cv, cv.width, cv.height)
    } catch {
      /* not ready */
    }
  } else if (node.type === 'media') {
    const el = mediaEl(node)
    if (el) {
      if (el.tagName === 'VIDEO' && el.videoWidth) cover(octx, el, el.videoWidth, el.videoHeight)
      else if (el.tagName === 'IMG' && el.naturalWidth) cover(octx, el, el.naturalWidth, el.naturalHeight)
      else if (el.tagName === 'CANVAS') cover(octx, el, el.width, el.height)
    }
  } else if (node.type === 'text') {
    const p = node.params
    if (p.bg) { octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H) }
    else octx.clearRect(0, 0, W, H)
    const px = Math.max(4, p.size * H)
    octx.save()
    octx.translate(p.x * W, p.y * H)
    octx.rotate(((p.rotate ?? 0) * Math.PI) / 180)
    octx.font = `${p.italic ? 'italic ' : ''}${Math.round(p.weight)} ${px}px ${p.font || 'sans-serif'}`
    octx.textAlign = 'center'
    octx.textBaseline = 'middle'
    octx.fillStyle = `hsl(${p.hue}, 90%, 62%)`
    // letter-spacing (tracking) — draw glyph by glyph
    const track = (p.tracking ?? 0) * px
    const str = String(p.text ?? '')
    let total = 0
    for (const ch of str) total += octx.measureText(ch).width + track
    total -= track
    let cx = -total / 2
    if (p.glow > 0.01) { octx.shadowColor = `hsl(${p.hue}, 100%, 60%)`; octx.shadowBlur = px * 0.4 * p.glow }
    for (const ch of str) {
      const w = octx.measureText(ch).width
      octx.fillText(ch, cx + w / 2, 0)
      cx += w + track
    }
    octx.restore()
    octx.shadowBlur = 0
  } else if (node.type === 'portal') {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
    const p = node.params
    const sx = p.srcX * W, sy = p.srcY * H, sw = p.srcW * W, sh = p.srcH * H
    const dx = p.dstX * W, dy = p.dstY * H
    let dw = p.dstW * W
    let dh = p.dstH * H
    // Lock proportions: derive the destination height from its width so the
    // portal keeps a chosen aspect ratio (in real pixels).
    if (p.lockAspect) dh = dw / (ASPECTS[p.aspect] ?? 1)
    // remap the source region into the destination region, optionally
    // recursively so the portal shows a portal showing a portal…
    const times = Math.max(1, Math.round(p.recurse ?? 1))
    for (let k = 0; k < times; k++) {
      octx.save()
      portalShapePath(octx, p.shape ?? 'rectangle', dx, dy, dw, dh)
      octx.clip()
      octx.drawImage(s.out, sx, sy, sw, sh, dx, dy, dw, dh)
      octx.restore()
    }
    if (p.border) {
      octx.strokeStyle = 'rgba(138,208,255,0.8)'
      octx.lineWidth = Math.max(1, W * 0.003)
      portalShapePath(octx, p.shape ?? 'rectangle', dx, dy, dw, dh)
      octx.stroke()
    }
  } else if (node.type === 'mask') {
    const content = inputCanvas(node, 0)
    const mask = inputCanvas(node, 1)
    if (content) octx.drawImage(content, 0, 0, W, H)
    if (mask) {
      octx.globalCompositeOperation = 'multiply'
      octx.drawImage(mask, 0, 0, W, H)
      octx.globalCompositeOperation = 'source-over'
    }
  } else if (node.type === 'shape') {
    // Clip the input to an editable polygon — the projection-mapping mask.
    // Vertices live in node.params.points as normalized [x,y]; drag them on
    // the output (Edit masks mode) to fit real surfaces.
    const content = inputCanvas(node, 0)
    if (content) octx.drawImage(content, 0, 0, W, H)
    const pts = node.params.points || []
    if (content && pts.length >= 3) {
      const invert = !!node.params.invert
      const feather = node.params.feather || 0
      octx.globalCompositeOperation = 'destination-in'
      if (feather > 0.001) {
        // Soft edge: build a blurred matte and keep the content under it.
        const m = s.matte || (s.matte = document.createElement('canvas'))
        if (m.width !== W || m.height !== H) { m.width = W; m.height = H }
        const mx = m.getContext('2d')
        mx.clearRect(0, 0, W, H)
        mx.filter = `blur(${feather * 0.12 * Math.min(W, H)}px)`
        mx.fillStyle = '#fff'
        polyPath(mx, pts, invert)
        mx.fill(invert ? 'evenodd' : 'nonzero')
        mx.filter = 'none'
        octx.drawImage(m, 0, 0)
      } else {
        octx.fillStyle = '#fff'
        polyPath(octx, pts, invert)
        octx.fill(invert ? 'evenodd' : 'nonzero')
      }
      octx.globalCompositeOperation = 'source-over'
    }
  } else if (node.type === 'blend') {
    const a = inputCanvas(node, 0)
    const b = inputCanvas(node, 1)
    if (a) octx.drawImage(a, 0, 0, W, H)
    if (b) {
      octx.globalCompositeOperation = node.params.mode === 'add' ? 'lighter' : node.params.mode
      octx.globalAlpha = node.params.mix ?? 1 // top input's contribution
      octx.drawImage(b, 0, 0, W, H)
      octx.globalAlpha = 1
      octx.globalCompositeOperation = 'source-over'
    }
  } else if (node.type === 'output') {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
  } else if (node.type === 'input') {
    // A VU-style meter of the control value the node is emitting.
    const v = inputValue(node, performance.now())
    octx.fillStyle = '#0c0e14'
    octx.fillRect(0, 0, W, H)
    octx.fillStyle = TYPES.input.color
    octx.fillRect(0, H * (1 - v), W, H * v)
    octx.fillStyle = 'rgba(255,255,255,0.9)'
    octx.font = `${Math.round(H * 0.16)}px system-ui, sans-serif`
    octx.fillText(node.params.source, W * 0.03, H * 0.22)
    octx.fillText(v.toFixed(2), W * 0.03, H * 0.95)
  } else if (node.type === 'xy') {
    // Touch surface: the thumbnail *is* the pad — drag on it to set x/y.
    const x = node.params.x * W
    const y = (1 - node.params.y) * H
    octx.fillStyle = '#0c0e14'
    octx.fillRect(0, 0, W, H)
    octx.strokeStyle = 'rgba(224,160,96,0.25)'
    octx.lineWidth = Math.max(1, H / 108)
    for (let i = 1; i < 4; i++) {
      octx.beginPath(); octx.moveTo((W * i) / 4, 0); octx.lineTo((W * i) / 4, H); octx.stroke()
      octx.beginPath(); octx.moveTo(0, (H * i) / 4); octx.lineTo(W, (H * i) / 4); octx.stroke()
    }
    octx.strokeStyle = TYPES.xy.color
    octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, H); octx.stroke()
    octx.beginPath(); octx.moveTo(0, y); octx.lineTo(W, y); octx.stroke()
    octx.fillStyle = TYPES.xy.color
    octx.beginPath(); octx.arc(x, y, H * 0.06, 0, Math.PI * 2); octx.fill()
    octx.fillStyle = 'rgba(255,255,255,0.85)'
    octx.font = `${Math.round(H * 0.14)}px system-ui, sans-serif`
    octx.fillText(`${node.params.x.toFixed(2)}, ${node.params.y.toFixed(2)}`, W * 0.03, H * 0.95)
  } else if (node.type === 'tracker') {
    // Camera/video tracking: find the brightest region of the input, emit its
    // smoothed x / y and apparent size (a stand-in for depth — nearer = bigger).
    const input = inputCanvas(node, 0)
    if (input) {
      octx.drawImage(input, 0, 0, W, H)
      if (!s.tinyT) {
        s.tinyT = document.createElement('canvas')
        s.tinyT.width = 48
        s.tinyT.height = 27
        s.tinyTx = s.tinyT.getContext('2d', { willReadFrequently: true })
        s.track = { x: 0.5, y: 0.5, z: 0 }
      }
      s.tinyTx.drawImage(input, 0, 0, 48, 27)
      try {
        const d = s.tinyTx.getImageData(0, 0, 48, 27).data
        const th = node.params.thresh * 255
        let sx = 0, sy = 0, sw = 0
        for (let yy = 0; yy < 27; yy++) {
          for (let xx = 0; xx < 48; xx++) {
            const i = (yy * 48 + xx) * 4
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
            if (l > th) {
              const w = l - th
              sx += xx * w
              sy += yy * w
              sw += w
            }
          }
        }
        const sm = node.params.smooth
        if (sw > 0) {
          const nx = sx / sw / 48
          const ny = 1 - sy / sw / 27
          const nz = clamp(sw / (48 * 27 * (255 - th) * 0.25), 0, 1)
          s.track.x = s.track.x * sm + nx * (1 - sm)
          s.track.y = s.track.y * sm + ny * (1 - sm)
          s.track.z = s.track.z * sm + nz * (1 - sm)
        } else {
          s.track.z *= sm // lost the target: size decays, position holds
        }
      } catch { /* tainted input */ }
      // Crosshair overlay at the tracked point, ring sized by z.
      const tx = s.track.x * W
      const ty = (1 - s.track.y) * H
      octx.strokeStyle = TYPES.tracker.color
      octx.lineWidth = Math.max(1.5, H / 80)
      octx.beginPath(); octx.moveTo(tx - W * 0.04, ty); octx.lineTo(tx + W * 0.04, ty); octx.stroke()
      octx.beginPath(); octx.moveTo(tx, ty - W * 0.04); octx.lineTo(tx, ty + W * 0.04); octx.stroke()
      octx.beginPath(); octx.arc(tx, ty, Math.max(2, s.track.z * H * 0.45), 0, Math.PI * 2); octx.stroke()
    } else {
      octx.fillStyle = '#0c0e14'
      octx.fillRect(0, 0, W, H)
      octx.fillStyle = 'rgba(255,255,255,0.5)'
      octx.font = `${Math.round(H * 0.13)}px system-ui, sans-serif`
      octx.fillText('wire a camera / video input', W * 0.06, H * 0.5)
    }
  }
}

// Topological order (cycles tolerated: leftovers appended → 1-frame feedback).
function evalOrder() {
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0)
  const order = []
  const seen = new Set()
  while (queue.length) {
    const n = queue.shift()
    if (seen.has(n.id)) continue
    seen.add(n.id)
    order.push(n)
    for (const e of edges.filter((e) => e.from === n.id)) {
      indeg.set(e.to, indeg.get(e.to) - 1)
      if (indeg.get(e.to) === 0) {
        const t = nodes.find((x) => x.id === e.to)
        if (t) queue.push(t)
      }
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n) // cyclic remainder
  return order
}

let raf = 0
// Adaptive throttling: a full compositor pass can get expensive (big
// resolutions, many nodes). Its cost is tracked as an EMA, and when a pass
// eats more than ~half a 60 Hz frame the next rAF tick(s) are skipped — so the
// main thread always has slack for pointer events, drags, and Vue updates.
// Control flow (beat broadcast + links) still runs every tick, so knobs and
// mappings feel live even when the video rate drops.
let passCost = 6 // ms, EMA
let skipLeft = 0
// FPS meter (compositor passes per second), shown via the toolbar toggle.
const FPS_KEY = 'sketchbook-patch-fps'
const showFps = ref(localStorage.getItem(FPS_KEY) === '1')
function toggleFps() {
  showFps.value = !showFps.value
  localStorage.setItem(FPS_KEY, showFps.value ? '1' : '0')
}
const fps = ref(0)
let passCount = 0

// Freeze the visuals (skip compositing AND pause every effect iframe's rAF) so
// a heavy/janky mix never blocks the editor — you can keep wiring and tweaking
// while it's held on the last frame, then unfreeze.
const renderPaused = ref(false)
function toggleRenderPaused() {
  renderPaused.value = !renderPaused.value
  for (const s of rtState.values()) s.iframe?.contentWindow?.postMessage({ type: 'sketch:pause', paused: renderPaused.value }, '*')
}
// Per-node composite cost (ms, smoothed) surfaced reactively for the slow badge.
const nodeCost = reactive({})
const SLOW_SCORE = 40 // perf score below this = a heavy effect
const SLOW_MS = 7 // composite time above this = a slow node
function nodeScore(n) {
  return (n.type === 'effect' || n.type === 'filter') && n.params.slug ? (perfScores[n.params.slug] ?? 100) : 100
}
function nodeSlow(n) {
  return nodeScore(n) < SLOW_SCORE || (nodeCost[n.id] ?? 0) > SLOW_MS
}
function nodeSlowReason(n) {
  return nodeScore(n) < SLOW_SCORE
    ? 'Heavy effect — likely to lower the frame rate'
    : 'Slow to composite — may lower the frame rate'
}
let fpsWindow = 0

function loop(ts) {
  const now = ts ?? performance.now()
  if (renderPaused.value) { raf = requestAnimationFrame(loop); return } // held — keep the editor snappy
  broadcastBeat(now)
  if (showMode.value === 'timeline' && showPlaying.value) tickShow(now)
  applyLinks(now) // drive params from Input nodes first
  if (skipLeft > 0) {
    skipLeft--
  } else {
    const t0 = performance.now()
    for (const n of evalOrder()) {
      const te = performance.now()
      evalNode(n)
      const s = rtState.get(n.id)
      if (s) s.cost = (s.cost ?? 0) * 0.9 + (performance.now() - te) * 0.1
    }
    // Blit the (last) Output node to the fullscreen stage.
    const out = nodes.find((n) => n.type === 'output')
    const cnv = stage.value
    if (cnv) {
      const cx = cnv.getContext('2d')
      cx.fillStyle = '#000'
      cx.fillRect(0, 0, cnv.width, cnv.height)
      if (out) {
        const s = rtState.get(out.id)
        if (s) {
          const scale = Math.max(cnv.width / W, cnv.height / H)
          const w = W * scale
          const h = H * scale
          cx.drawImage(s.out, (cnv.width - w) / 2, (cnv.height - h) / 2, w, h)
        }
      }
      // Cue crossfade: the frozen previous frame fades out over the new one.
      if (xfade) {
        const a = 1 - (performance.now() - xfade.t0) / xfade.dur
        if (a <= 0) xfade = null
        else { cx.globalAlpha = a; cx.drawImage(xfade.img, 0, 0, cnv.width, cnv.height); cx.globalAlpha = 1 }
      }
    }
    blitPopup()
    passCost = passCost * 0.85 + (performance.now() - t0) * 0.15
    // Keep compositor occupancy under ~55% of the frame budget.
    skipLeft = Math.min(5, Math.floor(passCost / 9))
    passCount++
    if (now - fpsWindow >= 500) {
      fps.value = Math.round((passCount * 1000) / (now - fpsWindow || 1))
      passCount = 0
      fpsWindow = now
      // publish per-node composite cost for the slow-node badge (reactive)
      for (const n of nodes) { const c = rtState.get(n.id)?.cost; if (c != null) nodeCost[n.id] = +c.toFixed(2) }
    }
  }
  raf = requestAnimationFrame(loop)
}

function resizeStage() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
  const c = stage.value
  if (!c) return
  // Back the stage with real device pixels (CSS scales it), so a native/1080p
  // compositor isn't thrown away in the final blit on hi-DPI screens.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  c.width = Math.round(window.innerWidth * dpr)
  c.height = Math.round(window.innerHeight * dpr)
  // Native resolution tracks the window, so re-resolve it when the window changes.
  if (RESOLUTIONS.find((r) => r.label === resLabel.value)?.native) applyResolution(resLabel.value)
}
// Toggle rather than enter-only: mobile has no Esc key, so an enter-only
// button strands the user in fullscreen with no way back.
const isFullscreen = ref(false)
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function fullscreen() {
  const el = board.value?.parentElement
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
  else (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el)
}
function onFsChange() {
  isFullscreen.value = !!fsElement()
}

// --- pop-out output: a separate window for a second display -----------------
// The composite is mirrored into a popup you can drag onto a projector or
// second monitor (double-click it for fullscreen) while the routing UI —
// wires, params, mappings — stays here, adjustable without disturbing the
// show. Same-origin about:blank, so the parent draws into it directly.
const popupOpen = ref(false)
let popup = null
function togglePopup() {
  if (popup && !popup.closed) {
    popup.close()
    popup = null
    popupOpen.value = false
    return
  }
  popup = window.open('', 'patch-output', 'width=960,height=540')
  if (!popup) return // blocked
  const d = popup.document
  d.title = 'Patch Output'
  d.body.style.cssText = 'margin:0;background:#000;overflow:hidden;'
  const c = d.createElement('canvas')
  c.id = 'out'
  c.style.cssText = 'display:block;width:100vw;height:100vh;cursor:none;'
  d.body.appendChild(c)
  const hint = d.createElement('div')
  hint.textContent = 'drag me to the display · double-click for fullscreen'
  hint.style.cssText =
    'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);color:rgba(255,255,255,0.5);font:13px system-ui;transition:opacity 1s;pointer-events:none;'
  d.body.appendChild(hint)
  setTimeout(() => (hint.style.opacity = 0), 6000)
  c.addEventListener('dblclick', () => {
    if (d.fullscreenElement) d.exitFullscreen()
    else c.requestFullscreen?.()
  })
  popup.addEventListener('beforeunload', () => {
    popup = null
    popupOpen.value = false
  })
  popupOpen.value = true
}
// Preview / program: with hold on, the pop-out keeps showing the last APPLIED
// composite (the live show on the projector) while you redesign the graph on
// the board (your preview). "Apply" pushes the current board look to the
// output — design and verify the next look, then cut to it cleanly.
const previewHold = ref(false)
let applyOne = false
function applyToOutput() { applyOne = true }
function blitPopup() {
  if (!popup || popup.closed) {
    if (popupOpen.value) {
      popupOpen.value = false
      popup = null
    }
    return
  }
  // held: don't update the show unless an Apply was requested
  if (previewHold.value && !applyOne) return
  applyOne = false
  const c = popup.document.getElementById('out')
  if (!c) return
  const dpr = Math.min(popup.devicePixelRatio || 1, 2)
  const pw = Math.round(popup.innerWidth * dpr)
  const ph = Math.round(popup.innerHeight * dpr)
  if (c.width !== pw || c.height !== ph) {
    c.width = pw
    c.height = ph
  }
  const out = nodes.find((n) => n.type === 'output')
  const s = out && rtState.get(out.id)
  const cx = c.getContext('2d')
  cx.fillStyle = '#000'
  cx.fillRect(0, 0, pw, ph)
  if (s) {
    const scale = Math.max(pw / W, ph / H)
    cx.drawImage(s.out, (pw - W * scale) / 2, (ph - H * scale) / 2, W * scale, H * scale)
  }
}

// --- output-only view: hide the routing UI, show just the composite -------
// Sources/graph keep running (only the graph UI is hidden), so the Output
// node still composites live.
const outputOnly = ref(false)

// --- projection mapping: drag polygon-mask vertices on the output ----------
// The stage shows the composite cover-fit to the window; these map a Polygon
// Mask's normalized points to/from screen pixels through that same fit, so you
// can drag the corners live onto a real surface — in the routing view or,
// more usefully, output-only + fullscreen on the projector.
const maskEdit = ref(false)
const vw = ref(window.innerWidth)
const vh = ref(window.innerHeight)
const geomVer = ref(0) // bump when the compositor resolution changes
function stageFit() {
  const scale = Math.max(vw.value / W, vh.value / H)
  const dispW = W * scale
  const dispH = H * scale
  return { offX: (vw.value - dispW) / 2, offY: (vh.value - dispH) / 2, dispW, dispH }
}
const shapeNodes = computed(() => nodes.filter((n) => n.type === 'shape'))
// Per shape-node handle/edge geometry in screen pixels for the SVG overlay.
const maskGeom = computed(() => {
  geomVer.value // reactive dep on resolution changes
  const fit = stageFit()
  return shapeNodes.value.map((n) => {
    const pts = (n.params.points || []).map((p) => ({
      nx: p[0], ny: p[1], x: fit.offX + p[0] * fit.dispW, y: fit.offY + p[1] * fit.dispH,
    }))
    return { id: n.id, selected: selected.value === n.id, pts, d: pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') + ' Z' }
  })
})
let maskDrag = null // { id, i }
function screenToNorm(clientX, clientY) {
  const fit = stageFit()
  return [
    Math.min(1, Math.max(0, (clientX - fit.offX) / fit.dispW)),
    Math.min(1, Math.max(0, (clientY - fit.offY) / fit.dispH)),
  ]
}
function maskDown(id, i, e) {
  e.stopPropagation()
  e.target.setPointerCapture?.(e.pointerId)
  maskDrag = { id, i }
  selected.value = id
}
function maskMove(e) {
  if (!maskDrag) return
  const n = nodes.find((x) => x.id === maskDrag.id)
  if (!n) return
  const [nx, ny] = screenToNorm(e.clientX, e.clientY)
  n.params.points[maskDrag.i] = [+nx.toFixed(4), +ny.toFixed(4)]
}
function maskUp() {
  if (!maskDrag) return
  maskDrag = null
  persist()
}
function removePoint(id, i, e) {
  e?.stopPropagation()
  const n = nodes.find((x) => x.id === id)
  if (!n || (n.params.points?.length ?? 0) <= 3) return // a polygon needs ≥3
  n.params.points.splice(i, 1)
  persist()
}
// Double-click an edge (segment starting at vertex i) to add a vertex there.
function insertPoint(id, i, e) {
  e?.stopPropagation()
  const n = nodes.find((x) => x.id === id)
  if (!n) return
  const pts = n.params.points
  const a = pts[i], b = pts[(i + 1) % pts.length]
  pts.splice(i + 1, 0, [+((a[0] + b[0]) / 2).toFixed(4), +((a[1] + b[1]) / 2).toFixed(4)])
  persist()
}
// Reset a shape back to a centered quad.
function resetShape(id) {
  const n = nodes.find((x) => x.id === id)
  if (!n) return
  n.params.points = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]
  persist()
}

// --- show sequencer: a cue list you can jump through or run on a timeline ---
// A cue is a full snapshot of the patch (graph + effect params) with a name,
// a timeline `time`, and a `fade`. Two modes: "cues" fires them on demand like
// a lighting console's cue stack; "timeline" plays them at their times and,
// when two adjacent cues share the same node topology, ramps their numeric
// params between them so variables (mask corners, a portal's position, text
// rotation, blend mix…) move smoothly over the show.
const SHOW_KEY = 'sketchbook-patch-show'
function loadShow() {
  try { return JSON.parse(localStorage.getItem(SHOW_KEY)) || [] } catch { return [] }
}
const cues = reactive(loadShow())
const showOpen = ref(false)
const showMode = ref('cues') // 'cues' | 'timeline'
const activeCue = ref(-1)
const showPlaying = ref(false)
const showLoop = ref(false)
const playhead = ref(0) // seconds
function persistShow() { localStorage.setItem(SHOW_KEY, JSON.stringify(cues)) }

function currentEffects() {
  const out = {}
  for (const [id, c] of effectControls) out[id] = { values: { ...c.values }, mappings: c.mappings.map((m) => ({ ...m })) }
  return out
}
function captureCue() {
  const t = cues.length ? Math.max(...cues.map((c) => c.time || 0)) + 8 : 0
  cues.push({ id: Date.now().toString(36), name: `Cue ${cues.length + 1}`, time: t, fade: 1, snap: JSON.parse(snapshot()), effects: currentEffects() })
  activeCue.value = cues.length - 1
  persistShow()
}
function updateCue(i) { cues[i].snap = JSON.parse(snapshot()); cues[i].effects = currentEffects(); persistShow() }
function deleteCue(i) {
  cues.splice(i, 1)
  if (activeCue.value >= cues.length) activeCue.value = cues.length - 1
  persistShow()
}
function moveCue(i, d) {
  const j = i + d
  if (j < 0 || j >= cues.length) return
  const [c] = cues.splice(i, 1)
  cues.splice(j, 0, c)
  persistShow()
}

// Re-apply captured effect-sketch param values once each effect iframe is live
// (reloaded effects announce ready; ones that didn't reload get it immediately).
let pendingEffects = null
function applyPendingEffects() {
  if (!pendingEffects) return
  for (const idStr of Object.keys(pendingEffects)) {
    const win = rtState.get(+idStr)?.iframe?.contentWindow
    if (!win) continue
    const pe = pendingEffects[idStr]
    win.postMessage({ type: 'sketch:apply-scene', values: pe.values, mappings: pe.mappings }, '*')
    const ec = effectControls.get(+idStr)
    if (ec) { ec.values = { ...pe.values }; ec.mappings = pe.mappings.map((m) => ({ ...m })) }
    delete pendingEffects[idStr]
  }
  if (!Object.keys(pendingEffects).length) pendingEffects = null
}
function applyCueState(cue) {
  applySnap(JSON.stringify(cue.snap))
  pendingEffects = { ...(cue.effects || {}) }
  nextTick(applyPendingEffects)
}
// Crossfade: freeze the current stage, swap the patch, fade the frozen frame
// out — hides the black flash while new effect iframes boot.
let xfade = null // { img, t0, dur }
function goCue(i, opts = {}) {
  if (i < 0 || i >= cues.length) return
  const cue = cues[i]
  const dur = ((opts.fade != null ? opts.fade : cue.fade) || 0) * 1000
  const cnv = stage.value
  if (dur > 0 && cnv && cnv.width) {
    const img = document.createElement('canvas')
    img.width = cnv.width; img.height = cnv.height
    img.getContext('2d').drawImage(cnv, 0, 0)
    xfade = { img, t0: performance.now(), dur }
  }
  applyCueState(cue)
  activeCue.value = i
}
function nextCue() { goCue(Math.min(cues.length - 1, activeCue.value + 1)) }
function prevCue() { goCue(Math.max(0, activeCue.value - 1)) }

// --- timeline playback ------------------------------------------------------
function showLength() { return cues.length ? Math.max(...cues.map((c) => c.time || 0)) : 0 }
let lastShowTs = 0
let curSeg = -1
function playShow() { if (!cues.length) return; showPlaying.value = true; lastShowTs = performance.now(); curSeg = -1 }
function pauseShow() { showPlaying.value = false }
function stopShow() { showPlaying.value = false; playhead.value = 0; curSeg = -1 }
function seekShow(t) { playhead.value = Math.max(0, Math.min(showLength(), t)); curSeg = -1 }
function topoMatch(a, b) {
  if (!a || !b || a.nodes.length !== b.nodes.length) return false
  const bm = new Map(b.nodes.map((n) => [n.id, n]))
  for (const n of a.nodes) { const m = bm.get(n.id); if (!m || m.type !== n.type) return false }
  if (JSON.stringify(a.edges) !== JSON.stringify(b.edges)) return false
  if (JSON.stringify(a.links || []) !== JSON.stringify(b.links || [])) return false
  return true
}
// Ramp the live graph's numeric params (and point arrays) from cue A→B by f.
function applyRamp(a, b, f) {
  const am = new Map(a.nodes.map((n) => [n.id, n]))
  const bm = new Map(b.nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    const A = am.get(n.id), B = bm.get(n.id)
    if (!A || !B || !A.params) continue
    for (const k of Object.keys(A.params)) {
      const av = A.params[k], bv = B.params?.[k]
      if (typeof av === 'number' && typeof bv === 'number') n.params[k] = av + (bv - av) * f
      else if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
        n.params[k] = av.map((p, idx) => (Array.isArray(p) && Array.isArray(bv[idx]) && p.length === bv[idx].length)
          ? p.map((c, ci) => c + (bv[idx][ci] - c) * f) : p)
      }
    }
  }
}
// Ramp each effect sketch's *internal* params between two cues by streaming
// set-param to the live iframe. Only animates params that actually differ
// between the cues, and throttles the postMessage traffic.
let lastEffectRamp = 0
function rampEffects(a, b, f) {
  const now = performance.now()
  if (now - lastEffectRamp < 45) return // ~22 Hz is plenty for a smooth ramp
  lastEffectRamp = now
  const ae = a.effects || {}, be = b.effects || {}
  for (const idStr of Object.keys(ae)) {
    if (!be[idStr]) continue
    const av = ae[idStr].values || {}, bv = be[idStr].values || {}
    const ec = effectControls.get(+idStr)
    for (const k of Object.keys(av)) {
      const x = av[k], y = bv[k]
      if (typeof x === 'number' && typeof y === 'number' && x !== y) {
        const v = x + (y - x) * f
        postToEffect(+idStr, { type: 'sketch:set-param', name: k, value: v })
        if (ec) ec.values[k] = v
      }
    }
  }
}
function tickShow(now) {
  const dt = (now - lastShowTs) / 1000
  lastShowTs = now
  playhead.value += dt
  const end = showLength()
  if (playhead.value >= end) {
    if (showLoop.value && end > 0) { playhead.value = 0; curSeg = -1 }
    else { playhead.value = end; showPlaying.value = false }
  }
  processTimeline()
}
function processTimeline() {
  if (!cues.length) return
  const sorted = [...cues].sort((a, b) => (a.time || 0) - (b.time || 0))
  let i = -1
  for (let k = 0; k < sorted.length; k++) { if ((sorted[k].time || 0) <= playhead.value + 1e-6) i = k; else break }
  if (i < 0) return
  if (i !== curSeg) {
    // Skip the reload when we're flowing forward through a ramped, same-topology
    // segment (the graph is already sitting at this cue from the last ramp).
    const rampedAdjacent = i === curSeg + 1 && curSeg >= 0 && topoMatch(sorted[curSeg].snap, sorted[i].snap)
    if (rampedAdjacent) activeCue.value = cues.indexOf(sorted[i])
    else goCue(cues.indexOf(sorted[i]), { fade: sorted[i].fade })
    curSeg = i
  }
  const next = sorted[i + 1]
  if (next && topoMatch(sorted[i].snap, next.snap)) {
    const span = (next.time || 0) - (sorted[i].time || 0)
    const f = span > 0 ? Math.min(1, Math.max(0, (playhead.value - (sorted[i].time || 0)) / span)) : 0
    applyRamp(sorted[i].snap, next.snap, f)
    rampEffects(sorted[i], next, f)
  }
}
// Timeline strip: a little headroom past the last cue so its marker is draggable.
const tlSpan = computed(() => Math.max(showLength(), 20))
function pct(t) { return (t / tlSpan.value) * 100 }
function tlSeek(e) {
  const r = e.currentTarget.getBoundingClientRect()
  seekShow(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * tlSpan.value)
}
let tlDrag = null
function tlCueMove(e) {
  if (!tlDrag) return
  const r = tlDrag.track.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  cues[tlDrag.i].time = +(f * tlSpan.value).toFixed(1)
}
function tlCueUp() {
  if (!tlDrag) return
  tlDrag = null
  persistShow()
  window.removeEventListener('pointermove', tlCueMove)
  window.removeEventListener('pointerup', tlCueUp)
}
function tlCueDown(i, e) {
  tlDrag = { i, track: e.currentTarget.parentElement }
  window.addEventListener('pointermove', tlCueMove)
  window.addEventListener('pointerup', tlCueUp)
}

// --- saved routings: named snapshots of the node graph in localStorage ----
const SAVED_KEY = 'sketchbook-patch-saved'
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || []
  } catch {
    return []
  }
}
const savedRoutings = ref(loadSaved())
const newName = ref('')
// Inline rename of a saved routing.
const editRoutingId = ref(null)
const editRoutingName = ref('')
function startRenameRouting(r) { editRoutingId.value = r.id; editRoutingName.value = r.name }
function commitRenameRouting() {
  const r = savedRoutings.value.find((x) => x.id === editRoutingId.value)
  if (r) { const n = editRoutingName.value.trim(); if (n) { r.name = n; persistSaved() } }
  editRoutingId.value = null
}
function persistSaved() {
  localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutings.value))
}

// --- blocks: reusable named subgraphs saved from a selection ----------------
// A block captures the selected nodes (with their params), the wiring between
// them, and any control links between them. It can be re-inserted (duplicated)
// as many times as you like, so you build a mini-rig once and stamp it out.
const BLOCK_KEY = 'sketchbook-patch-blocks'
const savedBlocks = ref((() => { try { return JSON.parse(localStorage.getItem(BLOCK_KEY)) || [] } catch { return [] } })())
const newBlockName = ref('')
const editBlockId = ref(null)
const editBlockName = ref('')
function persistBlocks() { localStorage.setItem(BLOCK_KEY, JSON.stringify(savedBlocks.value)) }
function saveBlock() {
  const ids = selectedSet.size ? [...selectedSet] : (selected.value != null ? [selected.value] : [])
  if (!ids.length) return
  const set = new Set(ids)
  const members = ids.map((id) => nodeById(id)).filter(Boolean)
  const minX = Math.min(...members.map((n) => n.x))
  const minY = Math.min(...members.map((n) => n.y))
  const bnodes = members.map((n) => ({
    id: n.id, type: n.type, x: n.x - minX, y: n.y - minY, name: n.name,
    locked: n.locked, params: JSON.parse(JSON.stringify(n.params)),
  }))
  const bedges = edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => ({ ...e }))
  const blinks = links.filter((l) => set.has(l.from) && set.has(l.node)).map((l) => ({ ...l }))
  savedBlocks.value.push({
    id: Date.now().toString(36),
    name: newBlockName.value.trim() || `Block ${savedBlocks.value.length + 1}`,
    nodes: bnodes, edges: bedges, links: blinks,
  })
  newBlockName.value = ''
  persistBlocks()
}
// Insert (stamp) a saved block into the graph with fresh ids, offset so it
// lands in view; selects the new nodes so you can immediately drag them.
function insertBlock(b) {
  const idMap = new Map()
  const ox = 90, oy = 80
  const created = []
  for (const mn of b.nodes) {
    const id = nextId++
    idMap.set(mn.id, id)
    const n = reactive({
      id, type: mn.type, x: mn.x + ox, y: mn.y + oy, name: mn.name,
      locked: mn.locked, params: JSON.parse(JSON.stringify(mn.params)),
    })
    nodes.push(n); st(id); created.push(id)
  }
  for (const e of b.edges) edges.push({ from: idMap.get(e.from), to: idMap.get(e.to), port: e.port })
  for (const l of b.links) links.push({ from: idMap.get(l.from), srcPort: l.srcPort, node: idMap.get(l.node), param: l.param })
  clearSelection()
  for (const id of created) selectedSet.add(id)
  persist()
  nextTick(() => layoutTick.value++)
}
function deleteBlock(b) {
  const i = savedBlocks.value.findIndex((x) => x.id === b.id)
  if (i >= 0) { savedBlocks.value.splice(i, 1); persistBlocks() }
}
function startRenameBlock(b) { editBlockId.value = b.id; editBlockName.value = b.name }
function commitRenameBlock() {
  const b = savedBlocks.value.find((x) => x.id === editBlockId.value)
  if (b) { const n = editBlockName.value.trim(); if (n) { b.name = n; persistBlocks() } }
  editBlockId.value = null
}
function saveRouting() {
  const name = newName.value.trim() || `Routing ${savedRoutings.value.length + 1}`
  savedRoutings.value.push({
    id: Date.now().toString(36),
    name,
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
    links: JSON.parse(JSON.stringify(links)),
    effects: currentEffects(), // each effect sketch's own param values + mappings
  })
  persistSaved()
  newName.value = ''
}
function loadRouting(r) {
  // r comes from the reactive saved list — deep-copy via JSON (structuredClone
  // throws DataCloneError on Vue's reactive proxies).
  const data = JSON.parse(JSON.stringify(r))
  normalizeNodes(data.nodes)
  nodes.splice(0, nodes.length, ...data.nodes.map((n) => reactive(n)))
  edges.splice(0, edges.length, ...data.edges)
  links.splice(0, links.length, ...(data.links ?? []))
  pruneOrphans()
  nextId = nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1
  // Keep runtime state (canvases, bound iframes/video) for node ids that
  // survive the swap — Vue won't re-mount same-keyed iframes, so clearing
  // their state would leave effect nodes black. Drop only vanished ids.
  const ids = new Set(nodes.map((n) => n.id))
  for (const id of [...rtState.keys()]) if (!ids.has(id)) rtState.delete(id)
  for (const n of nodes) st(n.id)
  // Restore each effect sketch's own params once its iframe is live.
  pendingEffects = { ...(data.effects || {}) }
  nextTick(applyPendingEffects)
  persist()
  nextTick(() => layoutTick.value++)
}
function deleteRouting(r) {
  const i = savedRoutings.value.findIndex((x) => x.id === r.id)
  if (i >= 0) {
    savedRoutings.value.splice(i, 1)
    persistSaved()
  }
}

// --- file import / export: patches and shows as .json -----------------------
function fileSlug(s) { return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled' }
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
function pickJsonFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json,.json'
    inp.onchange = () => {
      const f = inp.files?.[0]
      if (!f) return resolve(null)
      const r = new FileReader()
      r.onload = () => { try { resolve(JSON.parse(r.result)) } catch { resolve(null) } }
      r.onerror = () => resolve(null)
      r.readAsText(f)
    }
    inp.click()
  })
}
// A patch file carries the graph plus a little metadata so it's self-describing.
function exportPatch() {
  const name = newName.value.trim() || 'patch'
  downloadJson({
    type: 'sketchbook-patch', version: 1, name, resolution: resLabel.value,
    patch: { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), links: JSON.parse(JSON.stringify(links)), effects: currentEffects() },
  }, `${fileSlug(name)}.patch.json`)
}
function exportRouting(r) {
  downloadJson({ type: 'sketchbook-patch', version: 1, name: r.name, patch: { nodes: r.nodes, edges: r.edges, links: r.links || [], effects: r.effects || {} } }, `${fileSlug(r.name)}.patch.json`)
}
async function importPatch() {
  const data = await pickJsonFile()
  if (!data) { alertBadFile(); return }
  // accept the wrapped form, a bare {nodes,edges,links}, or a list of routings
  if (Array.isArray(data)) {
    for (const r of data) if (r?.nodes) savedRoutings.value.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: r.name || 'Imported', nodes: r.nodes, edges: r.edges || [], links: r.links || [] })
    persistSaved()
    return
  }
  const patch = data.patch || (data.nodes ? data : null)
  if (!patch?.nodes) { alertBadFile(); return }
  if (data.resolution && RESOLUTIONS.some((x) => x.label === data.resolution)) applyResolution(data.resolution)
  loadRouting(patch)
  // keep it around in the saved list too
  savedRoutings.value.push({ id: Date.now().toString(36), name: data.name || 'Imported patch', nodes: patch.nodes, edges: patch.edges || [], links: patch.links || [] })
  persistSaved()
}
function exportShow() {
  downloadJson({ type: 'sketchbook-show', version: 1, cues: JSON.parse(JSON.stringify(cues)) }, `${fileSlug('show')}.show.json`)
}
async function importShow() {
  const data = await pickJsonFile()
  const arr = Array.isArray(data) ? data : data?.cues
  if (!Array.isArray(arr)) { alertBadFile(); return }
  cues.splice(0, cues.length, ...arr)
  activeCue.value = -1
  curSeg = -1
  persistShow()
}
function alertBadFile() {
  console.warn('Patch: could not read that JSON file')
}

// --- guided tour -------------------------------------------------------------
const tourActive = ref(false)
const tourSteps = [
  { title: 'Patch — the studio', body: 'A node compositor: wire generator effects through filters and blends into an Output, then project it. This is the deep end.' },
  { target: '[data-tour="patch-add"]', title: 'Build the graph', body: 'Add effects, filters, text, media, masks and blends from here, then drag a node’s right port to another’s left port to wire them.', pad: 8 },
  { target: '[data-tour="patch-random"]', title: 'Randomize', body: 'Deal out a whole new random-but-sensible patch in one click (undoable). It draws from the effect pool you set in Settings.' },
  { target: '[data-tour="patch-mask"]', title: 'Projection mapping', body: 'Add a Polygon Mask node, then turn this on and drag the mask’s corners on the output to fit it to a real surface.' },
  { target: '[data-tour="patch-show"]', title: 'Plan a show', body: 'Capture the patch as cues and step through them, or lay them on a timeline that ramps parameters between them.' },
  { target: '[data-tour="patch-output"]', title: 'Go live', body: 'Switch to output-only and fullscreen for a clean projection, pop the output to a second display, or export the patch to a file.' },
]
function startTour() { tourActive.value = true }
function finishTour(payload) { settings.markSeen('patch'); if (payload?.disableAll) settings.setTutorials(false) }

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  if (settings.shouldAutoTour('patch')) setTimeout(startTour, 600)
  // Deep link from the Library: ?load=<id> opens a saved routing.
  const loadId = new URLSearchParams(location.hash.split('?')[1] || '').get('load')
  if (loadId) {
    const r = savedRoutings.value.find((x) => x.id === loadId)
    if (r) {
      loadRouting(r)
      await nextTick()
      layoutTick.value++
      resizeStage()
      window.addEventListener('resize', resizeStage)
      window.addEventListener('message', onEffectMessage)
      window.addEventListener('keydown', onKey)
      window.addEventListener('pointermove', trackMouse)
      raf = requestAnimationFrame(loop)
      return
    }
  }
  // Seed a starter graph the first time: effect → filter → output.
  if (!nodes.length) {
    addNode('effect')
    addNode('filter')
    addNode('output')
    await nextTick()
    nodes[1].x = 280
    nodes[2].x = 500
    edges.push({ from: nodes[0].id, to: nodes[1].id, port: 0 })
    edges.push({ from: nodes[1].id, to: nodes[2].id, port: 0 })
    persist()
  }
  await nextTick()
  layoutTick.value++ // measure param jacks once the graph is laid out
  resizeStage()
  window.addEventListener('resize', resizeStage)
  window.addEventListener('message', onEffectMessage)
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointermove', trackMouse)
  raf = requestAnimationFrame(loop)
})
function trackMouse(e) {
  mouseN.x = e.clientX / window.innerWidth
  mouseN.y = 1 - e.clientY / window.innerHeight
}
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resizeStage)
  window.removeEventListener('message', onEffectMessage)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', trackMouse)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  beat.stop()
  if (popup && !popup.closed) popup.close()
  stopSharedCamera()
  if (recorder && recorder.state === 'recording') recorder.stop()
})
</script>

<template>
  <div class="patch">
    <canvas ref="stage" class="stage" />

    <!-- hidden capture sources (iframes render at the compositor resolution) -->
    <div class="sources" aria-hidden="true">
      <template v-for="n in nodes" :key="'src' + n.id">
        <iframe
          v-if="(n.type === 'effect' || n.type === 'filter') && n.params.slug"
          :ref="(el) => bindFrame(n.id, el)"
          :src="effectSrc(n)"
          :style="{ width: frameSize.w + 'px', height: frameSize.h + 'px' }"
          allow="microphone; camera; midi; accelerometer; gyroscope"
        />
      </template>
    </div>

    <!-- toolbar: two layers — build the graph on top, run the show below -->
    <div v-show="!outputOnly" class="toolbar">
      <div class="toolbar-row">
        <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
        <span class="text-subtitle-2 mr-2">Patch</span>
        <!-- add-node buttons: icons tinted with each node type's colour -->
        <v-btn data-tour="patch-add" icon="mdi-creation" variant="tonal" size="small" title="Add Effect (generator sketch)" :style="{ color: TYPES.effect.color }" @click="addNode('effect')" />
        <v-btn icon="mdi-image-filter-vintage" variant="tonal" size="small" title="Add Filter (processes its video input)" :style="{ color: TYPES.filter.color }" @click="addNode('filter')" />
        <v-btn icon="mdi-image-multiple" variant="tonal" size="small" title="Add Media (camera · files · clips)" :style="{ color: TYPES.media.color }" @click="addNode('media')" />
        <v-btn icon="mdi-vector-intersection" variant="tonal" size="small" title="Add Mask (content × matte)" :style="{ color: TYPES.mask.color }" @click="addNode('mask')" />
        <v-btn icon="mdi-vector-polygon" variant="tonal" size="small" title="Add Polygon Mask (drag points on the output — projection mapping)" :style="{ color: TYPES.shape.color }" @click="addNode('shape')" />
        <v-btn icon="mdi-shape-outline" variant="tonal" size="small" title="Add Portal (remap a region elsewhere)" :style="{ color: TYPES.portal.color }" @click="addNode('portal')" />
        <v-btn icon="mdi-circle-half-full" variant="tonal" size="small" title="Add Blend (composite two streams)" :style="{ color: TYPES.blend.color }" @click="addNode('blend')" />
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-tune-variant" variant="tonal" size="small" title="Add a control node (Input · XY Pad · Tracker)" :style="{ color: TYPES.input.color }" />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-sine-wave" title="Input (audio · midi · …)" @click="addNode('input')" />
            <v-list-item prepend-icon="mdi-gesture-tap" title="XY Pad (touch surface)" @click="addNode('xy')" />
            <v-list-item prepend-icon="mdi-target" title="Tracker (video tracking)" @click="addNode('tracker')" />
          </v-list>
        </v-menu>
        <v-btn icon="mdi-format-text" variant="tonal" size="small" title="Add Text (mappable font)" :style="{ color: TYPES.text.color }" @click="addNode('text')" />
        <v-btn icon="mdi-monitor" variant="tonal" size="small" title="Add Output (fullscreen stage)" @click="addNode('output')" />
        <v-spacer />
        <v-btn data-tour="patch-random" icon="mdi-dice-multiple" variant="text" size="small" title="Randomize — deal out a whole new patch (undoable)" @click="randomPatch" />
        <v-btn icon="mdi-delete-sweep" variant="text" size="small" title="Clear graph" @click="clearAll" />
        <v-btn icon="mdi-undo" variant="text" size="small" title="Undo (Ctrl/Cmd+Z)" :disabled="!undoStack.length" @click="undo" />
        <v-btn icon="mdi-redo" variant="text" size="small" title="Redo (Ctrl/Cmd+Shift+Z)" :disabled="!redoStack.length" @click="redo" />
      </div>
      <div class="toolbar-row">
      <!-- Save: name + store the current graph as a routing -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-content-save-outline">Save</v-btn>
        </template>
        <v-card class="pa-2" min-width="250">
          <div class="d-flex ga-1 mb-2">
            <v-text-field
              v-model="newName"
              density="compact"
              hide-details
              placeholder="Name this routing"
              @keyup.enter="saveRouting"
            />
            <v-btn size="small" variant="tonal" @click="saveRouting">Save</v-btn>
          </div>
          <div class="d-flex ga-1">
            <v-btn size="small" variant="text" prepend-icon="mdi-download" @click="exportPatch">Export .json</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-upload" @click="importPatch">Import file</v-btn>
          </div>
        </v-card>
      </v-menu>
      <!-- Load: pick a saved routing -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-folder-open-outline">Load</v-btn>
        </template>
        <v-card class="pa-2" min-width="250">
          <v-list density="compact" max-height="320">
            <v-list-item
              v-for="r in savedRoutings"
              :key="r.id"
              @click="editRoutingId === r.id ? null : loadRouting(r)"
            >
              <template #title>
                <input
                  v-if="editRoutingId === r.id"
                  class="routing-rename"
                  :value="editRoutingName"
                  autofocus
                  @click.stop
                  @input="editRoutingName = $event.target.value"
                  @keyup.enter="commitRenameRouting"
                  @blur="commitRenameRouting"
                />
                <span v-else>{{ r.name }}</span>
              </template>
              <template #append>
                <v-icon icon="mdi-pencil" size="16" class="mr-2" title="Rename" @click.stop="startRenameRouting(r)" />
                <v-icon icon="mdi-download" size="16" class="mr-2" title="Export this routing as a file" @click.stop="exportRouting(r)" />
                <v-icon icon="mdi-delete" size="16" @click.stop="deleteRouting(r)" />
              </template>
            </v-list-item>
            <v-list-item v-if="!savedRoutings.length" title="No saved routings yet" disabled />
          </v-list>
        </v-card>
      </v-menu>

      <!-- Blocks: reusable named subgraphs stamped from a selection -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-view-grid-plus-outline">Blocks</v-btn>
        </template>
        <v-card class="pa-2" min-width="260">
          <div class="d-flex ga-1 mb-2">
            <v-text-field
              v-model="newBlockName"
              density="compact"
              hide-details
              :placeholder="selectedSet.size ? `Name this block (${selectedSet.size} nodes)` : 'Select nodes first'"
              @keyup.enter="saveBlock"
            />
            <v-btn size="small" variant="tonal" :disabled="!selectedSet.size && selected == null" @click="saveBlock">Save</v-btn>
          </div>
          <p class="text-caption text-medium-emphasis mb-1" style="font-size:11px">Click a block to stamp a copy into the graph.</p>
          <v-list density="compact" max-height="300">
            <v-list-item
              v-for="b in savedBlocks"
              :key="b.id"
              @click="editBlockId === b.id ? null : insertBlock(b)"
            >
              <template #title>
                <input
                  v-if="editBlockId === b.id"
                  class="routing-rename"
                  :value="editBlockName"
                  autofocus
                  @click.stop
                  @input="editBlockName = $event.target.value"
                  @keyup.enter="commitRenameBlock"
                  @blur="commitRenameBlock"
                />
                <span v-else>{{ b.name }} <span class="text-medium-emphasis" style="font-size:11px">· {{ b.nodes.length }}</span></span>
              </template>
              <template #append>
                <v-icon icon="mdi-content-copy" size="16" class="mr-2" title="Duplicate into the graph" @click.stop="insertBlock(b)" />
                <v-icon icon="mdi-pencil" size="16" class="mr-2" title="Rename" @click.stop="startRenameBlock(b)" />
                <v-icon icon="mdi-delete" size="16" @click.stop="deleteBlock(b)" />
              </template>
            </v-list-item>
            <v-list-item v-if="!savedBlocks.length" title="No saved blocks yet" disabled />
          </v-list>
        </v-card>
      </v-menu>

      <v-spacer />
      <v-btn
        :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
        variant="text"
        size="small"
        :color="micOn ? 'primary' : undefined"
        title="Mic — effect nodes' audio mappings react to sound"
        @click="toggleMic"
      />
      <v-btn
        :icon="cameraOn ? 'mdi-webcam' : 'mdi-webcam-off'"
        variant="text"
        size="small"
        :color="cameraOn ? 'primary' : undefined"
        title="Camera — request the webcam once; all Media nodes in camera mode share it"
        @click="toggleCamera"
      />
      <v-btn
        v-if="cameraOn"
        icon="mdi-camera-flip"
        variant="text"
        size="small"
        title="Flip between the front and back camera"
        @click="flipCamera"
      />
      <v-btn
        :icon="recording ? 'mdi-stop-circle' : 'mdi-record-circle-outline'"
        variant="text"
        size="small"
        :color="recording ? 'error' : undefined"
        :title="recording ? `Stop recording (${recElapsed}s) — saves to the library + downloads` : 'Record the output to a clip (prebake slow effects)'"
        @click="toggleRecord"
      />
      <v-btn
        icon="mdi-camera-iris"
        variant="text"
        size="small"
        title="Snapshot the output to a PNG (also added to the media library)"
        @click="snapshotPng"
      />
      <v-btn
        icon="mdi-speedometer"
        variant="text"
        size="small"
        :color="showFps ? 'primary' : undefined"
        title="FPS counter (compositor rate)"
        @click="toggleFps"
      />
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-monitor-screenshot">{{ resLabel }}</v-btn>
        </template>
        <v-list density="compact">
          <v-list-subheader>Compositor resolution</v-list-subheader>
          <v-list-item
            v-for="r in RESOLUTIONS"
            :key="r.label"
            :title="r.label"
            :active="resLabel === r.label"
            @click="applyResolution(r.label)"
          />
        </v-list>
      </v-menu>
      <v-btn icon="mdi-content-paste" variant="text" size="small" title="Paste node (Ctrl/Cmd+V)" :disabled="!clipboard" @click="pasteClipboard" />
      <v-btn
        data-tour="patch-mask"
        icon="mdi-vector-square-edit"
        variant="text" size="small"
        :color="maskEdit ? 'primary' : undefined"
        :title="shapeNodes.length ? 'Edit masks — drag the polygon points on the output' : 'Add a Polygon Mask first, then edit its points here'"
        @click="maskEdit = !maskEdit"
      />
      <v-btn
        data-tour="patch-show"
        icon="mdi-movie-open-play-outline"
        variant="text" size="small"
        :color="showOpen ? 'primary' : undefined"
        title="Show — plan cues and run them manually or on a timeline"
        @click="showOpen = !showOpen"
      />
      <v-btn
        :icon="renderPaused ? 'mdi-motion-play-outline' : 'mdi-motion-pause-outline'"
        variant="text" size="small"
        :color="renderPaused ? 'warning' : undefined"
        :title="renderPaused ? 'Resume the visuals' : 'Freeze the visuals (keeps the editor snappy while you tweak)'"
        @click="toggleRenderPaused"
      />
      <!-- pop-out output group, sat next to Output-only -->
      <v-btn
        icon="mdi-monitor-shimmer"
        variant="text"
        size="small"
        :color="popupOpen ? 'primary' : undefined"
        title="Pop out the output — drag it to a second display and keep adjusting here"
        @click="togglePopup"
      />
      <v-btn
        v-if="popupOpen"
        :icon="previewHold ? 'mdi-lock' : 'mdi-lock-open-variant-outline'"
        variant="text"
        size="small"
        :color="previewHold ? 'primary' : undefined"
        title="Preview hold — freeze the pop-out on the applied look while you redesign; use Apply to cut to the new one"
        @click="previewHold = !previewHold"
      />
      <v-btn
        v-if="popupOpen && previewHold"
        icon="mdi-check-bold"
        variant="tonal"
        size="small"
        color="primary"
        title="Apply — push the current board look to the held output"
        @click="applyToOutput"
      />
      <v-btn data-tour="patch-output" icon="mdi-projector-screen-outline" variant="text" size="small" title="Output only (hide routing)" @click="outputOnly = true" />
      <v-btn icon="mdi-help-circle-outline" variant="text" size="small" title="Replay the walkthrough" @click="startTour" />
      <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" variant="text" size="small" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="fullscreen" />
      </div>
    </div>

    <!-- output-only: floating controls to exit / go fullscreen -->
    <div v-if="outputOnly" class="output-ctrls">
      <v-btn icon="mdi-tune-variant" size="small" variant="flat" title="Show routing" @click="outputOnly = false" />
      <v-btn
        v-if="shapeNodes.length"
        icon="mdi-vector-square-edit" size="small" variant="flat"
        :color="maskEdit ? 'primary' : undefined"
        title="Edit masks — drag the polygon points"
        @click="maskEdit = !maskEdit"
      />
      <v-btn
        icon="mdi-movie-open-play-outline" size="small" variant="flat"
        :color="showOpen ? 'primary' : undefined"
        title="Show — run cues / timeline"
        @click="showOpen = !showOpen"
      />
      <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" size="small" variant="flat" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="fullscreen" />
    </div>

    <!-- projection-mapping overlay: draggable polygon-mask vertices over the
         stage; the SVG root ignores pointer events so the graph/UI underneath
         still work, only the handles and edges are interactive -->
    <svg v-if="maskEdit && shapeNodes.length" class="mask-overlay">
      <g v-for="sh in maskGeom" :key="sh.id" :class="{ 'mask-sel': sh.selected }">
        <path class="mask-fill" :d="sh.d" />
        <!-- wide invisible hit-lines: double-click an edge to add a point -->
        <line
          v-for="(p, i) in sh.pts" :key="'e' + i"
          class="mask-edge-hit"
          :x1="p.x" :y1="p.y"
          :x2="sh.pts[(i + 1) % sh.pts.length].x" :y2="sh.pts[(i + 1) % sh.pts.length].y"
          @dblclick="insertPoint(sh.id, i, $event)"
        />
        <circle
          v-for="(p, i) in sh.pts" :key="'h' + i"
          class="mask-handle"
          :cx="p.x" :cy="p.y" r="9"
          @pointerdown="maskDown(sh.id, i, $event)"
          @pointermove="maskMove"
          @pointerup="maskUp"
          @dblclick="removePoint(sh.id, i, $event)"
        />
      </g>
    </svg>

    <!-- show sequencer: cue list (manual) or timeline (auto + param ramps) -->
    <div v-if="showOpen" class="show-panel" @pointerdown.stop @wheel.stop>
      <div class="show-head">
        <span class="show-title">Show</span>
        <div class="show-modes">
          <button :class="{ on: showMode === 'cues' }" @click="showMode = 'cues'">Cues</button>
          <button :class="{ on: showMode === 'timeline' }" @click="showMode = 'timeline'">Timeline</button>
        </div>
        <button class="show-capture" title="Capture the current patch as a new cue" @click="captureCue">＋ Capture cue</button>
        <span class="show-spacer" />
        <v-btn icon="mdi-download" size="x-small" variant="text" :disabled="!cues.length" title="Export show as a .json file" @click="exportShow" />
        <v-btn icon="mdi-upload" size="x-small" variant="text" title="Import a show .json file" @click="importShow" />
        <v-btn icon="mdi-close" size="x-small" variant="text" @click="showOpen = false" />
      </div>

      <!-- transport: manual GO stack, or timeline play/scrub -->
      <div v-if="showMode === 'cues'" class="show-transport">
        <v-btn icon="mdi-skip-previous" size="small" variant="text" :disabled="activeCue <= 0" title="Previous cue" @click="prevCue" />
        <button class="go-btn" :disabled="!cues.length" title="Go to the next cue" @click="activeCue < 0 ? goCue(0) : nextCue()">GO</button>
        <v-btn icon="mdi-skip-next" size="small" variant="text" :disabled="activeCue >= cues.length - 1" title="Next cue" @click="nextCue" />
        <span class="show-hint">Click a cue to jump to it. GO steps through in order.</span>
      </div>
      <div v-else class="show-transport">
        <v-btn :icon="showPlaying ? 'mdi-pause' : 'mdi-play'" size="small" variant="text" @click="showPlaying ? pauseShow() : playShow()" />
        <v-btn icon="mdi-stop" size="small" variant="text" title="Stop and rewind" @click="stopShow" />
        <v-btn :icon="showLoop ? 'mdi-repeat' : 'mdi-repeat-off'" size="small" variant="text" :color="showLoop ? 'primary' : undefined" title="Loop the show" @click="showLoop = !showLoop" />
        <span class="show-clock">{{ playhead.toFixed(1) }}s / {{ showLength().toFixed(1) }}s</span>
        <div class="tl-track" @pointerdown="tlSeek($event)">
          <div class="tl-fill" :style="{ width: pct(playhead) + '%' }" />
          <div
            v-for="(c, i) in cues" :key="c.id"
            class="tl-cue" :class="{ on: activeCue === i }"
            :style="{ left: pct(c.time) + '%' }"
            :title="c.name + ' @ ' + c.time + 's'"
            @pointerdown.stop="tlCueDown(i, $event)"
          />
        </div>
      </div>

      <!-- cue list -->
      <div class="cue-list">
        <div v-if="!cues.length" class="show-empty">No cues yet. Set up the patch, then “＋ Capture cue”. Capture a few and step or time them into a show.</div>
        <div v-for="(c, i) in cues" :key="c.id" class="cue" :class="{ on: activeCue === i }" @click="goCue(i)">
          <span class="cue-idx">{{ i + 1 }}</span>
          <input class="cue-name" :value="c.name" @click.stop @change="c.name = $event.target.value; persistShow()" />
          <label v-if="showMode === 'timeline'" class="cue-num" title="Start time (s)" @click.stop>
            @<input type="number" min="0" step="0.5" :value="c.time" @change="c.time = Math.max(0, +$event.target.value); persistShow()" />s
          </label>
          <label class="cue-num" title="Crossfade (s)" @click.stop>
            ↝<input type="number" min="0" step="0.1" :value="c.fade" @change="c.fade = Math.max(0, +$event.target.value); persistShow()" />s
          </label>
          <button class="cue-mini" title="Update this cue to the current patch" @click.stop="updateCue(i)">⟳</button>
          <button class="cue-mini" title="Move up" @click.stop="moveCue(i, -1)">↑</button>
          <button class="cue-mini" title="Move down" @click.stop="moveCue(i, 1)">↓</button>
          <button class="cue-mini" title="Delete cue" @click.stop="deleteCue(i)">✕</button>
        </div>
      </div>
    </div>

    <!-- node board -->
    <div
      v-show="!outputOnly"
      ref="board"
      class="board"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerdown="onBoardDown"
      @wheel.prevent="onWheel"
    >
      <div class="space" :style="spaceStyle">
      <svg class="wires">
        <path
          v-for="w in wires"
          :key="w.idx"
          :d="w.d"
          :stroke="w.color"
          fill="none"
          stroke-width="2.5"
          :stroke-dasharray="w.matte ? '7 5' : undefined"
          class="wire"
          @click="removeEdge(w.idx)"
        />
        <!-- control links (Input node → a param jack) -->
        <path
          v-for="w in linkWires"
          :key="'l' + w.idx"
          :d="w.d"
          stroke="#e0a060"
          fill="none"
          stroke-width="2"
          stroke-dasharray="2 4"
          class="wire wire--control"
          @click="removeLink(w.idx)"
        />
        <path
          v-if="wire.active"
          :d="wirePath(outPortAt(nodes.find((n) => n.id === wire.from), wire.fromPort), { x: wire.x, y: wire.y })"
          :stroke="wire.kind === 'control' ? '#e0a060' : '#fff'"
          fill="none"
          stroke-width="2"
          :stroke-dasharray="wire.kind === 'control' ? '2 4' : '4 4'"
        />
      </svg>

      <div
        v-for="n in nodes"
        :key="n.id"
        :data-node-id="n.id"
        class="node"
        :class="{ 'node--selected': selectedSet.has(n.id) || selected === n.id, 'node--locked': n.locked, 'node--slow': nodeSlow(n) }"
        :style="{ left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px' }"
      >
        <div
          class="node-head"
          :style="{ background: TYPES[n.type].color }"
          @pointerdown="startDrag(n, $event)"
          @dblclick="!n.locked && startRename(n)"
        >
          <input
            v-if="editingName === n.id"
            class="node-name-edit"
            :value="n.name || ''"
            :placeholder="TYPES[n.type].title"
            autofocus
            @pointerdown.stop
            @keyup.enter="commitRename(n, $event.target.value)"
            @blur="commitRename(n, $event.target.value)"
          />
          <span v-else class="node-name" title="Double-click to rename">{{ nodeTitle(n) }}</span>
          <v-icon v-if="nodeSlow(n)" icon="mdi-alert" size="16" class="node-warn" :title="nodeSlowReason(n)" @pointerdown.stop />
          <v-icon :icon="n.locked ? 'mdi-lock' : 'mdi-lock-open-variant-outline'" size="13" class="node-lock" :title="n.locked ? 'Locked — click to unlock' : 'Lock this node'" @pointerdown.stop @click="n.locked = !n.locked; persist()" />
          <v-icon v-if="!n.locked" icon="mdi-close" size="14" class="node-close" @pointerdown.stop @click="removeNode(n.id)" />
        </div>

        <div
          class="node-thumb"
          :ref="(el) => bindThumb(n.id, el)"
          :style="{ height: THUMB_H + 'px', cursor: n.type === 'xy' ? 'crosshair' : undefined, touchAction: n.type === 'xy' ? 'none' : undefined }"
          @pointerdown="n.type === 'xy' && xyDown(n, $event)"
          @pointermove="n.type === 'xy' && xyMove(n, $event)"
          @pointerup="n.type === 'xy' && persist()"
        />

        <!-- input ports (centered on the wire endpoint; diamond = matte/mask) -->
        <div
          v-for="i in TYPES[n.type].ins"
          :key="'in' + i"
          class="port"
          :class="inKind(n, i - 1) === 'matte' ? 'port--matte' : 'port--image'"
          :style="{
            left: '-7px',
            top: HEAD_H + (THUMB_H * i) / (TYPES[n.type].ins + 1) - 7 + 'px',
          }"
          :data-in-node="n.id"
          :data-in-port="i - 1"
          :title="n.type === 'mask' ? (i === 1 ? 'content' : 'mask (matte)') : 'input'"
          @pointerup="endWire(n, i - 1)"
        />
        <!-- always-visible control dots for linked params whose settings panel
             is closed — control wires terminate here instead of vanishing -->
        <div
          v-for="d in nodeDots(n)"
          :key="'dot' + d.param"
          class="ldot"
          :data-jack-node="n.id"
          :data-jack-param="d.param"
          :style="{ left: '-5px', top: dotPos(n, d.param).y - n.y - 5 + 'px' }"
          :title="'control: ' + d.param"
          @pointerup="endLink(n, d.param)"
        />
        <!-- output ports (◆ matte · ▣ control value · ● image); XY Pad and
             Tracker expose several control outs (x / y / size) -->
        <div
          v-for="oi in outCount(n)"
          :key="'out' + oi"
          class="port"
          :class="outKind(n) === 'matte' ? 'port--matte' : outKind(n) === 'control' ? 'port--control' : 'port--image'"
          :style="{ left: NODE_W - 7 + 'px', top: HEAD_H + (THUMB_H * oi) / (outCount(n) + 1) - 7 + 'px' }"
          :title="OUT_LABELS[n.type]?.[oi - 1] ?? (outKind(n) === 'control' ? 'control out — drag to a param ▣' : 'output')"
          @pointerdown="startWire(n, $event, oi - 1)"
        />
        <template v-if="OUT_LABELS[n.type]">
          <span
            v-for="oi in outCount(n)"
            :key="'ol' + oi"
            class="port-label"
            :style="{ left: NODE_W + 9 + 'px', top: HEAD_H + (THUMB_H * oi) / (outCount(n) + 1) - 7 + 'px' }"
          >{{ OUT_LABELS[n.type][oi - 1] }}</span>
        </template>

        <!-- per-node controls -->
        <div class="node-body">
          <template v-if="n.type === 'effect' || n.type === 'filter'">
            <div class="d-flex ga-1 align-center">
              <select v-model="n.params.slug" class="flex-grow-1" @change="persist" @pointerdown.stop>
                <option v-for="o in n.type === 'filter' ? filterOptions : effectOptions" :key="o.slug" :value="o.slug">{{ o.title }}</option>
              </select>
              <button
                v-if="effectControls.has(n.id)"
                class="knob-btn"
                :class="{ on: showParams.get(n.id) }"
                title="Parameters & input mappings"
                @pointerdown.stop
                @click="toggleParams(n.id)"
              >⚙</button>
            </div>

            <!-- effect params + mappings (same protocol as the viewer/Mixer) -->
            <div v-if="showParams.get(n.id) && effectControls.get(n.id)" class="params" @pointerdown.stop>
              <template v-for="(spec, name) in effectControls.get(n.id).schema" :key="name">
                <label v-if="spec.type === 'bool'" class="chk">
                  <input type="checkbox" :checked="effectControls.get(n.id).values[name]" @change="setEffectParam(n.id, name, $event.target.checked)" /> {{ spec.label ?? name }}
                </label>
                <button v-else-if="spec.type === 'action'" class="shape-btn" @pointerdown.stop @click="postToEffect(n.id, { type: 'sketch:action', name })">{{ spec.label ?? name }}</button>
                <label v-else-if="spec.type === 'select'">
                  {{ spec.label ?? name }}
                  <select :value="effectControls.get(n.id).values[name]" @change="setEffectParam(n.id, name, $event.target.value)">
                    <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                  </select>
                </label>
                <label v-else>
                  <span class="pjack" :ref="(el) => bindJack(n.id, name, el)" :data-jack-node="n.id" :data-jack-param="name" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, name)" />
                  {{ spec.label ?? name }}
                  <input type="range" :min="spec.min" :max="spec.max" :step="spec.step ?? 0.01" :value="effectControls.get(n.id).values[name]" @input="setEffectParam(n.id, name, +$event.target.value)" />
                </label>
              </template>

              <div class="map-head">
                <span>Mappings</span>
                <span class="d-flex ga-1">
                  <button class="mini" title="Auto-map — apply this sketch's default input mappings" @click="autoMap(n)">⚡</button>
                  <button class="mini" title="Add mapping" @click="addEffectMapping(n.id)">+</button>
                </span>
              </div>
              <div v-for="(m, mi) in effectControls.get(n.id).mappings" :key="mi" class="map-row">
                <select v-model="m.source" @change="syncEffectMappings(n.id)">
                  <optgroup v-for="[g, list] in INPUT_GROUPS" :key="g" :label="g">
                    <option v-for="src in list" :key="src" :value="src">{{ src }}</option>
                  </optgroup>
                </select>
                <span>→</span>
                <select v-model="m.param" @change="syncEffectMappings(n.id)">
                  <option v-for="pn in numericParamsOfEffect(n.id)" :key="pn" :value="pn">{{ pn }}</option>
                </select>
                <input type="range" min="-1" max="1" step="0.05" v-model.number="m.amount" title="amount" @input="syncEffectMappings(n.id)" />
                <input type="range" min="0" max="0.98" step="0.02" :value="m.smooth ?? 0" title="smoothing" @input="m.smooth = +$event.target.value; syncEffectMappings(n.id)" />
                <button class="mini" title="Remove" @click="removeEffectMapping(n.id, mi)">×</button>
              </div>
            </div>
          </template>

          <template v-if="n.type === 'input'">
            <select v-model="n.params.source" @change="persist" @pointerdown.stop title="control source">
              <optgroup v-for="[g, list] in INPUT_GROUPS" :key="g" :label="g">
                <option v-for="src in list" :key="src" :value="src">{{ src }}</option>
              </optgroup>
            </select>
            <label>scale <input type="range" min="-2" max="2" step="0.05" v-model.number="n.params.scale" @change="persist" @pointerdown.stop /></label>
            <label>offset <input type="range" min="-1" max="1" step="0.02" v-model.number="n.params.offset" @change="persist" @pointerdown.stop /></label>
            <label>curve
              <select v-model="n.params.curve" @change="persist" @pointerdown.stop>
                <option v-for="c in INPUT_CURVES" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.invert" @change="persist" @pointerdown.stop /> invert</label>
          </template>
          <template v-if="n.type === 'tracker'">
            <label>threshold <input type="range" min="0.05" max="0.95" step="0.01" v-model.number="n.params.thresh" @change="persist" @pointerdown.stop /></label>
            <label>smoothing <input type="range" min="0" max="0.95" step="0.01" v-model.number="n.params.smooth" @change="persist" @pointerdown.stop /></label>
          </template>
          <template v-if="n.type === 'blend'">
            <select v-model="n.params.mode" @change="persist" @pointerdown.stop>
              <option v-for="b in BLENDS" :key="b" :value="b">{{ b }}</option>
            </select>
            <label><span class="pjack" :ref="(el) => bindJack(n.id, 'mix', el)" :data-jack-node="n.id" data-jack-param="mix" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'mix')" /> mix <input type="range" min="0" max="1" step="0.02" :value="n.params.mix ?? 1" @input="n.params.mix = +$event.target.value; persist()" @pointerdown.stop /></label>
          </template>
          <template v-if="n.type === 'media'">
            <label>source
              <select v-model="n.params.mode" @change="persist" @pointerdown.stop>
                <option value="camera">📷 Camera{{ cameraOn ? '' : ' (off)' }}</option>
                <option value="library">🎞 Library</option>
              </select>
            </label>
            <label v-if="n.params.mode === 'library'">clip
              <select :value="n.params.mediaId" @change="pickMedia(n, +$event.target.value)" @pointerdown.stop>
                <option v-if="!mediaLibrary.length" :value="null" disabled>— load files below —</option>
                <option v-for="m in mediaLibrary" :key="m.id" :value="m.id">{{ m.kind === 'video' ? '▶' : '🖼' }} {{ m.name }}</option>
              </select>
            </label>
            <label class="load-btn" title="Load images or videos into the library" @pointerdown.stop>
              ＋ Load files
              <input type="file" accept="image/*,video/*" multiple hidden @change="loadMediaFiles(n, $event)" />
            </label>
            <div v-if="n.params.mode === 'camera' && !cameraOn" class="media-hint">Camera is off — enable it with the webcam button in the toolbar.</div>
          </template>
          <template v-if="n.type === 'text'">
            <input class="text-in" type="text" :value="n.params.text" placeholder="type…" @input="n.params.text = $event.target.value; persist()" @pointerdown.stop />
            <label>font
              <select v-model="n.params.font" @change="persist" @pointerdown.stop>
                <option v-for="f in TEXT_FONTS" :key="f" :value="f">{{ f }}</option>
              </select>
            </label>
            <label v-for="pk in ['size', 'weight', 'tracking', 'x', 'y', 'hue', 'rotate']" :key="pk">
              <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
              {{ pk }}
              <input type="range" :min="PARAM_RANGES.text[pk][0]" :max="PARAM_RANGES.text[pk][1]" :step="(PARAM_RANGES.text[pk][1] - PARAM_RANGES.text[pk][0]) / 100" :value="n.params[pk]" @input="n.params[pk] = +$event.target.value; persist()" @pointerdown.stop />
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.italic" @change="persist" @pointerdown.stop /> italic</label>
            <label class="chk"><input type="checkbox" v-model="n.params.bg" @change="persist" @pointerdown.stop /> black background</label>
            <label>glow <input type="range" min="0" max="1.5" step="0.05" v-model.number="n.params.glow" @change="persist" @pointerdown.stop /></label>
          </template>
          <template v-if="n.type === 'portal'">
            <div class="portal-grid">
              <span class="portal-lbl">from</span>
              <label v-for="pk in ['srcX', 'srcY', 'srcW', 'srcH']" :key="pk" class="portal-cell">
                <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
                {{ pk.slice(3).toLowerCase() }}
                <input type="range" min="0" max="1" step="0.01" :value="n.params[pk]" @input="n.params[pk] = +$event.target.value; persist()" @pointerdown.stop />
              </label>
              <span class="portal-lbl">to</span>
              <label v-for="pk in ['dstX', 'dstY', 'dstW', 'dstH']" :key="pk" class="portal-cell">
                <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
                {{ pk.slice(3).toLowerCase() }}
                <input type="range" min="0" max="1" step="0.01" :value="n.params[pk]" @input="n.params[pk] = +$event.target.value; persist()" @pointerdown.stop />
              </label>
            </div>
            <label>shape
              <select v-model="n.params.shape" @change="persist" @pointerdown.stop>
                <option v-for="sh in PORTAL_SHAPES" :key="sh" :value="sh">{{ sh }}</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.lockAspect" @change="persist" @pointerdown.stop /> lock proportions</label>
            <label v-if="n.params.lockAspect">aspect
              <select v-model="n.params.aspect" @change="persist" @pointerdown.stop>
                <option v-for="a in Object.keys(ASPECTS)" :key="a" :value="a">{{ a }}</option>
              </select>
            </label>
            <label>recurse <input type="range" min="1" max="8" step="1" v-model.number="n.params.recurse" @change="persist" @pointerdown.stop /></label>
            <label class="chk"><input type="checkbox" v-model="n.params.border" @change="persist" @pointerdown.stop /> outline</label>
          </template>

          <template v-if="n.type === 'shape'">
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'feather', el)" :data-jack-node="n.id" data-jack-param="feather" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'feather')" />
              feather <input type="range" min="0" max="0.5" step="0.01" :value="n.params.feather" @input="n.params.feather = +$event.target.value; persist()" @pointerdown.stop />
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.invert" @change="persist" @pointerdown.stop /> invert (cut a hole)</label>
            <div class="shape-row">
              <button class="shape-btn" :class="{ on: maskEdit }" @pointerdown.stop @click="maskEdit = !maskEdit">{{ maskEdit ? 'editing points' : 'edit points' }}</button>
              <button class="shape-btn" @pointerdown.stop @click="resetShape(n.id)">reset</button>
            </div>
            <div class="shape-hint">Turn on “edit points”, then drag the corners on the output. Double-click an edge to add a point, a point to remove it.</div>
          </template>
        </div>
      </div>
      </div>
    </div>

    <div v-if="showFps" class="fps-meter">{{ fps }} FPS</div>

    <div v-show="!outputOnly" class="zoom-ctrls">
      <v-btn icon="mdi-magnify-minus-outline" size="x-small" variant="text" title="Zoom out" @click="zoomStep(1 / 1.2)" />
      <span class="zoom-pct">{{ Math.round(view.zoom * 100) }}%</span>
      <v-btn icon="mdi-magnify-plus-outline" size="x-small" variant="text" title="Zoom in" @click="zoomStep(1.2)" />
      <v-btn icon="mdi-backup-restore" size="x-small" variant="text" title="Reset zoom to 100%" @click="resetView" />
      <v-btn icon="mdi-fit-to-page-outline" size="x-small" variant="text" title="Zoom to fit — frame the whole graph" @click="fitToView" />
    </div>

    <div v-show="!outputOnly" class="hint">Drag a node's right port to another node's left port to wire it. Drag an Input node's ▣ output to any param's ▣ jack to modulate it. Click a wire to remove it.</div>

    <TourOverlay v-model="tourActive" :steps="tourSteps" @finish="finishTour" />
  </div>
</template>

<style scoped>
.patch { position: fixed; inset: 0; background: #0a0b0f; z-index: 2000; overflow: hidden; }
.stage { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
.sources { position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none; }
.sources iframe, .sources video { width: 384px; height: 216px; border: 0; }
.toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  display: flex; flex-direction: column; gap: 2px; padding: 6px 12px 8px;
  background: linear-gradient(to bottom, rgba(5,6,10,0.94), rgba(5,6,10,0.72));
  backdrop-filter: blur(6px);
}
.toolbar-row {
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; row-gap: 2px; min-width: 0;
}
@media (max-width: 640px) {
  .toolbar { padding: 3px 4px 5px; }
  /* two fixed layers that scroll sideways — never a third wrapped line */
  .toolbar-row {
    gap: 2px; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .toolbar-row::-webkit-scrollbar { display: none; }
  .toolbar-row > * { flex: 0 0 auto; }
  .toolbar :deep(.v-btn--icon.v-btn--size-small) { width: 34px; height: 34px; }
  .toolbar :deep(.v-btn--size-small:not(.v-btn--icon)) { padding: 0 8px; min-width: 0; }
}
.board { position: absolute; inset: 0; z-index: 10; cursor: grab; touch-action: none; }
.board:active { cursor: grabbing; }
.space { position: absolute; inset: 0; transform-origin: 0 0; }
.zoom-ctrls {
  position: absolute; bottom: 8px; left: 8px; z-index: 30;
  display: flex; align-items: center; gap: 2px;
  background: rgba(20,22,30,0.85); border-radius: 8px; padding: 2px 4px;
}
.zoom-pct { font: 11px system-ui, sans-serif; color: #cdd3e0; min-width: 38px; text-align: center; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 11; }
.wire { pointer-events: stroke; cursor: pointer; opacity: 0.9; }
.wire:hover { stroke-width: 4; }
.node {
  position: absolute; z-index: 12; border-radius: 8px; overflow: visible;
  touch-action: none;
  background: rgba(20,22,30,0.96); border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 6px 20px rgba(0,0,0,0.4); user-select: none;
}
.node--selected { border-color: #7c8cff; box-shadow: 0 0 0 2px rgba(124,140,255,0.5), 0 6px 20px rgba(0,0,0,0.4); }
.node-head {
  display: flex; align-items: center; justify-content: space-between;
  height: 30px; padding: 0 8px; border-radius: 8px 8px 0 0; cursor: grab;
  color: #06070a; font: 600 12px system-ui, sans-serif;
}
.node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-name-edit {
  flex: 1; min-width: 0; margin-right: 4px; background: rgba(255,255,255,0.7);
  border: 0; border-radius: 3px; padding: 1px 4px; font: 600 12px system-ui; color: #06070a;
}
.node-close { cursor: pointer; color: rgba(0,0,0,0.6); }
.node-warn { color: #ffd23f; margin-right: 2px; filter: drop-shadow(0 0 4px rgba(255,60,60,0.95)); cursor: help; }
/* A slow node gets a prominent red outline + pulsing warning so it's obvious. */
.node--slow { outline: 2px solid #ff4d4d; outline-offset: 0; box-shadow: 0 0 0 2px rgba(255,77,77,0.35), 0 6px 20px rgba(0,0,0,0.4); }
.node--slow .node-warn { animation: warnPulse 1.4s ease-in-out infinite; }
@keyframes warnPulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
.node-lock { cursor: pointer; color: rgba(0,0,0,0.55); margin-right: 2px; }
.node-lock:hover { color: rgba(0,0,0,0.85); }
/* A locked node resists moving/removal and its params can't be edited. */
.node--locked { outline: 1px dashed rgba(124,140,255,0.5); }
.node--locked .node-head { cursor: default; }
.node--locked .node-body, .node--locked .node-thumb { pointer-events: none; opacity: 0.75; }
.load-btn {
  display: inline-block; cursor: pointer; font: 11px system-ui, sans-serif;
  color: #cdd3e0; background: #12141c; border: 1px solid #333; border-radius: 4px;
  padding: 3px 8px; text-align: center;
}
.load-btn:hover { background: #1a1d28; }
.media-hint { font: 10px system-ui, sans-serif; color: #9aa4c0; opacity: 0.8; }
.text-in {
  width: 100%; background: #12141c; color: #e8ecf5; border: 1px solid #333;
  border-radius: 4px; padding: 3px 6px; font: 12px system-ui, sans-serif;
}
.routing-rename { width: 100%; background: #12141c; color: #e8ecf5; border: 1px solid #3a4056; border-radius: 4px; font: 13px system-ui, sans-serif; padding: 2px 6px; }
.shape-row { display: flex; gap: 6px; margin-top: 4px; }
.shape-btn {
  flex: 1; font: 10px system-ui, sans-serif; color: #cdd3e0; cursor: pointer;
  background: #12141c; border: 1px solid #333; border-radius: 4px; padding: 3px 6px;
}
.shape-btn.on { border-color: #f2ad00; color: #ffcd5a; }
.shape-hint { font: 10px system-ui, sans-serif; color: #8a90a0; margin-top: 4px; line-height: 1.35; }
.portal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 6px; align-items: center; }
.portal-lbl { grid-column: 1 / -1; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; margin-top: 2px; }

/* --- show sequencer panel (bottom sheet) --- */
.show-panel {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 41;
  max-height: 42vh; display: flex; flex-direction: column;
  background: rgba(12, 14, 20, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px); font: 12px system-ui, sans-serif; color: #cdd3e0;
}
.show-head { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.show-title { font-weight: 600; color: #e8ecf5; }
.show-modes { display: flex; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
.show-modes button { font: 11px system-ui; color: #9aa4c0; background: transparent; border: 0; padding: 3px 12px; cursor: pointer; }
.show-modes button.on { background: rgba(124,140,255,0.25); color: #fff; }
.show-capture { font: 11px system-ui; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.show-capture:hover { border-color: #7c8cff; }
.show-spacer { flex: 1; }
.show-transport { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.go-btn { font: 700 12px system-ui; color: #0a0b0f; background: #a0e060; border: 0; border-radius: 6px; padding: 5px 18px; cursor: pointer; letter-spacing: 0.08em; }
.go-btn:disabled { opacity: 0.4; cursor: default; }
.show-hint { font: 11px system-ui; color: #8a90a0; margin-left: 6px; }
.show-clock { font: 11px ui-monospace, monospace; color: #9aa4c0; min-width: 96px; }
.tl-track { position: relative; flex: 1; height: 22px; margin-left: 6px; border-radius: 6px; background: #1a1d28; border: 1px solid #2a2f40; cursor: pointer; overflow: hidden; }
.tl-fill { position: absolute; top: 0; bottom: 0; left: 0; background: rgba(124,140,255,0.22); }
.tl-cue { position: absolute; top: -1px; bottom: -1px; width: 3px; margin-left: -1.5px; background: #a0e060; cursor: ew-resize; }
.tl-cue.on { background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.7); }
.cue-list { overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.show-empty { color: #8a90a0; font: 11px system-ui; padding: 10px 4px; line-height: 1.5; }
.cue { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; background: #14171f; border: 1px solid transparent; cursor: pointer; }
.cue:hover { border-color: #3a4056; }
.cue.on { border-color: #a0e060; background: rgba(160,224,96,0.08); }
.cue-idx { font: 11px ui-monospace, monospace; color: #7a8090; min-width: 16px; text-align: right; }
.cue-name { flex: 1; min-width: 60px; background: transparent; border: 0; color: #e8ecf5; font: 12px system-ui; padding: 2px 4px; border-radius: 4px; }
.cue-name:focus { background: #12141c; outline: 1px solid #3a4056; }
.cue-num { display: inline-flex; align-items: center; gap: 1px; font: 10px system-ui; color: #9aa4c0; }
.cue-num input { width: 42px; background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; font: 10px ui-monospace, monospace; padding: 1px 3px; }
.cue-mini { width: 20px; height: 20px; border-radius: 4px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 11px; line-height: 1; }
.cue-mini:hover { border-color: #7c8cff; }
.portal-cell { font-size: 10px; }
.node-thumb { width: 100%; background: #000; }
.node-thumb :deep(canvas) { width: 100%; height: 100%; display: block; }
.node-body { padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
.node-body select, .node-body label { font: 11px system-ui, sans-serif; color: #cdd3e0; }
.node-body select { width: 100%; background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; }
.node-body input[type=range] { width: 100%; }
.node-body .chk { display: flex; align-items: center; gap: 4px; }
.knob-btn {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 4px; cursor: pointer;
  background: #12141c; color: #cdd3e0; border: 1px solid #333; font-size: 12px;
}
.knob-btn.on { border-color: #7c8cff; color: #7c8cff; }
.params { margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; display: flex; flex-direction: column; gap: 3px; }
.params label { display: flex; flex-direction: column; gap: 1px; }
.map-head { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; }
.map-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 3px; align-items: center; }
.map-row select { font-size: 10px; }
.map-row input[type=range] { grid-column: 1 / -1; }
.mini { width: 18px; height: 18px; border-radius: 3px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 12px; line-height: 1; }
.port {
  position: absolute; box-sizing: border-box; width: 14px; height: 14px;
  background: #12141c; border: 2px solid #9aa4c0; cursor: crosshair; z-index: 13;
}
.port:hover { border-color: #fff; background: #2a2f40; }
/* image stream = round; matte / mask = diamond; control value = amber square */
.port--image { border-radius: 50%; }
.port--matte { border-radius: 2px; transform: rotate(45deg); }
.port--control { border-radius: 2px; border-color: #e0a060; }
.port--control:hover { border-color: #ffd9a0; }
/* a control-input jack sitting beside a param control */
.pjack {
  display: inline-block; width: 10px; height: 10px; box-sizing: border-box;
  border: 2px solid #e0a060; border-radius: 2px; background: #12141c;
  cursor: crosshair; vertical-align: middle; margin-right: 4px;
}
.pjack:hover { border-color: #ffd9a0; background: #2a2f40; }
/* left-edge dot for a linked param whose settings panel is closed */
.ldot {
  position: absolute; box-sizing: border-box; width: 10px; height: 10px;
  background: #12141c; border: 2px solid #e0a060; border-radius: 2px;
  cursor: crosshair; z-index: 13;
}
.ldot:hover { border-color: #ffd9a0; }
.port-label {
  position: absolute; z-index: 13; pointer-events: none;
  font: 10px system-ui, sans-serif; color: #e0a060;
}
.wire--control { opacity: 0.85; }
.hint {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); z-index: 30;
  color: rgba(255,255,255,0.5); font: 12px system-ui, sans-serif; pointer-events: none;
}
.output-ctrls {
  position: absolute; top: 10px; right: 10px; z-index: 40;
  display: flex; gap: 6px; opacity: 0.35; transition: opacity 0.2s;
}
.output-ctrls:hover { opacity: 1; }
/* projection-mapping overlay */
.mask-overlay {
  position: fixed; inset: 0; z-index: 35; pointer-events: none;
  width: 100%; height: 100%;
}
.mask-fill { fill: rgba(242, 173, 0, 0.08); stroke: rgba(242, 173, 0, 0.7); stroke-width: 1.5; }
.mask-sel .mask-fill { fill: rgba(242, 173, 0, 0.14); stroke: rgba(255, 205, 90, 0.95); }
.mask-edge-hit { stroke: transparent; stroke-width: 16; pointer-events: stroke; cursor: copy; }
.mask-handle {
  fill: #10121a; stroke: #f2ad00; stroke-width: 2.5;
  pointer-events: auto; cursor: grab; touch-action: none;
}
.mask-handle:hover { fill: #f2ad00; }
.mask-sel .mask-handle { stroke: #ffcd5a; }
/* fingers need fatter targets than a mouse */
@media (pointer: coarse) {
  .port { width: 20px; height: 20px; }
  .pjack, .ldot { width: 16px; height: 16px; }
  .node-body input[type=range] { height: 26px; }
}
.fps-meter {
  position: absolute; bottom: 8px; right: 8px; z-index: 40;
  padding: 3px 8px; border-radius: 6px;
  font: 12px/1.4 ui-monospace, monospace; color: #8f8;
  background: rgba(0, 0, 0, 0.55); pointer-events: none;
}
</style>
