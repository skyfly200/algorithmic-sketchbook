<script setup>
/**
 * Patch — a node-based compositor for live visuals. Drop operator
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
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore, CATEGORIES } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'
import { PATCH_HANDOFF_KEY } from '../lib/mixToPatch'
import { inputParams } from '../lib/inputParams'
import TourOverlay from '../components/TourOverlay.vue'
import NumSlider from '../components/NumSlider.vue'
import ColorField from '../components/ColorField.vue'
import CurveEditor from '../components/CurveEditor.vue'
import perfScores from '../registry/perf.json'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'
import { createMidiInput, createLeapInput, createArtnetInput } from '../../sketches/_lib/inputs.js'
import { mediaLibrary, addMediaFile, addRecordedClip, removeMedia, mediaById, startSharedCamera, stopSharedCamera, sharedCameraOn, sharedCameraStream, flipSharedCamera, startSharedScreen, stopSharedScreen, sharedScreenOn, sharedScreenStream } from '../stores/media.js'
import { pickFromGooglePhotos, setGooglePhotosClientId, googlePhotosConfigured } from '../lib/googlePhotos.js'
// Source-filter sketches (built on _lib/source.js): they accept a mixer:frame
// feed, so in the graph they live behind a dedicated Filter node type that
// pipes its video input straight into them.
import { FILTER_SLUGS } from '../registry/filters'

const router = useRouter()
const store = useSketchStore()
const settings = useSettingsStore()
// Only local, same-origin sketches can be captured for piping. Filters (and
// Motion Extraction, which has a native node) are organized under the Filter
// node type instead of the Effect source list.
const effectOptions = computed(() =>
  store.sketches.filter((s) => s.embed && !s.standalone && !FILTER_SLUGS.includes(s.slug)),
)
const filterOptions = computed(() =>
  store.sketches.filter((s) => s.embed && !s.standalone && FILTER_SLUGS.includes(s.slug)),
)

// The effect/filter node pickers are grouped into sections so a long list is
// scannable: starred favorites first, then themed sections, then anything left.
// Effects group by their tags/tech (the gallery's CATEGORIES); filters group by
// a small slug-based taxonomy since their tags don't map to those themes.
const FILTER_GROUPS = [
  { label: 'Stylize', keys: ['pointillism', 'halftone', 'painterly', 'crt', 'vhs-defects', 'interlace', 'rolling-shutter', 'shaky-film'] },
  { label: 'Optical', keys: ['camera-lens', 'lens-flare', 'kaleidoscope', 'warp', 'channel-offset', 'polarization', 'light-leaves', 'blur'] },
  { label: 'Atmosphere', keys: ['fog', 'mist', 'glow', 'nebula-gasses', 'uv-light'] },
  { label: 'Colour & tone', keys: ['color-filter', 'strobe', 'film-tone', 'brightness-contrast'] },
  { label: 'Time-based', keys: ['delay', 'feedback', 'motion-extraction'] },
  { label: 'Weather', keys: ['rain-window'] },
]
function groupOptions(list, defs, matchFn) {
  const favSet = settings.favoriteSet
  const groups = []
  const favs = list.filter((s) => favSet.has(s.slug))
  if (favs.length) groups.push({ label: '★ Favorites', items: favs })
  const rest = list.filter((s) => !favSet.has(s.slug))
  const used = new Set()
  for (const d of defs) {
    const items = rest.filter((s) => !used.has(s.slug) && matchFn(s, d))
    if (items.length) { items.forEach((s) => used.add(s.slug)); groups.push({ label: d.label, items }) }
  }
  const other = rest.filter((s) => !used.has(s.slug))
  if (other.length) groups.push({ label: 'Other', items: other })
  return groups
}
const effectGroups = computed(() =>
  groupOptions(effectOptions.value, CATEGORIES, (s, d) => d.keys.some((k) => [...s.tags, ...s.tech].includes(k))),
)
const filterGroups = computed(() =>
  groupOptions(filterOptions.value, FILTER_GROUPS, (s, d) => d.keys.includes(s.slug)),
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
  effect: { title: 'Effect', ins: 0, color: '#7c8cff', icon: 'mdi-creation' },
  filter: { title: 'Filter', ins: 1, color: '#c98cff', icon: 'mdi-image-filter-vintage' },
  media: { title: 'Media', ins: 0, color: '#4dd0c4', icon: 'mdi-image-multiple' }, // camera / files / clips
  // Live map / satellite imagery for a place — a 2D image source you can pipe,
  // filter and composite. Public tiles by default; a key upgrades the provider.
  geodata: { title: 'Geodata', ins: 0, color: '#5bd6a8', icon: 'mdi-earth' },
  text: { title: 'Text', ins: 0, color: '#ff9ec4', icon: 'mdi-format-text' },
  // A loaded image (or sprite-sheet) positioned in the frame, animated over time
  // by a motion preset and/or control-mapped x/y/scale/rotate/opacity.
  sprite: { title: 'Sprite', ins: 0, color: '#7fe3a1', icon: 'mdi-image-move' },
  portal: { title: 'Portal', ins: 1, color: '#8ad0ff', icon: 'mdi-shape-outline' }, // remap a region elsewhere
  mask: { title: 'Mask', ins: 2, color: '#f2ad00', icon: 'mdi-vector-intersection' },
  polygon: { title: 'Polygon', ins: 0, color: '#f2ad00', icon: 'mdi-vector-polygon' }, // a matte-shape source: white editable polygon → wire into a Mask
  blend: { title: 'Blend', ins: 2, color: '#a0e060', icon: 'mdi-circle-half-full' },
  // Geometry space: a mesh source (its displacement stands in for a vertex
  // shader) and a virtual Camera that rasterizes connected geometry down to a
  // pixel frame the rest of the graph can composite.
  geo: { title: 'Geometry', ins: 0, color: '#6ee7b7', icon: 'mdi-cube-outline' },
  vcam: { title: 'Camera', ins: 3, color: '#ffd166', icon: 'mdi-camera-control' },
  output: { title: 'Output', ins: 1, color: '#ffffff', icon: 'mdi-monitor' },
  // Control emitters (0..1 values, not video): their output jacks wire into the
  // parameter jacks of other nodes to modulate them live.
  input: { title: 'Input', ins: 0, color: '#e0a060', icon: 'mdi-sine-wave' },
  xy: { title: 'XY Pad', ins: 0, color: '#e0a060', icon: 'mdi-gesture-tap' },
  tracker: { title: 'Tracker', ins: 1, color: '#e0a060', icon: 'mdi-target' },
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
  // Polygon: only the edge softness is a scalar worth modulating; the
  // vertices are edited by dragging on the output.
  polygon: { feather: [0, 0.5] },
  // Sprite: position, size, rotation and opacity are all control-mappable, so a
  // sprite can be flown around and keyframed through space over time.
  sprite: { x: [0, 1], y: [0, 1], scale: [0.02, 2], rotate: [-180, 180], opacity: [0, 1] },
}
const SPRITE_MOTIONS = ['None', 'Drift', 'Orbit', 'Bounce', 'Float', 'Spin']
const TEXT_TRANSITIONS = ['None', 'Fade', 'Slide L', 'Slide R', 'Rise', 'Drop', 'Zoom', 'Typewriter']
// Fallback font list (generic families + common web-safe faces) used until the
// user loads their real installed fonts via the Local Font Access API.
const TEXT_FONTS = [
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'Georgia', 'Times New Roman', 'Courier New', 'Arial', 'Arial Black', 'Impact',
  'Trebuchet MS', 'Verdana', 'Tahoma', 'Palatino Linotype', 'Garamond', 'Comic Sans MS', 'Brush Script MT',
]
const systemFonts = ref([])
const fontList = computed(() => (systemFonts.value.length ? systemFonts.value : TEXT_FONTS))
// Query the machine's installed fonts (Chromium's Local Font Access API — needs
// a user gesture + permission). Falls back silently to TEXT_FONTS if blocked.
async function loadSystemFonts() {
  try {
    if (!window.queryLocalFonts) { showToast('System fonts need a Chromium browser'); return }
    const fonts = await window.queryLocalFonts()
    const fams = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
    if (fams.length) { systemFonts.value = fams; showToast(`Loaded ${fams.length} system fonts`) }
  } catch { showToast('Font access was blocked') }
}
// Starter shapes for the Polygon (matte) node — normalized [x,y] point rings in
// 0..1, so a shape can be dropped in and then its corners dragged. Built from a
// couple of generators plus a few hand-tuned outlines.
function regPoly(n, r = 0.4, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; pts.push([+(0.5 + r * Math.cos(a)).toFixed(3), +(0.5 + r * Math.sin(a)).toFixed(3)]) }
  return pts
}
function starPoly(points = 5, outer = 0.44, inner = 0.19) {
  const pts = []
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points, r = i % 2 ? inner : outer; pts.push([+(0.5 + r * Math.cos(a)).toFixed(3), +(0.5 + r * Math.sin(a)).toFixed(3)]) }
  return pts
}
function heartPoly() {
  const pts = []
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2
    const hx = 16 * Math.pow(Math.sin(t), 3)
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push([+(0.5 + (hx / 34)).toFixed(3), +(0.5 - (hy / 34)).toFixed(3)])
  }
  return pts
}
const POLY_SHAPES = {
  Triangle: regPoly(3), Square: [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]],
  Pentagon: regPoly(5), Hexagon: regPoly(6), Octagon: regPoly(8),
  Circle: regPoly(28), Diamond: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]],
  Star: starPoly(5), 'Star 6': starPoly(6), Heart: heartPoly(),
  Arrow: [[0.1, 0.35], [0.55, 0.35], [0.55, 0.18], [0.9, 0.5], [0.55, 0.82], [0.55, 0.65], [0.1, 0.65]],
  Cross: [[0.38, 0.1], [0.62, 0.1], [0.62, 0.38], [0.9, 0.38], [0.9, 0.62], [0.62, 0.62], [0.62, 0.9], [0.38, 0.9], [0.38, 0.62], [0.1, 0.62], [0.1, 0.38], [0.38, 0.38]],
}
// Portal destination shapes + aspect-ratio presets (for lock-proportions).
const PORTAL_SHAPES = ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'heart']
const MASK_MODES = ['multiply', 'screen', 'lighten', 'darken', 'overlay', 'add']
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
  'normal', 'screen', 'add', 'lighten', 'darken', 'multiply', 'overlay', 'soft-light',
  'hard-light', 'color-dodge', 'color-burn', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
]
// Blend modes that actually *mix* two pictures — 'normal' (plain over) is
// excluded here because with two opaque inputs it just hides the base; it's
// reserved for compositing a shaped/transparent layer over another.
const MIX_BLENDS = BLENDS.filter((m) => m !== 'normal')
// Input sources grouped for the pickers (audio, midi, mouse, touch, tilt,
// time, leap, artnet — per-category optgroups instead of one long list).
const INPUT_GROUPS = computed(() => {
  const groups = { audio: [], midi: [], mouse: [], touch: [], tilt: [], time: [], leap: [], artnet: [] }
  for (const s of INPUT_SOURCES) {
    if (s.startsWith('midi.')) continue // MIDI handled below (hidden until set up)
    const head = s.split('.')[0]
    const g = head === 'shake' ? 'tilt' : head
    ;(groups[g] ?? (groups[g] = [])).push(s)
  }
  // MIDI stays hidden until it's set up in Settings; once set up it's a single
  // entry (the channel is chosen globally there, not per-mapping).
  if (settings.midiEnabled) groups.midi = ['midi.cc1', 'midi.note', 'midi.velocity']
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
    // Legacy "Polygon Mask" (shape) → the new Polygon matte source. Its old
    // content input is rewired to a Mask node in migrateGraph(); here we just
    // switch the type and drop the now-meaningless invert (Mask owns that).
    if (n.type === 'shape') { n.type = 'polygon'; delete n.params.invert }
  }
  return list
}
// The old Polygon Mask clipped its input to the polygon. Now Polygon is a
// source, so reconnect any legacy graph: for each converted polygon that had a
// content wire, insert a Mask (content × polygon) in its place so old routings
// keep clipping as before.
function migrateGraph(nodesArr, edgesArr) {
  let maxId = nodesArr.reduce((m, n) => Math.max(m, n.id ?? 0), 0)
  for (const poly of [...nodesArr]) {
    if (poly.type !== 'polygon') continue
    const inEdge = edgesArr.find((e) => e.to === poly.id)
    if (!inEdge) continue // a fresh Polygon source — nothing to rewire
    const m = { id: ++maxId, type: 'mask', x: poly.x, y: poly.y, params: { strength: 1, invert: false } }
    nodesArr.push(m)
    // reroute the polygon's downstream consumers to come from the new Mask
    for (const e of edgesArr) if (e.from === poly.id) e.from = m.id
    inEdge.to = m.id; inEdge.port = 0 // old content → Mask.content
    edgesArr.push({ from: poly.id, to: m.id, port: 1 }) // polygon → Mask.matte
    poly.x -= 60; poly.y += 70 // nudge the polygon out from under the mask
  }
}
const saved = settings.persistEditors ? loadGraph() : null
let nextId = 1
const nodes = reactive(normalizeNodes(saved?.nodes) ?? [])
const edges = reactive(saved?.edges ?? [])
// Control links: an Input node's value → a numeric param on another node.
const links = reactive(saved?.links ?? [])
migrateGraph(nodes, edges) // reconnect legacy Polygon-Mask graphs
if (nodes.length) nextId = Math.max(...nodes.map((n) => n.id)) + 1

// --- undo / redo: every persisted change pushes the previous graph state ----
const undoStack = reactive([])
const redoStack = reactive([])
let restoring = false
const snapshot = () => JSON.stringify({ nodes, edges, links })
let lastSnap = snapshot()

function persist() {
  // Autosave carries the effect sketches' own param values + mappings too, so a
  // browser reload restores the whole patch — not just the node graph.
  if (settings.persistEditors) localStorage.setItem(STORE_KEY, JSON.stringify({ nodes, edges, links, effects: currentEffects() }))
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
  for (const id of [...rtState.keys()]) if (!ids.has(id)) { disposeRuntime(id); rtState.delete(id) }
  for (const n of nodes) st(n.id)
  if (settings.persistEditors) localStorage.setItem(STORE_KEY, JSON.stringify({ ...data, effects: currentEffects() }))
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
// Release a node's geometry-space GPU resources (meshes) before its runtime
// state is dropped, so deleting/undoing Camera nodes doesn't leak the GPU.
function disposeRuntime(id) {
  const s = rtState.get(id)
  if (s?.three) {
    for (const o of s.three.meshes.values()) disposeObject(o)
    s.three.meshes.clear()
    s.three = null
  }
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
          ? { slug: effectOptions.value[0]?.slug ?? '', seed: randSeed() }
          : type === 'filter'
            ? { slug: filterOptions.value[0]?.slug ?? '', seed: randSeed() }
            : type === 'input'
              ? { source: 'audio.volume', scale: 1, offset: 0, invert: false, curve: 'linear' }
              : type === 'xy'
                ? { x: 0.5, y: 0.5, recenter: false, xMin: 0, xMax: 1, yMin: 0, yMax: 1, curve: 'linear', padW: NODE_W, padH: THUMB_H }
                : type === 'tracker'
                  ? { thresh: 0.5, smooth: 0.7 }
                  : type === 'media'
                    ? { mode: 'camera', mediaId: null }
                    : type === 'geodata'
                      ? { layer: 'Satellite', lat: 36.06, lon: -112.14, zoom: 12, drift: 0.15 }
                    : type === 'text'
                      ? { text: 'BRIGHT WAVES', font: 'sans-serif', size: 0.18, weight: 700, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, sat: 82, val: 96, rotate: 0, italic: false, glow: 0.4, bg: false, seqMode: 'off', lyrics: '', lineDur: 3, loopSeq: true, transition: 'None', transDur: 0.4 }
                      : type === 'sprite'
                        ? { mediaId: null, x: 0.5, y: 0.5, scale: 0.4, rotate: 0, opacity: 1, spin: 0, motion: 'None', speed: 0.5, amp: 0.2, cols: 1, rows: 1, fps: 12 }
                      : type === 'portal'
                        ? { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' }
                        : type === 'polygon'
                          ? { points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], feather: 0 }
                          : type === 'geo'
                            ? { shape: 'Icosahedron', material: 'Solid', hue: 160, sat: 72, val: 90, displace: 0.25, freq: 2, spin: 0.5, detail: 2, flutes: 8, twist: 90, groove: 0.28, source: 'Shape', cloud: 'Galaxy', voxel: 'Sphere', count: 12000, res: 18, pointSize: 0.03, dataVer: 0, lat: 46.5, lon: 8.0, zoom: 11, terrainRes: 96, verticalScale: 0.6, drape: true }
                            : type === 'vcam'
                              ? { fov: 55, distance: 4.5, orbit: 0.4, tilt: 0.35, bg: 'Dark', lightHue: 40, lightSat: 34, lightVal: 86, spin: true }
                              : type === 'mask'
                                ? { mode: 'multiply', strength: 1, invert: false }
                                : {},
  })
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
  disposeRuntime(id)
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
// blends, an Output at the end, and a control node wired into a blend mix.
// Masks, when used, cut a picture to a proper matte (a Polygon or Text), not a
// second picture. Goes through persist(), so it's a single undo step. Drives
// both the RNG dice and the Patch auto-reroll.
function randomPatch() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const chance = (p) => Math.random() < p

  // Keep locked / kept nodes (and any wiring purely among them); randomize the
  // rest. "keep" (pin) protects from reshuffle without locking editing.
  const keptIds = new Set(nodes.filter((n) => n.locked || n.keep).map((n) => n.id))
  const keptNodes = nodes.filter((n) => keptIds.has(n.id))
  const keptEdges = edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
  const keptLinks = links.filter((l) => keptIds.has(l.from) && keptIds.has(l.to))
  nodes.splice(0, nodes.length, ...keptNodes)
  edges.splice(0, edges.length, ...keptEdges)
  links.splice(0, links.length, ...keptLinks)
  for (const id of [...rtState.keys()]) if (!keptIds.has(id)) { disposeRuntime(id); rtState.delete(id) }
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
    let prev = mk('effect', { slug: pick(pooledEffects)?.slug ?? '', seed: randSeed() }, 0, y)
    const nFilters = chance(0.75) ? 1 + (chance(0.3) ? 1 : 0) : 0
    for (let f = 0; f < nFilters; f++) {
      const filt = mk('filter', { slug: pick(filterOptions.value)?.slug ?? '', seed: randSeed() }, 1 + f, y + 20 * (f + 1))
      edges.push({ from: prev.id, to: filt.id, port: 0 })
      prev = filt
      maxCol = Math.max(maxCol, 1 + f)
    }
    heads.push(prev)
  }

  // Integrate any kept producer nodes that currently feed nothing: fold them
  // into the mix as extra heads so locked/pinned nodes (and blocks) actually
  // appear in the new routing instead of being left dangling. A kept output is
  // reused as the sink; drop its stale inputs so we can rewire it to the mix.
  const PRODUCER = new Set(['effect', 'filter', 'media', 'text', 'portal', 'blend', 'vcam', 'mask'])
  const keptOut = keptNodes.find((n) => n.type === 'output')
  if (keptOut) { for (let i = edges.length - 1; i >= 0; i--) if (edges[i].to === keptOut.id) edges.splice(i, 1) }
  for (const kn of keptNodes) {
    if (PRODUCER.has(kn.type) && !edges.some((e) => e.from === kn.id)) heads.push(kn)
  }

  let c = maxCol + 1

  // Cut a picture to a shape with a Mask, the way the node is meant to be used:
  // the picture on the content input (port 0) and a real *matte* on port 1 — an
  // editable Polygon shape or bright Text, whose luminance keys what shows
  // through. (A Mask is NOT a two-picture combiner: feeding it two effects just
  // silhouettes one through the other's brightness. Two pictures are folded with
  // blends below instead.)
  const randPolyPoints = () => {
    const n = 3 + Math.floor(Math.random() * 5)
    const cx = 0.5 + (Math.random() * 2 - 1) * 0.08, cy = 0.5 + (Math.random() * 2 - 1) * 0.08
    const rx = 0.26 + Math.random() * 0.16, ry = 0.26 + Math.random() * 0.16
    const rot = Math.random() * Math.PI * 2, pts = []
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2, jt = 0.85 + Math.random() * 0.3
      pts.push([
        +Math.min(0.98, Math.max(0.02, cx + Math.cos(a) * rx * jt)).toFixed(3),
        +Math.min(0.98, Math.max(0.02, cy + Math.sin(a) * ry * jt)).toFixed(3),
      ])
    }
    return pts
  }
  const maskShape = (content, cc, y) => {
    let matte
    if (chance(0.3)) {
      matte = mk('text', { text: pick(['BRIGHT', 'WAVES', 'GLOW', 'LOVE', 'DREAM']), font: 'sans-serif', size: 0.34, weight: 800, tracking: 0.02, x: 0.5, y: 0.5, hue: 0, sat: 0, val: 100, rotate: 0, italic: false, glow: 0, bg: false }, Math.max(0, cc - 1), y + 170)
    } else {
      matte = mk('polygon', { points: randPolyPoints(), feather: +(Math.random() * 0.35).toFixed(2) }, Math.max(0, cc - 1), y + 170)
      matte.locked = true
    }
    const m = mk('mask', { mode: 'multiply', strength: +(0.75 + Math.random() * 0.25).toFixed(2), invert: chance(0.25) }, cc, y)
    edges.push({ from: content.id, to: m.id, port: 0 }) // picture → content
    edges.push({ from: matte.id, to: m.id, port: 1 })   // shape / text → matte
    return m
  }

  // Maybe cut a single source layer to a shape so it can be overlaid on the rest
  // as a shape cutout. More likely when there are ≥2 layers to sit it over.
  if (heads.length && chance(heads.length > 1 ? 0.5 : 0.3)) {
    const idx = Math.floor(Math.random() * heads.length)
    heads[idx] = maskShape(heads[idx], c, heads[idx].y)
    c++
  }

  // Fold the chains together pairwise. When one input is a shaped (masked) layer
  // it's overlaid on top of the other with a plain 'normal' blend — a shape
  // cutout of one effect over another — instead of a random mixing mode that
  // would ignore its transparency.
  const blends = []
  while (heads.length > 1) {
    const a = heads.shift()
    const b = heads.shift()
    const aMask = a.type === 'mask', bMask = b.type === 'mask'
    let base = a, top = b, mode, mix
    if (aMask !== bMask) {
      base = aMask ? b : a
      top = aMask ? a : b           // the shaped layer sits on top
      mode = 'normal'
      mix = 1
    } else {
      mode = pick(MIX_BLENDS)
      mix = +(0.4 + Math.random() * 0.6).toFixed(2)
    }
    const node = mk('blend', { mode, mix }, c, (a.y + b.y) / 2)
    edges.push({ from: base.id, to: node.id, port: 0 }) // base
    edges.push({ from: top.id, to: node.id, port: 1 })  // top / overlay
    blends.push(node)
    heads.unshift(node)
    c++
  }

  // maybe cut the whole finished mix to a shape as a final flourish
  let head = heads[0]
  if (chance(0.28)) { head = maskShape(head, c, head.y); c++ }

  const outNode = keptOut || mk('output', {}, c, head.y + 10)
  edges.push({ from: head.id, to: outNode.id, port: 0 })

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

// Randomize the *look* of the current patch without changing its structure —
// works on any patch (hand-built or generated). Reseeds every generative
// effect/filter and shuffles all node params within their ranges; locked and
// pinned nodes are left alone.
function randomizeLook() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  for (const n of nodes) {
    if (n.locked || n.keep) continue
    if (n.type === 'effect' || n.type === 'filter') {
      n.params.seed = randSeed() // fresh generative content
      rollEffectParams(n)        // roll params + survive the reseed reload
    } else {
      const rng = PARAM_RANGES[n.type]
      if (rng) for (const [name, r] of Object.entries(rng)) n.params[name] = stepQuant(r[0], r[1])
      if (n.type === 'blend') { n.params.mode = pick(BLENDS); n.params.mix = +(0.3 + Math.random() * 0.6).toFixed(2) }
      if (n.type === 'geo') { n.params.shape = pick(GEO_SHAPES); n.params.material = pick(GEO_MATERIALS); n.params.hue = Math.floor(Math.random() * 360); n.params.flutes = 4 + Math.floor(Math.random() * 12); n.params.twist = Math.round((Math.random() * 2 - 1) * 270); n.params.groove = +(0.12 + Math.random() * 0.36).toFixed(2) }
      if (n.type === 'vcam') n.params.lightHue = Math.floor(Math.random() * 360)
      if (n.type === 'text') n.params.hue = Math.floor(Math.random() * 360)
    }
  }
  persist()
  showToast('Randomized the patch')
}

// --- natural-language patch designer -------------------------------------
// Turn a plain-English (or spoken) description into a wired patch. This is a
// local, deterministic parser — no network, no model call — that scans the
// text for known effect/filter names (plus a handful of synonyms), a source
// (camera / text), a blend word and control cues, then lays the graph out as
// sources → blends → filter chain → (mask) → Output. Locked/kept nodes survive.
const nlOpen = ref(false)
const nlText = ref('')
const nlListening = ref(false)
const nlLast = ref('')
const NL_EXAMPLES = [
  'dreamy underwater scene, slow and deep blue',
  'glitchy retro camera, punchy and fast',
  'liquid metal over noise, intense, react to the beat',
  'the text "BRIGHT WAVES" masked through a psychedelic swirl',
]
const nlIntent = ref(null) // the editable parse result shown before building
const nlModKeys = computed(() => Object.keys(nlIntent.value?.mods || {}))
function nlDropMod(k) { if (nlIntent.value) delete nlIntent.value.mods[k] }
// slug → extra spoken/written phrases that don't appear in the title or slug
const NL_SYN = {
  glow: ['bloom', 'halo', 'soft glow'], 'vhs-defects': ['vhs', 'tape', 'video tape'],
  'rain-window': ['rain', 'rainy', 'raindrops', 'window rain'],
  kaleidoscope: ['kaleidoscopic', 'mirror'], 'channel-offset': ['rgb split', 'chromatic', 'chromatic aberration', 'colour split', 'color split'],
  'motion-extraction': ['motion', 'motion extraction', 'echo trails'], pointillism: ['dots', 'stipple', 'pointillist'],
  halftone: ['comic', 'newspaper', 'print dots'], 'brightness-contrast': ['brightness', 'contrast'],
  'liquid-metal': ['chrome', 'mercury', 'molten'], 'ink-bleed': ['ink', 'watercolor', 'watercolour', 'bleeding ink'],
  polaroid: ['old photo', 'vintage photo', 'aged photo'], twist: ['twirl', 'swirl'],
  'hyperbolic-space': ['hyperbolic', 'poincare'], azulejos: ['azulejo', 'spanish tiles', 'portuguese tiles', 'ceramic tiles'],
  noise: ['static', 'fractal noise', 'tv snow'], feedback: ['trails', 'feedback loop'],
  crt: ['old tv', 'scanlines'],
}
// Mood/theme words → extra search keywords that get matched against the catalog,
// so vibe-only descriptions ("dreamy underwater", "glitchy") still find sketches.
const NL_MOODS = {
  dreamy: ['glow', 'bloom', 'soft', 'mist', 'fog', 'nebula'], ethereal: ['glow', 'mist', 'nebula', 'aurora'],
  glitch: ['vhs', 'channel', 'rgb split', 'crt', 'interlace', 'feedback'], glitchy: ['vhs', 'channel', 'rgb split', 'crt', 'interlace'],
  underwater: ['caustics', 'water', 'ripple', 'liquid', 'ocean', 'wave'], aquatic: ['caustics', 'water', 'ripple', 'liquid'],
  psychedelic: ['kaleidoscope', 'plasma', 'moire', 'swirl', 'liquid light'], trippy: ['kaleidoscope', 'moire', 'swirl', 'plasma'],
  retro: ['vhs', 'crt', 'film', 'halftone'], vintage: ['film', 'polaroid', 'halftone', 'grain', 'crt'],
  fiery: ['ember', 'flame', 'solar', 'lava', 'fire'], fire: ['ember', 'flame', 'solar', 'lava'],
  cosmic: ['nebula', 'stars', 'galaxy', 'solar', 'aurora'], space: ['nebula', 'stars', 'galaxy', 'solar'],
  organic: ['slime', 'coral', 'fungal', 'mycelium', 'flower', 'bloom'], natural: ['coral', 'flower', 'bloom', 'animal'],
  geometric: ['tiling', 'hyperbolic', 'moire', 'grid', 'azulejo'], neon: ['glow', 'uv', 'strobe', 'laser'],
  calm: ['fog', 'mist', 'glow', 'flow'], chaotic: ['feedback', 'strobe', 'shaky', 'noise'], energetic: ['strobe', 'feedback', 'kaleidoscope'],
}
// Adjectives that nudge parameters after building: [category, +1|-1, trigger words].
const NL_MODS = [
  ['speed', +1, ['fast', 'quick', 'rapid', 'energetic', 'frantic', 'hyper', 'racing']],
  ['speed', -1, ['slow', 'calm', 'gentle', 'lazy', 'sluggish', 'relaxed', 'drifting']],
  ['bright', +1, ['bright', 'glowing', 'vivid', 'luminous', 'radiant', 'brilliant']],
  ['bright', -1, ['dark', 'dim', 'moody', 'shadowy', 'murky', 'gloomy', 'muted']],
  ['contrast', +1, ['punchy', 'harsh', 'high contrast', 'high-contrast', 'stark', 'crisp', 'bold']],
  ['contrast', -1, ['soft', 'flat', 'washed', 'faded', 'hazy', 'gentle']],
  ['amount', +1, ['intense', 'strong', 'heavy', 'extreme', 'aggressive', 'wild', 'max', 'dramatic']],
  ['amount', -1, ['subtle', 'light', 'faint', 'minimal', 'delicate', 'slight']],
  ['scale', +1, ['big', 'large', 'huge', 'zoomed', 'macro', 'giant', 'coarse']],
  ['scale', -1, ['small', 'tiny', 'fine', 'micro', 'dense', 'detailed']],
]
// category → which schema param names/labels it should drive
const NL_MOD_PARAMS = {
  speed: /speed|rate|flow|churn|drift|velocity|tempo|spin|swirl/i,
  bright: /bright|expos|glow|lumin|value|gain|light/i,
  contrast: /contrast|gamma|punch/i,
  amount: /amount|intensity|strength|mix|power|depth|density|opacity|blur/i,
  scale: /scale|zoom|size|radius|detail|freq|count/i,
}
const NL_COLORS = { red: 0, crimson: 350, scarlet: 5, orange: 30, amber: 40, yellow: 55, gold: 48, lime: 90, green: 130, emerald: 150, teal: 170, cyan: 185, aqua: 185, blue: 215, azure: 205, indigo: 250, purple: 275, violet: 270, magenta: 305, pink: 325, rose: 340, white: 0, black: 0 }
const NL_STOP = new Set('the and with over into through onto a an of to in on for it its this that make makes look looks like live source filter effect them then as by from your you i me my is are be or so at not no all one two some more very really want give show turn put using use add just kinda sort feel feels bit little lot really really'.split(/\s+/))
const NL_BLENDS = [['soft light', 'soft-light'], ['hard light', 'hard-light'], ['color dodge', 'color-dodge'], ['dodge', 'color-dodge'], ['burn', 'color-burn'], ['screen', 'screen'], ['additive', 'add'], ['add', 'add'], ['multiply', 'multiply'], ['overlay', 'overlay'], ['difference', 'difference'], ['lighten', 'lighten'], ['darken', 'darken']]
const NL_TEXT_DEFAULTS = { font: 'sans-serif', size: 0.2, weight: 800, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, sat: 82, val: 96, rotate: 0, italic: false, glow: 0.4, bg: false }

// word-boundary-ish search; returns match position or -1
function nlHas(text, phrase) {
  const p = (phrase || '').trim().toLowerCase()
  if (p.length < 2) return -1
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').exec(text)
  return m ? m.index : -1
}
// HSV(0-360,0-100,0-100) → #rrggbb, for setting an effect's colour params.
function hueHex(h, s = 85, v = 95) {
  h = ((h % 360) + 360) % 360; s /= 100; v /= 100
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]
  return '#' + [r, g, b].map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('')
}
// Words distinctive enough (appear in few descriptions) to be worth matching on.
const nlDescIndex = computed(() => {
  const idx = new Map()
  for (const s of [...effectOptions.value, ...filterOptions.value]) {
    for (const w of new Set(String(s.description || '').toLowerCase().match(/[a-z]{5,}/g) || [])) idx.set(w, (idx.get(w) || 0) + 1)
  }
  return idx
})
// Score each catalog option against the text: strong hits on title/slug/synonym,
// weaker on tags, distinctive description words, and mood-derived keywords.
function nlScore(opts, text, moodKW) {
  const idx = nlDescIndex.value
  const found = []
  for (const s of opts) {
    let score = 0, pos = Infinity
    const strong = [s.title.toLowerCase(), s.slug.replace(/-/g, ' '), ...(NL_SYN[s.slug] || [])]
    for (const ph of strong) { const i = nlHas(text, ph); if (i >= 0) { score += 5; if (i < pos) pos = i } }
    for (const t of (s.tags || [])) { if (t.length >= 4 && !t.includes('-')) { const i = nlHas(text, t); if (i >= 0) { score += 1.5; if (i < pos) pos = i } } }
    for (const w of new Set(String(s.description || '').toLowerCase().match(/[a-z]{5,}/g) || [])) {
      if ((idx.get(w) || 99) <= 5) { const i = nlHas(text, w); if (i >= 0) { score += 1; if (i < pos) pos = i } }
    }
    for (const kw of moodKW) { for (const ph of strong) if (ph.includes(kw)) { score += 2.5; break } }
    if (score > 0) found.push({ s, score, pos: pos === Infinity ? 9999 : pos })
  }
  found.sort((a, b) => b.score - a.score || a.pos - b.pos)
  const seen = new Set()
  return found.filter((m) => !seen.has(m.s.slug) && seen.add(m.s.slug))
}

// Parse the prompt into an editable intent (does NOT build yet). The preview
// shows this so you can drop anything it got wrong before committing.
function parseIntent(raw) {
  const prompt = (raw ?? nlText.value ?? '').trim()
  if (!prompt) { nlIntent.value = null; showToast('Describe the look you want'); return }
  nlText.value = prompt
  const text = prompt.toLowerCase()
  const recognized = new Set()
  const note = (phrase) => { for (const w of String(phrase).toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2) recognized.add(w) }

  // Pull the literal text-content first (a quoted string, or "saying X"), then
  // strip it from the matching text so words *inside* the caption (e.g. "BRIGHT
  // WAVES") don't get read as effect names, moods, adjectives or colours.
  let quote = prompt.match(/["“”'‘’]([^"“”'‘’]{1,60})["“”'‘’]/)
  let textContent = quote ? quote[1] : null
  const textM = text.match(/\b(text|title|lyrics|typography|caption|words)\b/)
  if (!textContent) { const m = text.match(/\b(?:saying|text|title|words?|says|caption)\s+([a-z0-9 ,'!?-]{2,40})/); if (m) { textContent = m[1].replace(/\b(over|on|onto|with|through|and|then|masked|blend).*$/, '').trim() } }
  let search = text
  if (quote) search = search.replace(quote[0].toLowerCase(), ' ')
  if (textM) note(textM[0])

  const moodKW = []
  for (const [mood, kws] of Object.entries(NL_MOODS)) if (nlHas(search, mood) >= 0) { moodKW.push(...kws); note(mood) }

  const effM = nlScore(effectOptions.value, search, moodKW)
  const filtM = nlScore(filterOptions.value, search, moodKW)
  for (const m of [...effM, ...filtM]) {
    note(m.s.title); note(m.s.slug.replace(/-/g, ' '))
    for (const syn of (NL_SYN[m.s.slug] || [])) if (nlHas(search, syn) >= 0) note(syn)
  }

  let blend = 'screen'
  for (const [w, mode] of NL_BLENDS) if (nlHas(search, w) >= 0) { blend = mode; note(w); break }

  const camM = search.match(/\b(camera|webcam|selfie|my face|live video|myself|my cam)\b/); if (camM) note(camM[0])
  const maskM = search.match(/\b(mask|masked|through the (?:text|shape|word)|inside the (?:text|shape)|cut ?out|silhouette|stencil|clipped)\b/); if (maskM) note(maskM[0])
  if (textContent) note(textContent)
  const audM = search.match(/\b(audio|music|beat|bass|mic|sound|react|pulse|rhythm)\b/); if (audM) note(audM[0])
  const mouM = search.match(/\b(mouse|cursor|pointer)\b/); if (mouM) note(mouM[0])

  const mods = {}
  for (const [cat, dir, words] of NL_MODS) { if (mods[cat]) continue; for (const w of words) if (nlHas(search, w) >= 0) { mods[cat] = dir; note(w); break } }

  let color = null
  for (const [name, hue] of Object.entries(NL_COLORS)) if (nlHas(search, name) >= 0) { color = { name, hue, sat: name === 'white' ? 0 : 85, val: name === 'black' ? 10 : 95 }; note(name); break }

  const ignored = [...new Set((search.match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !NL_STOP.has(w) && !recognized.has(w)))].slice(0, 12)

  nlIntent.value = {
    effects: effM.slice(0, 3).map((m) => ({ slug: m.s.slug, title: m.s.title })),
    filters: filtM.slice(0, 4).map((m) => ({ slug: m.s.slug, title: m.s.title })),
    camera: !!camM, text: { on: !!textContent || !!textM, content: textContent },
    mask: !!maskM, audio: !!audM, mouse: !!mouM, blend, mods, color, ignored,
  }
}

// Queue adjective/colour mods for an effect/filter node, applied once its sketch
// announces its schema (via onEffectMessage), so we know which params exist.
const nlPendingMods = new Map() // node id -> { mods, color }
function queueNlMods(node, it) {
  if (Object.keys(it.mods).length || it.color) nlPendingMods.set(node.id, { mods: it.mods, color: it.color })
}
function applyNlMods(id, { mods, color }) {
  const c = effectControls.get(id)
  if (!c?.schema) return
  for (const [name, spec] of Object.entries(c.schema)) {
    const label = (name + ' ' + (spec.label || '')).toLowerCase()
    if (spec.type === 'color') { if (color) setEffectParam(id, name, hueHex(color.hue, color.sat, color.val)); continue }
    if (typeof spec.min !== 'number') continue
    const span = spec.max - spec.min || 1
    let applied = false
    for (const [cat, re] of Object.entries(NL_MOD_PARAMS)) {
      if (mods[cat] && re.test(label)) { setEffectParam(id, name, +(spec.min + span * (mods[cat] > 0 ? 0.8 : 0.2)).toFixed(4)); applied = true; break }
    }
    if (!applied && color && /\bhue\b/.test(label)) setEffectParam(id, name, spec.max <= 361 ? color.hue : +(color.hue / 360).toFixed(3))
  }
}

// Build the graph from the (possibly edited) intent.
function buildFromIntent() {
  const it = nlIntent.value
  if (!it) { parseIntent(nlText.value); return }

  const keptIds = new Set(nodes.filter((n) => n.locked || n.keep).map((n) => n.id))
  for (let k = edges.length - 1; k >= 0; k--) if (!keptIds.has(edges[k].from) || !keptIds.has(edges[k].to)) edges.splice(k, 1)
  for (let k = links.length - 1; k >= 0; k--) if (!keptIds.has(links[k].from) || !keptIds.has(links[k].node)) links.splice(k, 1)
  for (let k = nodes.length - 1; k >= 0; k--) if (!keptIds.has(nodes[k].id)) { const id = nodes[k].id; nodes.splice(k, 1); disposeRuntime(id); rtState.delete(id); effectControls.delete(id); nlPendingMods.delete(id) }
  if (keptIds.size) nextId = Math.max(nextId, ...keptIds) + 1

  const COL = (c) => 60 + c * 240
  const add = (type, params, c, y) => { const n = reactive({ id: nextId++, type, x: COL(c), y, params }); nodes.push(n); st(n.id); return n }
  const summary = []
  const colParams = it.color ? { hue: it.color.hue, sat: it.color.sat, val: it.color.val } : {}

  const sources = []
  let sy = 80
  if (it.camera) { sources.push(add('media', { mode: 'camera', mediaId: null }, 0, sy)); summary.push('Camera'); sy += 210 }
  for (const e of it.effects.slice(0, Math.max(1, 3 - (it.camera ? 1 : 0)))) { const n = add('effect', { slug: e.slug, seed: randSeed() }, 0, sy); sources.push(n); queueNlMods(n, it); summary.push(e.title); sy += 210 }
  if (it.text.on && !it.mask) { sources.push(add('text', { ...NL_TEXT_DEFAULTS, ...colParams, text: (it.text.content || 'BRIGHT WAVES').toUpperCase() }, 0, sy)); summary.push('Text'); sy += 210 }
  if (!sources.length) { const def = effectOptions.value[0]; if (def) { const n = add('effect', { slug: def.slug, seed: randSeed() }, 0, 80); sources.push(n); queueNlMods(n, it); summary.push(def.title) } }
  if (!sources.length) { showToast('No sources available'); return }

  const mix = it.mods.amount > 0 ? 0.85 : it.mods.amount < 0 ? 0.35 : 0.6
  let col = 1, head = sources[0]
  for (let i = 1; i < sources.length; i++) {
    const b = add('blend', { mode: it.blend, mix }, col, (head.y + sources[i].y) / 2)
    edges.push({ from: head.id, to: b.id, port: 0 }); edges.push({ from: sources[i].id, to: b.id, port: 1 })
    head = b; col++
  }
  if (sources.length > 1) summary.push(`${it.blend} blend`)

  for (const f of it.filters.slice(0, 4)) {
    const fn = add('filter', { slug: f.slug, seed: randSeed() }, col, head.y); queueNlMods(fn, it)
    edges.push({ from: head.id, to: fn.id, port: 0 }); head = fn; col++; summary.push(f.title)
  }

  if (it.mask) {
    let matte
    if (it.text.content || it.text.on) matte = add('text', { ...NL_TEXT_DEFAULTS, text: (it.text.content || 'BRIGHT').toUpperCase(), hue: 0, sat: 0, val: 100, glow: 0 }, col - 1, head.y + 190)
    else { matte = add('polygon', { points: [[0.3, 0.15], [0.72, 0.28], [0.82, 0.7], [0.4, 0.85], [0.18, 0.5]], feather: 0.12 }, col - 1, head.y + 190) }
    const mnode = add('mask', { mode: 'multiply', strength: 1, invert: false }, col, head.y)
    edges.push({ from: head.id, to: mnode.id, port: 0 }); edges.push({ from: matte.id, to: mnode.id, port: 1 })
    head = mnode; col++; summary.push('Mask')
  }

  const blendNodes = nodes.filter((n) => n.type === 'blend' && !keptIds.has(n.id))
  const ctlTarget = blendNodes[blendNodes.length - 1]
  if (ctlTarget && it.mouse) {
    const xy = add('xy', { x: 0.5, y: 0.5, recenter: false, xMin: 0, xMax: 1, yMin: 0, yMax: 1, curve: 'linear', padW: NODE_W, padH: THUMB_H }, 0, head.y + 250)
    links.push({ from: xy.id, srcPort: 0, node: ctlTarget.id, param: 'mix' }); summary.push('XY→mix')
  } else if (ctlTarget && it.audio) {
    const inp = add('input', { source: 'audio.pulse', scale: 1, offset: 0, invert: false, curve: 'linear' }, 0, head.y + 250)
    links.push({ from: inp.id, srcPort: 0, node: ctlTarget.id, param: 'mix' }); summary.push('Audio→mix')
  }

  const out = nodes.find((n) => n.type === 'output' && keptIds.has(n.id)) || add('output', {}, col, head.y)
  for (let k = edges.length - 1; k >= 0; k--) if (edges[k].to === out.id) edges.splice(k, 1)
  edges.push({ from: head.id, to: out.id, port: 0 })

  selected.value = null
  nlLast.value = summary.join(' → ') + ' → Output'
  persist()
  showToast('Built: ' + nlLast.value)
  nextTick(() => layoutTick.value++)
  nlOpen.value = false; nlIntent.value = null
}

// --- AI smart mode (opt-in) -----------------------------------------------
// With the user's own Claude API key (Settings), send the description + the
// catalog to the Anthropic API and build the structured graph it returns. This
// understands relational/free-form language the offline parser can't. The key
// stays in the browser and the request goes straight to Anthropic.
const nlSmart = ref(settings.aiSmart)
const nlBusy = ref(false)
const nlAiSpec = ref(null) // the model's returned plan, shown before building
watch(nlSmart, (v) => settings.setAiSmart(v))

const NL_SYS = `You are the patch designer for "Bright Waves", a live-visuals node-graph compositor. Turn the user's description into a graph as a JSON object and nothing else.

Node types (field "type"):
- effect: a generative source. Needs "slug" from the effects list.
- filter: processes ONE video input (port 0). Needs "slug" from the filters list.
- media: a camera source. Use {"type":"media","mode":"camera"}.
- text: on-screen text. Fields: text, and optional x,y (0..1), size (0.03..0.6), weight (100..900), hue (0..360), sat (0..100), val (0..100), rotate.
- sprite: a placed image. Optional x,y,scale.
- polygon: a white matte shape source. Optional "shape": one of triangle,square,pentagon,hexagon,octagon,circle,diamond,star,heart,arrow,cross.
- mask: cuts a picture to a matte. Input port 0 = picture (content), port 1 = matte (a polygon/text). Optional "invert".
- blend: composites TWO inputs. Port 0 = base, port 1 = top. Fields: mode (screen,add,multiply,overlay,difference,lighten,darken,soft-light,normal), mix (0..1).
- portal: remaps a region. geo/vcam: 3D geometry + camera (geo feeds vcam).
- input: emits a 0..1 control signal. Field "source" from the input-sources list. xy: an XY pad control. tracker: video motion tracker.
- output: the final image. Exactly one; wire the last picture node into it.

Rules:
- "edges" are VIDEO/geometry connections: {"from": id, "to": id, "port": inputIndex}. port is 0-based.
- "links" are CONTROL connections from an input/xy/tracker OUTPUT to a target node's numeric PARAM: {"from": id, "to": id, "param": "mix"}. Controllable params include blend "mix", text "x"/"y"/"hue"/"rotate"/"size", portal edges, polygon "feather".
- Every graph must end in exactly one output node fed by the final picture.
- Only use slugs that appear in the provided lists. Prefer few nodes (2–7) unless the description clearly needs more.
- ids are short strings you choose.

Return ONLY a JSON object: {"nodes":[...],"edges":[...],"links":[...],"notes":"one short sentence"}. No markdown, no prose.`

async function nlCallClaude(prompt) {
  const key = settings.aiKey
  const eff = effectOptions.value.map((s) => `${s.slug}: ${s.title}`).join('\n')
  const filt = filterOptions.value.map((s) => `${s.slug}: ${s.title}`).join('\n')
  const user = `EFFECTS (sources), slug: title —\n${eff}\n\nFILTERS (process video), slug: title —\n${filt}\n\nINPUT SOURCES for input nodes: ${INPUT_SOURCES.join(', ')}\n\nDESCRIPTION: "${prompt}"\n\nReturn ONLY the JSON patch.`
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: settings.aiModel, max_tokens: 1600, system: NL_SYS, messages: [{ role: 'user', content: user }] }),
  })
  if (!res.ok) {
    let msg = res.status + ''
    try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j).slice(0, 140) } catch { /* non-json */ }
    throw new Error(msg)
  }
  const data = await res.json()
  const text = (data.content || []).map((c) => c.text || '').join('')
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('no JSON in response')
  return JSON.parse(text.slice(a, b + 1))
}

async function smartInterpret() {
  const prompt = (nlText.value || '').trim()
  if (!prompt) { showToast('Describe the look you want'); return }
  if (!settings.aiKey) { showToast('Add a Claude API key in Settings for smart mode'); return }
  nlBusy.value = true; nlAiSpec.value = null; nlIntent.value = null
  try {
    const spec = await nlCallClaude(prompt)
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) throw new Error('empty patch')
    nlAiSpec.value = spec
  } catch (e) {
    showToast('Smart mode failed: ' + (e.message || e))
  } finally {
    nlBusy.value = false
  }
}

const nlNum = (v, d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d)
// Lay the graph out left-to-right by dependency depth (longest path from a source).
function layoutByDepth(newIds) {
  const set = new Set(newIds)
  const depth = new Map(newIds.map((id) => [id, 0]))
  for (let iter = 0; iter <= newIds.length; iter++) {
    for (const e of edges) {
      if (!set.has(e.from) || !set.has(e.to)) continue
      const d = (depth.get(e.from) ?? 0) + 1
      if (d > (depth.get(e.to) ?? 0)) depth.set(e.to, d)
    }
  }
  const byCol = new Map()
  for (const id of newIds) { const c = depth.get(id) ?? 0; if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(id) }
  for (const [c, list] of byCol) list.forEach((id, i) => { const n = nodeById(id); if (n) { n.x = 60 + c * 240; n.y = 70 + i * 200 } })
}

function buildFromSpec(spec) {
  if (!spec || !Array.isArray(spec.nodes)) { showToast('AI returned no usable patch'); return }
  const effSet = new Set(effectOptions.value.map((s) => s.slug))
  const filtSet = new Set(filterOptions.value.map((s) => s.slug))
  const inputSet = new Set(INPUT_SOURCES)
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)

  // clear everything except locked / kept nodes
  const keptIds = new Set(nodes.filter((n) => n.locked || n.keep).map((n) => n.id))
  for (let k = edges.length - 1; k >= 0; k--) if (!keptIds.has(edges[k].from) || !keptIds.has(edges[k].to)) edges.splice(k, 1)
  for (let k = links.length - 1; k >= 0; k--) if (!keptIds.has(links[k].from) || !keptIds.has(links[k].node)) links.splice(k, 1)
  for (let k = nodes.length - 1; k >= 0; k--) if (!keptIds.has(nodes[k].id)) { const id = nodes[k].id; nodes.splice(k, 1); disposeRuntime(id); rtState.delete(id); effectControls.delete(id); nlPendingMods.delete(id) }
  if (keptIds.size) nextId = Math.max(nextId, ...keptIds) + 1

  const idMap = new Map()
  const newIds = []
  for (const n of spec.nodes) {
    if (!n || !TYPES[n.type]) continue
    let params
    switch (n.type) {
      case 'effect': params = { slug: effSet.has(n.slug) ? n.slug : (effectOptions.value[0]?.slug ?? ''), seed: randSeed() }; break
      case 'filter': params = { slug: filtSet.has(n.slug) ? n.slug : (filterOptions.value[0]?.slug ?? ''), seed: randSeed() }; break
      case 'blend': params = { mode: BLENDS.includes(n.mode) ? n.mode : 'screen', mix: nlNum(n.mix, 0.6, 0, 1) }; break
      case 'text': params = { ...NL_TEXT_DEFAULTS, text: String(n.text ?? 'BRIGHT WAVES'), x: nlNum(n.x, 0.5, 0, 1), y: nlNum(n.y, 0.5, 0, 1), size: nlNum(n.size, 0.2, 0.03, 0.6), weight: nlNum(n.weight, 800, 100, 900), hue: nlNum(n.hue, 200, 0, 360), sat: nlNum(n.sat, 82, 0, 100), val: nlNum(n.val, 96, 0, 100), rotate: nlNum(n.rotate, 0, -180, 180) }; break
      case 'input': params = { source: inputSet.has(n.source) ? n.source : 'audio.pulse', scale: 1, offset: 0, invert: false, curve: 'linear' }; break
      case 'xy': params = { x: 0.5, y: 0.5, recenter: false, xMin: 0, xMax: 1, yMin: 0, yMax: 1, curve: 'linear', padW: NODE_W, padH: THUMB_H }; break
      case 'tracker': params = { thresh: 0.5, smooth: 0.7 }; break
      case 'media': params = { mode: 'camera', mediaId: null }; break
      case 'sprite': params = { mediaId: null, x: nlNum(n.x, 0.5, 0, 1), y: nlNum(n.y, 0.5, 0, 1), scale: nlNum(n.scale, 0.4, 0.02, 2), rotate: 0, opacity: 1, spin: 0, motion: 'None', speed: 0.5, amp: 0.2, cols: 1, rows: 1, fps: 12 }; break
      case 'polygon': { const shp = POLY_SHAPES[capitalize(n.shape)]; params = { points: (shp || [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]).map((p) => [...p]), feather: nlNum(n.feather, 0, 0, 0.5) }; break }
      case 'mask': params = { mode: 'multiply', strength: 1, invert: !!n.invert }; break
      case 'portal': params = { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' }; break
      case 'geo': params = { shape: 'Icosahedron', material: 'Solid', hue: 160, sat: 72, val: 90, displace: 0.25, freq: 2, spin: 0.5, detail: 2, flutes: 8, twist: 90, groove: 0.28, source: 'Shape', cloud: 'Galaxy', voxel: 'Sphere', count: 12000, res: 18, pointSize: 0.03, dataVer: 0, lat: 46.5, lon: 8.0, zoom: 11, terrainRes: 96, verticalScale: 0.6, drape: true }; break
      case 'vcam': params = { fov: 55, distance: 4.5, orbit: 0.4, tilt: 0.35, bg: 'Dark', lightHue: 40, lightSat: 34, lightVal: 86, spin: true }; break
      default: params = {}
    }
    const rn = reactive({ id: nextId++, type: n.type, x: 0, y: 0, params })
    nodes.push(rn); st(rn.id); idMap.set(n.id, rn.id); newIds.push(rn.id)
  }
  if (!newIds.length) { showToast('AI returned no usable nodes'); return }

  for (const e of (spec.edges || [])) {
    const from = idMap.get(e.from), to = idMap.get(e.to)
    if (from == null || to == null) continue
    const toNode = nodeById(to); const ins = TYPES[toNode?.type]?.ins ?? 0
    if (ins <= 0) continue
    edges.push({ from, to, port: Math.max(0, Math.min(ins - 1, (e.port | 0))) })
  }
  for (const l of (spec.links || [])) {
    const from = idMap.get(l.from), node = idMap.get(l.to ?? l.node) // model uses "to"; our schema calls it "node"
    if (from == null || node == null || !l.param) continue
    if (outKind(nodeById(from)) !== 'control') continue
    links.push({ from, srcPort: (l.srcPort | 0), node, param: String(l.param) })
  }

  // ensure exactly one fed output
  let out = nodes.find((n) => n.type === 'output')
  if (!out) { out = reactive({ id: nextId++, type: 'output', x: 0, y: 0, params: {} }); nodes.push(out); st(out.id); newIds.push(out.id) }
  if (!edges.some((e) => e.to === out.id)) {
    const PROD = new Set(['effect', 'filter', 'media', 'text', 'sprite', 'blend', 'mask', 'portal', 'vcam'])
    const feeders = new Set(edges.map((e) => e.from))
    const cand = [...nodes].reverse().find((n) => PROD.has(n.type) && n.id !== out.id && !feeders.has(n.id)) || [...nodes].reverse().find((n) => PROD.has(n.type) && n.id !== out.id)
    if (cand) edges.push({ from: cand.id, to: out.id, port: 0 })
  }
  pruneOrphans()
  layoutByDepth(newIds)

  selected.value = null
  nlLast.value = (spec.notes || 'AI patch') + ` · ${newIds.length} nodes`
  persist()
  showToast('Built: ' + (spec.notes || 'AI patch'))
  nextTick(() => layoutTick.value++)
  nlOpen.value = false; nlAiSpec.value = null
}

// spoken input via the Web Speech API (Chromium); falls back with a toast
let nlRecog = null
function nlVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { showToast('Voice input needs a Chromium browser'); return }
  if (nlListening.value) { nlRecog?.stop(); return }
  nlRecog = new SR()
  nlRecog.lang = 'en-US'; nlRecog.interimResults = true; nlRecog.continuous = false
  let finalTxt = ''
  nlRecog.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalTxt += r[0].transcript
      else interim += r[0].transcript
    }
    nlText.value = (finalTxt + ' ' + interim).trim()
  }
  nlRecog.onerror = () => { nlListening.value = false }
  nlRecog.onend = () => { nlListening.value = false }
  nlListening.value = true
  try { nlRecog.start() } catch { nlListening.value = false }
}

// All nodes that feed (directly or transitively) into `id` via video edges.
function ancestorsOf(id) {
  const anc = new Set()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of edges) if (e.to === cur && !anc.has(e.from)) { anc.add(e.from); stack.push(e.from) }
  }
  return anc
}
// Replace the whole branch feeding a node: remove every (unlocked) node upstream
// of it and grow a fresh random source into each of its now-empty input ports.
// Slide a proposed node box downward until it no longer overlaps any existing
// node (plus a margin) — keeps freshly-laid-out nodes from stacking on top of
// each other or on nodes that are staying put.
const NODE_H = HEAD_H + THUMB_H + 24
function freeSpot(x, y, ignore = new Set()) {
  const mx = 24, my = 20
  let guard = 0
  let overlap = true
  while (overlap && guard++ < 200) {
    overlap = false
    for (const o of nodes) {
      if (ignore.has(o.id)) continue
      if (Math.abs(o.x - x) < NODE_W + mx && Math.abs(o.y - y) < NODE_H + my) { y = o.y + NODE_H + my; overlap = true; break }
    }
  }
  return { x, y }
}
function rerollUpstream(node) {
  if (!node || TYPES[node.type].ins === 0) return
  const anc = ancestorsOf(node.id)
  const rm = new Set([...anc].filter((id) => !nodeById(id)?.locked && !nodeById(id)?.keep))
  for (let i = nodes.length - 1; i >= 0; i--) if (rm.has(nodes[i].id)) { disposeRuntime(nodes[i].id); rtState.delete(nodes[i].id); nodes.splice(i, 1) }
  for (let i = edges.length - 1; i >= 0; i--) if (rm.has(edges[i].from) || rm.has(edges[i].to)) edges.splice(i, 1)
  for (let i = links.length - 1; i >= 0; i--) if (rm.has(links[i].from) || rm.has(links[i].node)) links.splice(i, 1)
  const pool = settings.filterToPool(effectOptions.value)
  const ins = Math.max(1, TYPES[node.type].ins)
  // the ports still needing a fresh feeder, laid out as a tidy column centred on
  // the target node so multi-input branches don't pile up on one another
  const openPorts = []
  for (let port = 0; port < ins; port++) if (!edges.some((e) => e.to === node.id && e.port === port)) openPorts.push(port)
  const ROW = NODE_H + 26
  const fresh = new Set()
  openPorts.forEach((port, idx) => {
    const cy = node.y + (idx - (openPorts.length - 1) / 2) * ROW
    const withFilter = Math.random() < 0.4
    const eSpot = freeSpot(node.x - (withFilter ? 430 : 250), cy, fresh)
    const eff = reactive({ id: nextId++, type: 'effect', x: eSpot.x, y: eSpot.y, params: { slug: pk(pool.length ? pool : effectOptions.value)?.slug ?? '' } })
    nodes.push(eff); st(eff.id); fresh.add(eff.id)
    let src = eff
    if (withFilter) {
      const fSpot = freeSpot(node.x - 220, cy, fresh)
      const f = reactive({ id: nextId++, type: 'filter', x: fSpot.x, y: fSpot.y, params: { slug: pk(filterOptions.value)?.slug ?? '' } })
      nodes.push(f); st(f.id); fresh.add(f.id); edges.push({ from: eff.id, to: f.id, port: 0 }); src = f
    }
    edges.push({ from: src.id, to: node.id, port })
  })
  persist()
  nextTick(() => layoutTick.value++)
}

// --- autopilot mode: auto-evolve the graph -----------------------------------
// A hands-free mode that mutates the graph on a timer, the same idea as the
// Autopilot view but operating on THIS node network: it swaps effect/filter
// sketches, restyles blends, and occasionally regrows a whole upstream branch —
// always leaving locked nodes alone. Toggle it to jump between hand-editing
// (manual) and letting it drive (autopilot).
const autoOn = ref(false)
const autoEverySec = ref(12)   // dwell between moves
const autoFpsFloor = ref(15)   // if the composite drops below this, cheapen the graph
const autoBudget = ref(12)     // keep the graph's total render cost under this
let autoTimer = 0
// Transport state — parity with the Autopilot view: a per-second countdown so
// we can draw the ring, a pause that holds the clock without dropping out of
// autopilot, and a panel ("tab") that surfaces the transport + countdown.
const autoPaused = ref(false)
const autoPanelOpen = ref(false)
const autoLeft = ref(0)        // whole seconds until the next move
const autoTotal = ref(1)       // length of the current dwell, for the ring
const autoProgress = computed(() => Math.min(1, Math.max(0, 1 - autoLeft.value / Math.max(1, autoTotal.value))))
function autoResetClock() { autoTotal.value = Math.max(2, autoEverySec.value); autoLeft.value = autoTotal.value }
// Per-sketch render cost (higher = slower), same model as the Autopilot view.
function slugCost(slug) {
  const s = perfScores[slug]
  if (!s) return 4
  return Math.min(12, Math.max(1, Math.round(100 / Math.max(s, 8))))
}
function graphCost() {
  return nodes.reduce((a, n) => a + ((n.type === 'effect' || n.type === 'filter') && n.params.slug ? slugCost(n.params.slug) : 0), 0)
}
function slugPool(n) {
  const base = n.type === 'filter' ? filterOptions.value : settings.filterToPool(effectOptions.value)
  return base.length ? base : (n.type === 'filter' ? filterOptions.value : effectOptions.value)
}
// Would autopilot ever mutate this node? (swap a slug, restyle a blend, or
// reroll its upstream branch) — only those get the "keep" pin.
function autoCanTouch(n) {
  if (n.type === 'output') return false
  return n.type === 'effect' || n.type === 'filter' || n.type === 'blend' || TYPES[n.type].ins > 0
}
function autoStep() {
  if (!autoOn.value) return
  const swappable = nodes.filter((n) => (n.type === 'effect' || n.type === 'filter') && !n.locked && !n.keep)

  // Perf watchdog: if the frame rate is under the floor, don't add churn — swap
  // the most expensive unlocked node for a cheaper sketch and stop for this tick.
  if (fps.value > 0 && fps.value < autoFpsFloor.value && swappable.length) {
    const heavy = [...swappable].sort((a, b) => slugCost(b.params.slug) - slugCost(a.params.slug))[0]
    const cheaper = slugPool(heavy).filter((o) => slugCost(o.slug) < slugCost(heavy.params.slug))
    if (cheaper.length) {
      cheaper.sort((a, b) => slugCost(a.slug) - slugCost(b.slug))
      heavy.params.slug = cheaper[Math.floor(Math.random() * Math.min(3, cheaper.length))].slug
      persist()
      return
    }
  }

  const blends = nodes.filter((n) => n.type === 'blend' && !n.locked && !n.keep)
  const branchable = nodes.filter((n) => TYPES[n.type].ins > 0 && !n.locked && !n.keep && edges.some((e) => e.to === n.id))
  // weight gentle moves (slug swap, blend restyle) over the drastic branch reroll
  const bag = []
  if (swappable.length) bag.push('swap', 'swap', 'swap')
  if (blends.length) bag.push('blend', 'blend')
  if (branchable.length) bag.push('branch')
  if (!bag.length) { randomPatch(); return }
  const move = bag[Math.floor(Math.random() * bag.length)]
  if (move === 'swap') {
    const n = swappable[Math.floor(Math.random() * swappable.length)]
    const opts = slugPool(n)
    if (!opts.length) return
    // respect the perf budget: prefer replacements that keep total cost in check
    const headroom = autoBudget.value - (graphCost() - slugCost(n.params.slug))
    let pool = opts.filter((o) => slugCost(o.slug) <= Math.max(2, headroom))
    if (!pool.length) pool = [...opts].sort((a, b) => slugCost(a.slug) - slugCost(b.slug)).slice(0, Math.max(1, Math.ceil(opts.length * 0.3)))
    let s = n.params.slug
    for (let k = 0; k < 6 && s === n.params.slug; k++) s = pool[Math.floor(Math.random() * pool.length)]?.slug ?? s
    n.params.slug = s
    persist()
  } else if (move === 'blend') {
    const n = blends[Math.floor(Math.random() * blends.length)]
    n.params.mode = BLENDS[Math.floor(Math.random() * BLENDS.length)]
    n.params.mix = +(0.35 + Math.random() * 0.6).toFixed(2)
    persist()
  } else {
    rerollUpstream(branchable[Math.floor(Math.random() * branchable.length)])
  }
}
// A 1 Hz clock drives the countdown ring; when it reaches zero we make a move
// and re-arm. Pausing stops the decrement but keeps autopilot engaged.
function armAuto() {
  clearInterval(autoTimer)
  if (!autoOn.value) return
  autoResetClock()
  autoTimer = setInterval(() => {
    if (autoPaused.value) return
    autoLeft.value--
    if (autoLeft.value <= 0) { autoStep(); autoResetClock() }
  }, 1000)
}
function toggleAuto() {
  autoOn.value = !autoOn.value
  if (autoOn.value) {
    autoPaused.value = false
    if (!nodes.some((n) => n.type === 'effect' || n.type === 'filter')) randomPatch()
    autoPanelOpen.value = true // surface the transport tab when it engages
  }
  armAuto()
}
// Transport — feature parity with the Autopilot page's controls.
function autoPlayPause() { autoPaused.value = !autoPaused.value }
function autoNextNow() { if (!autoOn.value) return; autoStep(); autoResetClock() } // jump the next move forward
function autoPrev() { undo() }                                                     // step back through the changes
function autoReroll() { randomPatch(); autoResetClock() }                          // deal a whole fresh graph
watch(autoEverySec, () => { if (autoOn.value) armAuto() })

// Jump to the full Autopilot view (its own evolving-mix mode).
function openAutopilot() { router.push({ name: 'autopilot' }) }

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
  const params = JSON.parse(JSON.stringify(c.params))
  // A pasted effect/filter gets a fresh generative seed so the copy is a new
  // variation instead of an identical twin of the original.
  if ((c.type === 'effect' || c.type === 'filter') && 'seed' in params) params.seed = randSeed()
  const n = reactive({
    id: nextId++,
    type: c.type,
    name: c.name,
    x: 80 + (nodes.length % 5) * 30,
    y: 110 + (nodes.length % 5) * 30,
    params,
  })
  nodes.push(n)
  st(n.id)
  selected.value = n.id
  persist()
}
function onKey(e) {
  if (editingName.value != null) return // don't hijack typing in the name field
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return // typing elsewhere
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key === 'c') copySelection()
  else if (mod && e.key === 'v') pasteClipboard()
  else if (mod && (e.key === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
  else if (mod && e.key === 'z') { e.preventDefault(); undo() }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value != null) {
    removeNode(selected.value)
    selected.value = null
  }
  // settings visibility: h = hide all, s = show all, m = show only modulated
  else if (!mod && e.key === 'h') hideAllBodies()
  else if (!mod && e.key === 's') showAllBodies()
  else if (!mod && e.key === 'm') showModulatedBodies()
}
function clearAll() {
  nodes.splice(0)
  edges.splice(0)
  rtState.clear()
  persist()
}

// --- ports & wiring ---
const board = ref(null)
// XY Pad nodes can be resized by dragging their corner; everything else keeps
// the fixed node dimensions. Port/wire geometry reads these so endpoints track.
function nodeW(n) { return n.type === 'xy' ? Math.max(120, Math.round(n.params.padW || NODE_W)) : NODE_W }
function thumbH(n) { return n.type === 'xy' ? Math.max(80, Math.round(n.params.padH || THUMB_H)) : THUMB_H }
function outPortAt(n, i = 0) {
  const cnt = outCount(n) || 1
  return { x: n.x + nodeW(n), y: n.y + HEAD_H + (thumbH(n) * (i + 1)) / (cnt + 1) }
}
function outPort(n) {
  return outPortAt(n, 0)
}
function inPort(n, i) {
  const cnt = TYPES[n.type].ins
  return { x: n.x, y: n.y + HEAD_H + (thumbH(n) * (i + 1)) / (cnt + 1) }
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
  if (node.type === 'vcam') return 'geometry' // Camera inputs take meshes, not frames
  return 'image'
}
function outKind(node) {
  if (node.type === 'input' || node.type === 'xy' || node.type === 'tracker') return 'control'
  if (node.type === 'geo') return 'geometry'
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
// Per-Input-node smoothing memory (EMA), for the `smooth` inertia control.
const inputSmooth = new Map()
function inputValue(node, now) {
  const p = node.params
  ensureInput(p.source)
  let v = sourceValue(p.source, now)
  if (p.invert) v = 1 - v
  v = clamp(v * (p.scale ?? 1) + (p.offset ?? 0), 0, 1)
  // gate: ignore input below the floor, then rescale [gate..1] → [0..1]
  const g = p.gate ?? 0
  if (g > 0) v = v <= g ? 0 : (v - g) / (1 - g)
  v = applyCurve(v, p.curve ?? 'linear')
  // smooth: inertia so the value glides instead of snapping (0 = none)
  const sm = p.smooth ?? 0
  if (sm > 0) {
    const prev = inputSmooth.get(node.id)
    v = prev == null ? v : prev + (v - prev) * (1 - sm)
    inputSmooth.set(node.id, v)
  }
  return v
}
const INPUT_CURVES = ['linear', 'exp', 'log', 's-curve', 'step']
// Control value emitted by any control node's given output port.
function controlValue(node, port, now) {
  if (node.type === 'input') return inputValue(node, now)
  if (node.type === 'xy') {
    const p = node.params
    let a = clamp(port === 1 ? p.y : p.x, 0, 1)
    a = applyCurve(a, p.curve ?? 'linear')
    const lo = port === 1 ? (p.yMin ?? 0) : (p.xMin ?? 0)
    const hi = port === 1 ? (p.yMax ?? 1) : (p.xMax ?? 1)
    return lo + a * (hi - lo)
  }
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
    const geometry = outKind(from) === 'geometry'
    return {
      idx,
      d: wirePath(outPort(from), inPort(to, e.port)),
      color: TYPES[from.type].color,
      matte,
      geometry,
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
  return { x: n.x, y: n.y + HEAD_H + thumbH(n) + 12 + di * 15 }
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
  const l = links[idx]
  links.splice(idx, 1)
  // Restore the knob's base value to a freed effect param (we'd been posting a
  // live value; without the link the sketch should sit at the knob again).
  if (l) {
    const tgt = nodes.find((n) => n.id === l.node)
    if (tgt && (tgt.type === 'effect' || tgt.type === 'filter')) {
      const c = effectControls.get(tgt.id)
      if (c && l.param in c.values) postToEffect(tgt.id, { type: 'sketch:set-param', name: l.param, value: c.values[l.param] })
    }
  }
  persist()
}
// Live (post-modulation) values for wired params, rebuilt each frame. The
// renderer reads these via pval() while the node's own knob keeps the *base*
// value — so a wired param behaves like modular synthesis: the knob sets the
// operating point and the input signal modulates up from it, and you can still
// turn the knob while it's patched.
const liveParams = new Map() // nodeId -> { param: liveValue }
const beatEdge = new Map() // nodeId -> last beat-jack signal, for rising-edge detection
function pval(n, key) {
  const lv = liveParams.get(n.id)
  return lv && key in lv ? lv[key] : n.params[key]
}
function applyLinks(now) {
  liveParams.clear()
  for (const l of links) {
    const from = nodes.find((n) => n.id === l.from)
    const tgt = nodes.find((n) => n.id === l.node)
    if (!from || !tgt || outKind(from) !== 'control') continue
    const v = controlValue(from, l.srcPort ?? 0, now) // 0..1 control signal
    const depth = l.depth ?? 1
    // A wire onto an effect's synthetic "beat" jack fires a manual beat on the
    // rising edge of the signal, so any input can trigger beat-driven sketches.
    if (l.param === '__beat') {
      if (tgt.type === 'effect' || tgt.type === 'filter') {
        const prev = beatEdge.get(tgt.id) ?? 0
        if (v >= 0.6 && prev < 0.6) postToEffect(tgt.id, { type: 'sketch:beat', energy: v })
        beatEdge.set(tgt.id, v)
      }
      continue
    }
    if (tgt.type === 'effect' || tgt.type === 'filter') {
      const spec = effectControls.get(tgt.id)?.schema?.[l.param]
      if (spec && typeof spec.min === 'number') {
        const span = spec.max - spec.min || 1
        const base = effectControls.get(tgt.id).values[l.param] // the knob value
        const bn = (base - spec.min) / span
        const live = spec.min + clamp(bn + v * depth, 0, 1) * span
        // post the live value only — never write it back into the knob's value
        postToEffect(tgt.id, { type: 'sketch:set-param', name: l.param, value: live })
      }
    } else if (tgt.type === 'text' && l.param === 'font') {
      // Categorical param: map the 0..1 control signal across the font list so an
      // input can flip/scan through typefaces live.
      const list = fontList.value
      if (list.length) {
        const idx = Math.max(0, Math.min(list.length - 1, Math.floor(clamp(v * depth, 0, 0.99999) * list.length)))
        let m = liveParams.get(tgt.id)
        if (!m) { m = {}; liveParams.set(tgt.id, m) }
        m.font = list[idx]
      }
    } else {
      const rng = PARAM_RANGES[tgt.type]?.[l.param]
      if (rng) {
        const span = rng[1] - rng[0] || 1
        const base = tgt.params[l.param] ?? rng[0]
        const bn = (base - rng[0]) / span
        const live = rng[0] + clamp(bn + v * depth, 0, 1) * span
        let m = liveParams.get(tgt.id)
        if (!m) { m = {}; liveParams.set(tgt.id, m) }
        m[l.param] = live
      }
    }
  }
}

const drag = reactive({ node: null, dx: 0, dy: 0, ids: [], starts: null, px: 0, py: 0 })
const wire = reactive({ active: false, from: null, fromPort: 0, x: 0, y: 0, kind: 'video' })
const selected = ref(null) // node id last clicked — target for copy/delete
const frontNodeId = ref(null) // node raised above the others while interacted with
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
    maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + hgt)
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
  frontNodeId.value = n.id // raise the grabbed node above its neighbours
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
function xyUp(n) {
  if (n.params.recenter) { n.params.x = 0.5; n.params.y = 0.5 } // spring back to centre
  persist()
}
// Resize the XY pad by dragging its corner grip. Deltas are divided by the
// board zoom so the pad tracks the cursor at any zoom level.
const padResize = reactive({ node: null, startX: 0, startY: 0, w0: 0, h0: 0 })
function padResizeDown(n, e) {
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)
  padResize.node = n; padResize.startX = e.clientX; padResize.startY = e.clientY
  padResize.w0 = nodeW(n); padResize.h0 = thumbH(n)
}
function padResizeMove(e) {
  if (!padResize.node) return
  e.stopPropagation()
  const z = view.zoom || 1
  padResize.node.params.padW = Math.max(120, Math.min(560, padResize.w0 + (e.clientX - padResize.startX) / z))
  padResize.node.params.padH = Math.max(80, Math.min(460, padResize.h0 + (e.clientY - padResize.startY) / z))
}
function padResizeUp() {
  if (!padResize.node) return
  padResize.node = null
  persist()
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
  const ok = outKind(n)
  wire.kind = ok === 'control' ? 'control' : ok === 'geometry' ? 'geometry' : 'video'
  wire.x = p.x
  wire.y = p.y
}
function endWire(n, port) {
  if (!wire.active || wire.from === n.id || wire.kind === 'control') return
  // geometry and image streams don't mix: a geometry out only feeds a geometry
  // in (the Camera), and an image out never lands on a geometry input
  const fromNode = nodes.find((x) => x.id === wire.from)
  if (fromNode && (outKind(fromNode) === 'geometry') !== (inKind(n, port) === 'geometry')) {
    wire.active = false
    return
  }
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
  // A per-node seed drives the sketch's generative variation; changing it
  // reloads the frame with a fresh look (the node's random seed input).
  const seed = n.params.seed ? `&seed=${encodeURIComponent(n.params.seed)}` : ''
  return s ? `${s.url}?capture=1&preview=1&quality=high&nomap=1${seed}${inputParams(settings)}` : ''
}
function randSeed() { return Math.floor(Math.random() * 1e9).toString(36) }
function randHex() { return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }
function stepQuant(lo, hi) { const step = (hi - lo) / 100 || 0.01; return +(lo + Math.round((Math.random() * (hi - lo)) / step) * step).toFixed(6) }
// Roll every exposed parameter of an effect/filter to a fresh value. Because
// changing the seed reloads the iframe (which re-announces its *default* values
// on ready), we can't just post the new values now — they'd be overwritten. So
// we also queue them through the same pendingEffects channel cues use, which
// re-applies them once the reloaded sketch announces ready.
function rollEffectParams(n) {
  const c = effectControls.get(n.id)
  if (!c?.schema || !Object.keys(c.schema).length) return
  const values = { ...c.values }
  for (const [name, spec] of Object.entries(c.schema)) {
    if (spec.type === 'action') continue
    if (spec.type === 'bool') values[name] = Math.random() < 0.5
    else if (spec.type === 'color') values[name] = randHex()
    else if (spec.type === 'select' && spec.options?.length) values[name] = spec.options[Math.floor(Math.random() * spec.options.length)]
    else if (typeof spec.min === 'number') values[name] = stepQuant(spec.min, spec.max)
  }
  effectControls.set(n.id, { ...c, values })
  for (const [k, v] of Object.entries(values)) postToEffect(n.id, { type: 'sketch:set-param', name: k, value: v })
  pendingEffects = { ...(pendingEffects || {}), [n.id]: { values, mappings: (c.mappings || []).map((m) => ({ ...m })), state: c.state ?? null } }
}
// The dice: reseed the generative content AND roll every exposed parameter to a
// fresh value, so one click gives a genuinely different look (not just a new RNG
// seed behind the same slider settings).
function reseedNode(n) {
  n.params.seed = randSeed()
  if (n.type === 'effect' || n.type === 'filter') rollEffectParams(n)
  persist()
}
function autoMap(n) {
  rtState.get(n.id)?.iframe?.contentWindow?.postMessage({ type: 'sketch:auto-map' }, '*')
}
function bindFrame(id, el) {
  if (el) st(id).iframe = el
}
// --- media node: shared camera + library playback -------------------------
const cameraOn = ref(sharedCameraOn())
const screenOn = ref(sharedScreenOn())
async function toggleScreen() {
  if (screenOn.value) {
    stopSharedScreen(); screenOn.value = false
    for (const s of rtState.values()) if (s.mediaWant === 'screen' && s.mediaEl?.srcObject) s.mediaEl.srcObject = null
  } else {
    try { await startSharedScreen(); screenOn.value = true } catch { showToast('Screen share cancelled') }
  }
}
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
  const want = p.mode === 'camera' ? 'camera' : p.mode === 'screen' ? 'screen' : `media:${p.mediaId}`
  if (s.mediaWant !== want) {
    s.mediaWant = want
    if (s.mediaEl) { try { s.mediaEl.pause?.() } catch {}; s.mediaEl.srcObject = null; s.mediaEl.removeAttribute('src'); s.mediaEl = null }
    if (p.mode === 'camera') {
      const v = document.createElement('video')
      v.muted = true; v.playsInline = true; v.autoplay = true
      s.mediaEl = v
      if (cameraOn.value) startSharedCamera().then((stream) => { v.srcObject = stream; v.play().catch(() => {}) }).catch(() => {})
    } else if (p.mode === 'screen') {
      const v = document.createElement('video')
      v.muted = true; v.playsInline = true; v.autoplay = true
      s.mediaEl = v
      const ss = sharedScreenStream(); if (ss) { v.srcObject = ss; v.play().catch(() => {}) }
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
  // screen share (re)started after the element was made, or ended — keep in sync
  if (p.mode === 'screen' && s.mediaEl) {
    const ss = sharedScreenStream()
    if (ss && s.mediaEl.srcObject !== ss) { s.mediaEl.srcObject = ss; s.mediaEl.play().catch(() => {}) }
    else if (!ss && s.mediaEl.srcObject) { s.mediaEl.srcObject = null }
    if (screenOn.value !== !!ss) screenOn.value = !!ss // reflect the picker's "Stop sharing"
  }
  return s.mediaEl
}

// Sprite image cache. The image lives in the shared media library (referenced
// by a small id) so cue snapshots and saved patches carry only the id, not a
// duplicated data-URL. A legacy inline `src` (from older saves) is still honored
// as a fallback. Reloads the <img> only when the resolved URL changes.
function spriteUrl(node) {
  const id = node.params.mediaId
  if (id != null) { const item = mediaById(id); if (item && item.kind === 'image') return item.url }
  return node.params.src || null // legacy inline data-URL
}
function spriteName(node) {
  const id = node.params.mediaId
  if (id != null) return mediaById(id)?.name || '(missing — reload the image)'
  return node.params.src ? 'embedded image' : ''
}
function spriteImg(node) {
  const s = st(node.id)
  const url = spriteUrl(node)
  if (s.spriteUrl !== url) {
    s.spriteUrl = url
    if (url) { const img = new Image(); img.src = url; s.spriteImg = img }
    else s.spriteImg = null
  }
  return s.spriteImg
}
// --- text-over-time (lyrics) sequencing ------------------------------------
// A Text node can march through a list of lines over time — plain lyrics or
// `[mm:ss]`-timecoded — advancing on a fixed cadence or on each detected beat,
// with an entrance/exit transition (fade / slide / rise / zoom / typewriter).
let beatCounter = 0   // ++ on every detected beat (drives 'advance on beat')
let lastBeatAt = 0    // seconds of the last beat, for the transition timing
function parseLyrics(str, lineDur) {
  const raw = String(str || '').split('\n').map((s) => s.trim()).filter(Boolean)
  if (!raw.length) return []
  let hasTC = false
  const entries = raw.map((line) => {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (m) { hasTC = true; return { t: (+m[1]) * 60 + parseFloat(m[2]), text: m[3] } }
    return { t: null, text: line }
  })
  if (hasTC) {
    let last = 0
    for (const e of entries) { if (e.t == null) e.t = last + lineDur; last = e.t }
    entries.sort((a, b) => a.t - b.t)
  } else {
    entries.forEach((e, i) => { e.t = i * lineDur })
  }
  return entries
}
function textSequence(node) {
  const p = node.params
  if (!p.seqMode || p.seqMode === 'off') return null
  const lineDur = p.lineDur ?? 3
  const entries = parseLyrics(p.lyrics, lineDur)
  if (!entries.length) return null
  const trans = p.transition || 'None'
  const td = Math.max(0.05, p.transDur ?? 0.4)
  const now = performance.now() / 1000
  let idx, tin, tout
  if (p.seqMode === 'beat') {
    idx = beatCounter % entries.length
    tin = Math.min(1, (now - lastBeatAt) / td)
    tout = 1
  } else {
    const total = entries[entries.length - 1].t + lineDur
    let clock = now
    if (p.loopSeq !== false && total > 0) clock %= total
    idx = 0
    for (let i = 0; i < entries.length; i++) { if (entries[i].t <= clock + 1e-4) idx = i; else break }
    const next = entries[idx + 1]
    const segEnd = next ? next.t : total
    tin = Math.min(1, (clock - entries[idx].t) / td)
    tout = Math.min(1, (segEnd - clock) / td)
  }
  const vis = Math.max(0, Math.min(tin, tout))
  const eio = (v) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 2)
  const inA = 1 - eio(tin), outA = 1 - eio(tout) // 1 while off-screen, 0 while settled
  let text = entries[idx].text, dx = 0, dy = 0, scale = 1, alpha = 1
  if (trans === 'Fade') alpha = vis
  else if (trans === 'Slide L') { dx = inA * 0.6 - outA * 0.6; alpha = vis }
  else if (trans === 'Slide R') { dx = -inA * 0.6 + outA * 0.6; alpha = vis }
  else if (trans === 'Rise') { dy = inA * 0.4 - outA * 0.4; alpha = vis }
  else if (trans === 'Drop') { dy = -inA * 0.4 + outA * 0.4; alpha = vis }
  else if (trans === 'Zoom') { scale = 0.4 + 0.6 * Math.min(1, tin); alpha = vis }
  else if (trans === 'Typewriter') { text = text.slice(0, Math.floor(text.length * Math.min(1, tin))); alpha = Math.min(1, tout) }
  return { text, dx, dy, scale, alpha }
}

function pickSpriteFile(node) {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = 'image/*'
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return
    const item = addMediaFile(f) // stored once in the shared media library
    node.params.mediaId = item.id
    delete node.params.src // drop any legacy inline data
    persist()
  }
  inp.click()
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
// Import from Google Photos via the Picker API (needs VITE_GOOGLE_CLIENT_ID).
// --- media ingest wizard ---------------------------------------------------
// One guided place to bring content in and drop the right node onto the graph:
// images/video (Media/Sprite), a URL, screen capture, Google Photos, a point
// cloud / LiDAR scan (Geometry), live map/satellite (Geodata) or 3D terrain.
const wizOpen = ref(false)
const wizHasGoogle = computed(() => googlePhotosConfigured())
function wizNode(type) { addNode(type); return nodes[nodes.length - 1] }
function wizUploadFiles() {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = 'image/*,video/*'; inp.multiple = true
  inp.onchange = () => {
    let first = null
    for (const f of inp.files) { const it = addMediaFile(f); if (!first) first = it }
    if (first) { const n = wizNode('media'); n.params.mode = 'library'; n.params.mediaId = first.id; persist(); showToast(`Added ${inp.files.length} file(s)`) }
    wizOpen.value = false
  }
  inp.click()
}
async function wizFromUrl() {
  const url = window.prompt('Paste an image or video URL:')
  if (!url) return
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(r.status)
    const blob = await r.blob()
    const name = (url.split('/').pop() || 'url-media').split('?')[0]
    const it = addMediaFile(new File([blob], name, { type: blob.type || 'image/png' }))
    const n = wizNode('media'); n.params.mode = 'library'; n.params.mediaId = it.id; persist()
    showToast('Imported from URL'); wizOpen.value = false
  } catch { showToast('URL import failed (the host may block cross-origin fetches)') }
}
// Live screen capture: create a Media node in 'screen' mode and start sharing.
async function wizScreenLive() {
  const n = wizNode('media'); n.params.mode = 'screen'; persist()
  wizOpen.value = false
  try { await startSharedScreen(); screenOn.value = true; showToast('Screen sharing') }
  catch { showToast('Screen share cancelled') }
}
// One-off still snapshot of a screen/window into the library.
async function wizScreenGrab() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    const v = document.createElement('video'); v.srcObject = stream; v.muted = true; await v.play()
    await new Promise((r) => setTimeout(r, 350))
    const cv = document.createElement('canvas'); cv.width = v.videoWidth || 1280; cv.height = v.videoHeight || 720
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height)
    stream.getTracks().forEach((t) => t.stop())
    cv.toBlob((bl) => { if (!bl) return; const it = addMediaFile(new File([bl], 'screen-grab.png', { type: 'image/png' })); const n = wizNode('media'); n.params.mode = 'library'; n.params.mediaId = it.id; persist(); showToast('Captured screen') })
    wizOpen.value = false
  } catch { showToast('Screen capture cancelled') }
}
function wizGoogle() { const n = wizNode('media'); n.params.mode = 'library'; importGooglePhotos(n); wizOpen.value = false }
function wizPointCloud() { const n = wizNode('geo'); n.params.source = 'Point cloud'; n.params.cloud = 'Imported'; persist(); importGeoPointFile(n); wizOpen.value = false }
function wizGeodata() { wizNode('geodata'); wizOpen.value = false }
function wizTerrain() { const n = wizNode('geo'); n.params.source = 'Terrain'; persist(); wizOpen.value = false }

async function importGooglePhotos(node) {
  try {
    const picks = await pickFromGooglePhotos((m) => { if (m) showToast(m + '…') })
    let first = null
    for (const p of picks) {
      const item = addMediaFile(new File([p.blob], p.name, { type: p.blob.type }))
      if (!first) first = item
    }
    if (first) { node.params.mode = 'library'; node.params.mediaId = first.id; persist() }
    showToast(picks.length ? `Added ${picks.length} from Google Photos` : 'Nothing selected')
  } catch (e) {
    showToast('Google Photos: ' + (e?.message || 'failed'))
  }
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

// --- per-node settings visibility -------------------------------------------
// Each node's controls body can be shown, hidden, or pinned. A single eye
// control on the head cycles: follows global (shown) → pinned (always shown) →
// hidden → follows. hideBody/pinBody live on the node so they persist and undo.
function bodyShown(n) { return !!n.pinBody || !n.hideBody }
function bodyEyeIcon(n) { return n.pinBody ? 'mdi-pin' : n.hideBody ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }
function bodyEyeTitle(n) {
  return n.pinBody ? 'Settings pinned — stay visible when others hide (click to hide)'
    : n.hideBody ? 'Settings hidden (click to show)'
      : 'Settings shown — click to pin them visible'
}
function cycleBody(n) {
  if (n.pinBody) { n.pinBody = false; n.hideBody = true }   // pinned → hidden
  else if (n.hideBody) { n.hideBody = false }               // hidden → follows/shown
  else { n.pinBody = true }                                 // shown → pinned
  persist(); nextTick(() => layoutTick.value++)
}
// A node counts as "modulated" when a control link drives one of its params, an
// effect has input mappings, or it is itself a control source you'd want to see.
function nodeModulated(n) {
  if (n.type === 'input' || n.type === 'xy' || n.type === 'tracker') return true
  if (links.some((l) => l.node === n.id)) return true
  const ec = effectControls.get(n.id)
  return !!(ec && ec.mappings && ec.mappings.length)
}
function hideAllBodies() { for (const n of nodes) if (!n.pinBody) n.hideBody = true; persist(); nextTick(() => layoutTick.value++) }
function showAllBodies() { for (const n of nodes) n.hideBody = false; persist(); nextTick(() => layoutTick.value++) }
function showModulatedBodies() { for (const n of nodes) if (!n.pinBody) n.hideBody = !nodeModulated(n); persist(); nextTick(() => layoutTick.value++) }

// Opening/closing the params panel shifts the param jacks below it, so nudge
// the control-wire geometry to re-measure after the DOM settles.
function toggleParams(id) {
  showParams.set(id, !showParams.get(id))
  nextTick(() => layoutTick.value++)
}
function onEffectMessage(e) {
  const d = e.data
  if (d?.type !== 'sketch:ready' && d?.type !== 'sketch:state') return
  for (const n of nodes) {
    if (n.type !== 'effect' && n.type !== 'filter') continue
    if (rtState.get(n.id)?.iframe?.contentWindow === e.source) {
      if (d.type === 'sketch:state') {
        // the sketch pushed serializable editor state (e.g. curve points) — keep
        // it so it saves with the patch/cue
        const c = effectControls.get(n.id)
        if (c) { c.state = d.state; persistSoon() }
      } else {
        effectControls.set(n.id, {
          schema: d.schema ?? {},
          values: { ...d.values },
          mappings: (d.mappings ?? []).map((m) => ({ ...m })),
          state: d.state ?? null,
        })
        // A cue being applied may be waiting to push this effect's saved params.
        if (pendingEffects) applyPendingEffects()
        // Natural-language adjective/colour mods waiting on this sketch's schema.
        if (nlPendingMods.has(n.id)) { applyNlMods(n.id, nlPendingMods.get(n.id)); nlPendingMods.delete(n.id) }
      }
      break
    }
  }
}
function postToEffect(id, msg) {
  rtState.get(id)?.iframe?.contentWindow?.postMessage(msg, '*')
}
// Effect sliders stream update:model-value on every drag frame, so coalesce the
// autosave write instead of hammering localStorage each pixel.
let persistTimer = 0
function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250) }
function setEffectParam(id, name, value) {
  effectControls.get(id).values[name] = value
  postToEffect(id, { type: 'sketch:set-param', name, value })
  persistSoon() // so the tweak survives a reload / autosave
}
// A curve editor (e.g. the Curves filter) edited the sketch's serializable state.
function onCurveEdit(id, curves) {
  const c = effectControls.get(id)
  if (!c) return
  c.state = { ...(c.state || {}), curves }
  postToEffect(id, { type: 'sketch:set-state', state: c.state })
  persistSoon()
}
function syncEffectMappings(id) {
  postToEffect(id, { type: 'sketch:set-mappings', mappings: effectControls.get(id).mappings })
  persist()
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
beat.onBeat(() => { pendingBeat = true; beatCounter++; lastBeatAt = performance.now() / 1000 })
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

// --- geometry space: mesh sources + a virtual Camera that rasterizes them ---
// Three.js loads on demand the first time a geometry/camera node renders, so the
// base app never pays for it. A Geometry node emits a mesh descriptor (shape,
// material, a vertex-space displacement standing in for a vertex shader); the
// Camera node collects the descriptors wired into it, builds/refreshes the
// meshes in a scene, and renders through a perspective camera into its frame.
let THREE = null
let threeReq = false
function ensureThree() {
  if (THREE || threeReq) return
  threeReq = true
  import('three').then((m) => { THREE = m }).catch(() => { threeReq = false })
}
let geoRenderer = null
function getRenderer() {
  if (!geoRenderer && THREE) {
    geoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    geoRenderer.setPixelRatio(1)
  }
  return geoRenderer
}
const GEO_SHAPES = ['Cube', 'Sphere', 'Torus', 'Icosahedron', 'Torus knot', 'Cone', 'Cylinder', 'Plane', 'Gaudí column']
const GEO_MATERIALS = ['Solid', 'Wireframe', 'Points', 'Normals']
function buildGeometry(shape, detail, geo) {
  const d = Math.max(0, Math.min(4, Math.round(detail ?? 2)))
  switch (shape) {
    case 'Sphere': return new THREE.SphereGeometry(1, 24 + d * 12, 16 + d * 8)
    case 'Torus': return new THREE.TorusGeometry(0.85, 0.34, 16 + d * 6, 40 + d * 16)
    case 'Icosahedron': return new THREE.IcosahedronGeometry(1.15, d)
    case 'Torus knot': return new THREE.TorusKnotGeometry(0.75, 0.26, 90 + d * 40, 12 + d * 4)
    case 'Cone': return new THREE.ConeGeometry(1, 1.8, 24 + d * 12, 3 + d * 3)
    case 'Cylinder': return new THREE.CylinderGeometry(0.8, 0.8, 1.7, 24 + d * 12, 2 + d * 2)
    case 'Plane': return new THREE.PlaneGeometry(2.2, 2.2, 12 + d * 10, 12 + d * 10)
    case 'Gaudí column': return buildGaudiColumn(d, geo?.flutes, geo?.twist, geo?.groove)
    default: return new THREE.BoxGeometry(1.5, 1.5, 1.5, 4 + d * 6, 4 + d * 6, 4 + d * 6)
  }
}
// A Gaudí column: sweep two fluted star profiles up a shaft, twisting each the
// opposite way, and keep their radial minimum (the intersection). Where the
// counter-twists cross, the flutes fold into the branching forms Gaudí used
// for the Sagrada Família. Centred on the origin and scaled to unit-ish size so
// it sits alongside the other Geometry-node shapes in the Camera.
function buildGaudiColumn(d, flutes, twist, groove) {
  const points = Math.max(3, Math.round(flutes ?? 8))
  const twRad = ((twist ?? 90) * Math.PI) / 180
  const depth = Math.max(0, groove ?? 0.28)
  const baseR = 0.72
  const half = 1.15 // column runs y = -half .. +half
  const radial = Math.max(32, points * (10 + d * 8))
  const rows = 40 + d * 40
  const mod = (n, m) => ((n % m) + m) % m
  const fluteR = (angle, tw) => baseR + Math.cos(mod(angle - tw, Math.PI * 2) * points) * depth
  const verts = [], uvs = []
  for (let yi = 0; yi <= rows; yi++) {
    const v = yi / rows
    const y = -half + v * (half * 2)
    const twA = v * twRad, twB = v * -twRad
    for (let ri = 0; ri <= radial; ri++) {
      const u = ri / radial
      const a = u * Math.PI * 2
      const r = Math.min(fluteR(a, twA), fluteR(a, twB)) // Gaudí intersection
      verts.push(Math.cos(a) * r, y, Math.sin(a) * r)
      uvs.push(u, v)
    }
  }
  const idx = [], stride = radial + 1
  for (let yi = 0; yi < rows; yi++) for (let ri = 0; ri < radial; ri++) {
    const aI = yi * stride + ri, bI = aI + 1, cI = (yi + 1) * stride + ri, dI = cI + 1
    idx.push(aI, bI, dI, aI, dI, cI)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
// HSV (h 0-360, s/v 0-100) → HSL fractions, for THREE.Color.setHSL and CSS.
// Colour nodes store H/S/V; the classic single-hue look is the default S/V.
function hsvToHsl(h, s, v) {
  const ss = (s ?? 72) / 100, vv = (v ?? 90) / 100
  const l = vv * (1 - ss / 2)
  const sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l)
  return { h: ((((h ?? 0) % 360) + 360) % 360) / 360, s: sl, l }
}
function hsvCss(h, s, v) { const c = hsvToHsl(h, s, v); return `hsl(${Math.round(c.h * 360)}, ${Math.round(c.s * 100)}%, ${Math.round(c.l * 100)}%)` }
function makeMaterial(material, hue, sat, val) {
  const c = hsvToHsl(hue ?? 160, sat, val)
  const col = new THREE.Color().setHSL(c.h, c.s, c.l)
  if (material === 'Wireframe') return new THREE.MeshBasicMaterial({ color: col, wireframe: true })
  if (material === 'Normals') return new THREE.MeshNormalMaterial({ flatShading: true })
  if (material === 'Points') return new THREE.PointsMaterial({ color: col, size: 0.045, sizeAttenuation: true })
  return new THREE.MeshStandardMaterial({ color: col, metalness: 0.25, roughness: 0.45 })
}
function buildObject(geo) {
  const g = buildGeometry(geo.shape, geo.detail, geo)
  if (!g.attributes.normal) g.computeVertexNormals()
  const base = Float32Array.from(g.attributes.position.array)
  const nrm = Float32Array.from(g.attributes.normal.array)
  const mat = makeMaterial(geo.material, geo.hue, geo.sat, geo.val)
  const obj = geo.material === 'Points' ? new THREE.Points(g, mat) : new THREE.Mesh(g, mat)
  obj.userData = { source: 'Shape', base, nrm, warped: false }
  return obj
}

// --- point cloud + voxel geometry sources ----------------------------------
const GEO_SOURCES = ['Shape', 'Point cloud', 'Voxel', 'Terrain']
const GEO_CLOUDS = ['Galaxy', 'Sphere', 'Torus', 'Terrain', 'Cube', 'Imported']
const GEO_VOXELS = ['Sphere', 'Terrain', 'Gyroid', 'Shell']
// Generate a procedural point cloud: {positions, colors} in unit-ish space,
// tinted from the node's hue by a per-point factor t (height/radius).
function genPointCloud(type, count, hue, sat, val) {
  const n = Math.max(200, Math.min(140000, Math.round(count || 8000)))
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
  const base = hsvToHsl(hue ?? 200, sat, val), c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0, t = 0.5
    if (type === 'Sphere') {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), rr = 1.1 * (0.92 + Math.random() * 0.1)
      x = Math.cos(a) * r * rr; y = u * rr; z = Math.sin(a) * r * rr; t = (u + 1) / 2
    } else if (type === 'Torus') {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2, R = 0.85, rr = 0.35
      x = (R + rr * Math.cos(b)) * Math.cos(a); y = rr * Math.sin(b); z = (R + rr * Math.cos(b)) * Math.sin(a); t = (Math.sin(b) + 1) / 2
    } else if (type === 'Terrain') {
      x = (Math.random() * 2 - 1) * 1.4; z = (Math.random() * 2 - 1) * 1.4
      y = (Math.sin(x * 2.3) * Math.cos(z * 2.1) + Math.sin(x * 5 + z * 3) * 0.4) * 0.35; t = y + 0.5
    } else if (type === 'Cube') {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; t = (y + 1) / 2
    } else { // Galaxy
      const arm = Math.floor(Math.random() * 3), rad = Math.pow(Math.random(), 0.6) * 1.4
      const ang = rad * 3.4 + arm * (Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.5
      x = Math.cos(ang) * rad; z = Math.sin(ang) * rad; y = (Math.random() - 0.5) * 0.14 * (1.3 - rad); t = 1 - rad / 1.4
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
    c.setHSL(base.h, base.s, Math.min(0.88, base.l * (0.45 + t * 0.9)))
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  return { positions: pos, colors: col }
}
function buildPointsObject(geo) {
  const data = geo.cloudData || genPointCloud(geo.cloud, geo.count, geo.hue, geo.sat, geo.val)
  const g = new THREE.BufferGeometry()
  const positions = Float32Array.from(data.positions)
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (data.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(Float32Array.from(data.colors), 3))
  const mat = new THREE.PointsMaterial({ size: geo.pointSize || 0.03, sizeAttenuation: true, vertexColors: !!data.colors })
  if (!data.colors) { const cc = hsvToHsl(geo.hue, geo.sat, geo.val); mat.color.setHSL(cc.h, cc.s, cc.l) }
  const obj = new THREE.Points(g, mat)
  // radial "normals" so the displace warp still works on a cloud
  const nrm = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) { const l = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1; nrm[i] = positions[i] / l; nrm[i + 1] = positions[i + 1] / l; nrm[i + 2] = positions[i + 2] / l }
  obj.userData = { source: 'Point cloud', base: positions, nrm, warped: false }
  return obj
}
// Voxel grid → one InstancedMesh of little cubes, coloured by height.
function genVoxels(type, res) {
  const N = Math.max(6, Math.min(46, Math.round(res || 18)))
  const cells = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = i / (N - 1) * 2 - 1, y = j / (N - 1) * 2 - 1, z = k / (N - 1) * 2 - 1
    let fill = false
    if (type === 'Terrain') { fill = y < (Math.sin(x * 2.5) * Math.cos(z * 2.3)) * 0.42 }
    else if (type === 'Gyroid') { const g = Math.sin(x * 3) * Math.cos(y * 3) + Math.sin(y * 3) * Math.cos(z * 3) + Math.sin(z * 3) * Math.cos(x * 3); fill = Math.abs(g) < 0.55 }
    else if (type === 'Shell') { const r = x * x + y * y + z * z; fill = r < 0.85 && r > 0.5 }
    else fill = (x * x + y * y + z * z) < 0.85 // Sphere
    if (fill) cells.push(x, y, z)
  }
  return { cells: Float32Array.from(cells), N }
}
function buildVoxelObject(geo) {
  const { cells, N } = genVoxels(geo.voxel, geo.res)
  const count = cells.length / 3
  const size = (2 / N) * 0.9
  const box = new THREE.BoxGeometry(size, size, size)
  const mat = new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.6 })
  const inst = new THREE.InstancedMesh(box, mat, Math.max(1, count))
  const m = new THREE.Matrix4(), c = new THREE.Color(), base = hsvToHsl(geo.hue, geo.sat, geo.val)
  for (let i = 0; i < count; i++) {
    const x = cells[i * 3], y = cells[i * 3 + 1], z = cells[i * 3 + 2]
    m.makeTranslation(x, y, z); inst.setMatrixAt(i, m)
    c.setHSL(base.h, base.s, Math.min(0.85, base.l * (0.5 + (y + 1) / 2 * 0.7))); inst.setColorAt(i, c)
  }
  inst.instanceMatrix.needsUpdate = true
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true
  inst.userData = { source: 'Voxel', warped: false }
  return inst
}
// Rebuild signature: any change here rebuilds the object in the camera. Point
// clouds and voxels bake their colours/size into the geometry, so those are part
// of their signature; a plain Shape updates colour live and leaves them out.
function geoSig(geo) {
  const baked = geo.source === 'Shape' ? '' : `${geo.hue}/${geo.sat}/${geo.val}/${geo.pointSize}/${geo.verticalScale}`
  return [geo.source, geo.shape, geo.material, geo.detail, geo.flutes, geo.twist, geo.groove, geo.cloud, geo.voxel, geo.count, geo.res, geo.dataVer, baked].join('|')
}
function buildGeoObject(geo) {
  let obj
  if (geo.source === 'Point cloud') obj = buildPointsObject(geo)
  else if (geo.source === 'Voxel') obj = buildVoxelObject(geo)
  else if (geo.source === 'Terrain') obj = buildTerrainObject(geo)
  else obj = buildObject(geo)
  obj.userData.sig = geoSig(geo)
  return obj
}
// --- 3D terrain from public elevation (DEM) tiles --------------------------
function loadCorsImage(url) { return new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url }) }
function terrainTileUrl(z, x, y) {
  const key = settings.mapKey, prov = settings.mapProvider
  if (key && prov === 'mapbox') return `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${key}`
  if (key && prov === 'maptiler') return `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${key}`
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` // free, CORS-enabled
}
function decodeElev(r, g, b) {
  if (settings.mapKey && (settings.mapProvider === 'mapbox' || settings.mapProvider === 'maptiler')) return -10000 + (r * 65536 + g * 256 + b) * 0.1 // terrain-RGB
  return (r * 256 + g + b / 256) - 32768 // Terrarium
}
function sampleTile(img, N) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, 256, 256)
  try { return cx.getImageData(0, 0, 256, 256).data } catch { return null }
}
// Fetch one DEM tile for the node's lat/lon/zoom, decode a heightfield, and
// (optionally) drape the matching satellite tile as vertex colours.
async function fetchTerrain(node, sig) {
  const p = node.params
  const z = Math.max(1, Math.min(14, Math.round(p.zoom ?? 11)))
  const x = Math.floor(lonToTileX(p.lon ?? 8, z)), y = Math.floor(latToTileY(p.lat ?? 46.5, z))
  const dem = await loadCorsImage(terrainTileUrl(z, x, y))
  if (!dem) { st(node.id).terrainErr = true; return }
  const demData = sampleTile(dem); if (!demData) { st(node.id).terrainErr = true; return }
  const N = Math.max(16, Math.min(180, Math.round(p.terrainRes ?? 96)))
  const heights = new Float32Array(N * N)
  let minH = Infinity, maxH = -Infinity
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const px = Math.round(i / (N - 1) * 255), py = Math.round(j / (N - 1) * 255), o = (py * 256 + px) * 4
    const h = decodeElev(demData[o], demData[o + 1], demData[o + 2]); heights[j * N + i] = h
    if (h < minH) minH = h; if (h > maxH) maxH = h
  }
  let colors = null
  if (p.drape) {
    const sat = await loadCorsImage(mapTileUrl('Satellite', z, x, y))
    const sd = sat && sampleTile(sat)
    if (sd) { colors = new Float32Array(N * N * 3); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const px = Math.round(i / (N - 1) * 255), py = Math.round(j / (N - 1) * 255), o = (py * 256 + px) * 4, k = (j * N + i) * 3; colors[k] = sd[o] / 255; colors[k + 1] = sd[o + 1] / 255; colors[k + 2] = sd[o + 2] / 255 } }
  }
  st(node.id).terrain = { ready: true, N, heights, minH, maxH, colors, sig }
  node.params.dataVer = (node.params.dataVer || 0) + 1
  persist()
}
function buildTerrainObject(geo) {
  const T = geo.terrainData
  const N = T?.ready ? T.N : 24
  const g = new THREE.PlaneGeometry(2.6, 2.6, N - 1, N - 1)
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position
  const vscale = geo.verticalScale ?? 0.6
  const base = hsvToHsl(geo.hue, geo.sat, geo.val), c = new THREE.Color()
  const col = new Float32Array(pos.count * 3)
  if (T?.ready) {
    const range = (T.maxH - T.minH) || 1
    for (let i = 0; i < pos.count; i++) {
      const nh = (T.heights[i] - T.minH) / range
      pos.setY(i, (nh - 0.4) * vscale * 1.4)
      if (T.colors) { col[i * 3] = T.colors[i * 3]; col[i * 3 + 1] = T.colors[i * 3 + 1]; col[i * 3 + 2] = T.colors[i * 3 + 2] }
      else { c.setHSL(base.h, base.s, 0.22 + nh * 0.62); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    }
    pos.needsUpdate = true
  } else {
    for (let i = 0; i < pos.count; i++) { c.setHSL(base.h, base.s, 0.35); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
  }
  g.computeVertexNormals()
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.95 })
  const obj = new THREE.Mesh(g, mat)
  obj.userData = { source: 'Terrain', base: Float32Array.from(pos.array), nrm: Float32Array.from(g.attributes.normal.array), warped: false }
  return obj
}
// Parse an imported .ply (ASCII) or .xyz point file → {positions, colors},
// centred and scaled to fit the unit-ish view.
function parsePointFile(text) {
  const lines = text.split(/\r?\n/)
  const xs = [], cs = []
  let hasColor = false
  if (/^ply\b/i.test(text.trimStart())) {
    let i = 0, count = 0, props = []
    for (; i < lines.length; i++) {
      const l = lines[i].trim()
      if (/^element\s+vertex\s+(\d+)/i.test(l)) count = +RegExp.$1
      else if (/^property\s+\S+\s+(\S+)/i.test(l)) props.push(RegExp.$1.toLowerCase())
      else if (/^end_header/i.test(l)) { i++; break }
    }
    const ix = props.indexOf('x'), iy = props.indexOf('y'), iz = props.indexOf('z')
    const ir = props.findIndex((p) => p === 'red' || p === 'r'), ig = props.findIndex((p) => p === 'green' || p === 'g'), ib = props.findIndex((p) => p === 'blue' || p === 'b')
    hasColor = ir >= 0 && ig >= 0 && ib >= 0
    for (let k = 0; k < count && i < lines.length; k++, i++) {
      const t = lines[i].trim().split(/\s+/).map(Number); if (t.length < 3) continue
      xs.push(t[ix], t[iy], t[iz])
      if (hasColor) cs.push(t[ir] / 255, t[ig] / 255, t[ib] / 255)
    }
  } else {
    for (const l of lines) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const v = t.split(/[\s,]+/).map(Number); if (v.length < 3 || v.some((x) => !isFinite(x))) continue
      xs.push(v[0], v[1], v[2])
      if (v.length >= 6) { hasColor = true; const s = v[3] > 1 ? 255 : 1; cs.push(v[3] / s, v[4] / s, v[5] / s) }
    }
  }
  const n = xs.length / 3
  if (n < 1) return null
  // centre + uniform scale to ~[-1.2,1.2]
  let cx = 0, cy = 0, cz = 0, mx = 0
  for (let i = 0; i < xs.length; i += 3) { cx += xs[i]; cy += xs[i + 1]; cz += xs[i + 2] }
  cx /= n; cy /= n; cz /= n
  for (let i = 0; i < xs.length; i += 3) { mx = Math.max(mx, Math.hypot(xs[i] - cx, xs[i + 1] - cy, xs[i + 2] - cz)) }
  const sc = mx > 0 ? 1.2 / mx : 1
  const pos = new Float32Array(xs.length)
  for (let i = 0; i < xs.length; i += 3) { pos[i] = (xs[i] - cx) * sc; pos[i + 1] = (xs[i + 1] - cy) * sc; pos[i + 2] = (xs[i + 2] - cz) * sc }
  return { positions: pos, colors: hasColor ? Float32Array.from(cs) : null, count: n }
}
// Colour a point by normalised height: teal → green → tan → snow.
function heightRamp(t) {
  t = Math.max(0, Math.min(1, t))
  const stops = [[0.08, 0.22, 0.36], [0.16, 0.5, 0.4], [0.55, 0.56, 0.33], [0.92, 0.92, 0.88]]
  const f = t * (stops.length - 1), i = Math.floor(f), u = f - i
  const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}
// Native parser for LAS (LASF) point clouds — the standard uncompressed LiDAR
// format. Reads point formats 0–10 (X/Y/Z always at the record start; RGB where
// the format carries it), applies the header scale/offset, remaps LAS z-up to
// three.js y-up, subsamples very large files, and colours by height when the
// scan has no RGB. LAZ (compressed) is detected and reported separately.
function parseLas(buf) {
  const dv = new DataView(buf)
  if (dv.getUint8(0) !== 0x4C || dv.getUint8(1) !== 0x41 || dv.getUint8(2) !== 0x53 || dv.getUint8(3) !== 0x46) return { err: 'not-las' }
  const verMinor = dv.getUint8(25)
  const offsetToPts = dv.getUint32(96, true)
  const fmtByte = dv.getUint8(104)
  if (fmtByte & 0xC0) return { err: 'laz' } // high bits set → LAZ compressed
  const fmt = fmtByte & 0x3f
  const recLen = dv.getUint16(105, true)
  let numPts = dv.getUint32(107, true)
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true)
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true)
  if (verMinor >= 4) { try { const n64 = dv.getBigUint64(247, true); if (n64 > 0n) numPts = Number(n64) } catch { /* keep legacy count */ } }
  if (!numPts || !recLen) return { err: 'empty' }
  const rgbOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt]
  const cap = 2_500_000
  const stride = numPts > cap ? Math.ceil(numPts / cap) : 1
  const outMax = Math.floor((numPts + stride - 1) / stride)
  const xs = new Float64Array(outMax * 3)
  const cs = rgbOff != null ? new Float32Array(outMax * 3) : null
  let w = 0
  for (let i = 0; i < numPts; i += stride) {
    const base = offsetToPts + i * recLen
    if (base + 12 > buf.byteLength) break
    const X = dv.getInt32(base, true) * sx + ox
    const Y = dv.getInt32(base + 4, true) * sy + oy
    const Z = dv.getInt32(base + 8, true) * sz + oz
    xs[w * 3] = X; xs[w * 3 + 1] = Z; xs[w * 3 + 2] = -Y // LAS z-up → three y-up
    if (cs) { const ro = base + rgbOff; const r = dv.getUint16(ro, true), g = dv.getUint16(ro + 2, true), b = dv.getUint16(ro + 4, true); const d = (r > 255 || g > 255 || b > 255) ? 65535 : 255; cs[w * 3] = r / d; cs[w * 3 + 1] = g / d; cs[w * 3 + 2] = b / d }
    w++
  }
  if (!w) return { err: 'empty' }
  return finalizePoints(xs.subarray(0, w * 3), w, cs ? cs.subarray(0, w * 3) : null)
}
// Centre + uniformly scale raw points to fit the view; colour by height when no
// per-point RGB is supplied. Shared by the LAS and LAZ decoders.
function finalizePoints(xs, w, colorsIn) {
  let cx = 0, cy = 0, cz = 0, mx = 0
  for (let i = 0; i < w * 3; i += 3) { cx += xs[i]; cy += xs[i + 1]; cz += xs[i + 2] }
  cx /= w; cy /= w; cz /= w
  for (let i = 0; i < w * 3; i += 3) mx = Math.max(mx, Math.hypot(xs[i] - cx, xs[i + 1] - cy, xs[i + 2] - cz))
  const scl = mx > 0 ? 1.2 / mx : 1
  const pos = new Float32Array(w * 3)
  for (let i = 0; i < w * 3; i += 3) { pos[i] = (xs[i] - cx) * scl; pos[i + 1] = (xs[i + 1] - cy) * scl; pos[i + 2] = (xs[i + 2] - cz) * scl }
  let colors = colorsIn ? Float32Array.from(colorsIn) : null
  if (!colors) { // no RGB → colour by height
    colors = new Float32Array(w * 3)
    let ymin = Infinity, ymax = -Infinity
    for (let i = 1; i < w * 3; i += 3) { if (pos[i] < ymin) ymin = pos[i]; if (pos[i] > ymax) ymax = pos[i] }
    const yr = (ymax - ymin) || 1
    for (let i = 0; i < w * 3; i += 3) { const c = heightRamp((pos[i + 1] - ymin) / yr); colors[i] = c[0]; colors[i + 1] = c[1]; colors[i + 2] = c[2] }
  }
  return { positions: pos, colors, count: w }
}
function importGeoPointFile(node) {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = '.ply,.xyz,.pts,.txt,.las,.laz'
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return
    const isLaz = /\.laz$/i.test(f.name), isLas = /\.las$/i.test(f.name)
    const binary = isLaz || isLas
    const reader = new FileReader()
    reader.onload = async () => {
      let data
      try {
        if (isLaz) {
          showToast('Decompressing LAZ…')
          const { decodeLaz } = await import('../lib/laz.js')
          const raw = await decodeLaz(reader.result)
          if (!raw || !raw.count) { showToast('Could not decode that LAZ file'); return }
          data = finalizePoints(raw.xs, raw.count, raw.colors)
        } else if (isLas) {
          const res = parseLas(reader.result)
          if (!res || res.err || !res.count) { showToast('Could not read that LAS file'); return }
          data = res
        } else {
          data = parsePointFile(String(reader.result))
        }
      } catch (e) { showToast('Point import failed: ' + (e?.message || e)); return }
      if (!data || !data.count) { showToast('No points found in that file'); return }
      st(node.id).cloudData = data
      node.params.source = 'Point cloud'; node.params.cloud = 'Imported'
      node.params.dataVer = (node.params.dataVer || 0) + 1
      persist(); showToast(`Loaded ${data.count.toLocaleString()} points`)
    }
    reader.onerror = () => showToast('Could not read the file')
    if (binary) reader.readAsArrayBuffer(f); else reader.readAsText(f)
  }
  inp.click()
}
function disposeObject(obj) {
  obj.geometry?.dispose?.()
  obj.material?.dispose?.()
}
function updateObject(obj, geo, time) {
  const spin = geo.spin ?? 0.5
  obj.rotation.y = time * spin * 0.6
  obj.rotation.x = time * spin * 0.25 + 0.3
  // Voxels (InstancedMesh) and vertex/instance-coloured objects keep their own
  // colours; only override a single-colour material's colour, and only warp
  // objects that carry per-vertex base positions (shapes + point clouds).
  if (obj.isInstancedMesh) return
  if (obj.material.color && !obj.material.vertexColors) { const c = hsvToHsl(geo.hue ?? 160, geo.sat, geo.val); obj.material.color.setHSL(c.h, c.s, c.l) }
  const base = obj.userData.base, nrm = obj.userData.nrm
  if (!base || !nrm) return
  const isSolid = geo.source === 'Shape' && geo.material === 'Solid'
  // the "vertex shader": push every vertex along its normal by a travelling wave
  // of its base position, so the mesh warps in geometry space each frame
  const amp = geo.displace ?? 0
  const g = obj.geometry
  const pos = g.attributes.position
  if (amp < 0.001) {
    if (obj.userData.warped) {
      pos.array.set(base); pos.needsUpdate = true; obj.userData.warped = false
      if (isSolid) g.computeVertexNormals()
    }
  } else {
    const f = geo.freq ?? 2
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3
      const bx = base[ix], by = base[ix + 1], bz = base[ix + 2]
      const w = Math.sin(bx * f + time) * Math.cos(by * f * 1.3 - time * 0.8) * Math.sin(bz * f * 0.7 + time * 1.1)
      const sc = amp * 0.55 * w
      pos.array[ix] = bx + nrm[ix] * sc
      pos.array[ix + 1] = by + nrm[ix + 1] * sc
      pos.array[ix + 2] = bz + nrm[ix + 2] * sc
    }
    pos.needsUpdate = true
    obj.userData.warped = true
    if (isSolid) g.computeVertexNormals()
  }
}
// Cheap wireframe skeletons (verts + edge index pairs) for the Geometry node's
// 2D thumbnail — one per shape so the preview matches the selected shape. Cached
// per shape since evalGeo runs every frame; the real 3D render is at the Camera.
const geoWireCache = new Map()
function geoWire(shape) {
  if (geoWireCache.has(shape)) return geoWireCache.get(shape)
  const V = [], E = []
  const ringEdges = (idx) => { for (let i = 0; i < idx.length; i++) E.push([idx[i], idx[(i + 1) % idx.length]]) }
  const circle = (n, rad, y) => { const idx = []; for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; idx.push(V.length); V.push([Math.cos(a) * rad, y, Math.sin(a) * rad]) } return idx }
  if (shape === 'Sphere') {
    const nlat = 4, nlon = 8, top = V.length; V.push([0, 1, 0]); const bot = V.length; V.push([0, -1, 0])
    const grid = []
    for (let i = 1; i < nlat; i++) { const phi = (Math.PI * i) / nlat, y = Math.cos(phi), r = Math.sin(phi); grid.push(circle(nlon, r, y)) }
    for (const row of grid) ringEdges(row)
    for (let j = 0; j < nlon; j++) { E.push([top, grid[0][j]]); for (let i = 0; i < grid.length - 1; i++) E.push([grid[i][j], grid[i + 1][j]]); E.push([grid[grid.length - 1][j], bot]) }
  } else if (shape === 'Icosahedron') {
    const t = 1.618033988749
    const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    for (const v of raw) { const L = Math.hypot(v[0], v[1], v[2]); V.push([(v[0] / L) * 1.15, (v[1] / L) * 1.15, (v[2] / L) * 1.15]) }
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const dx = V[i][0] - V[j][0], dy = V[i][1] - V[j][1], dz = V[i][2] - V[j][2]
      if (dx * dx + dy * dy + dz * dz < 1.6) E.push([i, j])
    }
  } else if (shape === 'Torus') {
    const Rr = 0.85, tr = 0.34, nu = 12, nv = 6, grid = []
    for (let i = 0; i < nu; i++) { const u = (2 * Math.PI * i) / nu, row = []; for (let j = 0; j < nv; j++) { const vv = (2 * Math.PI * j) / nv, cr = Rr + tr * Math.cos(vv); row.push(V.length); V.push([cr * Math.cos(u), tr * Math.sin(vv), cr * Math.sin(u)]) } grid.push(row) }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { E.push([grid[i][j], grid[(i + 1) % nu][j]]); E.push([grid[i][j], grid[i][(j + 1) % nv]]) }
  } else if (shape === 'Torus knot') {
    const p = 2, q = 3, n = 48, idx = []
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, r = 0.6 + 0.28 * Math.cos(q * a); idx.push(V.length); V.push([r * Math.cos(p * a), 0.3 * Math.sin(q * a), r * Math.sin(p * a)]) }
    ringEdges(idx)
  } else if (shape === 'Cone') {
    const apex = V.length; V.push([0, 1.1, 0]); const idx = circle(12, 1, -0.7); ringEdges(idx)
    for (let i = 0; i < idx.length; i += 2) E.push([apex, idx[i]])
  } else if (shape === 'Cylinder') {
    const top = circle(12, 0.8, 0.85), bot = circle(12, 0.8, -0.85); ringEdges(top); ringEdges(bot)
    for (let i = 0; i < top.length; i += 2) E.push([top[i], bot[i]])
  } else if (shape === 'Plane') {
    const n = 4, s = 1.1, grid = []
    for (let i = 0; i <= n; i++) { const row = []; for (let j = 0; j <= n; j++) { row.push(V.length); V.push([(j / n * 2 - 1) * s, (i / n * 2 - 1) * s, 0]) } grid.push(row) }
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { if (j < n) E.push([grid[i][j], grid[i][j + 1]]); if (i < n) E.push([grid[i][j], grid[i + 1][j]]) }
  } else if (shape === 'Gaudí column') {
    // a few stacked counter-twisted fluted rings sketch the intersected column
    const pts = 8, nring = 6, nu = 16, half = 1.05, baseR = 0.72, depth = 0.26, tw = Math.PI / 2
    const mod = (x, m) => ((x % m) + m) % m
    const grid = []
    for (let i = 0; i < nring; i++) {
      const v = i / (nring - 1), y = -half + v * half * 2, tA = v * tw, tB = v * -tw, ring = []
      for (let j = 0; j < nu; j++) {
        const a = (2 * Math.PI * j) / nu
        const r = Math.min(baseR + Math.cos(mod(a - tA, Math.PI * 2) * pts) * depth, baseR + Math.cos(mod(a - tB, Math.PI * 2) * pts) * depth)
        ring.push(V.length); V.push([Math.cos(a) * r, y, Math.sin(a) * r])
      }
      grid.push(ring)
    }
    for (const ring of grid) ringEdges(ring)
    for (let i = 0; i < nring - 1; i++) for (let j = 0; j < nu; j++) E.push([grid[i][j], grid[i + 1][j]])
  } else {
    V.push([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1])
    E.push([0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7])
  }
  const w = { V, E }
  geoWireCache.set(shape, w)
  return w
}
function drawGeoGlyph(ctx, ang, hue, warp, shape, sat, val) {
  const cx = W / 2, cy = H * 0.44, R = Math.min(W, H) * 0.26
  const { V, E } = geoWire(shape)
  const ca = Math.cos(ang), sa = Math.sin(ang), cb = Math.cos(ang * 0.6), sb = Math.sin(ang * 0.6)
  const proj = V.map(([x, y, z]) => {
    let X = x * ca - z * sa, Z = x * sa + z * ca
    let Y = y * cb - Z * sb; Z = y * sb + Z * cb
    const wob = 1 + warp * 0.3 * Math.sin(ang * 3 + x + y + z)
    const s = 2.6 / (Z + 3.2)
    return [cx + X * R * s * wob, cy + Y * R * s * wob]
  })
  ctx.strokeStyle = hsvCss(hue, sat, val)
  ctx.lineWidth = Math.max(1.2, Math.min(W, H) * 0.006)
  ctx.beginPath()
  for (const [a, b] of E) { ctx.moveTo(proj[a][0], proj[a][1]); ctx.lineTo(proj[b][0], proj[b][1]) }
  ctx.stroke()
}
function evalGeo(node, octx) {
  const p = node.params
  const rs = st(node.id)
  // Terrain: (re)fetch the DEM (+ optional satellite drape) when the place or
  // settings change; the heightfield mesh rebuilds once dataVer bumps.
  if (p.source === 'Terrain') {
    const tsig = [p.lat, p.lon, p.zoom, p.terrainRes, p.drape ? 1 : 0, settings.mapKey ? settings.mapProvider : 'free'].join(',')
    if (rs.terrainSig !== tsig) { rs.terrainSig = tsig; rs.terrainErr = false; fetchTerrain(node, tsig) }
  }
  rs.geo = {
    shape: p.shape, material: p.material, hue: p.hue, sat: p.sat, val: p.val, displace: p.displace, freq: p.freq, spin: p.spin, detail: p.detail, flutes: p.flutes, twist: p.twist, groove: p.groove,
    source: p.source ?? 'Shape', cloud: p.cloud, voxel: p.voxel, count: p.count, res: p.res, pointSize: p.pointSize, dataVer: p.dataVer, verticalScale: p.verticalScale,
    cloudData: (p.source === 'Point cloud' && p.cloud === 'Imported') ? rs.cloudData : null,
    terrainData: (p.source === 'Terrain') ? rs.terrain : null,
  }
  const t = performance.now() * 0.001
  octx.fillStyle = '#0a0e14'
  octx.fillRect(0, 0, W, H)
  drawGeoGlyph(octx, t * (0.4 + (p.spin ?? 0.5) * 0.6), p.hue ?? 160, p.displace ?? 0, p.shape ?? 'Box', p.sat, p.val)
  octx.fillStyle = 'rgba(230,240,255,0.85)'
  octx.font = `${Math.round(H * 0.07)}px system-ui, sans-serif`
  octx.textAlign = 'center'
  const label = (p.source === 'Point cloud') ? `Point cloud · ${p.cloud}` : (p.source === 'Voxel') ? `Voxel · ${p.voxel}` : `${p.shape} · ${p.material}`
  octx.fillText(label, W / 2, H * 0.9)
}
function evalCamera(node, octx) {
  const s = st(node.id)
  if (!THREE) {
    ensureThree()
    octx.fillStyle = '#0a0e14'; octx.fillRect(0, 0, W, H)
    octx.fillStyle = 'rgba(230,240,255,0.7)'
    octx.font = `${Math.round(H * 0.06)}px system-ui, sans-serif`
    octx.textAlign = 'center'
    octx.fillText('loading 3D…', W / 2, H / 2)
    return
  }
  const renderer = getRenderer()
  if (!renderer) return
  let three = s.three
  if (!three) {
    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(55, W / H, 0.1, 100)
    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(3, 4, 5); scene.add(key)
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5); rim.position.set(-4, -2, -3); scene.add(rim)
    const amb = new THREE.AmbientLight(0xffffff, 0.38); scene.add(amb)
    three = s.three = { scene, cam, key, rim, amb, meshes: new Map() }
  }
  const p = node.params
  const time = performance.now() * 0.001
  // collect the geometry wired into this camera, keyed by its source node id
  const inputs = []
  for (const e of edges) if (e.to === node.id) { const g = rtState.get(e.from)?.geo; if (g) inputs.push({ id: e.from, geo: g }) }
  const want = new Set(inputs.map((i) => i.id))
  for (const [id, obj] of three.meshes) if (!want.has(id)) { three.scene.remove(obj); disposeObject(obj); three.meshes.delete(id) }
  inputs.forEach(({ id, geo }, idx) => {
    let obj = three.meshes.get(id)
    if (!obj || obj.userData.sig !== geoSig(geo)) {
      if (obj) { three.scene.remove(obj); disposeObject(obj) }
      obj = buildGeoObject(geo); three.meshes.set(id, obj); three.scene.add(obj)
    }
    updateObject(obj, geo, time)
    obj.position.x = (idx - (inputs.length - 1) / 2) * 2.7
  })
  const dist = p.distance ?? 4.5
  const orbit = p.spin === false ? (node._orbit ?? 0) : (node._orbit = (node._orbit ?? 0) + (p.orbit ?? 0) * 0.016)
  three.cam.position.set(Math.sin(orbit) * dist, (p.tilt ?? 0.35) * dist, Math.cos(orbit) * dist)
  three.cam.lookAt(0, 0, 0)
  three.cam.fov = p.fov ?? 55
  three.cam.aspect = W / H
  three.cam.updateProjectionMatrix()
  { const c = hsvToHsl(p.lightHue ?? 40, p.lightSat ?? 34, p.lightVal ?? 86); three.key.color.setHSL(c.h, c.s, c.l) }
  const rw = Math.min(W, 1280), rh = Math.max(1, Math.round((rw * H) / W))
  renderer.setSize(rw, rh, false)
  const transparent = p.bg === 'Transparent'
  renderer.setClearColor(0x05070c, transparent ? 0 : 1)
  renderer.render(three.scene, three.cam)
  if (transparent) octx.clearRect(0, 0, W, H)
  else { octx.fillStyle = '#05070c'; octx.fillRect(0, 0, W, H) }
  cover(octx, renderer.domElement, renderer.domElement.width, renderer.domElement.height)
}

// --- Geodata: live slippy-map / satellite tiles as a 2D image source --------
const GEO_LAYERS = ['Streets', 'Satellite', 'Topographic', 'Dark']
const geoTileCache = new Map() // url -> { img, ok, err }
function getMapTile(url) {
  let e = geoTileCache.get(url)
  if (!e) {
    e = { img: new Image(), ok: false, err: false }
    e.img.crossOrigin = 'anonymous'
    e.img.onload = () => { e.ok = true }
    e.img.onerror = () => { e.err = true }
    e.img.src = url
    geoTileCache.set(url, e)
    if (geoTileCache.size > 500) { const k = geoTileCache.keys().next().value; geoTileCache.delete(k) }
  }
  return e
}
const lonToTileX = (lon, z) => (lon + 180) / 360 * (2 ** z)
const latToTileY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (2 ** z) }
// Tile URL: free no-key public sources by default; a MapTiler/Mapbox key
// (Settings) upgrades the imagery. Note Esri uses {z}/{y}/{x} order.
function mapTileUrl(layer, z, x, y) {
  const key = settings.mapKey, prov = settings.mapProvider
  if (key && prov === 'maptiler') {
    const set = layer === 'Satellite' ? 'satellite-v2' : layer === 'Topographic' ? 'outdoor-v2' : layer === 'Dark' ? 'streets-v2-dark' : 'streets-v2'
    const ext = layer === 'Satellite' ? 'jpg' : 'png'
    return `https://api.maptiler.com/maps/${set}/${z}/${x}/${y}.${ext}?key=${key}`
  }
  if (key && prov === 'mapbox') {
    const set = layer === 'Satellite' ? 'mapbox.satellite' : 'mapbox.mapbox-streets-v8'
    if (layer === 'Satellite') return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${key}`
    const style = layer === 'Dark' ? 'dark-v11' : layer === 'Topographic' ? 'outdoors-v12' : 'streets-v12'
    return `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/${z}/${x}/${y}@2x?access_token=${key}`
  }
  // free defaults
  if (layer === 'Satellite') return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
  if (layer === 'Topographic') return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`
  if (layer === 'Dark') return `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
  return `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`
}
function drawGeodata(node, octx) {
  const p = node.params
  const z = Math.max(1, Math.min(19, Math.round(p.zoom ?? 12)))
  const n2 = 2 ** z
  const now = performance.now()
  const dt = node._geoLast ? Math.min(0.05, (now - node._geoLast) / 1000) : 0.016; node._geoLast = now
  node._geoPan = (node._geoPan ?? 0) + (p.drift ?? 0) * dt * 0.12 // slow east/west drift, in tiles
  const cxT = lonToTileX(p.lon ?? 0, z) + node._geoPan
  const cyT = latToTileY(p.lat ?? 0, z)
  const tile = Math.max(256, Math.round(Math.min(W, H) / 2)) // scale tiles to the compositor size
  octx.fillStyle = '#0a0e14'; octx.fillRect(0, 0, W, H)
  const halfCols = Math.ceil((W / tile) / 2) + 1
  const halfRows = Math.ceil((H / tile) / 2) + 1
  let loaded = 0, total = 0
  octx.imageSmoothingEnabled = true
  for (let dxi = -halfCols; dxi <= halfCols; dxi++) for (let dyi = -halfRows; dyi <= halfRows; dyi++) {
    const ix = Math.floor(cxT) + dxi, iy = Math.floor(cyT) + dyi
    if (iy < 0 || iy >= n2) continue
    const wx = ((ix % n2) + n2) % n2
    const sx = W / 2 + (ix - cxT) * tile, sy = H / 2 + (iy - cyT) * tile
    total++
    const e = getMapTile(mapTileUrl(p.layer || 'Satellite', z, wx, iy))
    if (e.ok) { octx.drawImage(e.img, sx, sy, tile + 1, tile + 1); loaded++ }
  }
  // attribution + a hint while tiles stream in
  octx.fillStyle = 'rgba(255,255,255,0.55)'
  octx.font = `${Math.round(H * 0.028)}px system-ui, sans-serif`
  octx.textAlign = 'right'
  const attr = settings.mapKey ? (settings.mapProvider === 'mapbox' ? '© Mapbox © OSM' : '© MapTiler © OSM') : (p.layer === 'Satellite' ? 'Esri, Maxar' : p.layer === 'Topographic' ? '© OpenTopoMap' : '© OpenStreetMap')
  octx.fillText(attr, W - Math.round(H * 0.02), H - Math.round(H * 0.02))
  if (total && loaded < total) {
    octx.textAlign = 'center'; octx.fillStyle = 'rgba(230,240,255,0.8)'
    octx.font = `${Math.round(H * 0.05)}px system-ui, sans-serif`
    octx.fillText('loading map…', W / 2, H / 2)
  }
}

const GEO_PLACES = { grand: { lat: 36.06, lon: -112.14, zoom: 12 }, alps: { lat: 45.98, lon: 7.66, zoom: 12 }, tokyo: { lat: 35.68, lon: 139.76, zoom: 13 } }
function geoGoto(node, key) { const g = GEO_PLACES[key]; if (g) { Object.assign(node.params, g); node._geoPan = 0; persist() } }

function evalNode(node) {
  const s = st(node.id)
  const octx = s.octx
  octx.globalCompositeOperation = 'source-over'
  octx.globalAlpha = 1
  octx.filter = 'none'
  octx.fillStyle = '#000'
  octx.fillRect(0, 0, W, H)

  if (node.type === 'geo') { evalGeo(node, octx); return }
  if (node.type === 'vcam') { evalCamera(node, octx); return }
  if (node.type === 'geodata') { drawGeodata(node, octx); return }

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
    // numeric params read through pval() so wired inputs modulate them live
    const hue = pval(node, 'hue')
    // lyrics/text-over-time sequencing (null when off): overrides the drawn
    // string and adds an entrance/exit transform + alpha
    const seq = textSequence(node)
    if (p.bg) { octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H) }
    else octx.clearRect(0, 0, W, H)
    const px = Math.max(4, pval(node, 'size') * H)
    octx.save()
    octx.translate(pval(node, 'x') * W, pval(node, 'y') * H)
    if (seq) { octx.translate(seq.dx * W, seq.dy * H); if (seq.scale !== 1) octx.scale(seq.scale, seq.scale) }
    octx.rotate(((pval(node, 'rotate') ?? 0) * Math.PI) / 180)
    octx.font = `${p.italic ? 'italic ' : ''}${Math.round(pval(node, 'weight'))} ${px}px "${pval(node, 'font') || 'sans-serif'}"`
    octx.textAlign = 'center'
    octx.textBaseline = 'middle'
    octx.globalAlpha = seq ? Math.max(0, Math.min(1, seq.alpha)) : 1
    octx.fillStyle = hsvCss(hue, p.sat ?? 82, p.val ?? 96)
    if (p.glow > 0.01) { octx.shadowColor = hsvCss(hue, 100, 100); octx.shadowBlur = px * 0.4 * p.glow }
    // letter-spacing (tracking) drawn glyph-by-glyph; multiple lines stacked
    const track = (pval(node, 'tracking') ?? 0) * px
    const lines = String((seq ? seq.text : p.text) ?? '').split('\n')
    const lineH = px * 1.18
    const top = -(lineH * (lines.length - 1)) / 2
    lines.forEach((line, li) => {
      const y = top + li * lineH
      let total = 0
      for (const ch of line) total += octx.measureText(ch).width + track
      total -= track
      let cx = -total / 2
      for (const ch of line) {
        const w = octx.measureText(ch).width
        octx.fillText(ch, cx + w / 2, y)
        cx += w + track
      }
    })
    octx.restore()
    octx.shadowBlur = 0
  } else if (node.type === 'sprite') {
    // A loaded image / sprite-sheet placed in the frame. Transparent background
    // so it composites over other layers; position/size/rotation/opacity read
    // through pval() (control-mappable), plus a built-in motion preset over time.
    octx.clearRect(0, 0, W, H)
    const img = spriteImg(node)
    if (img && img.complete && img.naturalWidth) {
      const p = node.params
      const t = performance.now() / 1000
      let x = pval(node, 'x'), y = pval(node, 'y')
      let scl = pval(node, 'scale'), rot = pval(node, 'rotate') ?? 0
      const op = pval(node, 'opacity') ?? 1
      const sp = p.speed ?? 0.5, amp = p.amp ?? 0.2
      if (p.motion === 'Drift') { x += Math.sin(t * sp) * amp; y += Math.cos(t * sp * 0.7) * amp }
      else if (p.motion === 'Orbit') { x += Math.cos(t * sp) * amp; y += Math.sin(t * sp) * amp }
      else if (p.motion === 'Bounce') { y += (Math.abs(Math.sin(t * sp * 2)) - 0.5) * amp * 2 }
      else if (p.motion === 'Float') { y += Math.sin(t * sp) * amp; rot += Math.sin(t * sp * 0.6) * 10 }
      else if (p.motion === 'Spin') { rot += t * sp * 90 }
      rot += (p.spin ?? 0) * t * 90
      const cols = Math.max(1, Math.round(p.cols || 1)), rows = Math.max(1, Math.round(p.rows || 1))
      const frames = cols * rows
      const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows
      const fi = frames > 1 ? Math.floor(t * (p.fps || 12)) % frames : 0
      const sx = (fi % cols) * fw, sy = Math.floor(fi / cols) * fh
      const drawH = Math.max(1, scl * H), drawW = drawH * (fw / fh)
      octx.save()
      octx.globalAlpha = Math.max(0, Math.min(1, op))
      octx.translate(x * W, y * H)
      octx.rotate((rot * Math.PI) / 180)
      octx.imageSmoothingEnabled = true
      octx.drawImage(img, sx, sy, fw, fh, -drawW / 2, -drawH / 2, drawW, drawH)
      octx.restore()
      octx.globalAlpha = 1
    }
  } else if (node.type === 'portal') {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
    const p = node.params
    const sx = pval(node, 'srcX') * W, sy = pval(node, 'srcY') * H, sw = pval(node, 'srcW') * W, sh = pval(node, 'srcH') * H
    const dx = pval(node, 'dstX') * W, dy = pval(node, 'dstY') * H
    let dw = pval(node, 'dstW') * W
    let dh = pval(node, 'dstH') * H
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
    // A luma matte, NOT a blend: the matte input's brightness becomes an alpha
    // channel that reveals/hides the content. (Mixing two pictures is Blend's
    // job — this cuts one picture to a shape/gradient.) The matte is keyed at a
    // capped resolution for cheap per-frame luma→alpha conversion.
    const content = inputCanvas(node, 0)
    const mask = inputCanvas(node, 1)
    if (content) octx.drawImage(content, 0, 0, W, H)
    if (content && mask) {
      const mw = Math.min(360, W), mh = Math.max(1, Math.round((mw * H) / W))
      const t = s.matte || (s.matte = document.createElement('canvas'))
      if (t.width !== mw || t.height !== mh) { t.width = mw; t.height = mh }
      const tx = s.matteCtx || (s.matteCtx = t.getContext('2d', { willReadFrequently: true }))
      tx.clearRect(0, 0, mw, mh)
      tx.drawImage(mask, 0, 0, mw, mh)
      try {
        const img = tx.getImageData(0, 0, mw, mh)
        const d = img.data
        const inv = !!node.params.invert
        const strength = node.params.strength ?? 1
        for (let i = 0; i < d.length; i += 4) {
          let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
          if (inv) l = 1 - l
          // strength dials how hard the matte cuts (0 = passes everything through)
          const a = strength * l + (1 - strength)
          d[i] = d[i + 1] = d[i + 2] = 255
          d[i + 3] = Math.round(a * 255)
        }
        tx.putImageData(img, 0, 0)
        octx.globalCompositeOperation = 'destination-in'
        octx.drawImage(t, 0, 0, W, H)
        octx.globalCompositeOperation = 'source-over'
      } catch { /* tainted matte */ }
    }
  } else if (node.type === 'polygon') {
    // A matte-shape SOURCE: a white editable polygon on black. Vertices live in
    // node.params.points (normalized [x,y]); drag them on the output. Wire this
    // node's output into a Mask node's matte input to cut a picture to the
    // shape (the Mask node's own "invert matte" flips it — projection mapping).
    const feather = pval(node, 'feather') || 0
    octx.fillStyle = '#fff'
    if (feather > 0.001) octx.filter = `blur(${feather * 0.12 * Math.min(W, H)}px)`
    if (node.params.svg?.d) {
      // an imported SVG matte: fit its bbox into the frame (even-odd for holes)
      const { d, bbox } = node.params.svg
      const scale = 0.9 * Math.min(W / bbox.w, H / bbox.h)
      const dx = (W - bbox.w * scale) / 2 - bbox.x * scale
      const dy = (H - bbox.h * scale) / 2 - bbox.y * scale
      octx.save()
      octx.setTransform(scale, 0, 0, scale, dx, dy)
      try { octx.fill(new Path2D(d), 'evenodd') } catch { /* malformed path */ }
      octx.restore()
    } else {
      const pts = node.params.points || []
      if (pts.length >= 3) { polyPath(octx, pts, false); octx.fill('nonzero') }
    }
    octx.filter = 'none'
  } else if (node.type === 'blend') {
    // "swap" flips which input is the base and which is composited on top.
    const a = inputCanvas(node, node.params.swap ? 1 : 0)
    const b = inputCanvas(node, node.params.swap ? 0 : 1)
    if (a) octx.drawImage(a, 0, 0, W, H)
    if (b) {
      octx.globalCompositeOperation = node.params.mode === 'add' ? 'lighter' : node.params.mode === 'normal' ? 'source-over' : node.params.mode
      octx.globalAlpha = pval(node, 'mix') ?? 1 // top input's contribution (modulated)
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
    // With nothing wired in, fall back to the live shared camera so a bare
    // Tracker node just works once the webcam is on.
    let input = inputCanvas(node, 0)
    if (!input) {
      const stream = sharedCameraStream()
      if (stream) {
        if (!s.camVid || s.camVid.srcObject !== stream) {
          const v = document.createElement('video')
          v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream
          v.play().catch(() => {})
          s.camVid = v
        }
        if (s.camVid.videoWidth) input = s.camVid
      }
    }
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
        const th = (node.params.thresh ?? 0.5) * 255
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
        const sm = node.params.smooth ?? 0.7
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
  const ms = nodeCost[n.id] ?? 0
  if (ms > SLOW_MS) return `Slow — ${ms.toFixed(1)} ms/frame to render, may drop the frame rate`
  return 'Heavy effect — likely to lower the frame rate'
}
// Live per-node render cost (ms/frame), measured in the loop, for the badge.
function nodeCostMs(n) { return nodeCost[n.id] ?? 0 }
function nodeCostLevel(n) {
  const ms = nodeCost[n.id] ?? 0
  return ms > SLOW_MS * 2 ? 'bad' : ms > SLOW_MS ? 'warn' : ''
}
let fpsWindow = 0
let costWindow = 0

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
    }
    // publish per-node render cost for the live perf badge (reactive), a touch
    // more often than the FPS meter so a heavy node lights up quickly
    if (now - costWindow >= 300) {
      costWindow = now
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
const shapeNodes = computed(() => nodes.filter((n) => n.type === 'polygon'))
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
  delete n.params.svg
  persist()
}
// Drop a preset starter shape into a Polygon node (corners stay editable after).
function applyPolyShape(id, name) {
  const shape = POLY_SHAPES[name]
  const n = nodes.find((x) => x.id === id)
  if (!n || !shape) return
  n.params.points = shape.map((p) => [...p])
  delete n.params.svg
  persist()
}

// --- SVG import for the Polygon (matte-shape) node -------------------------
// An imported SVG becomes a filled matte: all of its shapes are flattened into
// one path (holes preserved via even-odd fill) and stored as { d, bbox }. The
// render path fits it into the frame; feather still applies. Clearing it drops
// back to the editable polygon points.
function svgElToPath(el) {
  const t = el.tagName.toLowerCase()
  const f = (a) => parseFloat(el.getAttribute(a) || '0')
  if (t === 'path') return el.getAttribute('d') || ''
  if (t === 'rect') { const x = f('x'), y = f('y'), w = f('width'), h = f('height'); return w && h ? `M${x} ${y}h${w}v${h}h${-w}Z` : '' }
  if (t === 'circle') { const cx = f('cx'), cy = f('cy'), r = f('r'); return r ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : '' }
  if (t === 'ellipse') { const cx = f('cx'), cy = f('cy'), rx = f('rx'), ry = f('ry'); return rx && ry ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` : '' }
  if (t === 'line') return `M${f('x1')} ${f('y1')}L${f('x2')} ${f('y2')}`
  if (t === 'polyline' || t === 'polygon') {
    const nums = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
    if (nums.length < 4) return ''
    let d = `M${nums[0]} ${nums[1]}`
    for (let i = 2; i < nums.length - 1; i += 2) d += `L${nums[i]} ${nums[i + 1]}`
    return t === 'polygon' ? d + 'Z' : d
  }
  return ''
}
function svgToPathData(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  const els = doc.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')
  const parts = []
  for (const el of els) { const d = svgElToPath(el); if (d) parts.push(d) }
  if (!parts.length) return null
  const combined = parts.join(' ')
  // measure the combined path's bounding box via a throwaway offscreen SVG
  const NS = 'http://www.w3.org/2000/svg'
  const tmp = document.createElementNS(NS, 'svg')
  tmp.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden')
  const pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', combined); tmp.appendChild(pth)
  document.body.appendChild(tmp)
  let bb; try { bb = pth.getBBox() } catch { bb = null } finally { document.body.removeChild(tmp) }
  if (!bb || !bb.width || !bb.height) return null
  return { d: combined, bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height } }
}
function importSvgToShape(id) {
  const n = nodes.find((x) => x.id === id)
  if (!n) return
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = '.svg,image/svg+xml'
  inp.onchange = () => {
    const file = inp.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const svg = svgToPathData(String(reader.result))
      if (!svg) { showToast('No usable shapes in that SVG'); return }
      n.params.svg = svg
      persist(); showToast('Imported SVG shape')
    }
    reader.onerror = () => showToast('Could not read the file')
    reader.readAsText(file)
  }
  inp.click()
}
function clearSvgShape(id) {
  const n = nodes.find((x) => x.id === id)
  if (!n) return
  delete n.params.svg
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
  for (const [id, c] of effectControls) out[id] = { values: { ...c.values }, mappings: c.mappings.map((m) => ({ ...m })), state: c.state ?? null }
  return out
}
function captureCueAt(t) {
  cues.push({ id: Date.now().toString(36), name: `Cue ${cues.length + 1}`, time: +Math.max(0, t).toFixed(1), fade: 1, snap: JSON.parse(snapshot()), effects: currentEffects() })
  activeCue.value = cues.length - 1
  persistShow()
}
function captureCue() {
  captureCueAt(cues.length ? Math.max(...cues.map((c) => c.time || 0)) + 8 : 0)
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
    win.postMessage({ type: 'sketch:apply-scene', values: pe.values, mappings: pe.mappings, state: pe.state ?? null }, '*')
    const ec = effectControls.get(+idStr)
    if (ec) { ec.values = { ...pe.values }; ec.mappings = pe.mappings.map((m) => ({ ...m })); ec.state = pe.state ?? null }
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
const tlSpan = computed(() => Math.max(showLength() + 4, 20))
function pct(t) { return (t / tlSpan.value) * 100 }
function fmtTime(t) {
  t = Math.round(t)
  return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`
}
// Evenly spaced ruler ticks at a "nice" interval (~8 across the span).
const tlTicks = computed(() => {
  const span = tlSpan.value
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600]
  const step = steps.find((s) => s >= span / 8) || 1200
  const ticks = []
  for (let t = 0; t <= span + 1e-6; t += step) ticks.push({ t, pct: (t / span) * 100 })
  return ticks
})
function tlSeek(e) {
  const r = e.currentTarget.getBoundingClientRect()
  seekShow(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * tlSpan.value)
}
// Double-click an empty spot on the timeline to capture a cue (keyframe) there.
function tlAddCueAt(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * tlSpan.value
  captureCueAt(t)
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
// The saved routing currently being edited (set on load/save) — lets "Save"
// overwrite it in place while "Save as" always forks a new one.
const currentRoutingId = ref(null)
const currentRoutingName = computed(() => savedRoutings.value.find((r) => r.id === currentRoutingId.value)?.name || '')
// Two-step guard so an in-place overwrite (Update) can't happen by accident.
const confirmUpdate = ref(false)
watch(currentRoutingId, () => { confirmUpdate.value = false })
// Grab a small JPEG of the composited output for a routing's preview thumbnail.
function capturePreview() {
  try {
    const cnv = stage.value
    if (!cnv || !cnv.width) return ''
    const w = 220, h = Math.max(1, Math.round(w * (cnv.height / cnv.width)))
    const off = document.createElement('canvas'); off.width = w; off.height = h
    off.getContext('2d').drawImage(cnv, 0, 0, w, h)
    return off.toDataURL('image/jpeg', 0.55)
  } catch { return '' }
}
// A transient success card (bottom-right) for saves/exports.
const toast = ref('')
let toastTimer = 0
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2800)
}
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
  const bname = newBlockName.value.trim() || `Block ${savedBlocks.value.length + 1}`
  savedBlocks.value.push({
    id: Date.now().toString(36),
    name: bname,
    nodes: bnodes, edges: bedges, links: blinks,
  })
  newBlockName.value = ''
  persistBlocks()
  showToast(`Saved block “${bname}”`)
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

// --- built-in preset blocks: common routing patterns -----------------------
// Structural templates (indices, not ids); slugs are filled from your enabled
// effect/filter pools when stamped, so each preset comes out with real sketches.
const CX = 230, RY = 170
const PRESET_BLOCKS = [
  { name: 'Blended pair',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'effect', x: 0, y: RY }, { type: 'blend', x: CX, y: RY * 0.5 }, { type: 'output', x: CX * 2, y: RY * 0.5 }],
    edges: [{ from: 0, to: 2, port: 0 }, { from: 1, to: 2, port: 1 }, { from: 2, to: 3, port: 0 }] },
  { name: 'Filtered effect',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'filter', x: CX, y: 0 }, { type: 'output', x: CX * 2, y: 0 }],
    edges: [{ from: 0, to: 1, port: 0 }, { from: 1, to: 2, port: 0 }] },
  { name: 'Filtered pair',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'effect', x: 0, y: RY }, { type: 'blend', x: CX, y: RY * 0.5 }, { type: 'filter', x: CX * 2, y: RY * 0.5 }, { type: 'output', x: CX * 3, y: RY * 0.5 }],
    edges: [{ from: 0, to: 2, port: 0 }, { from: 1, to: 2, port: 1 }, { from: 2, to: 3, port: 0 }, { from: 3, to: 4, port: 0 }] },
  { name: 'Layered trio',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'effect', x: 0, y: RY }, { type: 'effect', x: 0, y: RY * 2 }, { type: 'blend', x: CX, y: RY * 0.5 }, { type: 'blend', x: CX * 2, y: RY }, { type: 'output', x: CX * 3, y: RY }],
    edges: [{ from: 0, to: 3, port: 0 }, { from: 1, to: 3, port: 1 }, { from: 3, to: 4, port: 0 }, { from: 2, to: 4, port: 1 }, { from: 4, to: 5, port: 0 }] },
  { name: 'Polygon-mapped',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'polygon', x: CX, y: RY }, { type: 'mask', x: CX, y: 0 }, { type: 'output', x: CX * 2, y: 0 }],
    edges: [{ from: 0, to: 2, port: 0 }, { from: 1, to: 2, port: 1 }, { from: 2, to: 3, port: 0 }] },
  // one effect cut to a shape, laid over a second effect — the "shape cutout
  // overlay": B masked by a polygon, composited normal over background A.
  { name: 'Shape cutout overlay',
    nodes: [
      { type: 'effect', x: 0, y: 0 },                              // 0: background A
      { type: 'effect', x: 0, y: RY },                             // 1: overlay B
      { type: 'mask', x: CX, y: RY },                              // 2: cut B to shape
      { type: 'polygon', x: CX, y: RY * 1.9, params: { points: [[0.5, 0.14], [0.8, 0.32], [0.8, 0.68], [0.5, 0.86], [0.2, 0.68], [0.2, 0.32]], feather: 0.05 } }, // 3: shape matte
      { type: 'blend', x: CX * 2, y: RY * 0.5, params: { mode: 'normal', mix: 1 } }, // 4: overlay over A
      { type: 'output', x: CX * 3, y: RY * 0.5 },                  // 5
    ],
    edges: [
      { from: 1, to: 2, port: 0 }, // B → mask content
      { from: 3, to: 2, port: 1 }, // polygon → mask matte
      { from: 0, to: 4, port: 0 }, // A → blend base
      { from: 2, to: 4, port: 1 }, // masked B → blend top
      { from: 4, to: 5, port: 0 },
    ] },
  { name: 'Portal echo',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'portal', x: CX, y: 0 }, { type: 'output', x: CX * 2, y: 0 }],
    edges: [{ from: 0, to: 1, port: 0 }, { from: 1, to: 2, port: 0 }] },
  { name: 'Audio-reactive blend',
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'effect', x: 0, y: RY }, { type: 'blend', x: CX, y: RY * 0.5 }, { type: 'output', x: CX * 2, y: RY * 0.5 }, { type: 'input', x: 0, y: RY * 2, params: { source: 'audio.volume', scale: 1, offset: 0 } }],
    edges: [{ from: 0, to: 2, port: 0 }, { from: 1, to: 2, port: 1 }, { from: 2, to: 3, port: 0 }],
    links: [{ from: 4, srcPort: 0, node: 2, param: 'mix' }] },
]
const pk = (a) => a[Math.floor(Math.random() * a.length)]
// Fill a structural template's effect/filter slugs from the current pools, then
// stamp it into the graph like any block.
function insertPreset(p) {
  const pool = settings.filterToPool(effectOptions.value)
  const bn = p.nodes.map((mn, i) => {
    const params = { ...(mn.params || {}) }
    if (mn.type === 'effect' && !params.slug) params.slug = pk(pool.length ? pool : effectOptions.value)?.slug ?? ''
    if (mn.type === 'filter' && !params.slug) params.slug = pk(filterOptions.value)?.slug ?? ''
    if (mn.type === 'blend' && !params.mode) { params.mode = pk(BLENDS); params.mix = +(0.5 + Math.random() * 0.5).toFixed(2) }
    if (mn.type === 'portal' && !params.srcW) Object.assign(params, { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' })
    if (mn.type === 'polygon' && !params.points) Object.assign(params, { points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], feather: 0 })
    return { id: i, type: mn.type, x: mn.x, y: mn.y, params, locked: !!mn.locked }
  })
  insertBlock({ nodes: bn, edges: (p.edges || []).map((e) => ({ ...e })), links: (p.links || []).map((l) => ({ ...l })) })
  showToast(`Added “${p.name}”`)
}
function startRenameBlock(b) { editBlockId.value = b.id; editBlockName.value = b.name }
function commitRenameBlock() {
  const b = savedBlocks.value.find((x) => x.id === editBlockId.value)
  if (b) { const n = editBlockName.value.trim(); if (n) { b.name = n; persistBlocks() } }
  editBlockId.value = null
}
// Save: overwrite the routing you're currently editing (if any), else fork one.
// Overwrite the routing being edited in place. Guarded by confirmUpdate in the
// UI so it can't clobber a saved file by accident; keeps the file's own name
// (renaming lives in the Load list) so a name typed for "Save as new" can't
// silently rename the old file.
function saveRouting() {
  const r = savedRoutings.value.find((x) => x.id === currentRoutingId.value)
  if (!r) { saveAsRouting(); return }
  r.nodes = JSON.parse(JSON.stringify(nodes))
  r.edges = JSON.parse(JSON.stringify(edges))
  r.links = JSON.parse(JSON.stringify(links))
  r.effects = currentEffects()
  r.preview = capturePreview()
  persistSaved()
  confirmUpdate.value = false
  showToast(`Updated “${r.name}”`)
}
// Discard unsaved edits and reload the saved version of the current routing.
function revertRouting() {
  const r = savedRoutings.value.find((x) => x.id === currentRoutingId.value)
  if (!r) return
  loadRouting(r)
  showToast(`Reverted to saved “${r.name}”`)
}
// Save as: always store a new routing and switch to editing it.
function saveAsRouting() {
  const name = newName.value.trim() || `Routing ${savedRoutings.value.length + 1}`
  const id = Date.now().toString(36)
  savedRoutings.value.push({
    id,
    name,
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
    links: JSON.parse(JSON.stringify(links)),
    effects: currentEffects(), // each effect sketch's own param values + mappings
    preview: capturePreview(),
  })
  currentRoutingId.value = id
  persistSaved()
  showToast(`Saved “${name}”`)
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
  migrateGraph(nodes, edges) // reconnect legacy Polygon-Mask routings
  pruneOrphans()
  nextId = nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1
  // Keep runtime state (canvases, bound iframes/video) for node ids that
  // survive the swap — Vue won't re-mount same-keyed iframes, so clearing
  // their state would leave effect nodes black. Drop only vanished ids.
  const ids = new Set(nodes.map((n) => n.id))
  for (const id of [...rtState.keys()]) if (!ids.has(id)) { disposeRuntime(id); rtState.delete(id) }
  for (const n of nodes) st(n.id)
  // Restore each effect sketch's own params once its iframe is live.
  pendingEffects = { ...(data.effects || {}) }
  nextTick(applyPendingEffects)
  // now editing this routing: Save overwrites it, and its name pre-fills the box
  currentRoutingId.value = r.id
  newName.value = r.name || ''
  persist()
  nextTick(() => layoutTick.value++)
}
function deleteRouting(r) {
  const i = savedRoutings.value.findIndex((x) => x.id === r.id)
  if (i >= 0) {
    savedRoutings.value.splice(i, 1)
    if (currentRoutingId.value === r.id) currentRoutingId.value = null
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
function exportShow(show = null) {
  const src = show && show.cues ? show.cues : cues
  const name = show?.name || 'show'
  downloadJson({ type: 'sketchbook-show', version: 1, name, mode: show?.mode ?? showMode.value, cues: JSON.parse(JSON.stringify(src)) }, `${fileSlug(name)}.show.json`)
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

// --- named show files: save a set of cues (+ mode) to a persisted library ---
const SHOWS_KEY = 'sketchbook-patch-shows'
function loadShows() { try { return JSON.parse(localStorage.getItem(SHOWS_KEY)) || [] } catch { return [] } }
const savedShows = ref(loadShows())
const newShowName = ref('')
function persistShows() { localStorage.setItem(SHOWS_KEY, JSON.stringify(savedShows.value)) }
function saveShowAs() {
  if (!cues.length) { showToast('No cues to save yet'); return }
  const name = newShowName.value.trim() || `Show ${savedShows.value.length + 1}`
  savedShows.value.push({
    id: Date.now().toString(36),
    name,
    mode: showMode.value,
    cues: JSON.parse(JSON.stringify(cues)),
  })
  persistShows()
  newShowName.value = ''
  showToast(`Saved show “${name}”`)
}
function loadShowFile(s) {
  cues.splice(0, cues.length, ...JSON.parse(JSON.stringify(s.cues || [])))
  if (s.mode) showMode.value = s.mode
  activeCue.value = -1
  curSeg = -1
  stopShow()
  persistShow()
  showToast(`Loaded show “${s.name}”`)
}
function deleteShowFile(s) {
  const i = savedShows.value.findIndex((x) => x.id === s.id)
  if (i >= 0) { savedShows.value.splice(i, 1); persistShows() }
}

// --- guided tour -------------------------------------------------------------
const tourActive = ref(false)
const tourSteps = [
  { title: 'Patch — the studio', body: 'A node compositor: wire generator effects through filters and blends into an Output, then project it. This is the deep end.' },
  { target: '[data-tour="patch-add"]', title: 'Build the graph', body: 'Add effects, filters, text, media, masks and blends from here, then drag a node’s right port to another’s left port to wire them.', pad: 8 },
  { target: '[data-tour="patch-random"]', title: 'Randomize', body: 'Deal out a whole new random-but-sensible patch in one click (undoable). It draws from the effect pool you set in Settings.' },
  { target: '[data-tour="patch-mask"]', title: 'Projection mapping', body: 'Add a Polygon node (wire it into a Mask), then turn this on and drag the polygon’s corners on the output to fit it to a real surface.' },
  { target: '[data-tour="patch-show"]', title: 'Plan a show', body: 'Capture the patch as cues and step through them, or lay them on a timeline that ramps parameters between them.' },
  { target: '[data-tour="patch-output"]', title: 'Go live', body: 'Switch to output-only and fullscreen for a clean projection, pop the output to a second display, or export the patch to a file.' },
]
function startTour() { tourActive.value = true }
function finishTour(payload) { settings.markSeen('patch'); if (payload?.disableAll) settings.setTutorials(false) }

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  setGooglePhotosClientId(settings.googleClientId) // enable Google Photos if a client id is set
  if (settings.shouldAutoTour('patch')) setTimeout(startTour, 600)
  // Handoff from the Mixer / Autopilot: a converted graph waiting to be edited.
  const handoff = localStorage.getItem(PATCH_HANDOFF_KEY)
  if (handoff) {
    localStorage.removeItem(PATCH_HANDOFF_KEY)
    try {
      const g = JSON.parse(handoff)
      if (g && g.nodes?.length) {
        loadRouting(g)
        await nextTick()
        layoutTick.value++
        resizeStage()
        window.addEventListener('resize', resizeStage)
        window.addEventListener('message', onEffectMessage)
        window.addEventListener('keydown', onKey)
        window.addEventListener('pointermove', trackMouse)
        raf = requestAnimationFrame(loop)
        showToast('Loaded mix as a patch')
        return
      }
    } catch { /* fall through to normal load */ }
  }
  // Deep link from the Library / Display mode: ?load=<id> opens a saved
  // routing, &output=1 starts chrome-free (for projection).
  const qs = new URLSearchParams(location.hash.split('?')[1] || '')
  const loadId = qs.get('load')
  if (qs.get('output') === '1') outputOnly.value = true
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
  // Restore each effect sketch's saved param values + mappings from the autosave
  // once its iframe announces ready (onEffectMessage drains pendingEffects).
  if (saved?.effects && Object.keys(saved.effects).length) { pendingEffects = { ...saved.effects }; nextTick(applyPendingEffects) }
  raf = requestAnimationFrame(loop)
})
function trackMouse(e) {
  mouseN.x = e.clientX / window.innerWidth
  mouseN.y = 1 - e.clientY / window.innerHeight
}
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearInterval(autoTimer)
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
  // release any geometry-space GPU resources
  for (const s of rtState.values()) {
    if (s.three) { for (const obj of s.three.meshes.values()) disposeObject(obj); s.three.meshes.clear() }
  }
  geoRenderer?.dispose?.()
  geoRenderer = null
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
        <v-btn icon="mdi-earth" variant="tonal" size="small" title="Add Geodata (live map / satellite imagery)" :style="{ color: TYPES.geodata.color }" @click="addNode('geodata')" />
        <v-btn icon="mdi-tray-arrow-down" variant="text" size="small" title="Import wizard — bring in media, URLs, screen, Google Photos, point clouds, maps &amp; terrain" @click="wizOpen = true" />
        <v-btn icon="mdi-vector-intersection" variant="tonal" size="small" title="Add Mask (content × matte)" :style="{ color: TYPES.mask.color }" @click="addNode('mask')" />
        <v-btn icon="mdi-vector-polygon" variant="tonal" size="small" title="Add Polygon (an editable matte shape — wire into a Mask)" :style="{ color: TYPES.polygon.color }" @click="addNode('polygon')" />
        <v-btn icon="mdi-shape-outline" variant="tonal" size="small" title="Add Portal (remap a region elsewhere)" :style="{ color: TYPES.portal.color }" @click="addNode('portal')" />
        <v-btn icon="mdi-circle-half-full" variant="tonal" size="small" title="Add Blend (composite two streams)" :style="{ color: TYPES.blend.color }" @click="addNode('blend')" />
        <v-btn icon="mdi-cube-outline" variant="tonal" size="small" title="Add Geometry (a mesh in vertex space)" :style="{ color: TYPES.geo.color }" @click="addNode('geo')" />
        <v-btn icon="mdi-camera-control" variant="tonal" size="small" title="Add Camera (render geometry to pixels)" :style="{ color: TYPES.vcam.color }" @click="addNode('vcam')" />
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
        <v-btn icon="mdi-image-move" variant="tonal" size="small" title="Add Sprite (an image/sprite-sheet placed &amp; animated in space)" :style="{ color: TYPES.sprite.color }" @click="addNode('sprite')" />
        <v-btn icon="mdi-monitor" variant="tonal" size="small" title="Add Output (fullscreen stage)" @click="addNode('output')" />
        <v-spacer />
        <v-menu v-model="nlOpen" :close-on-content-click="false" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" size="small" title="Describe a patch in words (or speak it) and wire it up" />
          </template>
          <v-card width="360" class="nl-card">
            <div class="nl-title">
              Describe a patch
              <span class="nl-spacer" />
              <button
                class="nl-smart-toggle" :class="{ on: nlSmart }"
                :title="settings.aiKey ? (nlSmart ? 'Smart mode on (Claude API) — click for the offline parser' : 'Use Claude to build free-form descriptions') : 'Add a Claude API key in Settings to enable smart mode'"
                @click="settings.aiKey ? (nlSmart = !nlSmart) : router.push({ name: 'settings' })"
              >✨ Smart</button>
            </div>
            <v-textarea
              v-model="nlText"
              rows="3" auto-grow variant="outlined" density="compact" hide-details autofocus
              :placeholder="nlSmart ? 'e.g. my camera inside a spinning heart, over a slow plasma, glitchy' : 'e.g. dreamy underwater scene, slow, deep blue'"
              @keydown.enter.exact.prevent="nlSmart ? smartInterpret() : parseIntent(nlText)"
            />
            <div class="nl-row">
              <v-btn
                :icon="nlListening ? 'mdi-microphone' : 'mdi-microphone-outline'"
                :color="nlListening ? 'primary' : undefined"
                variant="text" size="small" :title="nlListening ? 'Stop listening' : 'Speak your description'"
                @click="nlVoice"
              />
              <div class="nl-spacer" />
              <v-btn v-if="nlSmart" size="small" variant="tonal" color="primary" :loading="nlBusy" prepend-icon="mdi-creation" @click="smartInterpret">Smart build</v-btn>
              <v-btn v-else size="small" variant="tonal" color="primary" prepend-icon="mdi-text-search-variant" @click="parseIntent(nlText)">Interpret</v-btn>
            </div>

            <!-- AI plan preview (smart mode) -->
            <div v-if="nlAiSpec" class="nl-preview">
              <div class="nl-pv-hint">✨ Claude's plan:</div>
              <div class="nl-ai-notes">{{ nlAiSpec.notes || 'A patch' }}</div>
              <div class="nl-pv-row">
                <span class="nl-pv-key">nodes</span>
                <span v-for="(n, i) in nlAiSpec.nodes" :key="i" class="nl-chip nl-chip--dim">{{ TYPES[n.type] ? (n.slug || TYPES[n.type].title) : ('?' + n.type) }}</span>
              </div>
              <v-btn size="small" variant="flat" color="primary" block prepend-icon="mdi-auto-fix" class="mt-2" @click="buildFromSpec(nlAiSpec)">Build this patch</v-btn>
            </div>

            <!-- editable interpretation: drop anything it got wrong, then build -->
            <div v-if="nlIntent" class="nl-preview">
              <div class="nl-pv-hint">Here's what I understood — click a chip to drop it, then build:</div>
              <div v-if="nlIntent.camera || nlIntent.effects.length || (nlIntent.text.on && !nlIntent.mask)" class="nl-pv-row">
                <span class="nl-pv-key">sources</span>
                <button v-if="nlIntent.camera" class="nl-chip" @click="nlIntent.camera = false">📷 Camera ✕</button>
                <button v-for="(e, i) in nlIntent.effects" :key="e.slug" class="nl-chip" @click="nlIntent.effects.splice(i, 1)">{{ e.title }} ✕</button>
                <button v-if="nlIntent.text.on && !nlIntent.mask" class="nl-chip" @click="nlIntent.text.on = false">T {{ nlIntent.text.content ? ('“' + nlIntent.text.content + '”') : 'Text' }} ✕</button>
              </div>
              <div v-if="nlIntent.filters.length" class="nl-pv-row">
                <span class="nl-pv-key">filters</span>
                <button v-for="(f, i) in nlIntent.filters" :key="f.slug" class="nl-chip nl-chip--f" @click="nlIntent.filters.splice(i, 1)">{{ f.title }} ✕</button>
              </div>
              <div v-if="nlIntent.mask || nlIntent.audio || nlIntent.mouse || nlModKeys.length || nlIntent.color || (nlIntent.effects.length + (nlIntent.camera ? 1 : 0) + (nlIntent.text.on && !nlIntent.mask ? 1 : 0)) > 1" class="nl-pv-row">
                <span class="nl-pv-key">also</span>
                <button v-if="(nlIntent.effects.length + (nlIntent.camera ? 1 : 0) + (nlIntent.text.on && !nlIntent.mask ? 1 : 0)) > 1" class="nl-chip nl-chip--dim">{{ nlIntent.blend }} blend</button>
                <button v-if="nlIntent.mask" class="nl-chip" @click="nlIntent.mask = false">mask ✕</button>
                <button v-if="nlIntent.audio" class="nl-chip" @click="nlIntent.audio = false">audio→mix ✕</button>
                <button v-if="nlIntent.mouse" class="nl-chip" @click="nlIntent.mouse = false">mouse→mix ✕</button>
                <button v-for="k in nlModKeys" :key="k" class="nl-chip nl-chip--dim" @click="nlDropMod(k)">{{ k }} {{ nlIntent.mods[k] > 0 ? '▲' : '▼' }} ✕</button>
                <button v-if="nlIntent.color" class="nl-chip nl-chip--dim" @click="nlIntent.color = null">colour: {{ nlIntent.color.name }} ✕</button>
              </div>
              <div v-if="nlIntent.ignored.length" class="nl-ignored" title="Words I couldn't map to anything — try renaming them to an effect/filter or a mood word">didn't use: {{ nlIntent.ignored.join(', ') }}</div>
              <v-btn size="small" variant="flat" color="primary" block prepend-icon="mdi-auto-fix" class="mt-2" @click="buildFromIntent">Build this patch</v-btn>
            </div>

            <div class="nl-examples">
              <span class="nl-ex-label">Try:</span>
              <button v-for="ex in NL_EXAMPLES" :key="ex" class="nl-ex" @click="nlText = ex; parseIntent(ex)">{{ ex }}</button>
            </div>
            <div v-if="nlLast" class="nl-last">Last: {{ nlLast }}</div>
          </v-card>
        </v-menu>
        <v-btn data-tour="patch-random" icon="mdi-dice-multiple" variant="text" size="small" title="New random patch — deal out a whole new graph (undoable)" @click="randomPatch" />
        <v-btn icon="mdi-shuffle-variant" variant="text" size="small" title="Randomize the look — reseed & shuffle every node's params, keep the wiring (undoable)" @click="randomizeLook" />
        <v-btn icon="mdi-delete-sweep" variant="text" size="small" title="Clear graph" @click="clearAll" />
        <v-btn icon="mdi-undo" variant="text" size="small" title="Undo (Ctrl/Cmd+Z)" :disabled="!undoStack.length" @click="undo" />
        <v-btn icon="mdi-redo" variant="text" size="small" title="Redo (Ctrl/Cmd+Shift+Z)" :disabled="!redoStack.length" @click="redo" />
      </div>
      <div class="toolbar-row">
      <!-- Autopilot: auto-evolve this graph; jump between manual and autopilot -->
      <v-btn
        :prepend-icon="autoOn ? 'mdi-robot' : 'mdi-robot-outline'"
        size="small"
        :variant="autoOn ? 'flat' : 'tonal'"
        :color="autoOn ? 'primary' : undefined"
        :title="autoOn ? 'Autopilot on — the graph is evolving itself; click to take over' : 'Autopilot — let it auto-evolve this graph'"
        @click="toggleAuto"
      >{{ autoOn ? 'Autopilot' : 'Manual' }}</v-btn>
      <v-btn
        icon="mdi-cog-outline"
        variant="text"
        size="x-small"
        :color="autoPanelOpen ? 'primary' : undefined"
        title="Autopilot transport &amp; options"
        @click="autoPanelOpen = !autoPanelOpen"
      />

      <!-- Save: name + store the current graph as a routing -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-content-save-outline">Save</v-btn>
        </template>
        <v-card class="pa-2" min-width="290">
          <div v-if="currentRoutingId" class="text-caption text-medium-emphasis mb-1" style="font-size:11px">
            Editing “{{ currentRoutingName }}” — changes aren’t saved until you Update it or Save as new.
          </div>
          <v-text-field
            v-model="newName"
            density="compact"
            hide-details
            class="mb-2"
            :placeholder="currentRoutingId ? 'Name for the new copy' : 'Name this routing'"
            @keyup.enter="saveAsRouting"
          />
          <!-- Primary action is always making a NEW file, so you can't clobber
               the loaded one by reflex. -->
          <v-btn block size="small" color="primary" variant="flat" prepend-icon="mdi-content-save-plus-outline" class="mb-2" @click="saveAsRouting">
            Save as new file
          </v-btn>
          <!-- Overwriting the loaded routing is a guarded, two-step action. -->
          <template v-if="currentRoutingId">
            <div v-if="!confirmUpdate" class="d-flex ga-1 mb-2">
              <v-btn size="small" variant="tonal" prepend-icon="mdi-content-save" @click="confirmUpdate = true">Update “{{ currentRoutingName }}”</v-btn>
              <v-btn size="small" variant="text" prepend-icon="mdi-backup-restore" title="Discard changes and reload the saved version" @click="revertRouting">Revert</v-btn>
            </div>
            <div v-else class="overwrite-warn mb-2">
              <div class="ow-msg">Overwrite the saved “{{ currentRoutingName }}”? The stored version is replaced.</div>
              <div class="d-flex ga-1 mt-1">
                <v-btn size="small" color="warning" variant="flat" prepend-icon="mdi-content-save-alert" @click="saveRouting">Overwrite</v-btn>
                <v-btn size="small" variant="text" @click="confirmUpdate = false">Cancel</v-btn>
              </div>
            </div>
          </template>
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
        <v-card class="pa-2" min-width="290">
          <p class="text-caption text-medium-emphasis mb-1" style="font-size:11px">Click a routing to open it for editing.</p>
          <v-list density="compact" max-height="360">
            <v-list-item
              v-for="r in savedRoutings"
              :key="r.id"
              :active="currentRoutingId === r.id"
              @click="editRoutingId === r.id ? null : loadRouting(r)"
            >
              <template #prepend>
                <div class="routing-preview">
                  <img v-if="r.preview" :src="r.preview" alt="" />
                  <v-icon v-else icon="mdi-vector-polyline" size="18" />
                </div>
              </template>
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
                <v-icon icon="mdi-pencil-box-outline" size="16" class="mr-2" title="Open for editing" @click.stop="loadRouting(r)" />
                <v-icon icon="mdi-rename-outline" size="16" class="mr-2" title="Rename" @click.stop="startRenameRouting(r)" />
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
          <p class="text-caption text-medium-emphasis mb-1" style="font-size:11px">Click a pattern or saved block to stamp it into the graph.</p>
          <v-list density="compact" max-height="340">
            <v-list-subheader>Common patterns</v-list-subheader>
            <v-list-item
              v-for="p in PRESET_BLOCKS"
              :key="p.name"
              @click="insertPreset(p)"
            >
              <template #prepend><v-icon icon="mdi-vector-polyline" size="16" class="mr-2" /></template>
              <template #title><span>{{ p.name }} <span class="text-medium-emphasis" style="font-size:11px">· {{ p.nodes.length }}</span></span></template>
            </v-list-item>
            <v-divider class="my-1" />
            <v-list-subheader>Your blocks</v-list-subheader>
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
      <v-btn icon="mdi-eye-off-outline" variant="text" size="small" title="Hide all node settings (h) — pinned nodes stay" @click="hideAllBodies" />
      <v-btn icon="mdi-eye-outline" variant="text" size="small" title="Show all node settings (s)" @click="showAllBodies" />
      <v-btn icon="mdi-sine-wave" variant="text" size="small" title="Show only modulated nodes (m) — those driven by an input" @click="showModulatedBodies" />
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
        <!-- Named show files: save the current cue set to a persisted library -->
        <v-menu :close-on-content-click="false" location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" size="x-small" variant="tonal" prepend-icon="mdi-content-save-outline" class="mr-1">Shows</v-btn>
          </template>
          <v-card class="pa-2" min-width="260">
            <div class="d-flex ga-1 mb-2">
              <v-text-field v-model="newShowName" density="compact" hide-details placeholder="Name this show" @keyup.enter="saveShowAs" />
              <v-btn size="small" variant="tonal" :disabled="!cues.length" prepend-icon="mdi-content-save" @click="saveShowAs">Save</v-btn>
            </div>
            <v-list density="compact" max-height="300">
              <v-list-item v-for="s in savedShows" :key="s.id" :title="s.name" :subtitle="`${s.cues.length} cue${s.cues.length === 1 ? '' : 's'} · ${s.mode}`" @click="loadShowFile(s)">
                <template #append>
                  <v-icon icon="mdi-download" size="16" class="mr-2" title="Export this show as a file" @click.stop="exportShow(s)" />
                  <v-icon icon="mdi-delete" size="16" title="Delete" @click.stop="deleteShowFile(s)" />
                </template>
              </v-list-item>
              <v-list-item v-if="!savedShows.length" title="No saved shows yet" disabled />
            </v-list>
          </v-card>
        </v-menu>
        <v-btn icon="mdi-download" size="x-small" variant="text" :disabled="!cues.length" title="Export current show as a .json file" @click="exportShow()" />
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
      <div v-else class="show-transport show-transport--tl">
        <div class="tl-controls">
          <v-btn :icon="showPlaying ? 'mdi-pause' : 'mdi-play'" size="small" variant="text" @click="showPlaying ? pauseShow() : playShow()" />
          <v-btn icon="mdi-stop" size="small" variant="text" title="Stop and rewind" @click="stopShow" />
          <v-btn :icon="showLoop ? 'mdi-repeat' : 'mdi-repeat-off'" size="small" variant="text" :color="showLoop ? 'primary' : undefined" title="Loop the show" @click="showLoop = !showLoop" />
          <span class="show-clock">{{ playhead.toFixed(1) }}s / {{ showLength().toFixed(1) }}s</span>
          <span class="tl-hint">double-click the timeline to drop a keyframe cue · drag a marker to retime it</span>
        </div>
        <!-- ruler + keyframe lane: cues are keyframes; params ramp between them -->
        <div class="tl-timeline">
          <div class="tl-ruler">
            <div v-for="tk in tlTicks" :key="tk.t" class="tl-tick" :style="{ left: tk.pct + '%' }"><span>{{ fmtTime(tk.t) }}</span></div>
          </div>
          <div class="tl-track tl-track--tall" @pointerdown="tlSeek($event)" @dblclick="tlAddCueAt($event)">
            <div v-for="tk in tlTicks" :key="'g' + tk.t" class="tl-grid" :style="{ left: tk.pct + '%' }" />
            <div class="tl-fill" :style="{ width: pct(playhead) + '%' }" />
            <div class="tl-playhead" :style="{ left: pct(playhead) + '%' }" />
            <div
              v-for="(c, i) in cues" :key="c.id"
              class="tl-cue tl-cue--tall" :class="{ on: activeCue === i }"
              :style="{ left: pct(c.time) + '%' }"
              :title="c.name + ' @ ' + c.time + 's — drag to retime'"
              @pointerdown.stop="tlCueDown(i, $event)"
              @dblclick.stop="goCue(i)"
            ><span class="tl-cue-lbl">{{ i + 1 }}</span></div>
          </div>
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

    <!-- Autopilot panel: transport + countdown ring + options, surfaced as its
         own tab when autopilot is engaged. Parity with the Autopilot view, but
         the graph stays hand-editable — add nodes from the toolbar any time. -->
    <div v-if="autoPanelOpen" class="auto-panel" @pointerdown.stop @wheel.stop>
      <div class="show-head">
        <span class="show-title">Autopilot</span>
        <div class="show-modes">
          <button :class="{ on: autoOn }" @click="!autoOn && toggleAuto()">Auto</button>
          <button :class="{ on: !autoOn }" @click="autoOn && toggleAuto()">Manual</button>
        </div>
        <span class="show-spacer" />
        <span class="auto-fps" :class="{ low: fps > 0 && fps < autoFpsFloor }">{{ fps }} fps</span>
        <v-btn icon="mdi-close" size="x-small" variant="text" @click="autoPanelOpen = false" />
      </div>

      <!-- transport: previous · play/pause · next-now · countdown ring · reroll -->
      <div class="show-transport">
        <v-btn icon="mdi-skip-previous" size="small" variant="text" :disabled="!undoStack.length" title="Step back (undo the last change)" @click="autoPrev" />
        <v-btn :icon="autoOn && !autoPaused ? 'mdi-pause' : 'mdi-play'" size="small" variant="text" :title="!autoOn ? 'Engage autopilot' : autoPaused ? 'Resume' : 'Pause (holds autopilot)'" @click="autoOn ? autoPlayPause() : toggleAuto()" />
        <v-btn icon="mdi-skip-next" size="small" variant="text" :disabled="!autoOn" title="Next move now" @click="autoNextNow" />
        <span class="countdown-ring" :title="autoOn ? (autoPaused ? 'Paused' : 'Time until the next change') : 'Autopilot is off'">
          <svg viewBox="0 0 36 36">
            <circle class="ring-bg" cx="18" cy="18" r="15.5" />
            <circle class="ring-fg" cx="18" cy="18" r="15.5" :stroke-dasharray="97.4" :stroke-dashoffset="97.4 * (1 - autoProgress)" />
          </svg>
          <span class="ring-num">{{ autoOn ? (autoPaused ? '‖' : autoLeft) : '–' }}</span>
        </span>
        <v-btn icon="mdi-dice-5-outline" size="small" variant="text" title="Full reroll — deal a fresh graph" @click="autoReroll" />
        <span class="show-spacer" />
        <v-btn icon="mdi-robot-outline" size="small" variant="text" title="Open the full Autopilot view" @click="openAutopilot" />
      </div>

      <!-- options -->
      <div class="auto-opts">
        <div class="auto-row">Change every {{ autoEverySec }}s</div>
        <v-slider v-model="autoEverySec" :min="3" :max="60" :step="1" hide-details density="compact" class="mb-1" @pointerdown.stop />
        <div class="auto-row">Perf budget: {{ autoBudget }} — bigger is richer &amp; heavier</div>
        <v-slider v-model="autoBudget" :min="4" :max="30" :step="1" hide-details density="compact" class="mb-1" @pointerdown.stop />
        <div class="auto-row">FPS floor: {{ autoFpsFloor }} — cheapen the graph below this</div>
        <v-slider v-model="autoFpsFloor" :min="10" :max="50" :step="1" hide-details density="compact" @pointerdown.stop />
        <p class="auto-hint">Autopilot swaps effects, restyles blends and regrows branches on the clock. Locked nodes are never touched — lock anything you want to keep, and keep adding nodes from the toolbar while it runs.</p>
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
          :stroke-dasharray="w.matte ? '7 5' : w.geometry ? '1 6' : undefined"
          :stroke-linecap="w.geometry ? 'round' : undefined"
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
          :stroke="wire.kind === 'control' ? '#e0a060' : wire.kind === 'geometry' ? '#6ee7b7' : '#fff'"
          fill="none"
          stroke-width="2"
          :stroke-dasharray="wire.kind === 'control' ? '2 4' : wire.kind === 'geometry' ? '1 6' : '4 4'"
        />
      </svg>

      <div
        v-for="n in nodes"
        :key="n.id"
        :data-node-id="n.id"
        class="node"
        :class="{ 'node--selected': selectedSet.has(n.id) || selected === n.id, 'node--locked': n.locked, 'node--slow': nodeSlow(n) }"
        :style="{ left: n.x + 'px', top: n.y + 'px', width: nodeW(n) + 'px', zIndex: selected === n.id || n.id === frontNodeId ? 20 : (selectedSet.has(n.id) ? 14 : undefined) }"
        @pointerdown.capture="frontNodeId = n.id"
      >
        <div
          class="node-head"
          :style="{ background: TYPES[n.type].color }"
          @pointerdown="startDrag(n, $event)"
          @dblclick="!n.locked && startRename(n)"
        >
          <v-icon :icon="TYPES[n.type].icon" size="14" class="node-type-ico" />
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
          <span v-if="nodeCostMs(n) > 2.5" class="node-ms" :class="nodeCostLevel(n)" :title="`${nodeCostMs(n).toFixed(1)} ms to render this node each frame`">{{ nodeCostMs(n).toFixed(1) }}ms</span>
          <v-icon v-if="nodeSlow(n)" icon="mdi-alert" size="16" class="node-warn" :title="nodeSlowReason(n)" @pointerdown.stop />
          <v-icon :icon="bodyEyeIcon(n)" size="13" class="node-lock" :class="{ 'node-keep-on': n.pinBody }" :title="bodyEyeTitle(n)" @pointerdown.stop @click="cycleBody(n)" />
          <v-icon v-if="TYPES[n.type].ins > 0" icon="mdi-backup-restore" size="13" class="node-lock" title="Replace the whole branch feeding this node" @pointerdown.stop @click="rerollUpstream(n)" />
          <v-icon v-if="autoCanTouch(n)" :icon="n.keep ? 'mdi-pin' : 'mdi-pin-outline'" size="13" class="node-lock" :class="{ 'node-keep-on': n.keep }" :title="n.keep ? 'Kept — Autopilot won’t reshuffle this (click to allow)' : 'Keep — protect from Autopilot reshuffle'" @pointerdown.stop @click="n.keep = !n.keep; persist()" />
          <v-icon :icon="n.locked ? 'mdi-lock' : 'mdi-lock-open-variant-outline'" size="13" class="node-lock" :title="n.locked ? 'Locked — click to unlock' : 'Lock this node'" @pointerdown.stop @click="n.locked = !n.locked; persist()" />
          <v-icon v-if="!n.locked" icon="mdi-close" size="14" class="node-close" @pointerdown.stop @click="removeNode(n.id)" />
        </div>

        <div
          class="node-thumb"
          :ref="(el) => bindThumb(n.id, el)"
          :style="{ height: thumbH(n) + 'px', cursor: n.type === 'xy' ? 'crosshair' : undefined, touchAction: n.type === 'xy' ? 'none' : undefined }"
          @pointerdown="n.type === 'xy' && xyDown(n, $event)"
          @pointermove="n.type === 'xy' && xyMove(n, $event)"
          @pointerup="n.type === 'xy' && xyUp(n)"
        />
        <!-- XY pad resize grip: drag the bottom-right corner of the pad to resize.
             Kept a sibling of the thumb because bindThumb rewrites the thumb's DOM. -->
        <div
          v-if="n.type === 'xy'"
          class="pad-grip"
          :style="{ left: nodeW(n) - 15 + 'px', top: HEAD_H + thumbH(n) - 15 + 'px' }"
          title="drag to resize the pad"
          @pointerdown="padResizeDown(n, $event)"
          @pointermove="padResizeMove($event)"
          @pointerup="padResizeUp"
        />

        <!-- input ports (centered on the wire endpoint; diamond = matte/mask) -->
        <div
          v-for="i in TYPES[n.type].ins"
          :key="'in' + i"
          class="port"
          :class="inKind(n, i - 1) === 'matte' ? 'port--matte' : inKind(n, i - 1) === 'geometry' ? 'port--geometry' : 'port--image'"
          :style="{
            left: '-7px',
            top: HEAD_H + (THUMB_H * i) / (TYPES[n.type].ins + 1) - 7 + 'px',
          }"
          :data-in-node="n.id"
          :data-in-port="i - 1"
          :title="n.type === 'mask' ? (i === 1 ? 'content' : 'mask (matte)') : n.type === 'vcam' ? 'geometry in' : 'input'"
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
          :class="outKind(n) === 'matte' ? 'port--matte' : outKind(n) === 'control' ? 'port--control' : outKind(n) === 'geometry' ? 'port--geometry' : 'port--image'"
          :style="{ left: nodeW(n) - 7 + 'px', top: HEAD_H + (thumbH(n) * oi) / (outCount(n) + 1) - 7 + 'px' }"
          :title="OUT_LABELS[n.type]?.[oi - 1] ?? (outKind(n) === 'control' ? 'control out — drag to a param ▣' : 'output')"
          @pointerdown="startWire(n, $event, oi - 1)"
        />
        <template v-if="OUT_LABELS[n.type]">
          <span
            v-for="oi in outCount(n)"
            :key="'ol' + oi"
            class="port-label"
            :style="{ left: nodeW(n) + 9 + 'px', top: HEAD_H + (thumbH(n) * oi) / (outCount(n) + 1) - 7 + 'px' }"
          >{{ OUT_LABELS[n.type][oi - 1] }}</span>
        </template>

        <!-- per-node controls (hidden/pinned via the eye on the head) -->
        <div v-show="bodyShown(n)" class="node-body">
          <template v-if="n.type === 'effect' || n.type === 'filter'">
            <div class="d-flex ga-1 align-center">
              <select v-model="n.params.slug" class="flex-grow-1" @change="persist" @pointerdown.stop>
                <optgroup v-for="g in (n.type === 'filter' ? filterGroups : effectGroups)" :key="g.label" :label="g.label">
                  <option v-for="o in g.items" :key="o.slug" :value="o.slug">{{ o.title }}</option>
                </optgroup>
              </select>
              <button
                class="knob-btn"
                title="Randomize — reseed and roll every parameter for a fresh look"
                @pointerdown.stop
                @click="reseedNode(n)"
              >🎲</button>
              <button
                v-if="effectControls.has(n.id)"
                class="knob-btn"
                :class="{ on: showParams.get(n.id) }"
                :title="showParams.get(n.id) ? 'Hide parameters & input mappings' : 'Show parameters & input mappings'"
                @pointerdown.stop
                @click="toggleParams(n.id)"
              ><v-icon :icon="showParams.get(n.id) ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" size="14" /></button>
            </div>
            <!-- beat trigger: drop an Input wire here to fire beats on this
                 effect from any source (rising edge of the signal) -->
            <label class="beat-jack">
              <span class="pjack pjack--beat" :ref="(el) => bindJack(n.id, '__beat', el)" :data-jack-node="n.id" data-jack-param="__beat" title="beat trigger — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, '__beat')" />
              beat trigger
            </label>

            <!-- effect params + mappings (same protocol as the viewer/Mixer) -->
            <div v-if="showParams.get(n.id) && effectControls.get(n.id)" class="params" @pointerdown.stop>
              <!-- curve editor for effects that expose curve state (e.g. Curves) -->
              <CurveEditor
                v-if="effectControls.get(n.id).state && effectControls.get(n.id).state.curves"
                :model-value="effectControls.get(n.id).state.curves"
                @update:model-value="onCurveEdit(n.id, $event)"
                @commit="persist"
              />
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
                <label v-else-if="spec.type === 'color'" class="color-row">
                  {{ spec.label ?? name }}
                  <input type="color" class="eff-color" :value="effectControls.get(n.id).values[name]" @input="setEffectParam(n.id, name, $event.target.value)" @pointerdown.stop />
                </label>
                <label v-else>
                  <span class="pjack" :ref="(el) => bindJack(n.id, name, el)" :data-jack-node="n.id" :data-jack-param="name" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, name)" />
                  {{ spec.label ?? name }}
                  <NumSlider :min="spec.min" :max="spec.max" :step="spec.step ?? 0.01" :model-value="effectControls.get(n.id).values[name]" @update:model-value="setEffectParam(n.id, name, $event)" />
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
            <!-- Same shaping as the per-mapping controls on the effect pages:
                 amount, smoothing, response curve and a gate/floor. -->
            <label>amount <NumSlider :min="-2" :max="2" :step="0.05" :model-value="n.params.scale" @update:model-value="n.params.scale = $event" @commit="persist" /></label>
            <label>offset <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.offset" @update:model-value="n.params.offset = $event" @commit="persist" /></label>
            <label>smooth <NumSlider :min="0" :max="0.98" :step="0.02" :model-value="n.params.smooth ?? 0" @update:model-value="n.params.smooth = $event" @commit="persist" /></label>
            <label>gate <NumSlider :min="0" :max="0.95" :step="0.01" :model-value="n.params.gate ?? 0" @update:model-value="n.params.gate = $event" @commit="persist" /></label>
            <label>curve
              <select v-model="n.params.curve" @change="persist" @pointerdown.stop>
                <option v-for="c in INPUT_CURVES" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.invert" @change="persist" @pointerdown.stop /> invert</label>
          </template>
          <template v-if="n.type === 'tracker'">
            <div class="media-hint">Tracks the brightest blob. Wire a video source into the port on the left, or turn the webcam on and it tracks that. Outputs x / y / size — drag them to any param jack.</div>
            <label>threshold <NumSlider :min="0.05" :max="0.95" :step="0.01" :model-value="n.params.thresh ?? 0.5" @update:model-value="n.params.thresh = $event" @commit="persist" /></label>
            <label>smoothing <NumSlider :min="0" :max="0.95" :step="0.01" :model-value="n.params.smooth ?? 0.7" @update:model-value="n.params.smooth = $event" @commit="persist" /></label>
          </template>
          <template v-if="n.type === 'blend'">
            <select v-model="n.params.mode" @change="persist" @pointerdown.stop>
              <option v-for="b in BLENDS" :key="b" :value="b">{{ b }}</option>
            </select>
            <label><span class="pjack" :ref="(el) => bindJack(n.id, 'mix', el)" :data-jack-node="n.id" data-jack-param="mix" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'mix')" /> mix <NumSlider :min="0" :max="1" :step="0.02" :model-value="n.params.mix ?? 1" @update:model-value="n.params.mix = $event" @commit="persist" /></label>
            <label class="chk"><input type="checkbox" v-model="n.params.swap" @change="persist" @pointerdown.stop /> swap A/B order</label>
          </template>
          <template v-if="n.type === 'geo'">
            <div class="media-hint">A 3D geometry source — wire it into a <b>Camera</b> node. Choose a procedural shape, a point cloud (procedural or imported .ply/.xyz), or a voxel grid.</div>
            <label>data
              <select :value="n.params.source || 'Shape'" @change="n.params.source = $event.target.value; persist()" @pointerdown.stop>
                <option v-for="sr in GEO_SOURCES" :key="sr" :value="sr">{{ sr }}</option>
              </select>
            </label>
            <template v-if="(n.params.source || 'Shape') === 'Shape'">
              <label>shape
                <select v-model="n.params.shape" @change="persist" @pointerdown.stop>
                  <option v-for="sh in GEO_SHAPES" :key="sh" :value="sh">{{ sh }}</option>
                </select>
              </label>
              <label>material
                <select v-model="n.params.material" @change="persist" @pointerdown.stop>
                  <option v-for="m in GEO_MATERIALS" :key="m" :value="m">{{ m }}</option>
                </select>
              </label>
              <template v-if="n.params.shape === 'Gaudí column'">
                <label>flutes <NumSlider :min="3" :max="20" :step="1" :model-value="n.params.flutes ?? 8" @update:model-value="n.params.flutes = $event" @commit="persist" /></label>
                <label>twist <NumSlider :min="-360" :max="360" :step="5" :model-value="n.params.twist ?? 90" @update:model-value="n.params.twist = $event" @commit="persist" /></label>
                <label>groove <NumSlider :min="0" :max="0.6" :step="0.01" :model-value="n.params.groove ?? 0.28" @update:model-value="n.params.groove = $event" @commit="persist" /></label>
              </template>
            </template>
            <template v-else-if="n.params.source === 'Point cloud'">
              <label>cloud
                <select v-model="n.params.cloud" @change="persist" @pointerdown.stop>
                  <option v-for="cl in GEO_CLOUDS" :key="cl" :value="cl">{{ cl }}</option>
                </select>
              </label>
              <label v-if="n.params.cloud !== 'Imported'">points <NumSlider :min="500" :max="120000" :step="500" :model-value="n.params.count ?? 12000" @update:model-value="n.params.count = $event" @commit="persist" /></label>
              <label>point size <NumSlider :min="0.005" :max="0.12" :step="0.005" :model-value="n.params.pointSize ?? 0.03" @update:model-value="n.params.pointSize = $event" @commit="persist" /></label>
              <div class="shape-row"><button class="shape-btn" @pointerdown.stop @click="importGeoPointFile(n)">import .ply / .las / .xyz</button></div>
            </template>
            <template v-else-if="n.params.source === 'Voxel'">
              <label>voxels
                <select v-model="n.params.voxel" @change="persist" @pointerdown.stop>
                  <option v-for="vx in GEO_VOXELS" :key="vx" :value="vx">{{ vx }}</option>
                </select>
              </label>
              <label>resolution <NumSlider :min="6" :max="46" :step="1" :model-value="n.params.res ?? 18" @update:model-value="n.params.res = $event" @commit="persist" /></label>
            </template>
            <template v-else>
              <div class="media-hint">Real-world 3D terrain from public elevation tiles, draped with satellite imagery. {{ settings.mapKey ? '' : 'Free Terrarium DEM by default.' }}</div>
              <label>latitude <NumSlider :min="-85" :max="85" :step="0.01" :model-value="n.params.lat ?? 46.5" @update:model-value="n.params.lat = $event" @commit="persist" /></label>
              <label>longitude <NumSlider :min="-180" :max="180" :step="0.01" :model-value="n.params.lon ?? 8" @update:model-value="n.params.lon = $event" @commit="persist" /></label>
              <label>zoom <NumSlider :min="6" :max="14" :step="1" :model-value="n.params.zoom ?? 11" @update:model-value="n.params.zoom = $event" @commit="persist" /></label>
              <label>resolution <NumSlider :min="16" :max="180" :step="4" :model-value="n.params.terrainRes ?? 96" @update:model-value="n.params.terrainRes = $event" @commit="persist" /></label>
              <label>height <NumSlider :min="0.1" :max="2" :step="0.05" :model-value="n.params.verticalScale ?? 0.6" @update:model-value="n.params.verticalScale = $event" @commit="persist" /></label>
              <label class="chk"><input type="checkbox" :checked="n.params.drape !== false" @change="n.params.drape = $event.target.checked; persist()" @pointerdown.stop /> drape satellite</label>
              <div class="shape-row">
                <button class="shape-btn" @pointerdown.stop @click="geoGoto(n, 'grand')">Grand Canyon</button>
                <button class="shape-btn" @pointerdown.stop @click="geoGoto(n, 'alps')">Alps</button>
              </div>
            </template>
            <label>color <ColorField v-model:h="n.params.hue" v-model:s="n.params.sat" v-model:v="n.params.val" @change="persist" /></label>
            <label v-if="(n.params.source || 'Shape') !== 'Voxel'">displace <NumSlider :min="0" :max="1" :step="0.01" :model-value="n.params.displace" @update:model-value="n.params.displace = $event" @commit="persist" /></label>
            <label>frequency <NumSlider :min="0.5" :max="6" :step="0.1" :model-value="n.params.freq" @update:model-value="n.params.freq = $event" @commit="persist" /></label>
            <label>spin <NumSlider :min="0" :max="3" :step="0.05" :model-value="n.params.spin" @update:model-value="n.params.spin = $event" @commit="persist" /></label>
            <label>detail <NumSlider :min="0" :max="4" :step="1" :model-value="n.params.detail" @update:model-value="n.params.detail = $event" @commit="persist" /></label>
          </template>
          <template v-if="n.type === 'vcam'">
            <div class="media-hint">Wire Geometry nodes into the ports on the left.</div>
            <label>field of view <NumSlider :min="20" :max="100" :step="1" :model-value="n.params.fov" @update:model-value="n.params.fov = $event" @commit="persist" /></label>
            <label>distance <NumSlider :min="2" :max="10" :step="0.1" :model-value="n.params.distance" @update:model-value="n.params.distance = $event" @commit="persist" /></label>
            <label>orbit speed <NumSlider :min="0" :max="3" :step="0.05" :model-value="n.params.orbit" @update:model-value="n.params.orbit = $event" @commit="persist" /></label>
            <label>tilt <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.tilt" @update:model-value="n.params.tilt = $event" @commit="persist" /></label>
            <label>light color <ColorField v-model:h="n.params.lightHue" v-model:s="n.params.lightSat" v-model:v="n.params.lightVal" @change="persist" /></label>
            <label>background
              <select v-model="n.params.bg" @change="persist" @pointerdown.stop>
                <option value="Dark">Dark</option>
                <option value="Transparent">Transparent</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" :checked="n.params.spin !== false" @change="n.params.spin = $event.target.checked; persist()" @pointerdown.stop /> auto-orbit</label>
          </template>
          <template v-if="n.type === 'media'">
            <label>source
              <select v-model="n.params.mode" @change="persist" @pointerdown.stop>
                <option value="camera">📷 Camera{{ cameraOn ? '' : ' (off)' }}</option>
                <option value="screen">🖥 Screen{{ screenOn ? '' : ' (off)' }}</option>
                <option value="library">🎞 Library</option>
              </select>
            </label>
            <div v-if="n.params.mode === 'screen'">
              <button class="load-btn" :title="screenOn ? 'Stop sharing your screen' : 'Share a window or screen (live)'" @pointerdown.stop @click="toggleScreen">{{ screenOn ? '■ Stop screen share' : '🖥 Share screen…' }}</button>
              <div v-if="!screenOn" class="media-hint">Live screen/window capture — click “Share screen” and pick a source.</div>
            </div>
            <label v-if="n.params.mode === 'library'">clip
              <select :value="n.params.mediaId" @change="pickMedia(n, +$event.target.value)" @pointerdown.stop>
                <option v-if="!mediaLibrary.length" :value="null" disabled>— load files below —</option>
                <option v-for="m in mediaLibrary" :key="m.id" :value="m.id">{{ m.kind === 'video' ? '▶' : '🖼' }} {{ m.name }}</option>
              </select>
            </label>
            <button class="load-btn" title="Open the import wizard — files, URL, screen, Google Photos, point clouds, maps" @pointerdown.stop @click="wizOpen = true">🧭 Import wizard…</button>
            <label class="load-btn" title="Load images or videos into the library" @pointerdown.stop>
              ＋ Load files
              <input type="file" accept="image/*,video/*" multiple hidden @change="loadMediaFiles(n, $event)" />
            </label>
            <button class="load-btn" :title="wizHasGoogle ? 'Import photos or videos from Google Photos' : 'Add a Google client ID in Settings first'" @pointerdown.stop @click="wizHasGoogle ? importGooglePhotos(n) : router.push({ name: 'settings' })">🖼 Google Photos{{ wizHasGoogle ? '' : ' (setup)' }}</button>
            <div v-if="n.params.mode === 'camera' && !cameraOn" class="media-hint">Camera is off — enable it with the webcam button in the toolbar.</div>
            <button v-if="n.params.mode === 'camera' && cameraOn" class="load-btn" title="Flip between the front and back camera" @pointerdown.stop @click="flipCamera">🔄 Flip camera</button>
          </template>
          <template v-if="n.type === 'geodata'">
            <div class="media-hint">Live map / satellite imagery for a place — a 2D image source. {{ settings.mapKey ? 'Using your ' + settings.mapProvider + ' key.' : 'Free public tiles (add a key in Settings for higher quality).' }}</div>
            <label>layer
              <select v-model="n.params.layer" @change="persist" @pointerdown.stop>
                <option v-for="l in GEO_LAYERS" :key="l" :value="l">{{ l }}</option>
              </select>
            </label>
            <label>latitude <NumSlider :min="-85" :max="85" :step="0.01" :model-value="n.params.lat" @update:model-value="n.params.lat = $event" @commit="persist" /></label>
            <label>longitude <NumSlider :min="-180" :max="180" :step="0.01" :model-value="n.params.lon" @update:model-value="n.params.lon = $event" @commit="persist" /></label>
            <label>zoom <NumSlider :min="1" :max="19" :step="1" :model-value="n.params.zoom" @update:model-value="n.params.zoom = $event" @commit="persist" /></label>
            <label>drift <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.drift" @update:model-value="n.params.drift = $event" @commit="persist" /></label>
            <div class="shape-row">
              <button class="shape-btn" title="Jump to a preset place" @pointerdown.stop @click="geoGoto(n, 'grand')">Grand Canyon</button>
              <button class="shape-btn" @pointerdown.stop @click="geoGoto(n, 'alps')">Alps</button>
              <button class="shape-btn" @pointerdown.stop @click="geoGoto(n, 'tokyo')">Tokyo</button>
            </div>
          </template>
          <template v-if="n.type === 'text'">
            <textarea class="text-in" rows="2" :value="n.params.text" placeholder="type…&#10;(enter for a new line)" @input="n.params.text = $event.target.value; persist()" @pointerdown.stop @keydown.stop></textarea>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'font', el)" :data-jack-node="n.id" data-jack-param="font" title="control input — map an Input / XY / Tracker here to scan through fonts" @pointerdown.stop @pointerup.stop="endLink(n, 'font')" />
              font
              <select v-model="n.params.font" @change="persist" @pointerdown.stop>
                <option v-for="f in fontList" :key="f" :value="f">{{ f }}</option>
              </select>
            </label>
            <button v-if="!systemFonts.length" class="load-btn" title="Use your installed system fonts (Chromium, asks permission)" @pointerdown.stop @click="loadSystemFonts">＋ System fonts</button>
            <label v-for="pk in ['size', 'weight', 'tracking', 'x', 'y', 'rotate']" :key="pk">
              <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
              {{ pk }}
              <NumSlider :min="PARAM_RANGES.text[pk][0]" :max="PARAM_RANGES.text[pk][1]" :step="(PARAM_RANGES.text[pk][1] - PARAM_RANGES.text[pk][0]) / 100" :model-value="n.params[pk]" @update:model-value="n.params[pk] = $event" @commit="persist" />
            </label>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'hue', el)" :data-jack-node="n.id" data-jack-param="hue" title="control input — drop an Input wire here" @pointerdown.stop @pointerup.stop="endLink(n, 'hue')" />
              color <ColorField v-model:h="n.params.hue" v-model:s="n.params.sat" v-model:v="n.params.val" @change="persist" />
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.italic" @change="persist" @pointerdown.stop /> italic</label>
            <label class="chk"><input type="checkbox" v-model="n.params.bg" @change="persist" @pointerdown.stop /> black background</label>
            <label>glow <NumSlider :min="0" :max="1.5" :step="0.05" :model-value="n.params.glow" @update:model-value="n.params.glow = $event" @commit="persist" /></label>
            <div class="seq-block">
              <label>text over time
                <select :value="n.params.seqMode || 'off'" @change="n.params.seqMode = $event.target.value; persist()" @pointerdown.stop>
                  <option value="off">off (static)</option>
                  <option value="timed">timed lyrics</option>
                  <option value="beat">advance on beat</option>
                </select>
              </label>
              <template v-if="n.params.seqMode && n.params.seqMode !== 'off'">
                <textarea class="text-in" rows="3" :value="n.params.lyrics" placeholder="one line per lyric&#10;optional [mm:ss] timecodes" @input="n.params.lyrics = $event.target.value; persist()" @pointerdown.stop @keydown.stop></textarea>
                <label v-if="n.params.seqMode === 'timed'">seconds/line <NumSlider :min="0.3" :max="12" :step="0.1" :model-value="n.params.lineDur ?? 3" @update:model-value="n.params.lineDur = $event" @commit="persist" /></label>
                <label v-if="n.params.seqMode === 'timed'" class="chk"><input type="checkbox" :checked="n.params.loopSeq !== false" @change="n.params.loopSeq = $event.target.checked; persist()" @pointerdown.stop /> loop</label>
                <label>transition
                  <select :value="n.params.transition || 'None'" @change="n.params.transition = $event.target.value; persist()" @pointerdown.stop>
                    <option v-for="tr in TEXT_TRANSITIONS" :key="tr" :value="tr">{{ tr }}</option>
                  </select>
                </label>
                <label v-if="(n.params.transition || 'None') !== 'None'">transition time <NumSlider :min="0.05" :max="2" :step="0.05" :model-value="n.params.transDur ?? 0.4" @update:model-value="n.params.transDur = $event" @commit="persist" /></label>
                <div class="shape-hint">One line per lyric. Prefix with <b>[mm:ss]</b> to pin a line to a time; “advance on beat” needs the mic on.</div>
              </template>
            </div>
          </template>
          <template v-if="n.type === 'portal'">
            <div class="portal-grid">
              <span class="portal-lbl">from</span>
              <label v-for="pk in ['srcX', 'srcY', 'srcW', 'srcH']" :key="pk" class="portal-cell">
                <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
                {{ pk.slice(3).toLowerCase() }}
                <NumSlider :min="0" :max="1" :step="0.01" :model-value="n.params[pk]" @update:model-value="n.params[pk] = $event" @commit="persist" />
              </label>
              <span class="portal-lbl">to</span>
              <label v-for="pk in ['dstX', 'dstY', 'dstW', 'dstH']" :key="pk" class="portal-cell">
                <span class="pjack" :ref="(el) => bindJack(n.id, pk, el)" :data-jack-node="n.id" :data-jack-param="pk" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, pk)" />
                {{ pk.slice(3).toLowerCase() }}
                <NumSlider :min="0" :max="1" :step="0.01" :model-value="n.params[pk]" @update:model-value="n.params[pk] = $event" @commit="persist" />
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
            <label>recurse <NumSlider :min="1" :max="8" :step="1" :model-value="n.params.recurse" @update:model-value="n.params.recurse = $event" @commit="persist" /></label>
            <label class="chk"><input type="checkbox" v-model="n.params.border" @change="persist" @pointerdown.stop /> outline</label>
          </template>

          <template v-if="n.type === 'polygon'">
            <div class="media-hint">A matte shape — outputs a white polygon on black. Wire it into a <b>Mask</b> node's matte input to cut a picture to this shape (the Mask's “invert matte” flips it).</div>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'feather', el)" :data-jack-node="n.id" data-jack-param="feather" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'feather')" />
              feather <NumSlider :min="0" :max="0.5" :step="0.01" :model-value="n.params.feather" @update:model-value="n.params.feather = $event" @commit="persist" />
            </label>
            <label>starter shape
              <select value="" title="Load a basic shape to start from (corners stay editable)" @change="applyPolyShape(n.id, $event.target.value); $event.target.value = ''" @pointerdown.stop>
                <option value="">choose a shape…</option>
                <option v-for="s in Object.keys(POLY_SHAPES)" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <div class="shape-row">
              <button v-if="!n.params.svg" class="shape-btn" :class="{ on: maskEdit }" @pointerdown.stop @click="maskEdit = !maskEdit">{{ maskEdit ? 'editing points' : 'edit points' }}</button>
              <button class="shape-btn" @pointerdown.stop @click="importSvgToShape(n.id)">import SVG</button>
              <button v-if="n.params.svg" class="shape-btn" @pointerdown.stop @click="clearSvgShape(n.id)">clear SVG</button>
              <button class="shape-btn" @pointerdown.stop @click="resetShape(n.id)">reset</button>
            </div>
            <div class="shape-hint">
              <template v-if="n.params.svg">Showing an imported SVG (holes preserved). “clear SVG” returns to the editable polygon.</template>
              <template v-else>Turn on “edit points”, then drag the corners on the output. Double-click an edge to add a point, a point to remove it. Or “import SVG” to use a vector file as the matte.</template>
            </div>
          </template>

          <template v-if="n.type === 'sprite'">
            <div class="media-hint">A loaded image or sprite-sheet placed in the frame. Position, size, rotation &amp; opacity have control jacks (▣) — wire an Input / XY&nbsp;Pad / Tracker into them to fly it around and keyframe it through time. Wire this node into a <b>Blend</b> to overlay it.</div>
            <div class="shape-row">
              <button class="shape-btn" @pointerdown.stop @click="pickSpriteFile(n)">{{ spriteName(n) ? 'change image' : 'load image' }}</button>
              <button v-if="n.params.mediaId != null || n.params.src" class="shape-btn" @pointerdown.stop @click="n.params.mediaId = null; delete n.params.src; persist()">clear</button>
            </div>
            <label v-if="mediaLibrary.some((m) => m.kind === 'image')">from library
              <select :value="n.params.mediaId ?? ''" @change="n.params.mediaId = $event.target.value === '' ? null : +$event.target.value; delete n.params.src; persist()" @pointerdown.stop>
                <option value="">—</option>
                <option v-for="m in mediaLibrary.filter((x) => x.kind === 'image')" :key="m.id" :value="m.id">🖼 {{ m.name }}</option>
              </select>
            </label>
            <div v-if="spriteName(n)" class="shape-hint">{{ spriteName(n) }}</div>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'x', el)" :data-jack-node="n.id" data-jack-param="x" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'x')" />
              x <NumSlider :min="0" :max="1" :step="0.01" :model-value="n.params.x" @update:model-value="n.params.x = $event" @commit="persist" />
            </label>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'y', el)" :data-jack-node="n.id" data-jack-param="y" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'y')" />
              y <NumSlider :min="0" :max="1" :step="0.01" :model-value="n.params.y" @update:model-value="n.params.y = $event" @commit="persist" />
            </label>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'scale', el)" :data-jack-node="n.id" data-jack-param="scale" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'scale')" />
              scale <NumSlider :min="0.02" :max="2" :step="0.01" :model-value="n.params.scale" @update:model-value="n.params.scale = $event" @commit="persist" />
            </label>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'rotate', el)" :data-jack-node="n.id" data-jack-param="rotate" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'rotate')" />
              rotate <NumSlider :min="-180" :max="180" :step="1" :model-value="n.params.rotate" @update:model-value="n.params.rotate = $event" @commit="persist" />
            </label>
            <label>
              <span class="pjack" :ref="(el) => bindJack(n.id, 'opacity', el)" :data-jack-node="n.id" data-jack-param="opacity" title="control input" @pointerdown.stop @pointerup.stop="endLink(n, 'opacity')" />
              opacity <NumSlider :min="0" :max="1" :step="0.02" :model-value="n.params.opacity" @update:model-value="n.params.opacity = $event" @commit="persist" />
            </label>
            <label>motion
              <select :value="n.params.motion" @change="n.params.motion = $event.target.value; persist()" @pointerdown.stop>
                <option v-for="m in SPRITE_MOTIONS" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label v-if="n.params.motion !== 'None'">speed <NumSlider :min="0" :max="3" :step="0.05" :model-value="n.params.speed" @update:model-value="n.params.speed = $event" @commit="persist" /></label>
            <label v-if="n.params.motion !== 'None' && n.params.motion !== 'Spin'">amount <NumSlider :min="0" :max="0.5" :step="0.01" :model-value="n.params.amp" @update:model-value="n.params.amp = $event" @commit="persist" /></label>
            <label>auto-spin <NumSlider :min="-2" :max="2" :step="0.05" :model-value="n.params.spin" @update:model-value="n.params.spin = $event" @commit="persist" /></label>
            <div class="sprite-sheet">
              <span class="portal-lbl">Sprite-sheet (frames)</span>
              <label>cols <NumSlider :min="1" :max="16" :step="1" :model-value="n.params.cols" @update:model-value="n.params.cols = $event" @commit="persist" /></label>
              <label>rows <NumSlider :min="1" :max="16" :step="1" :model-value="n.params.rows" @update:model-value="n.params.rows = $event" @commit="persist" /></label>
              <label v-if="(n.params.cols || 1) * (n.params.rows || 1) > 1">fps <NumSlider :min="1" :max="30" :step="1" :model-value="n.params.fps" @update:model-value="n.params.fps = $event" @commit="persist" /></label>
            </div>
          </template>

          <template v-if="n.type === 'mask'">
            <div class="media-hint">Cuts a picture to a shape. Wire the picture into <b>content</b> and a matte into <b>mask</b> — the matte’s brightness sets what shows through (bright = keep). To <em>mix</em> two pictures instead, use a Blend node.</div>
            <label>strength <NumSlider :min="0" :max="1" :step="0.02" :model-value="n.params.strength ?? 1" @update:model-value="n.params.strength = $event" @commit="persist" /></label>
            <label class="chk"><input type="checkbox" v-model="n.params.invert" @change="persist" @pointerdown.stop /> invert matte</label>
          </template>

          <template v-if="n.type === 'xy'">
            <div class="media-hint">Drag on the pad above to set X / Y — its output jacks drive linked params. Drag the pad's bottom-right corner to resize it.</div>
            <div class="xy-range">
              <span class="portal-lbl">X output range</span>
              <label>min <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.xMin ?? 0" @update:model-value="n.params.xMin = $event" @commit="persist" /></label>
              <label>max <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.xMax ?? 1" @update:model-value="n.params.xMax = $event" @commit="persist" /></label>
              <span class="portal-lbl">Y output range</span>
              <label>min <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.yMin ?? 0" @update:model-value="n.params.yMin = $event" @commit="persist" /></label>
              <label>max <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.yMax ?? 1" @update:model-value="n.params.yMax = $event" @commit="persist" /></label>
            </div>
            <label>response curve
              <select v-model="n.params.curve" @change="persist" @pointerdown.stop>
                <option v-for="c in INPUT_CURVES" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" v-model="n.params.recenter" @change="persist" @pointerdown.stop /> spring back to centre on release</label>
            <div class="shape-row">
              <button class="shape-btn" @pointerdown.stop @click="n.params.x = 0.5; n.params.y = 0.5; persist()">reset to centre</button>
              <button class="shape-btn" @pointerdown.stop @click="n.params.padW = NODE_W; n.params.padH = THUMB_H; persist()">reset size</button>
            </div>
          </template>

          <template v-if="n.type === 'output'">
            <div class="media-hint">The final mix. Wire your last node into the port on the left — this is what the show displays.</div>
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

    <!-- media ingest wizard -->
    <div v-if="wizOpen" class="wiz-backdrop" @pointerdown.self="wizOpen = false">
      <div class="wiz" @pointerdown.stop>
        <div class="wiz-head">
          <v-icon icon="mdi-tray-arrow-down" size="18" class="mr-2" />
          <span class="wiz-title">Import content</span>
          <span class="show-spacer" />
          <v-btn icon="mdi-close" size="x-small" variant="text" @click="wizOpen = false" />
        </div>
        <div class="wiz-grid">
          <button class="wiz-card" @click="wizUploadFiles">
            <v-icon icon="mdi-file-image-outline" size="26" /><span>Images / Video</span><small>Files → Media / Sprite</small>
          </button>
          <button class="wiz-card" @click="wizFromUrl">
            <v-icon icon="mdi-link-variant" size="26" /><span>From URL</span><small>Paste an image/video link</small>
          </button>
          <button class="wiz-card" @click="wizScreenLive">
            <v-icon icon="mdi-monitor-share" size="26" /><span>Screen capture</span><small>Live window/screen source</small>
          </button>
          <button class="wiz-card" @click="wizScreenGrab">
            <v-icon icon="mdi-monitor-screenshot" size="26" /><span>Screen snapshot</span><small>One still frame → Media</small>
          </button>
          <button class="wiz-card" :class="{ 'wiz-card--dim': !wizHasGoogle }" @click="wizHasGoogle ? wizGoogle() : router.push({ name: 'settings' })">
            <v-icon icon="mdi-google-photos" size="26" /><span>Google Photos</span><small>{{ wizHasGoogle ? 'Pick from your library' : 'Add a client ID in Settings' }}</small>
          </button>
          <button class="wiz-card" @click="wizPointCloud">
            <v-icon icon="mdi-dots-hexagon" size="26" /><span>Point cloud / LiDAR</span><small>.ply / .las / .xyz / .pts → Geometry</small>
          </button>
          <button class="wiz-card" @click="wizGeodata">
            <v-icon icon="mdi-map" size="26" /><span>Map / Satellite</span><small>Live tiles → Geodata node</small>
          </button>
          <button class="wiz-card" @click="wizTerrain">
            <v-icon icon="mdi-terrain" size="26" /><span>3D Terrain</span><small>Elevation → Geometry / Camera</small>
          </button>
        </div>
        <div class="wiz-note">Point clouds accept common LiDAR exports (.ply/.xyz/.pts). Maps &amp; terrain use free public tiles; add a provider key in Settings for higher quality.</div>
      </div>
    </div>

    <transition name="toast-fade">
      <div v-if="toast" class="save-toast"><v-icon icon="mdi-check-circle" size="16" class="mr-1" />{{ toast }}</div>
    </transition>

    <TourOverlay v-model="tourActive" :steps="tourSteps" @finish="finishTour" />
  </div>
</template>

<style scoped>
.patch { position: fixed; inset: 0; background: #0a0b0f; z-index: 2000; overflow: hidden; }
.stage { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
.sources { position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none; }
.sources iframe, .sources video { width: 384px; height: 216px; border: 0; }
.wiz-backdrop { position: fixed; inset: 0; z-index: 4000; background: rgba(5,6,10,0.6); display: flex; align-items: center; justify-content: center; }
.wiz { width: min(560px, 92vw); background: #14161e; border: 1px solid #2a2f40; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); overflow: hidden; }
.wiz-head { display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #cdd3e6; }
.wiz-title { font-weight: 600; font-size: 0.9rem; }
.wiz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; padding: 12px; }
.wiz-card {
  display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center;
  padding: 14px 8px; border-radius: 10px; cursor: pointer; color: #cdd3e6;
  background: #1a1d28; border: 1px solid #2a2f40;
}
.wiz-card:hover { border-color: #7c8cff; background: rgba(124,140,255,0.1); }
.wiz-card span { font-size: 0.78rem; font-weight: 600; margin-top: 4px; }
.wiz-card small { font-size: 0.64rem; color: #8a90a0; }
.wiz-card--dim { opacity: 0.7; }
.wiz-note { font-size: 0.66rem; color: #737b93; padding: 0 12px 12px; }
.nl-card { padding: 12px; background: #14161e; }
.nl-title { font-size: 0.82rem; font-weight: 600; color: #cdd3e6; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.nl-smart-toggle {
  font-size: 0.66rem; color: #9aa4c0; background: #1c1f2b; border: 1px solid #333;
  border-radius: 10px; padding: 2px 9px; cursor: pointer;
}
.nl-smart-toggle.on { background: rgba(124,140,255,0.18); border-color: #7c8cff; color: #b7c1ff; }
.nl-ai-notes { font-size: 0.74rem; color: #cdd3e6; margin: 2px 0 8px; font-style: italic; }
.nl-row { display: flex; align-items: center; margin-top: 8px; }
.nl-spacer { flex: 1; }
.nl-preview { margin-top: 10px; padding: 8px; border: 1px solid rgba(124,140,255,0.2); border-radius: 8px; background: rgba(124,140,255,0.05); }
.nl-pv-hint { font-size: 0.68rem; color: #9aa4c0; margin-bottom: 6px; }
.nl-pv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 5px; }
.nl-pv-key { font-size: 0.6rem; color: #737b93; flex: 0 0 auto; min-width: 46px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.02em; }
.nl-chip {
  font-size: 0.7rem; color: #cdd3e6; background: #2a2f42; border: 1px solid #3a4055;
  border-radius: 10px; padding: 2px 8px; cursor: pointer;
}
.nl-chip:hover { border-color: #ff8a8a; color: #fff; }
.nl-chip--f { background: rgba(201,140,255,0.16); }
.nl-chip--dim { background: #1c1f2b; color: #9aa4c0; cursor: default; }
.nl-chip--dim:hover { border-color: #3a4055; color: #cdd3e6; }
.nl-ignored { font-size: 0.66rem; color: #b08a5a; margin-top: 4px; }
.nl-examples { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.nl-ex-label { font-size: 0.68rem; color: #7f879c; }
.nl-ex {
  text-align: left; font-size: 0.72rem; color: #9db0ff; background: rgba(124,140,255,0.08);
  border: 1px solid rgba(124,140,255,0.18); border-radius: 6px; padding: 4px 7px; cursor: pointer;
}
.nl-ex:hover { background: rgba(124,140,255,0.16); }
.nl-last { margin-top: 10px; font-size: 0.7rem; color: #7f879c; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
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
.save-toast {
  position: absolute; right: 16px; bottom: 16px; z-index: 40;
  display: flex; align-items: center; padding: 9px 14px; border-radius: 10px;
  background: rgba(16, 32, 22, 0.92); border: 1px solid rgba(80, 220, 140, 0.4);
  color: #c8f5d8; font: 500 13px system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,0.45);
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; transform: translateY(10px); }
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
.node-type-ico { flex: 0 0 auto; margin-right: 4px; opacity: 0.85; }
.node-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-name-edit {
  flex: 1; min-width: 0; margin-right: 4px; background: rgba(255,255,255,0.7);
  border: 0; border-radius: 3px; padding: 1px 4px; font: 600 12px system-ui; color: #06070a;
}
.node-close { cursor: pointer; color: rgba(0,0,0,0.6); }
.node-warn { color: #ffd23f; margin-right: 2px; filter: drop-shadow(0 0 4px rgba(255,60,60,0.95)); cursor: help; }
/* live per-node render cost (ms/frame) — green under budget, amber/red over it */
.node-ms { margin-right: 3px; padding: 0 3px; border-radius: 3px; font: 9px ui-monospace, monospace; line-height: 14px; color: #bfe6c4; background: rgba(0,0,0,0.28); cursor: help; }
.node-ms.warn { color: #10141c; background: #ffd23f; }
.node-ms.bad { color: #fff; background: #ff4d4d; }
/* A slow node gets a prominent red outline + pulsing warning so it's obvious. */
.node--slow { outline: 2px solid #ff4d4d; outline-offset: 0; box-shadow: 0 0 0 2px rgba(255,77,77,0.35), 0 6px 20px rgba(0,0,0,0.4); }
.node--slow .node-warn { animation: warnPulse 1.4s ease-in-out infinite; }
@keyframes warnPulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
.node-lock { cursor: pointer; color: rgba(0,0,0,0.55); margin-right: 2px; }
.node-lock:hover { color: rgba(0,0,0,0.85); }
.node-keep-on { color: #2b6cff; }
.beat-jack { display: flex; align-items: center; gap: 6px; font: 11px system-ui; color: #cdd3e0; margin-top: 2px; }
.pjack--beat { background: #ff5a7a; }
.color-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.eff-color { width: 44px; height: 22px; padding: 0; border: 1px solid #333; border-radius: 4px; background: transparent; cursor: pointer; }
.overwrite-warn { border: 1px solid rgba(255, 176, 32, 0.5); background: rgba(255, 176, 32, 0.08); border-radius: 6px; padding: 6px 8px; }
.overwrite-warn .ow-msg { font: 11px system-ui; color: #ffcf87; line-height: 1.35; }
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
  resize: vertical; min-height: 30px;
}
.routing-rename { width: 100%; background: #12141c; color: #e8ecf5; border: 1px solid #3a4056; border-radius: 4px; font: 13px system-ui, sans-serif; padding: 2px 6px; }
.routing-preview { width: 46px; height: 30px; margin-right: 10px; border-radius: 4px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.12); flex: none; }
.routing-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
/* Autopilot control panel — a floating tab with transport + countdown + opts. */
.auto-panel {
  position: absolute; right: 12px; top: 96px; z-index: 42; width: 280px;
  display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
  background: rgba(12, 14, 20, 0.97); border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px);
  font: 12px system-ui, sans-serif; color: #cdd3e0;
}
.auto-fps { font: 11px ui-monospace, monospace; color: #9aa4c0; }
.auto-fps.low { color: #ff8a6a; }
.auto-opts { padding: 8px 12px 10px; }
.auto-row { font: 11px system-ui; color: #9aa4c0; margin-top: 4px; }
.auto-hint { font: 10px system-ui; color: #8a90a0; line-height: 1.4; margin: 8px 0 0; }
/* Countdown number wrapped in a circular progress ring (mirrors Autopilot). */
.countdown-ring { display: inline-grid; place-items: center; width: 34px; height: 34px; }
.countdown-ring svg { grid-area: 1 / 1; width: 34px; height: 34px; transform: rotate(-90deg); }
.countdown-ring .ring-bg { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 3; }
.countdown-ring .ring-fg { fill: none; stroke: #7c8cff; stroke-width: 3; stroke-linecap: round; transition: stroke-dashoffset 0.9s linear; }
.countdown-ring .ring-num { grid-area: 1 / 1; font: 600 10px/1 ui-monospace, monospace; color: #cdd3e0; }
.go-btn { font: 700 12px system-ui; color: #0a0b0f; background: #a0e060; border: 0; border-radius: 6px; padding: 5px 18px; cursor: pointer; letter-spacing: 0.08em; }
.go-btn:disabled { opacity: 0.4; cursor: default; }
.show-hint { font: 11px system-ui; color: #8a90a0; margin-left: 6px; }
.show-clock { font: 11px ui-monospace, monospace; color: #9aa4c0; min-width: 96px; }
.tl-track { position: relative; flex: 1; height: 22px; margin-left: 6px; border-radius: 6px; background: #1a1d28; border: 1px solid #2a2f40; cursor: pointer; overflow: hidden; }
.tl-fill { position: absolute; top: 0; bottom: 0; left: 0; background: rgba(124,140,255,0.22); }
.tl-cue { position: absolute; top: -1px; bottom: -1px; width: 3px; margin-left: -1.5px; background: #a0e060; cursor: ew-resize; }
.tl-cue.on { background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.7); }
/* Expanded timeline view: a labelled ruler over a taller keyframe lane. */
.show-transport--tl { flex-direction: column; align-items: stretch; gap: 6px; }
.tl-controls { display: flex; align-items: center; gap: 6px; }
.tl-hint { font: 10px system-ui; color: #737b93; margin-left: auto; }
.tl-timeline { position: relative; padding-top: 14px; }
.tl-ruler { position: absolute; top: 0; left: 6px; right: 0; height: 12px; }
.tl-tick { position: absolute; top: 0; transform: translateX(-50%); font: 9px ui-monospace, monospace; color: #808aa6; white-space: nowrap; }
.tl-tick::after { content: ''; position: absolute; left: 50%; top: 11px; width: 1px; height: 4px; background: #3a4055; }
.tl-track--tall { height: 40px; }
.tl-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.05); }
.tl-playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: #ffd166; box-shadow: 0 0 4px rgba(255,209,102,0.8); }
.tl-cue--tall { width: 4px; margin-left: -2px; border-radius: 2px; }
.tl-cue-lbl { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font: 9px ui-monospace, monospace; color: #0a0b0f; background: #a0e060; border-radius: 3px; padding: 0 3px; pointer-events: none; }
.tl-cue--tall.on .tl-cue-lbl { background: #fff; }
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
.pad-grip {
  position: absolute; width: 15px; height: 15px; z-index: 5; cursor: nwse-resize; touch-action: none;
  background: linear-gradient(135deg, transparent 46%, rgba(224,160,96,0.85) 46% 60%, transparent 60% 72%, rgba(224,160,96,0.85) 72% 86%, transparent 86%);
}
.xy-range { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 6px; align-items: center; margin-bottom: 4px; }
.xy-range .portal-lbl { grid-column: 1 / -1; }
.node-thumb :deep(canvas) { width: 100%; height: 100%; display: block; }
.node-body { padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
.node-body select, .node-body label { font: 11px system-ui, sans-serif; color: #cdd3e0; }
.node-body select { width: 100%; background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; }
.node-body input[type=range] { width: 100%; }
.node-body .chk { display: flex; align-items: center; gap: 4px; }
.knob-btn {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 4px; cursor: pointer;
  background: #12141c; color: #cdd3e0; border: 1px solid #333; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
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
/* geometry ports: a hexagon-ish cut so mesh wires read as their own kind */
.port--geometry { border-radius: 2px; border-color: #6ee7b7; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); }
.port--geometry:hover { border-color: #b6f5da; }
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
