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
// Only local, same-origin sketches can be captured for piping. Motion Extraction
// has its own dedicated node type, so it's excluded from the Effect source list.
const effectOptions = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && s.slug !== 'motion-extraction'),
)

// Internal compositor resolution — a user setting (all node canvases and the
// ring buffers are sized to it). Higher = sharper piping, more GPU/CPU.
const RESOLUTIONS = [
  { label: '384 × 216', w: 384, h: 216 },
  { label: '640 × 360', w: 640, h: 360 },
  { label: '960 × 540', w: 960, h: 540 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
]
const RES_KEY = 'sketchbook-patch-res'
const resLabel = ref(localStorage.getItem(RES_KEY) || RESOLUTIONS[0].label)
let W = (RESOLUTIONS.find((r) => r.label === resLabel.value) ?? RESOLUTIONS[0]).w
let H = (RESOLUTIONS.find((r) => r.label === resLabel.value) ?? RESOLUTIONS[0]).h
function applyResolution(label) {
  const r = RESOLUTIONS.find((x) => x.label === label)
  if (!r) return
  W = r.w
  H = r.h
  resLabel.value = label
  localStorage.setItem(RES_KEY, label)
  // Resize every existing node canvas + ring buffer to the new resolution.
  for (const s of rtState.values()) {
    s.out.width = W
    s.out.height = H
    if (s.ring) for (const c of s.ring) {
      c.width = W
      c.height = H
    }
  }
}

const NODE_W = 190
const HEAD_H = 30
const THUMB_H = 107

const TYPES = {
  effect: { title: 'Effect', ins: 0, color: '#7c8cff' },
  camera: { title: 'Camera', ins: 0, color: '#4dd0c4' },
  motion: { title: 'Motion Extract', ins: 1, color: '#ff7ca8' },
  mask: { title: 'Mask', ins: 2, color: '#f2ad00' },
  blend: { title: 'Blend', ins: 2, color: '#a0e060' },
  output: { title: 'Output', ins: 1, color: '#ffffff' },
  // An Input node emits a 0..1 control value (not video); its output jack wires
  // into the parameter jacks of other nodes to modulate them live.
  input: { title: 'Input', ins: 0, color: '#e0a060' },
}
// Numeric params a control wire can drive on the non-effect operator nodes
// (effect params come from the sketch's own schema over postMessage).
const PARAM_RANGES = {
  motion: { delay: [1, 29], gain: [0.5, 4] },
  blend: { mix: [0, 1] },
}
const BLENDS = ['screen', 'add', 'lighten', 'multiply', 'difference', 'exclusion', 'overlay']

// --- persisted graph ---
const STORE_KEY = 'sketchbook-patch'
function loadGraph() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    return null
  }
}
const saved = loadGraph()
let nextId = 1
const nodes = reactive(saved?.nodes ?? [])
const edges = reactive(saved?.edges ?? [])
// Control links: an Input node's value → a numeric param on another node.
const links = reactive(saved?.links ?? [])
if (nodes.length) nextId = Math.max(...nodes.map((n) => n.id)) + 1

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ nodes, edges, links }))
}

// Non-reactive per-node runtime state (canvases, iframes, video, ring buffers).
const rtState = new Map()
function st(id) {
  let s = rtState.get(id)
  if (!s) {
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    s = { out, octx: out.getContext('2d'), ring: null, head: 0, iframe: null, video: null }
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
      type === 'motion'
        ? { delay: 6, gain: 1.4, mode: 0 }
        : type === 'blend'
          ? { mode: 'screen' }
          : type === 'effect'
            ? { slug: effectOptions.value[0]?.slug ?? '' }
            : type === 'input'
              ? { source: 'audio.volume', scale: 1, offset: 0 }
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
function outPort(n) {
  return { x: n.x + NODE_W, y: n.y + HEAD_H + THUMB_H / 2 }
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
  return node.type === 'input' ? 'control' : node.type === 'motion' ? 'matte' : 'image'
}

// --- control input sources (mirror of the sketch runtime's resolver) -------
const cin = { midi: createMidiInput(), leap: createLeapInput(), artnet: createArtnetInput() }
const started = { midi: false, leap: false, artnet: false }
const mouseN = { x: 0.5, y: 0.5 }
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
function jackPos(nodeId, param) {
  const n = nodes.find((x) => x.id === nodeId)
  const el = jackEls.get(nodeId + ':' + param)
  if (!n || !el) return null
  return { x: n.x + el.offsetLeft + el.offsetWidth / 2, y: n.y + el.offsetTop + el.offsetHeight / 2 }
}
const linkWires = computed(() => {
  layoutTick.value // dependency: recompute when inner layout shifts
  return links
    .map((l, idx) => {
      const from = nodes.find((n) => n.id === l.from)
      const jp = jackPos(l.node, l.param)
      if (!from || !jp) return null
      return { idx, d: wirePath(outPort(from), jp) }
    })
    .filter(Boolean)
})
function endLink(node, param) {
  if (!wire.active || wire.kind !== 'control' || wire.from === node.id) return
  for (let k = links.length - 1; k >= 0; k--)
    if (links[k].node === node.id && links[k].param === param) links.splice(k, 1)
  links.push({ from: wire.from, node: node.id, param })
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
    if (!from || !tgt || from.type !== 'input') continue
    const v = inputValue(from, now)
    if (tgt.type === 'effect') {
      const spec = effectControls.get(tgt.id)?.schema?.[l.param]
      if (spec && typeof spec.min === 'number') setEffectParam(tgt.id, l.param, spec.min + v * (spec.max - spec.min))
    } else {
      const rng = PARAM_RANGES[tgt.type]?.[l.param]
      if (rng) tgt.params[l.param] = rng[0] + v * (rng[1] - rng[0])
    }
  }
}

const drag = reactive({ node: null, dx: 0, dy: 0 })
const wire = reactive({ active: false, from: null, x: 0, y: 0, kind: 'video' })
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
function onBoardDown(e) {
  if (e.target.closest('.node')) return // let node/port handlers run
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
function startWire(n, e) {
  e.stopPropagation()
  const p = outPort(n)
  wire.active = true
  wire.from = n.id
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
function onUp() {
  if (drag.node != null) persist()
  drag.node = null
  wire.active = false
  pan.active = false
}
function removeEdge(idx) {
  edges.splice(idx, 1)
  persist()
}

// --- source binding (iframes / video) ---
function effectSrc(n) {
  const s = store.bySlug(n.params.slug)
  return s ? `${s.url}?capture=1&preview=1&quality=low` : ''
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
    if (n.type !== 'effect') continue
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
const MAXD = 30

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
  } else if (node.type === 'camera') {
    if (s.video && s.video.videoWidth) cover(octx, s.video, s.video.videoWidth, s.video.videoHeight)
  } else if (node.type === 'motion') {
    const input = inputCanvas(node, 0)
    if (input) {
      if (!s.ring) {
        s.ring = Array.from({ length: MAXD }, () => {
          const c = document.createElement('canvas')
          c.width = W
          c.height = H
          return c
        })
        s.head = 0
      }
      const delay = Math.min(MAXD - 1, Math.max(1, Math.round(node.params.delay)))
      const ref = s.ring[(s.head - delay + MAXD) % MAXD]
      const g = node.params.gain
      octx.filter = g !== 1 ? `brightness(${g})` : 'none'
      octx.drawImage(input, 0, 0, W, H)
      octx.globalCompositeOperation = 'difference'
      octx.drawImage(ref, 0, 0, W, H)
      octx.globalCompositeOperation = 'source-over'
      octx.filter = 'none'
      if (node.params.mode < 0.5) {
        octx.globalCompositeOperation = 'saturation'
        octx.fillStyle = 'hsl(0,0%,50%)'
        octx.fillRect(0, 0, W, H)
        octx.globalCompositeOperation = 'source-over'
      }
      const slot = s.ring[s.head].getContext('2d')
      slot.clearRect(0, 0, W, H)
      slot.drawImage(input, 0, 0, W, H)
      s.head = (s.head + 1) % MAXD
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
function loop(ts) {
  broadcastBeat(ts ?? performance.now())
  applyLinks(ts ?? performance.now()) // drive params from Input nodes first
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
  raf = requestAnimationFrame(loop)
}

function resizeStage() {
  const c = stage.value
  if (!c) return
  c.width = window.innerWidth
  c.height = window.innerHeight
}
function fullscreen() {
  board.value?.parentElement?.requestFullscreen?.()
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
  // Seed a starter graph the first time.
  if (!nodes.length) {
    addNode('effect')
    addNode('motion')
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
  for (const s of rtState.values()) s.video?.srcObject?.getTracks?.().forEach((t) => t.stop())
})
</script>

<template>
  <div class="patch">
    <canvas ref="stage" class="stage" />

    <!-- hidden capture sources -->
    <div class="sources" aria-hidden="true">
      <template v-for="n in nodes" :key="'src' + n.id">
        <iframe
          v-if="n.type === 'effect' && n.params.slug"
          :ref="(el) => bindFrame(n.id, el)"
          :src="effectSrc(n)"
          allow="microphone; camera; midi; accelerometer; gyroscope"
        />
        <video v-else-if="n.type === 'camera'" :ref="(el) => bindVideo(n.id, el)" muted playsinline />
      </template>
    </div>

    <!-- toolbar -->
    <div v-show="!outputOnly" class="toolbar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-2">Patch</span>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('effect')">Effect</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('camera')">Camera</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('motion')">Motion</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('mask')">Mask</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('blend')">Blend</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('input')">Input</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('output')">Output</v-btn>
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

        <div class="node-thumb" :ref="(el) => bindThumb(n.id, el)" :style="{ height: THUMB_H + 'px' }" />

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
          :title="n.type === 'mask' ? (i === 1 ? 'content' : 'mask (matte)') : 'input'"
          @pointerup="endWire(n, i - 1)"
        />
        <!-- output port (◆ matte · ▣ control value · ● image) -->
        <div
          v-if="n.type !== 'output'"
          class="port"
          :class="outKind(n) === 'matte' ? 'port--matte' : outKind(n) === 'control' ? 'port--control' : 'port--image'"
          :style="{ left: NODE_W - 7 + 'px', top: HEAD_H + THUMB_H / 2 - 7 + 'px' }"
          :title="outKind(n) === 'control' ? 'control out — drag to a param ▣' : 'output'"
          @pointerdown="startWire(n, $event)"
        />

        <!-- per-node controls -->
        <div class="node-body">
          <template v-if="n.type === 'effect'">
            <div class="d-flex ga-1 align-center">
              <select v-model="n.params.slug" class="flex-grow-1" @change="persist" @pointerdown.stop>
                <option v-for="o in effectOptions" :key="o.slug" :value="o.slug">{{ o.title }}</option>
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
                  <span class="pjack" :ref="(el) => bindJack(n.id, name, el)" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, name)" />
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
                  <option v-for="src in INPUT_SOURCES" :key="src" :value="src">{{ src }}</option>
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
              <option v-for="src in INPUT_SOURCES" :key="src" :value="src">{{ src }}</option>
            </select>
            <label>scale <input type="range" min="-2" max="2" step="0.05" v-model.number="n.params.scale" @change="persist" @pointerdown.stop /></label>
            <label>offset <input type="range" min="-1" max="1" step="0.02" v-model.number="n.params.offset" @change="persist" @pointerdown.stop /></label>
          </template>
          <template v-if="n.type === 'motion'">
            <label><span class="pjack" :ref="(el) => bindJack(n.id, 'delay', el)" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'delay')" /> delay <input type="range" min="1" max="29" step="1" v-model.number="n.params.delay" @pointerdown.stop /></label>
            <label><span class="pjack" :ref="(el) => bindJack(n.id, 'gain', el)" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'gain')" /> gain <input type="range" min="0.5" max="4" step="0.05" v-model.number="n.params.gain" @pointerdown.stop /></label>
            <label class="chk"><input type="checkbox" :checked="n.params.mode > 0.5" @change="n.params.mode = $event.target.checked ? 1 : 0; persist()" @pointerdown.stop /> color</label>
          </template>
          <template v-if="n.type === 'blend'">
            <select v-model="n.params.mode" @change="persist" @pointerdown.stop>
              <option v-for="b in BLENDS" :key="b" :value="b">{{ b }}</option>
            </select>
            <label><span class="pjack" :ref="(el) => bindJack(n.id, 'mix', el)" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'mix')" /> mix <input type="range" min="0" max="1" step="0.02" :value="n.params.mix ?? 1" @input="n.params.mix = +$event.target.value; persist()" @pointerdown.stop /></label>
          </template>
        </div>
      </div>
      </div>
    </div>

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
  background: linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0.1));
}
.board { position: absolute; inset: 0; z-index: 10; cursor: grab; }
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
</style>
