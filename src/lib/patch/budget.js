// Patch cost model — an analytical estimate of what a graph costs per frame, so
// limits come from complexity, not from timing one particular machine.
//
// Notation (per deck):  P = compositor pixels (W·H)    V = nodes    F = effect /
// filter nodes (each a live iframe)    w(n) = relative sketch weight.
//
//   GPU/raster work  G = Σ_F  w(slug) · P/P_REF   +   Σ_other  c_node · P/P_REF
//       Each effect is a fragment/raster workload linear in the pixels it draws;
//       w comes from the perf audit's relative score (slugCost: 1 cheap … 12
//       heavy). Compositing a node (clear + drawImage into its out canvas) is a
//       memory-bandwidth cost, also linear in P, at a small constant c_node.
//   Main-thread    C  = V·(blit ∝ P)  +  (V+E) scheduling (the topo order is
//       memoised, so it's O(V+E) only when wiring changes, not per frame).
//       Filters add one ImageBitmap upload of P·4 bytes per frame.
//   Memory         M  = Σ_F (IFRAME_BASE + P·4·IFRAME_BUFFERS [+ THREE_EXTRA])
//                     + V·P·4 (each node's out canvas)
//       Iframes dominate: a live page costs heap + GL context whether or not it
//       is drawing, so an off-air deck *saves* G but not M.
//
// Only the ratios between terms are modelled; TIERS turns them into limits. The
// constants below are assumptions, deliberately conservative, and the tier
// limits are documented (src/docs/pages/performance.md). Nothing here reads a
// clock — `npm run perf` supplies the per-sketch weights (relative, not ms).

export const REF_PIXELS = 384 * 216 // resolution the weights are expressed at

// Model constants (MB unless stated).
export const IFRAME_BASE_MB = 30   // JS heap + DOM + a GL context, per live iframe
export const IFRAME_BUFFERS = 3    // front + back + preserveDrawingBuffer copy
export const THREE_EXTRA_MB = 60   // geometry/texture/program overhead of three.js sketches
export const NODE_COST = 0.25      // compositing a non-sketch node, in weight units
export const FILTER_UPLOAD = 0.5   // extra weight for the per-frame ImageBitmap upload
export const FRAME_MEMORY_SHARE = 0.35 // fraction of device memory we allow for patch frames
export const BASE_MEMORY_MB = 350  // the app + browser itself

const isFx = (n) => (n.type === 'effect' || n.type === 'filter') && n.params?.slug
const mb = (pixels) => (pixels * 4) / (1024 * 1024)

// info(slug) → { weight (1..12), three (bool) }; default = a mid-weight plain sketch.
const DEFAULT_INFO = () => ({ weight: 4, three: false })

// Cost of one deck's graph at `pixels` (W·H): { gpu, ram, fx, nodes }.
export function deckCost(nodes, { pixels = REF_PIXELS, info = DEFAULT_INFO } = {}) {
  const scale = pixels / REF_PIXELS
  let gpu = 0, ram = 0, fx = 0
  for (const n of nodes) {
    ram += mb(pixels) // every node owns an output canvas
    if (isFx(n)) {
      fx++
      const i = info(n.params.slug) ?? DEFAULT_INFO()
      gpu += (i.weight + (n.type === 'filter' ? FILTER_UPLOAD : 0)) * scale
      ram += IFRAME_BASE_MB + mb(pixels) * IFRAME_BUFFERS + (i.three ? THREE_EXTRA_MB : 0)
    } else {
      gpu += NODE_COST * scale
    }
  }
  return { gpu: +gpu.toFixed(2), ram: Math.round(ram), fx, nodes: nodes.length }
}

// --- capability tiers ---------------------------------------------------------
// `capacity` is the per-frame GPU/raster budget in the same weight units as
// deckCost().gpu, for ONE live deck at 60 fps; dual-live costs twice as much.
// Minimum targets software rendering (no GPU: a few cheap sketches at low res);
// baseline an integrated GPU laptop; recommended a discrete / Apple-silicon GPU.
export const TIERS = {
  minimum:     { label: 'Minimum',     capacity: 6,  maxPixels: 384 * 216,   maxStandby: 1, maxDecks: 1, minCores: 2, minMemGB: 2 },
  baseline:    { label: 'Baseline',    capacity: 24, maxPixels: 1280 * 720,  maxStandby: 3, maxDecks: 2, minCores: 4, minMemGB: 4 },
  recommended: { label: 'Recommended', capacity: 64, maxPixels: 1920 * 1080, maxStandby: 8, maxDecks: 2, minCores: 8, minMemGB: 8 },
}

// Reduce a probed capability to a tier: the weakest of GPU class, core count and
// memory wins (a fast GPU can't rescue a 2 GB machine).
export function classifyTier({ gpu = 'integrated', cores = 4, memGB = 4 } = {}) {
  const byGpu = gpu === 'software' ? 'minimum' : gpu === 'discrete' ? 'recommended' : 'baseline'
  const rank = { minimum: 0, baseline: 1, recommended: 2 }
  const cap = (name, min) => (name >= min ? 2 : name >= min / 2 ? 1 : 0)
  const byCpu = ['minimum', 'baseline', 'recommended'][cap(cores, TIERS.recommended.minCores)]
  const byMem = ['minimum', 'baseline', 'recommended'][cap(memGB, TIERS.recommended.minMemGB)]
  return [byGpu, byCpu, byMem].reduce((a, b) => (rank[a] <= rank[b] ? a : b))
}

// Frames the device can hold: memory-bound, independent of GPU speed.
export function maxFrames(memGB, pixels) {
  const budget = memGB * 1024 * FRAME_MEMORY_SHARE - BASE_MEMORY_MB
  const per = IFRAME_BASE_MB + mb(pixels) * (IFRAME_BUFFERS + 1)
  return Math.max(1, Math.floor(budget / per))
}

// How to run two decks on this machine. costs = { on, off } from deckCost().
//   offAirMode  'paused' (hold GPU state, draw nothing) | 'cued' (half rate,
//               for the preview monitor) | 'live' (full rate)
//   liveFade    whether a true live-to-live crossfade fits (2× on-air cost)
//   standby     how many warm-up iframes to allow
// Returns { offAirMode, liveFade, standby, load, warnings[] }.
export function planDecks(tier, costs, { cap = { memGB: 4 }, pixels = REF_PIXELS } = {}) {
  const t = TIERS[tier] ?? TIERS.baseline
  const warnings = []
  const live = costs.on.gpu // one deck live
  const both = costs.on.gpu + costs.off.gpu
  const liveFade = t.maxDecks > 1 && both <= t.capacity
  const cuedFits = costs.on.gpu + costs.off.gpu * 0.5 <= t.capacity
  const offAirMode = liveFade ? 'cued' : 'paused'
  // RAM is held by both decks whichever mode they run in
  const ram = costs.on.ram + costs.off.ram
  const ramCap = cap.memGB * 1024 * FRAME_MEMORY_SHARE
  if (live > t.capacity) warnings.push(`The on-air deck (${live.toFixed(0)} units) is over this machine's ${t.capacity}-unit budget — expect dropped frames.`)
  if (t.maxDecks < 2) warnings.push('Two decks need at least a baseline machine (integrated GPU, 4 cores, 4 GB).')
  else if (!liveFade) warnings.push('Both decks together exceed the budget, so crossfades use a frozen frame of the outgoing deck instead of running it live.')
  if (!cuedFits && t.maxDecks > 1) warnings.push('The off-air deck will be paused while you edit it (its preview updates only on demand).')
  if (ram > ramCap) warnings.push(`Memory: ~${ram} MB of patch frames vs ~${Math.round(ramCap)} MB allowed on a ${cap.memGB} GB device.`)
  if (pixels > t.maxPixels) warnings.push(`Resolution is above this tier's ${Math.round(Math.sqrt(t.maxPixels * 16 / 9))}p target — try a lower compositor resolution.`)
  const fit = Math.max(1, maxFrames(cap.memGB, pixels) - costs.on.fx - costs.off.fx)
  return { offAirMode, liveFade, standby: Math.min(t.maxStandby, fit), load: live / t.capacity, warnings }
}
