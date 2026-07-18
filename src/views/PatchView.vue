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
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'
import { createMidiInput, createLeapInput, createArtnetInput } from '../../sketches/_lib/inputs.js'

const store = useSketchStore()
// Source-filter sketches (built on _lib/source.js): they accept a mixer:frame
// feed, so in the graph they live behind a dedicated Filter node type that
// pipes its video input straight into them.
const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone',
  'channel-offset', 'delay', 'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope',
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
}

const NODE_W = 190
const HEAD_H = 30
const THUMB_H = 107

const TYPES = {
  effect: { title: 'Effect', ins: 0, color: '#7c8cff' },
  filter: { title: 'Filter', ins: 1, color: '#c98cff' },
  camera: { title: 'Camera', ins: 0, color: '#4dd0c4' },
  mask: { title: 'Mask', ins: 2, color: '#f2ad00' },
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
    if (n.type === 'motion') {
      n.type = 'filter'
      n.params = { slug: 'motion-extraction' }
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
              ? { source: 'audio.volume', scale: 1, offset: 0 }
              : type === 'xy'
                ? { x: 0.5, y: 0.5 }
                : type === 'tracker'
                  ? { thresh: 0.5, smooth: 0.7 }
                  : {},
  })
  nodes.push(n)
  st(n.id) // create runtime state
  persist()
  nextTick(() => layoutTick.value++)
}
function removeNode(id) {
  const i = nodes.findIndex((n) => n.id === id)
  if (i >= 0) nodes.splice(i, 1)
  for (let k = edges.length - 1; k >= 0; k--)
    if (edges[k].from === id || edges[k].to === id) edges.splice(k, 1)
  for (let k = links.length - 1; k >= 0; k--)
    if (links[k].from === id || links[k].node === id) links.splice(k, 1)
  rtState.delete(id)
  persist()
}

// --- randomize: deal out a whole new patch -------------------------------
// Builds a fresh random-but-sensible graph: 1–3 effect sources, each pushed
// through a random filter chain, the streams folded together with random
// blends (or the odd mask), an Output at the end, and a control node wired
// into a blend mix. Goes through persist(), so it's a single undo step.
function randomPatch() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const chance = (p) => Math.random() < p

  nodes.splice(0)
  edges.splice(0)
  links.splice(0)
  rtState.clear()

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
  for (let i = 0; i < nChains; i++) {
    const y = 90 + i * 230
    let prev = mk('effect', { slug: pick(effectOptions.value)?.slug ?? '' }, 0, y)
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
function inputValue(node, now) {
  ensureInput(node.params.source)
  return clamp(sourceValue(node.params.source, now) * node.params.scale + node.params.offset, 0, 1)
}
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

const drag = reactive({ node: null, dx: 0, dy: 0 })
const wire = reactive({ active: false, from: null, fromPort: 0, x: 0, y: 0, kind: 'video' })
const selected = ref(null) // node id last clicked — target for copy/delete

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
// Two-finger pinch state (pointerId -> last client point).
const pinch = new Map()
function onBoardDown(e) {
  if (e.target.closest('.node')) return // let node/port handlers run
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
  const p = boardXY(e)
  drag.node = n.id
  selected.value = n.id
  drag.dx = p.x - n.x
  drag.dy = p.y - n.y
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
    const n = nodes.find((x) => x.id === drag.node)
    if (n) {
      n.x = p.x - drag.dx
      n.y = p.y - drag.dy
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
  return s ? `${s.url}?capture=1&preview=1&quality=high` : ''
}
function bindFrame(id, el) {
  if (el) st(id).iframe = el
}
async function bindVideo(id, el) {
  const s = st(id)
  if (!el || s.video === el) return
  s.video = el
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } })
    el.srcObject = stream
    await el.play()
  } catch {
    /* no camera */
  }
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
  } else if (node.type === 'camera') {
    if (s.video && s.video.videoWidth) cover(octx, s.video, s.video.videoWidth, s.video.videoHeight)
  } else if (node.type === 'mask') {
    const content = inputCanvas(node, 0)
    const mask = inputCanvas(node, 1)
    if (content) octx.drawImage(content, 0, 0, W, H)
    if (mask) {
      octx.globalCompositeOperation = 'multiply'
      octx.drawImage(mask, 0, 0, W, H)
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
let fpsWindow = 0

function loop(ts) {
  const now = ts ?? performance.now()
  broadcastBeat(now)
  applyLinks(now) // drive params from Input nodes first
  if (skipLeft > 0) {
    skipLeft--
  } else {
    const t0 = performance.now()
    for (const n of evalOrder()) evalNode(n)
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
    }
  }
  raf = requestAnimationFrame(loop)
}

function resizeStage() {
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
function fullscreen() {
  board.value?.parentElement?.requestFullscreen?.()
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
function blitPopup() {
  if (!popup || popup.closed) {
    if (popupOpen.value) {
      popupOpen.value = false
      popup = null
    }
    return
  }
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
function persistSaved() {
  localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutings.value))
}
function saveRouting() {
  const name = newName.value.trim() || `Routing ${savedRoutings.value.length + 1}`
  savedRoutings.value.push({
    id: Date.now().toString(36),
    name,
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
    links: JSON.parse(JSON.stringify(links)),
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
  nextId = nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1
  // Keep runtime state (canvases, bound iframes/video) for node ids that
  // survive the swap — Vue won't re-mount same-keyed iframes, so clearing
  // their state would leave effect nodes black. Drop only vanished ids.
  const ids = new Set(nodes.map((n) => n.id))
  for (const id of [...rtState.keys()]) if (!ids.has(id)) rtState.delete(id)
  for (const n of nodes) st(n.id)
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

onMounted(async () => {
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
  beat.stop()
  if (popup && !popup.closed) popup.close()
  for (const s of rtState.values()) s.video?.srcObject?.getTracks?.().forEach((t) => t.stop())
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
        <video v-else-if="n.type === 'camera'" :ref="(el) => bindVideo(n.id, el)" muted playsinline />
      </template>
    </div>

    <!-- toolbar -->
    <div v-show="!outputOnly" class="toolbar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-2">Patch</span>
      <!-- add-node buttons: icons tinted with each node type's colour -->
      <v-btn icon="mdi-creation" variant="tonal" size="small" title="Add Effect (generator sketch)" :style="{ color: TYPES.effect.color }" @click="addNode('effect')" />
      <v-btn icon="mdi-image-filter-vintage" variant="tonal" size="small" title="Add Filter (processes its video input)" :style="{ color: TYPES.filter.color }" @click="addNode('filter')" />
      <v-btn icon="mdi-camera" variant="tonal" size="small" title="Add Camera (webcam source)" :style="{ color: TYPES.camera.color }" @click="addNode('camera')" />
      <v-btn icon="mdi-vector-intersection" variant="tonal" size="small" title="Add Mask (content × matte)" :style="{ color: TYPES.mask.color }" @click="addNode('mask')" />
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
      <v-btn icon="mdi-monitor" variant="tonal" size="small" title="Add Output (fullscreen stage)" @click="addNode('output')" />
      <v-btn icon="mdi-dice-multiple" variant="text" size="small" title="Randomize — deal out a whole new patch (undoable)" @click="randomPatch" />
      <v-btn icon="mdi-undo" variant="text" size="small" title="Undo (Ctrl/Cmd+Z)" :disabled="!undoStack.length" @click="undo" />
      <v-btn icon="mdi-redo" variant="text" size="small" title="Redo (Ctrl/Cmd+Shift+Z)" :disabled="!redoStack.length" @click="redo" />
      <v-spacer />

      <!-- save / load named routings -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-content-save-outline">Routings</v-btn>
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
          <v-list density="compact" max-height="260">
            <v-list-item
              v-for="r in savedRoutings"
              :key="r.id"
              :title="r.name"
              @click="loadRouting(r)"
            >
              <template #append>
                <v-icon icon="mdi-delete" size="16" @click.stop="deleteRouting(r)" />
              </template>
            </v-list-item>
            <v-list-item v-if="!savedRoutings.length" title="No saved routings yet" disabled />
          </v-list>
        </v-card>
      </v-menu>

      <v-btn
        :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
        variant="text"
        size="small"
        :color="micOn ? 'primary' : undefined"
        title="Mic — effect nodes' audio mappings react to sound"
        @click="toggleMic"
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
        icon="mdi-monitor-shimmer"
        variant="text"
        size="small"
        :color="popupOpen ? 'primary' : undefined"
        title="Pop out the output — drag it to a second display and keep adjusting here"
        @click="togglePopup"
      />
      <v-btn icon="mdi-projector-screen-outline" variant="text" size="small" title="Output only (hide routing)" @click="outputOnly = true" />
      <v-btn icon="mdi-delete-sweep" variant="text" size="small" title="Clear graph" @click="clearAll" />
      <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
    </div>

    <!-- output-only: floating controls to exit / go fullscreen -->
    <div v-if="outputOnly" class="output-ctrls">
      <v-btn icon="mdi-tune-variant" size="small" variant="flat" title="Show routing" @click="outputOnly = false" />
      <v-btn icon="mdi-fullscreen" size="small" variant="flat" title="Fullscreen" @click="fullscreen" />
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
          :d="wirePath(outPort(nodes.find((n) => n.id === wire.from)), { x: wire.x, y: wire.y })"
          :stroke="wire.kind === 'control' ? '#e0a060' : '#fff'"
          fill="none"
          stroke-width="2"
          :stroke-dasharray="wire.kind === 'control' ? '2 4' : '4 4'"
        />
      </svg>

      <div
        v-for="n in nodes"
        :key="n.id"
        class="node"
        :class="{ 'node--selected': selected === n.id }"
        :style="{ left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px' }"
      >
        <div
          class="node-head"
          :style="{ background: TYPES[n.type].color }"
          @pointerdown="startDrag(n, $event)"
          @dblclick="startRename(n)"
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
          <v-icon icon="mdi-close" size="14" class="node-close" @pointerdown.stop @click="removeNode(n.id)" />
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
                <button class="mini" title="Add mapping" @click="addEffectMapping(n.id)">+</button>
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
        </div>
      </div>
      </div>
    </div>

    <div v-if="showFps" class="fps-meter">{{ fps }} FPS</div>

    <div v-show="!outputOnly" class="zoom-ctrls">
      <v-btn icon="mdi-magnify-minus-outline" size="x-small" variant="text" title="Zoom out" @click="zoomStep(1 / 1.2)" />
      <span class="zoom-pct">{{ Math.round(view.zoom * 100) }}%</span>
      <v-btn icon="mdi-magnify-plus-outline" size="x-small" variant="text" title="Zoom in" @click="zoomStep(1.2)" />
      <v-btn icon="mdi-fit-to-page-outline" size="x-small" variant="text" title="Reset view" @click="resetView" />
    </div>

    <div v-show="!outputOnly" class="hint">Drag a node's right port to another node's left port to wire it. Drag an Input node's ▣ output to any param's ▣ jack to modulate it. Click a wire to remove it.</div>
  </div>
</template>

<style scoped>
.patch { position: fixed; inset: 0; background: #0a0b0f; z-index: 2000; overflow: hidden; }
.stage { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
.sources { position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none; }
.sources iframe, .sources video { width: 384px; height: 216px; border: 0; }
.toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  flex-wrap: wrap; row-gap: 2px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0.1));
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
