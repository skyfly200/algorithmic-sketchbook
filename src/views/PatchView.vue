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
import { inputParams, groupInputSources } from '../lib/inputParams'
import { parsePointFile, parseLas, finalizePoints } from '../lib/points.js'
import { NL_TEXT_DEFAULTS, specNodeParams, resolveEffectMods } from '../lib/nlDesigner.js'
import NlDesigner from '../components/patch/NlDesigner.vue'
import MediaWizard from '../components/patch/MediaWizard.vue'
import AutopilotBar from '../components/patch/AutopilotBar.vue'
import ShowPanel from '../components/patch/ShowPanel.vue'
import { useAutopilot } from '../composables/useAutopilot.js'
import { useShow } from '../composables/useShow.js'
import { lonToTileX, latToTileY, mapTileUrl as tileUrl, terrainTileUrl as demTileUrl, decodeElev as demDecode } from '../lib/geoTiles.js'
import { hsvToHsl, hsvCss, geoSig, disposeObject, updateObject, drawGeoGlyph, createGeometryKit } from '../lib/patch/geometry.js'
import { POLY_SHAPES, PORTAL_SHAPES, portalShapePath, polyPath, svgToPathData } from '../lib/patch/shapes.js'
import { createRenderers } from '../lib/patch/renderers.js'
import { NODE_W, HEAD_H, THUMB_H, RESOLUTIONS, TYPES, OUT_LABELS, PARAM_RANGES, SPRITE_MOTIONS, TEXT_TRANSITIONS, TEXT_FONTS, BLENDS, MIX_BLENDS, ASPECTS, INPUT_CURVES, GEO_SHAPES, GEO_MATERIALS, GEO_SOURCES, GEO_CLOUDS, GEO_VOXELS, GEO_LAYERS, GEO_PLACES, PRESET_BLOCKS, NL_EXAMPLES, PATCH_TOUR_STEPS } from '../lib/patch/constants.js'
import { normalizeNodes, migrateGraph, applyCurve, usedInGraph, evalOrder as orderGraph, ancestorsOf as ancestorsIn, graphCost as costOfGraph, slugCost as costOfSlug, freeSpot as placeFree, layoutByDepth as layoutDepth } from '../lib/patch/graph.js'
import { loadJson, saveJson, fileSlug, downloadJson, pickJsonFile, captureBlockData, stampBlock, fillPreset, buildPatchFile, parsePatchImport } from '../lib/patch/library.js'
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

// Node box dimensions (px) live in ../lib/patch/constants.js.

// How many control/video outputs a node exposes (xy: x,y · tracker: x,y,size).
function outCount(n) {
  if (n.type === 'output') return 0
  if (n.type === 'xy') return 2
  if (n.type === 'tracker') return 3
  return 1
}
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
// Node catalogue, param ranges, blend lists, geometry/geodata option sets,
// polygon presets + path builders and the aspect presets live in
// ../lib/patch/{constants,shapes}.js.
// Input sources grouped for the pickers (per-category optgroups). The grouping
// (incl. MIDI hidden until set up) lives in ../lib/inputParams.js.
const INPUT_GROUPS = computed(() => groupInputSources(INPUT_SOURCES, { midiEnabled: settings.midiEnabled }))

// --- persisted graph ---
const STORE_KEY = 'sketchbook-patch'
function loadGraph() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    return null
  }
}
// normalizeNodes (legacy save migration) + migrateGraph (Polygon-Mask rewire)
// live in ../lib/patch/graph.js.
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
                      ? { layer: 'Satellite', lat: 36.06, lon: -112.14, zoom: 12, driftX: 0.15, driftY: 0, driftRandom: false }
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
// A node is "used in the graph" when it participates in any video edge or
// control link. A reroll/rebuild protects a locked or pinned node only when it's
// actually wired in — a locked node left disconnected is clutter, so it's
// cleared with the rest instead of being dragged into (and re-integrated with)
// every new patch. (Locking still protects a used node from manual removal.)
// Whether a locked/pinned node survives a reroll. Under the 'ditch' orphan
// policy it must also be wired into the graph (a disconnected orphan is cleared);
// under 'keep'/'reintegrate' every locked/pinned node is protected.
function protectedInReroll(n) {
  if (!(n.locked || n.keep)) return false
  return settings.orphanPolicy === 'ditch' ? usedInGraph(n.id, edges, links) : true
}
// Masks, when used, cut a picture to a proper matte (a Polygon or Text), not a
// second picture. Goes through persist(), so it's a single undo step. Drives
// both the RNG dice and the Patch auto-reroll.
function randomPatch() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const chance = (p) => Math.random() < p

  // Keep locked / kept nodes (and any wiring purely among them); randomize the
  // rest. "keep" (pin) protects from reshuffle without locking editing.
  const keptIds = new Set(nodes.filter(protectedInReroll).map((n) => n.id))
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
  // Only under the 'reintegrate' policy — 'keep' leaves orphans where they are.
  const PRODUCER = new Set(['effect', 'filter', 'media', 'text', 'portal', 'blend', 'vcam', 'mask'])
  const keptOut = keptNodes.find((n) => n.type === 'output')
  if (keptOut) { for (let i = edges.length - 1; i >= 0; i--) if (edges[i].to === keptOut.id) edges.splice(i, 1) }
  if (settings.orphanPolicy === 'reintegrate') {
    for (const kn of keptNodes) {
      if (PRODUCER.has(kn.type) && !edges.some((e) => e.from === kn.id)) heads.push(kn)
    }
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
// The NL designer's panel + parse/AI/voice live in the <NlDesigner> add-in
// (src/components/patch/NlDesigner.vue); it emits an intent or an AI spec and
// the graph-building below turns that into nodes. nlLast is the panel's
// "Last: …" summary; nlRef lets us close the panel after a successful build.
const nlLast = ref('')
const nlRef = ref(null)
function onBuildIntent(it) { if (buildFromIntent(it)) nlRef.value?.close() }
function onBuildSpec(spec) { if (buildFromSpec(spec)) nlRef.value?.close() }

// Queue adjective/colour mods for an effect/filter node, applied once its sketch
// announces its schema (via onEffectMessage), so we know which params exist.
const nlPendingMods = new Map() // node id -> { mods, color }
function queueNlMods(node, it) {
  if (Object.keys(it.mods).length || it.color) nlPendingMods.set(node.id, { mods: it.mods, color: it.color })
}
function applyNlMods(id, { mods, color }) {
  const c = effectControls.get(id)
  if (!c?.schema) return
  for (const [name, value] of resolveEffectMods(c.schema, mods, color)) setEffectParam(id, name, value)
}

// Build the graph from the (possibly edited) intent emitted by the designer.
// Returns true on success so the caller can dismiss the panel.
function buildFromIntent(it) {
  if (!it) return false

  const keptIds = new Set(nodes.filter(protectedInReroll).map((n) => n.id))
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
  if (!sources.length) { showToast('No sources available'); return false }

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
  return true
}

// Lay the graph out left-to-right by dependency depth (longest path from a source).
const layoutByDepth = (newIds) => layoutDepth(newIds, nodes, edges)

// Build the graph from Claude's AI spec. Returns true on success.
function buildFromSpec(spec) {
  if (!spec || !Array.isArray(spec.nodes)) { showToast('AI returned no usable patch'); return false }
  const specCtx = {
    effectSlugs: new Set(effectOptions.value.map((s) => s.slug)),
    filterSlugs: new Set(filterOptions.value.map((s) => s.slug)),
    inputSlugs: new Set(INPUT_SOURCES),
    blends: BLENDS, polyShapes: POLY_SHAPES,
    fallbackEffect: effectOptions.value[0]?.slug ?? '', fallbackFilter: filterOptions.value[0]?.slug ?? '',
    seed: randSeed, nodeW: NODE_W, thumbH: THUMB_H,
  }

  // clear everything except locked / kept nodes
  const keptIds = new Set(nodes.filter(protectedInReroll).map((n) => n.id))
  for (let k = edges.length - 1; k >= 0; k--) if (!keptIds.has(edges[k].from) || !keptIds.has(edges[k].to)) edges.splice(k, 1)
  for (let k = links.length - 1; k >= 0; k--) if (!keptIds.has(links[k].from) || !keptIds.has(links[k].node)) links.splice(k, 1)
  for (let k = nodes.length - 1; k >= 0; k--) if (!keptIds.has(nodes[k].id)) { const id = nodes[k].id; nodes.splice(k, 1); disposeRuntime(id); rtState.delete(id); effectControls.delete(id); nlPendingMods.delete(id) }
  if (keptIds.size) nextId = Math.max(nextId, ...keptIds) + 1

  const idMap = new Map()
  const newIds = []
  for (const n of spec.nodes) {
    if (!n || !TYPES[n.type]) continue
    const params = specNodeParams(n, specCtx)
    const rn = reactive({ id: nextId++, type: n.type, x: 0, y: 0, params })
    nodes.push(rn); st(rn.id); idMap.set(n.id, rn.id); newIds.push(rn.id)
  }
  if (!newIds.length) { showToast('AI returned no usable nodes'); return false }

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
  return true
}

// All nodes that feed (directly or transitively) into `id` via video edges.
const ancestorsOf = (id) => ancestorsIn(id, edges)
// Replace the whole branch feeding a node: remove every (unlocked) node upstream
// of it and grow a fresh random source into each of its now-empty input ports.
const NODE_H = HEAD_H + THUMB_H + 24
const freeSpot = (x, y, ignore = new Set()) => placeFree(x, y, nodes, { nodeW: NODE_W, nodeH: NODE_H, ignore })
const pk = (a) => a[Math.floor(Math.random() * a.length)] // random pick, for reroll
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
// The transport state + move engine live in ../composables/useAutopilot.js and
// the panel in <AutopilotBar>; `ap` (created below, once its graph-mutating deps
// exist) is the instance. The per-sketch cost model it uses stays here.
const slugCost = (slug) => costOfSlug(slug, perfScores)
const graphCost = () => costOfGraph(nodes, perfScores)
function slugPool(n) {
  const base = n.type === 'filter' ? filterOptions.value : settings.filterToPool(effectOptions.value)
  return base.length ? base : (n.type === 'filter' ? filterOptions.value : effectOptions.value)
}
// The autopilot instance — its deps (randomPatch/rerollUpstream/undo/persist are
// hoisted functions; fps is a ref declared later, so it's read via a getter).
const ap = useAutopilot({
  nodes, edges, TYPES, BLENDS,
  fps: () => fps.value,
  slugPool, slugCost, graphCost, persist, randomPatch, rerollUpstream, undo,
})
// The node card shows a "keep" pin only on nodes autopilot might touch.
const autoCanTouch = ap.canTouch

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
// applyCurve (input response reshape) lives in ../lib/patch/graph.js.
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
// postMessage can't structured-clone a Vue reactive proxy, and effect payloads
// (values/mappings/state) come straight from the reactive effectControls store.
// JSON round-trip yields a plain deep copy — exact here, since every effect
// payload is scene/param data that already survives JSON (it's what we persist).
const plain = (x) => JSON.parse(JSON.stringify(x))
function postToEffect(id, msg) {
  const win = rtState.get(id)?.iframe?.contentWindow
  if (!win) return
  // Fast path for primitive-carrying messages (set-param streams every frame);
  // only pay the clone cost when a reactive proxy actually blocks the post.
  try { win.postMessage(msg, '*') } catch { win.postMessage(plain(msg), '*') }
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
// The THREE geometry builders live in ../lib/patch/geometry.js; bind them to the
// lazily-loaded module the first time the Camera needs one.
let geoKit = null
function gkit() { if (!geoKit && THREE) geoKit = createGeometryKit(THREE); return geoKit }
// --- 3D terrain from public elevation (DEM) tiles --------------------------
function loadCorsImage(url) { return new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url }) }
// (terrainTileUrl / decodeElev live in ../lib/geoTiles.js; wrappers inject settings.)
function terrainTileUrl(z, x, y) { return demTileUrl(z, x, y, settings.mapKey, settings.mapProvider) }
function decodeElev(r, g, b) { return demDecode(r, g, b, settings.mapKey, settings.mapProvider) }
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
// parsePointFile / parseLas / finalizePoints / heightRamp / intensityRamp
// live in ../lib/points.js (pure ingest logic, unit-tested).
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
          data = finalizePoints(raw.xs, raw.count, raw.colors, raw.intensity)
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
// disposeObject / updateObject / geoWire / drawGeoGlyph live in
// ../lib/patch/geometry.js (framework-free; drawGeoGlyph takes the canvas size).
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
  drawGeoGlyph(octx, t * (0.4 + (p.spin ?? 0.5) * 0.6), p.hue ?? 160, p.displace ?? 0, p.shape ?? 'Box', p.sat, p.val, W, H)
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
      obj = gkit().buildGeoObject(geo); three.meshes.set(id, obj); three.scene.add(obj)
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
// Tile URL: free no-key public sources by default; a MapTiler/Mapbox key
// (Settings) upgrades the imagery. (Web Mercator math + provider URLs live in
// ../lib/geoTiles.js; these wrappers inject the current key/provider.)
function mapTileUrl(layer, z, x, y) { return tileUrl(layer, z, x, y, settings.mapKey, settings.mapProvider) }
function drawGeodata(node, octx) {
  const p = node.params
  const z = Math.max(1, Math.min(19, Math.round(p.zoom ?? 12)))
  const n2 = 2 ** z
  const now = performance.now()
  const dt = node._geoLast ? Math.min(0.05, (now - node._geoLast) / 1000) : 0.016; node._geoLast = now
  // Independent east/west (X) and north/south (Y) drift, in tiles. `drift` is the
  // legacy single-axis value → east/west. Random mode wanders both axes via a
  // damped random walk scaled by the drift magnitudes.
  const dvx = p.driftX ?? p.drift ?? 0, dvy = p.driftY ?? 0
  if (p.driftRandom) {
    const amt = Math.max(Math.abs(dvx), Math.abs(dvy), 0.2)
    node._geoVX = (node._geoVX ?? 0) * 0.98 + (Math.random() - 0.5) * amt * 0.05
    node._geoVY = (node._geoVY ?? 0) * 0.98 + (Math.random() - 0.5) * amt * 0.05
    node._geoPanX = (node._geoPanX ?? 0) + node._geoVX * dt * 0.12
    node._geoPanY = (node._geoPanY ?? 0) + node._geoVY * dt * 0.12
  } else {
    node._geoPanX = (node._geoPanX ?? 0) + dvx * dt * 0.12
    node._geoPanY = (node._geoPanY ?? 0) + dvy * dt * 0.12
  }
  const cxT = lonToTileX(p.lon ?? 0, z) + node._geoPanX
  const cyT = latToTileY(p.lat ?? 0, z) + node._geoPanY
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

function geoGoto(node, key) { const g = GEO_PLACES[key]; if (g) { Object.assign(node.params, g); node._geoPanX = 0; node._geoPanY = 0; node._geoVX = 0; node._geoVY = 0; persist() } }

// Per-node-type renderers live in ../lib/patch/renderers.js. Bind them to the
// view's live compositor helpers once; geo/vcam/geodata keep their own
// evaluators here. evalNode clears the canvas then dispatches with (W, H).
const NODE_RENDERERS = {
  ...createRenderers({ cover, inputCanvas, pval, mediaEl, spriteImg, textSequence, inputValue, clamp }),
  geo: (n, octx) => evalGeo(n, octx), vcam: (n, octx) => evalCamera(n, octx), geodata: (n, octx) => drawGeodata(n, octx),
}
function evalNode(node) {
  const s = st(node.id)
  const octx = s.octx
  octx.globalCompositeOperation = 'source-over'
  octx.globalAlpha = 1
  octx.filter = 'none'
  octx.fillStyle = '#000'
  octx.fillRect(0, 0, W, H)
  NODE_RENDERERS[node.type]?.(node, octx, s, W, H)
}

// Topological order (cycles tolerated: leftovers appended → 1-frame feedback).
const evalOrder = () => orderGraph(nodes, edges)

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
  if (show.state.mode === 'timeline' && show.state.playing) show.tickShow(now)
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
      show.drawXfade(cx, cnv)
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
// svgElToPath / svgToPathData live in ../lib/patch/shapes.js.
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

// Effect scenes: each effect sketch's own param values + input mappings, keyed
// by node id. Captured with the patch (cues, saved routings, autosave) and
// re-applied to the live iframes. Shared by the show sequencer and file I/O.
function currentEffects() {
  const out = {}
  for (const [id, c] of effectControls) out[id] = { values: { ...c.values }, mappings: c.mappings.map((m) => ({ ...m })), state: c.state ?? null }
  return out
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
    // plain() strips reactive proxies so the scene survives structured-clone.
    win.postMessage(plain({ type: 'sketch:apply-scene', values: pe.values, mappings: pe.mappings, state: pe.state ?? null }), '*')
    const ec = effectControls.get(+idStr)
    if (ec) { ec.values = { ...pe.values }; ec.mappings = pe.mappings.map((m) => ({ ...m })); ec.state = pe.state ?? null }
    delete pendingEffects[idStr]
  }
  if (!Object.keys(pendingEffects).length) pendingEffects = null
}
// Queue a set of effect scenes to re-apply once their iframes are live (used
// by cue playback, saved-routing loads and the autosave restore).
function queueEffects(fx) { pendingEffects = { ...(fx || {}) }; nextTick(applyPendingEffects) }

// The cue list, timeline playback engine and saved-show library live in
// ../composables/useShow.js; <ShowPanel> renders them. The graph/effect-touch
// primitives it needs are injected here.
const show = useShow({
  nodes,
  snapshot,
  applySnap,
  currentEffects,
  queueEffects,
  effectControls,
  postToEffect,
  stage,
  showToast,
  alertBadFile,
})

// --- saved routings: named snapshots of the node graph in localStorage ----
const SAVED_KEY = 'sketchbook-patch-saved'
const savedRoutings = ref(loadJson(SAVED_KEY, []))
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
function persistSaved() { saveJson(SAVED_KEY, savedRoutings.value) }

// --- blocks: reusable named subgraphs saved from a selection ----------------
// A block captures the selected nodes (with their params), the wiring between
// them, and any control links between them. It can be re-inserted (duplicated)
// as many times as you like, so you build a mini-rig once and stamp it out.
const BLOCK_KEY = 'sketchbook-patch-blocks'
const savedBlocks = ref(loadJson(BLOCK_KEY, []))
const newBlockName = ref('')
const editBlockId = ref(null)
const editBlockName = ref('')
function persistBlocks() { saveJson(BLOCK_KEY, savedBlocks.value) }
function saveBlock() {
  const ids = selectedSet.size ? [...selectedSet] : (selected.value != null ? [selected.value] : [])
  if (!ids.length) return
  const members = ids.map((id) => nodeById(id)).filter(Boolean)
  const bname = newBlockName.value.trim() || `Block ${savedBlocks.value.length + 1}`
  savedBlocks.value.push({ id: Date.now().toString(36), name: bname, ...captureBlockData(members, edges, links) })
  newBlockName.value = ''
  persistBlocks()
  showToast(`Saved block “${bname}”`)
}
// Insert (stamp) a saved block into the graph with fresh ids, offset so it
// lands in view; selects the new nodes so you can immediately drag them.
function insertBlock(b) {
  const stamped = stampBlock(b, nextId)
  nextId = stamped.nextId
  for (const d of stamped.nodes) { const n = reactive(d); nodes.push(n); st(n.id) }
  edges.push(...stamped.edges)
  links.push(...stamped.links)
  clearSelection()
  for (const id of stamped.ids) selectedSet.add(id)
  persist()
  nextTick(() => layoutTick.value++)
}
function deleteBlock(b) {
  const i = savedBlocks.value.findIndex((x) => x.id === b.id)
  if (i >= 0) { savedBlocks.value.splice(i, 1); persistBlocks() }
}

// PRESET_BLOCKS (built-in routing patterns) live in ../lib/patch/constants.js.
// Fill a preset's effect/filter slugs from the current pools, then stamp it in.
function insertPreset(p) {
  const pool = settings.filterToPool(effectOptions.value)
  insertBlock(fillPreset(p, {
    effectPool: pool.length ? pool : effectOptions.value,
    filterPool: filterOptions.value,
    blends: BLENDS,
  }))
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

// --- file import / export: patches as .json ---------------------------------
// The serialization/validation core (fileSlug, downloadJson, pickJsonFile,
// buildPatchFile, parsePatchImport) lives in ../lib/patch/library.js; here we
// wire it to the live reactive graph. Show file I/O lives in useShow().
function exportPatch() {
  const name = newName.value.trim() || 'patch'
  downloadJson(buildPatchFile({ name, resolution: resLabel.value, nodes, edges, links, effects: currentEffects() }), `${fileSlug(name)}.patch.json`)
}
function exportRouting(r) {
  downloadJson(buildPatchFile({ name: r.name, nodes: r.nodes, edges: r.edges, links: r.links || [], effects: r.effects || {} }), `${fileSlug(r.name)}.patch.json`)
}
async function importPatch() {
  const parsed = parsePatchImport(await pickJsonFile(), RESOLUTIONS.map((r) => r.label))
  if (!parsed) { alertBadFile(); return }
  if (parsed.kind === 'routings') {
    for (const r of parsed.routings) savedRoutings.value.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: r.name || 'Imported', nodes: r.nodes, edges: r.edges || [], links: r.links || [], effects: r.effects || {} })
    persistSaved()
    return
  }
  const patch = parsed.patch
  if (parsed.resolution) applyResolution(parsed.resolution)
  loadRouting(patch)
  // keep it around in the saved list too
  savedRoutings.value.push({ id: Date.now().toString(36), name: parsed.name, nodes: patch.nodes, edges: patch.edges || [], links: patch.links || [], effects: patch.effects || {} })
  persistSaved()
}
function alertBadFile() {
  console.warn('Patch: could not read that JSON file')
}

// --- guided tour -------------------------------------------------------------
const tourActive = ref(false)
const tourSteps = PATCH_TOUR_STEPS // step data lives in ../lib/patch/constants.js
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
        <!-- add nodes, grouped by role so the toolbar stays compact; each menu's
             activator is tinted with the group's node-type colour -->
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" data-tour="patch-add" icon="mdi-creation" variant="tonal" size="small" title="Add a source" :style="{ color: TYPES.effect.color }" />
          </template>
          <v-list density="compact">
            <v-list-subheader>Sources</v-list-subheader>
            <v-list-item prepend-icon="mdi-creation" title="Effect" subtitle="generator sketch" @click="addNode('effect')" />
            <v-list-item prepend-icon="mdi-image-filter-vintage" title="Filter" subtitle="processes its video input" @click="addNode('filter')" />
            <v-list-item prepend-icon="mdi-image-multiple" title="Media" subtitle="camera · files · clips" @click="addNode('media')" />
            <v-list-item prepend-icon="mdi-earth" title="Geodata" subtitle="live map / satellite imagery" @click="addNode('geodata')" />
            <v-list-item prepend-icon="mdi-format-text" title="Text" subtitle="mappable font" @click="addNode('text')" />
            <v-list-item prepend-icon="mdi-image-move" title="Sprite" subtitle="image placed & animated in space" @click="addNode('sprite')" />
            <v-divider class="my-1" />
            <v-list-item prepend-icon="mdi-tray-arrow-down" title="Import wizard…" subtitle="media · URL · screen · Photos · point cloud · maps · terrain" @click="wizOpen = true" />
          </v-list>
        </v-menu>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-vector-polygon" variant="tonal" size="small" title="Compose (blend · mask · shape · portal)" :style="{ color: TYPES.blend.color }" />
          </template>
          <v-list density="compact">
            <v-list-subheader>Compose</v-list-subheader>
            <v-list-item prepend-icon="mdi-circle-half-full" title="Blend" subtitle="composite two streams" @click="addNode('blend')" />
            <v-list-item prepend-icon="mdi-vector-intersection" title="Mask" subtitle="content × matte" @click="addNode('mask')" />
            <v-list-item prepend-icon="mdi-vector-polygon" title="Polygon" subtitle="editable matte shape — wire into a Mask" @click="addNode('polygon')" />
            <v-list-item prepend-icon="mdi-shape-outline" title="Portal" subtitle="remap a region elsewhere" @click="addNode('portal')" />
          </v-list>
        </v-menu>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-cube-outline" variant="tonal" size="small" title="3D (geometry · camera)" :style="{ color: TYPES.geo.color }" />
          </template>
          <v-list density="compact">
            <v-list-subheader>3D</v-list-subheader>
            <v-list-item prepend-icon="mdi-cube-outline" title="Geometry" subtitle="a mesh in vertex space" @click="addNode('geo')" />
            <v-list-item prepend-icon="mdi-camera-control" title="Camera" subtitle="render geometry to pixels" @click="addNode('vcam')" />
          </v-list>
        </v-menu>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-tune-variant" variant="tonal" size="small" title="Control (input · XY · tracker)" :style="{ color: TYPES.input.color }" />
          </template>
          <v-list density="compact">
            <v-list-subheader>Control</v-list-subheader>
            <v-list-item prepend-icon="mdi-sine-wave" title="Input" subtitle="audio · midi · …" @click="addNode('input')" />
            <v-list-item prepend-icon="mdi-gesture-tap" title="XY Pad" subtitle="touch surface" @click="addNode('xy')" />
            <v-list-item prepend-icon="mdi-target" title="Tracker" subtitle="video tracking" @click="addNode('tracker')" />
          </v-list>
        </v-menu>
        <v-btn icon="mdi-monitor" variant="tonal" size="small" title="Add Output (fullscreen stage)" @click="addNode('output')" />
        <v-spacer />
        <NlDesigner
          ref="nlRef"
          :effects="effectOptions" :filters="filterOptions" :types="TYPES" :examples="NL_EXAMPLES"
          :ai-key="settings.aiKey" :ai-model="settings.aiModel" :smart="settings.aiSmart" :last="nlLast"
          @update:smart="settings.setAiSmart" @build-intent="onBuildIntent" @build-spec="onBuildSpec"
          @open-settings="router.push({ name: 'settings' })" @toast="showToast"
        />
        <v-btn data-tour="patch-random" icon="mdi-dice-multiple" variant="text" size="small" title="New random patch — deal out a whole new graph (undoable)" @click="randomPatch" />
        <!-- what a reroll does with a locked/pinned node that isn't wired in -->
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-pin-outline" variant="text" size="small" :title="`Orphaned locked nodes on reroll: ${settings.orphanPolicy}`" />
          </template>
          <v-list density="compact" width="290">
            <v-list-subheader>Locked/pinned nodes not wired in…</v-list-subheader>
            <v-list-item :active="settings.orphanPolicy === 'reintegrate'" prepend-icon="mdi-vector-link" title="Reintegrate" subtitle="fold them into the new patch" @click="settings.setOrphanPolicy('reintegrate')" />
            <v-list-item :active="settings.orphanPolicy === 'keep'" prepend-icon="mdi-pin" title="Keep" subtitle="leave them where they are, disconnected" @click="settings.setOrphanPolicy('keep')" />
            <v-list-item :active="settings.orphanPolicy === 'ditch'" prepend-icon="mdi-delete-outline" title="Ditch" subtitle="clear them with the rest" @click="settings.setOrphanPolicy('ditch')" />
          </v-list>
        </v-menu>
        <v-btn icon="mdi-shuffle-variant" variant="text" size="small" title="Randomize the look — reseed & shuffle every node's params, keep the wiring (undoable)" @click="randomizeLook" />
        <v-btn icon="mdi-delete-sweep" variant="text" size="small" title="Clear graph" @click="clearAll" />
        <v-btn icon="mdi-undo" variant="text" size="small" title="Undo (Ctrl/Cmd+Z)" :disabled="!undoStack.length" @click="undo" />
        <v-btn icon="mdi-redo" variant="text" size="small" title="Redo (Ctrl/Cmd+Shift+Z)" :disabled="!redoStack.length" @click="redo" />
      </div>
      <div class="toolbar-row">
      <!-- Autopilot: auto-evolve this graph; jump between manual and autopilot -->
      <v-btn
        :prepend-icon="ap.state.on ? 'mdi-robot' : 'mdi-robot-outline'"
        size="small"
        :variant="ap.state.on ? 'flat' : 'tonal'"
        :color="ap.state.on ? 'primary' : undefined"
        :title="ap.state.on ? 'Autopilot on — the graph is evolving itself; click to take over' : 'Autopilot — let it auto-evolve this graph'"
        @click="ap.toggle()"
      >{{ ap.state.on ? 'Autopilot' : 'Manual' }}</v-btn>
      <v-btn
        icon="mdi-cog-outline"
        variant="text"
        size="x-small"
        :color="ap.state.panelOpen ? 'primary' : undefined"
        title="Autopilot transport &amp; options"
        @click="ap.state.panelOpen = !ap.state.panelOpen"
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
        :color="show.state.open ? 'primary' : undefined"
        title="Show — plan cues and run them manually or on a timeline"
        @click="show.state.open = !show.state.open"
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
        :color="show.state.open ? 'primary' : undefined"
        title="Show — run cues / timeline"
        @click="show.state.open = !show.state.open"
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
    <ShowPanel :show="show" />

    <!-- Autopilot transport + options — surfaced when engaged; the graph stays
         hand-editable while it runs. -->
    <AutopilotBar :ap="ap" :fps="fps" :undo-depth="undoStack.length" @open-full="openAutopilot" />

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
            <label>drift X <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.driftX ?? n.params.drift ?? 0" @update:model-value="n.params.driftX = $event" @commit="persist" /></label>
            <label>drift Y <NumSlider :min="-1" :max="1" :step="0.02" :model-value="n.params.driftY ?? 0" @update:model-value="n.params.driftY = $event" @commit="persist" /></label>
            <label class="chk"><input type="checkbox" :checked="!!n.params.driftRandom" @change="n.params.driftRandom = $event.target.checked; persist()" @pointerdown.stop /> random drift (wander)</label>
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
    <MediaWizard
      v-model="wizOpen" :has-google="wizHasGoogle"
      @upload="wizUploadFiles" @url="wizFromUrl" @screen-live="wizScreenLive" @screen-grab="wizScreenGrab"
      @google="wizGoogle" @point-cloud="wizPointCloud" @geodata="wizGeodata" @terrain="wizTerrain"
      @open-settings="router.push({ name: 'settings' })"
    />

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
/* Import-wizard styles moved into src/components/patch/MediaWizard.vue */
/* NL designer styles moved into src/components/patch/NlDesigner.vue */
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
/* overflow:visible so wires to nodes dragged past the viewport box aren't
   clipped to the SVG's rect (the root <svg> clips by default). */
.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 11; }
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

/* Show-sequencer panel + Autopilot-panel styles now live in their
   components (src/components/patch/ShowPanel.vue, AutopilotBar.vue). */
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
