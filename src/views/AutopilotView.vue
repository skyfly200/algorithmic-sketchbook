<script setup>
/**
 * Autopilot — a hands-free tour that *evolves* a mix instead of dealing whole
 * new scenes: a persistent stack of 1–3 blend-composited effect layers
 * (often capped by a filter fed the live composite below) is mutated one
 * move at a time — replace a layer, add one, drop one, swap the filter,
 * restyle a blend. Every incoming sketch warms up invisibly until it has
 * announced itself and rendered frames, then crossfades in while only its
 * counterpart fades out — the rest of the network never stops.
 *
 * Routing is perf-aware: each sketch's measured performance score
 * (src/registry/perf.json, `npm run perf`) becomes a cost, the stack keeps
 * its total under a budget, and the FPS watchdog degrades gracefully —
 * first thinning the most expensive layer, then swapping in cheap sketches —
 * rather than cutting to a new scene.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSketchStore } from '../stores/sketches'
import { useSettingsStore } from '../stores/settings'
import TourOverlay from '../components/TourOverlay.vue'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'
import perfScores from '../registry/perf.json'
import { traitsOf } from '../registry/traits'
import { FILTER_SLUGS } from '../registry/filters'
import { handOffToPatch } from '../lib/mixToPatch'

const router = useRouter()
const store = useSketchStore()
const settings = useSettingsStore()
const BLENDS = [
  'screen', 'lighten', 'overlay', 'soft-light', 'hard-light',
  'color-dodge', 'difference', 'exclusion', 'hue', 'color', 'luminosity',
]
// The full set of eligible effects; the picker below narrows to those the
// user has ticked on (an empty enabled-set means "all").
const allEffects = computed(() =>
  store.sketches.filter(
    (s) => s.type === 'local' && s.embed && !FILTER_SLUGS.includes(s.slug) && s.slug !== 'bright-waves-logo',
  ),
)
// The pool Autopilot picks from is the app-wide effect selection (shared with
// the Randomize feature), configurable here or on the Settings page.
const effectPool = computed(() => settings.filterToPool(allEffects.value))
const filterPool = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && FILTER_SLUGS.includes(s.slug)),
)

// --- settings (persisted) ---------------------------------------------------
const SET_KEY = 'sketchbook-autopilot'
const savedSet = (() => {
  if (!settings.persistEditors) return {}
  try {
    return JSON.parse(localStorage.getItem(SET_KEY)) ?? {}
  } catch {
    return {}
  }
})()
const dwell = ref(savedSet.dwell ?? 25) // seconds between routing moves
const lowSkip = ref(savedSet.lowSkip ?? true)
const fpsFloor = ref(savedSet.fpsFloor ?? 24)
const perfBudget = ref(savedSet.perfBudget ?? 12)
const resolution = ref(savedSet.resolution ?? 'high') // low | medium | high | native
const showNotes = ref(savedSet.showNotes ?? true) // the change title-card in the corner
const evolveOptions = ref(savedSet.evolveOptions ?? true) // auto-drift each layer's own params
// How the show evolves over time. Each mode shapes which effects get strung
// together, how many layers stack, and the cadence of change — see the helpers
// further down. "Evolve" is the original one-move-at-a-time behaviour.
const evolveMode = ref(savedSet.evolveMode ?? 'Evolve')
const EVOLVE_MODES = ['Evolve', 'Curated', 'Energy arc', 'Calm ambient', 'Beat-synced', 'Chaos']
const MODE_BLURB = {
  'Evolve': 'One move at a time — the original steady, ever-changing drift.',
  'Curated': 'Strings together effects that share an element for a coherent look.',
  'Energy arc': 'Builds energy to a peak (busier, more energetic) then releases to calm.',
  'Calm ambient': 'Few layers, gentle calm effects, slow changes.',
  'Beat-synced': 'Changes land on the music — needs the mic on to sync.',
  'Chaos': 'Fast, dense, high-churn — throws everything at the wall.',
}
const playing = ref(true)
// The rendered view stays clean: every control lives inside one panel opened
// from a single, unobtrusive corner button — nothing else overlays the visuals.
const panelOpen = ref(false)
// Collapsible drawer sections (persisted so the drawer opens how you left it).
const sections = reactive(savedSet.sections ?? { mix: true, settings: true, effects: false, layers: true })
function toggleSection(k) { sections[k] = !sections[k]; persistSettings() }
function persistSettings() {
  if (!settings.persistEditors) return
  localStorage.setItem(SET_KEY, JSON.stringify({
    dwell: dwell.value, lowSkip: lowSkip.value, fpsFloor: fpsFloor.value, perfBudget: perfBudget.value,
    resolution: resolution.value, evolveMode: evolveMode.value, showNotes: showNotes.value,
    evolveOptions: evolveOptions.value, sections: { ...sections },
  }))
}
function toggleEffect(slug) {
  settings.toggleEffect(slug, allEffects.value.map((s) => s.slug))
  // If you just unchecked an effect that's currently on screen, don't yank it —
  // queue it to be swapped out on the next move and never routed back in.
  if (!settings.isEffectEnabled(slug)) {
    if (liveLayers().some((l) => l.slug === slug)) { swapOutQueue.add(slug); say(`${titleOf(slug)} will swap out next`) }
  } else {
    swapOutQueue.delete(slug) // re-checked → allow it back
  }
}

// --- perf-aware routing ------------------------------------------------------
// A sketch's cost is roughly "what fraction of a frame it eats": a perf
// score of 100 costs 1 unit, 50 costs 2, 12 costs 8… The stack's total cost
// stays under the budget, so one heavy sketch runs alone while cheap ones
// stack three deep.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const chance = (p) => Math.random() < p
function cost(slug) {
  const s = perfScores[slug]
  if (!s) return 4
  return Math.min(12, Math.max(1, Math.round(100 / Math.max(s, 8))))
}

// --- the living stack --------------------------------------------------------
// Layer: { id, slug, kind, blend, opacity, seed, state, replaces }
//   state: 'warming' (mounted, invisible, booting) → 'live' → 'dying'
const stack = reactive([])
let nextId = 1
const recent = [] // recently retired slugs — avoid immediate repeats
const readyWins = new WeakSet()

// Slugs the user unchecked while they were live: they're never swapped IN, and
// the router swaps them OUT at the next opportunity rather than leaving them up.
const swapOutQueue = reactive(new Set())
// A user-planned next move: pick a live layer to swap and (optionally) preview
// the incoming sketch's name before it actually happens.
const plannedNext = ref(null) // { targetId, slug } | null
// Cache each sketch's tweaked params/mappings by slug so back/forward and full
// rerolls restore the options you set instead of resetting to defaults.
const paramCache = {}
// A short grace window after start / any (re)build during which the FPS
// watchdog holds off — effects are still loading and would be culled unfairly.
let settleUntil = 0

// --- learned interest --------------------------------------------------------
// Autopilot learns what you like from what you keep vs. skip: a layer you let
// play accrues weight, one you skip past quickly loses it, and the router then
// favours the higher-weighted sketches. Persisted, so the taste carries over.
const INTEREST_KEY = 'sketchbook-autopilot-interest'
const interest = (() => {
  if (!settings.persistEditors) return {}
  try {
    return JSON.parse(localStorage.getItem(INTEREST_KEY)) ?? {}
  } catch {
    return {}
  }
})()
let interestSaveTimer = 0
function weightOf(slug) {
  return interest[slug] ?? 1
}
function noteEngagement(slug, liveMs) {
  const d = Math.max(1, dwell.value) * 1000
  let w = weightOf(slug)
  if (liveMs < d * 0.5) w *= 0.9 // gone before it settled in → less wanted
  else if (liveMs > d * 1.4) w *= 1.08 // left running → more wanted
  else return
  interest[slug] = Math.min(4, Math.max(0.2, +w.toFixed(3)))
  clearTimeout(interestSaveTimer)
  if (!settings.persistEditors) return
  interestSaveTimer = setTimeout(() => localStorage.setItem(INTEREST_KEY, JSON.stringify(interest)), 500)
}
// Weighted random pick, biased by learned interest.
function weightedPick(arr) {
  if (!arr.length) return undefined
  let total = 0
  for (const s of arr) total += weightOf(s.slug)
  let r = Math.random() * total
  for (const s of arr) {
    r -= weightOf(s.slug)
    if (r <= 0) return s
  }
  return arr[arr.length - 1]
}
const frames = new Map() // layer id -> iframe element
const note = ref('')
let noteTimer = 0
function say(text) {
  if (!showNotes.value) return
  note.value = text
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => (note.value = ''), 3400)
}

function liveLayers() {
  return stack.filter((l) => l.state !== 'dying')
}
function stackCost() {
  return liveLayers().reduce((a, l) => a + cost(l.slug), 0)
}
function effectsOf(list = liveLayers()) {
  return list.filter((l) => l.kind === 'effect')
}
function filterOf() {
  return liveLayers().find((l) => l.kind === 'filter')
}

function srcFor(layer) {
  const s = store.bySlug(layer.slug)
  return s ? `${s.url}?preview=1&capture=1&quality=${resolution.value}&seed=${layer.seed}` : ''
}
function titleOf(slug) {
  return store.bySlug(slug)?.title ?? slug
}

// --- save the current mix as a Patch routing -------------------------------
// Turn the live stack into a node graph in the same format Patch loads:
// effect sources chained through Blend nodes, an optional Filter fed the
// composite, then Output. It lands in the shared saved-routings store so it
// shows up in Patch and the Library.
function buildMixGraph() {
  const layers = liveLayers()
  const effs = layers.filter((l) => l.kind === 'effect')
  const filt = layers.find((l) => l.kind === 'filter')
  if (!effs.length) return null
  const nodes = []
  const edges = []
  let id = 1
  const mk = (type, params, x, y) => { const n = { id: id++, type, x, y, params }; nodes.push(n); return n }
  // effect source nodes down the left
  const effNodes = effs.map((l, i) => mk('effect', { slug: l.slug }, 40, 60 + i * 150))
  // fold them together with blends: base, then blend each next on top
  let composite = effNodes[0]
  for (let i = 1; i < effNodes.length; i++) {
    const b = mk('blend', { mode: effs[i].blend === 'normal' ? 'source-over' : effs[i].blend, mix: effs[i].opacity ?? 1 }, 250 + i * 40, 60 + i * 150)
    edges.push({ from: composite.id, to: b.id, port: 0 })
    edges.push({ from: effNodes[i].id, to: b.id, port: 1 })
    composite = b
  }
  let tail = composite
  if (filt) {
    const f = mk('filter', { slug: filt.slug }, 480, 120)
    edges.push({ from: composite.id, to: f.id, port: 0 })
    tail = f
  }
  const out = mk('output', {}, 700, 160)
  edges.push({ from: tail.id, to: out.id, port: 0 })
  const name = `Autopilot: ${effs.map((l) => titleOf(l.slug)).join(' + ')}`.slice(0, 60)
  return { nodes, edges, links: [], name }
}
function saveAsPatch() {
  const g = buildMixGraph()
  if (!g) return
  const SAVED_KEY = 'sketchbook-patch-saved'
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(SAVED_KEY)) || [] } catch {}
  saved.push({ id: Date.now().toString(36), name: g.name, nodes: g.nodes, edges: g.edges, links: [] })
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  say('saved as a patch')
}
// Jump to the Patch view with the current mix loaded, ready to edit by hand.
function editInPatch() {
  const g = buildMixGraph()
  if (!g) return
  handOffToPatch(g)
  router.push({ name: 'patch' })
}

// --- evolution-mode intelligence -------------------------------------------
// A build/release phase in [0,1] that rises then falls, driving "Energy arc".
function arcPhase() { return 0.5 + 0.5 * Math.sin(performance.now() * 0.00008) }
// The dominant element among the current live effects (for coherent stringing).
function dominantElement() {
  const counts = {}
  for (const l of effectsOf()) { const e = traitsOf({ slug: l.slug, tags: [] }).element; if (e) counts[e] = (counts[e] || 0) + 1 }
  let best = null, n = 0
  for (const k in counts) if (counts[k] > n) { n = counts[k]; best = k }
  return best
}
// Score a candidate sketch for the current mode: higher = a better next pick.
// This is the "intelligence" that strings a compelling show together.
function modeScore(s) {
  const t = traitsOf({ slug: s.slug, tags: [] })
  const mode = evolveMode.value
  if (mode === 'Curated') {
    // favour effects that cohere with the mix's dominant element, and lean
    // toward calmer companions so the composite stays legible
    const dom = dominantElement()
    let sc = 1
    if (dom && t.element === dom) sc += 1.5
    if (t.energy === 'calm') sc += 0.4
    return sc
  }
  if (mode === 'Energy arc') {
    // on the build, want energetic; on the release, want calm
    const build = arcPhase()
    return t.energy === 'energetic' ? 0.3 + build * 1.6 : 0.3 + (1 - build) * 1.6
  }
  if (mode === 'Calm ambient') return t.energy === 'calm' ? 2 : 0.25
  if (mode === 'Beat-synced' || mode === 'Chaos') return t.energy === 'energetic' ? 1.6 : 0.6
  return 1 // Evolve: neutral
}
// Weighted pick that folds the mode score into the learned-interest weight.
function modePick(arr) {
  if (!arr.length) return undefined
  let total = 0
  const w = arr.map((s) => { const x = weightOf(s.slug) * modeScore(s); total += x; return x })
  let r = Math.random() * total
  for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i] }
  return arr[arr.length - 1]
}
// Per-mode target ceiling on how many effect layers stack.
function maxLayersForMode() {
  const m = evolveMode.value
  if (m === 'Calm ambient') return 2
  if (m === 'Chaos') return 3
  if (m === 'Energy arc') return arcPhase() > 0.6 ? 3 : 2
  return 3
}
// Per-mode seconds between changes: Chaos churns fast, Calm lingers, the arc
// quickens toward its energy peak. Beat-synced ignores this (beats drive it).
function effectiveDwell() {
  const m = evolveMode.value, base = dwell.value
  if (m === 'Chaos') return Math.max(4, base * 0.4)
  if (m === 'Calm ambient') return base * 1.4
  if (m === 'Energy arc') return Math.max(5, base * (1.4 - arcPhase() * 0.9))
  return base
}

function pickSketch(pool, budgetLeft) {
  const inStack = new Set(stack.map((l) => l.slug))
  // Never route back in a slug the user just unchecked while it was live.
  const usable = pool.filter((s) => !swapOutQueue.has(s.slug))
  const fresh = usable.filter((s) => !inStack.has(s.slug) && !recent.includes(s.slug))
  let cands = fresh.filter((s) => cost(s.slug) <= budgetLeft)
  if (!cands.length) {
    // nothing fresh fits — fall back to the cheapest few available
    cands = usable
      .filter((s) => !inStack.has(s.slug))
      .sort((a, b) => cost(a.slug) - cost(b.slug))
      .slice(0, 5)
  }
  // modePick folds the current evolution mode's intelligence into the weighting.
  return modePick(cands)
}

function makeLayer(slug, kind, blend, opacity, locked = false) {
  return {
    id: nextId++,
    slug,
    kind,
    blend,
    opacity,
    locked,
    seed: ((Math.random() * 4294967296) >>> 0).toString(36),
    state: 'warming',
    replaces: null,
    bornAt: performance.now(),
  }
}

// Insertion is position-aware and never reorders mounted layers (moving an
// iframe in the DOM reloads it): a base replacement slides UNDER the stack
// (hidden until the old base fades out), a mid replacement mounts directly
// above its target, adds go just below the filter, filters go on top.
function insertLayer(l, at) {
  if (at != null) stack.splice(at, 0, l)
  else {
    const fi = stack.findIndex((x) => x.kind === 'filter')
    if (l.kind === 'filter' || fi < 0) stack.push(l)
    else stack.splice(fi, 0, l)
  }
  return l
}

function retire(layer, after = 1600) {
  if (!layer || layer.state === 'dying') return
  // Score how long it got to play before being retired — the core skip signal.
  if (layer.liveAt) noteEngagement(layer.slug, performance.now() - layer.liveAt)
  layer.state = 'dying'
  if (!recent.includes(layer.slug)) recent.push(layer.slug)
  while (recent.length > 8) recent.shift()
  setTimeout(() => {
    const i = stack.findIndex((x) => x.id === layer.id)
    if (i >= 0) stack.splice(i, 1)
    pruneControls()
  }, after)
}

// --- routing moves -----------------------------------------------------------
// A locked layer is never touched by the router (or the watchdog).
function unlocked(list) { return list.filter((l) => !l.locked) }

function opReplace(target, preferSlug) {
  if (!target || target.locked) return false
  const freed = cost(target.slug)
  const pool = target.kind === 'filter' ? filterPool.value : effectPool.value
  let s = preferSlug ? pool.find((x) => x.slug === preferSlug) : null
  if (!s) s = pickSketch(pool, perfBudget.value - stackCost() + freed)
  if (!s) return false
  const ti = stack.findIndex((x) => x.id === target.id)
  const isBase = target.kind === 'effect' && ti === stack.findIndex((x) => x.kind === 'effect')
  const l = makeLayer(s.slug, target.kind, isBase ? 'normal' : target.blend, target.opacity)
  l.replaces = target.id
  insertLayer(l, isBase ? ti : ti + 1) // base slides underneath, others mount on top
  say(`${titleOf(target.slug)} → ${titleOf(s.slug)}`)
  return true
}
function opAdd() {
  const s = pickSketch(effectPool.value, perfBudget.value - stackCost())
  if (!s) return false
  insertLayer(makeLayer(s.slug, 'effect', pick(BLENDS), +(0.55 + Math.random() * 0.45).toFixed(2)))
  say(`adding ${titleOf(s.slug)}`)
  return true
}
function opRemove() {
  const eff = unlocked(effectsOf())
  if (effectsOf().length < 2 || !eff.length) return false
  const victim = eff[eff.length - 1]
  retire(victim)
  say(`removing ${titleOf(victim.slug)}`)
  return true
}
function opAddFilter() {
  const s = pickSketch(filterPool.value, perfBudget.value - stackCost())
  if (!s) return false
  insertLayer(makeLayer(s.slug, 'filter', 'normal', 1))
  say(`adding filter ${titleOf(s.slug)}`)
  return true
}
function opDropFilter() {
  const f = filterOf()
  if (!f || f.locked) return false
  retire(f)
  say(`removing filter ${titleOf(f.slug)}`)
  return true
}
function opRestyle() {
  const eff = effectsOf()
  const nonBase = unlocked(eff.slice(1))
  if (!nonBase.length) return false
  const l = pick(nonBase)
  l.blend = pick(BLENDS.filter((b) => b !== l.blend))
  l.opacity = +(0.55 + Math.random() * 0.45).toFixed(2)
  say(`restyle: ${titleOf(l.slug)} · ${l.blend}`)
  return true
}

function warmingCount() {
  return stack.filter((l) => l.state === 'warming').length
}

// A live layer whose slug the user unchecked — swap these out first.
function queuedOut() {
  return liveLayers().find((l) => !l.locked && swapOutQueue.has(l.slug))
}

// One routing move: honour a user-planned swap and any unchecked layers first,
// otherwise a weighted pick among whatever is currently possible.
function mutate() {
  if (warmingCount()) return // let the network settle first
  let did = false

  // 1) A layer the user picked to swap next.
  if (plannedNext.value) {
    const target = stack.find((l) => l.id === plannedNext.value.targetId && l.state === 'live')
    if (target && !target.locked) did = opReplace(target, plannedNext.value.slug)
    plannedNext.value = null
  }
  // 2) An unchecked live layer — replace it (or drop if it's a spare effect).
  if (!did) {
    const q = queuedOut()
    if (q) {
      const spareEffect = q.kind === 'effect' && effectsOf().length > 1
      did = spareEffect ? (retire(q), say(`removing ${titleOf(q.slug)}`), true) : opReplace(q)
      if (did) swapOutQueue.delete(q.slug)
    }
  }
  // 3) Otherwise a weighted random move over unlocked targets.
  if (!did) {
    const eff = effectsOf()
    const uEff = unlocked(eff)
    const filter = filterOf()
    const budgetLeft = perfBudget.value - stackCost()
    const moves = []
    if (uEff.length) moves.push([() => opReplace(pick(uEff)), 5])
    if (eff.length < maxLayersForMode() && budgetLeft >= 2) moves.push([opAdd, evolveMode.value === 'Chaos' ? 3.5 : 2.2])
    if (unlocked(eff).length && eff.length > 1) moves.push([opRemove, 1.4])
    if (filter) {
      if (!filter.locked) moves.push([() => opReplace(filter), 2])
      if (!filter.locked) moves.push([opDropFilter, 0.8])
    } else if (budgetLeft >= 1) {
      moves.push([opAddFilter, 2])
    }
    if (unlocked(eff.slice(1)).length) moves.push([opRestyle, 1.6])
    // occasionally swap the whole unlocked branch at once (bigger scene change)
    if (liveLayers().filter((l) => !l.locked).length >= 2) moves.push([opSwapBranch, evolveMode.value === 'Chaos' ? 1.8 : 0.9])
    let total = moves.reduce((a, [, w]) => a + w, 0)
    let r = Math.random() * total
    for (const [fn, w] of moves) {
      r -= w
      if (r <= 0) { if (!fn()) continue; break }
    }
  }
  redo.length = 0 // a fresh move starts a new branch — old redo is void
  snapshot()
  dwellLeft = effectiveDwell()
}

// Full reroll: tear the whole mix down (respecting locks) and deal a fresh one.
function reroll() {
  for (const l of [...stack]) if (!l.locked) retire(l, 1600)
  const keptCost = liveLayers().filter((l) => l.locked).reduce((a, l) => a + cost(l.slug), 0)
  const hasBase = liveLayers().some((l) => l.kind === 'effect' && l.locked)
  if (!hasBase) {
    const base = pickSketch(effectPool.value, perfBudget.value - keptCost)
    if (base) insertLayer(makeLayer(base.slug, 'effect', 'normal', 1))
  }
  if (chance(0.8)) opAdd()
  if (!liveLayers().some((l) => l.kind === 'filter') && chance(0.5)) opAddFilter()
  settleUntil = performance.now() + 4000
  plannedNext.value = null
  snapshot()
  dwellLeft = effectiveDwell()
  say('rerolled')
}

// Replace a whole branch: retire every unlocked layer (effects + the filter it
// caps) at once and grow a fresh sub-mix in their place — a bigger, more
// dramatic change than nudging one layer, but still keeping any locked layers.
// Common branch "blocks" Autopilot builds a fresh sub-mix from — structural
// templates of how many effect layers stack and whether a filter caps them.
const BRANCH_BLOCKS = [
  { name: 'single', effects: 1, filter: false },
  { name: 'blended pair', effects: 2, filter: false },
  { name: 'filtered effect', effects: 1, filter: true },
  { name: 'filtered pair', effects: 2, filter: true },
  { name: 'trio', effects: 3, filter: false },
  { name: 'filtered trio', effects: 3, filter: true },
]
function opSwapBranch() {
  const un = liveLayers().filter((l) => !l.locked)
  if (un.length < 2) return false
  for (const l of un) retire(l)
  const lockedEffect = liveLayers().some((l) => l.kind === 'effect' && l.locked)
  const lockedFilter = liveLayers().some((l) => l.kind === 'filter')
  // pick a routing block that fits the layer ceiling + perf budget
  const maxE = maxLayersForMode()
  const blocks = BRANCH_BLOCKS.filter((b) => b.effects <= maxE)
  const blk = pick(blocks) ?? BRANCH_BLOCKS[0]
  // grow the effects (unless a locked base already anchors the mix)
  const startE = lockedEffect ? 1 : 0
  for (let i = startE; i < blk.effects; i++) {
    const budgetLeft = perfBudget.value - stackCost()
    if (budgetLeft < 1) break
    if (i === 0 && !lockedEffect) {
      const base = pickSketch(effectPool.value, budgetLeft)
      if (base) insertLayer(makeLayer(base.slug, 'effect', 'normal', 1))
    } else if (!opAdd()) break
  }
  if (blk.filter && !lockedFilter) opAddFilter()
  settleUntil = performance.now() + 4000
  say(`new branch · ${blk.name}`)
  return true
}

// Plan the next swap for a specific layer, and preview the incoming sketch by
// name so you can see the change before it lands.
function planSwap(layer) {
  if (!layer || layer.locked) return
  const pool = layer.kind === 'filter' ? filterPool.value : effectPool.value
  const s = pickSketch(pool, perfBudget.value) // a representative candidate
  plannedNext.value = { targetId: layer.id, slug: s?.slug ?? null }
  if (s) say(`next: ${titleOf(layer.slug)} → ${titleOf(s.slug)}`)
}
function toggleLock(layer) {
  layer.locked = !layer.locked
  if (layer.locked && plannedNext.value?.targetId === layer.id) plannedNext.value = null
}
const plannedTitle = computed(() => {
  if (!plannedNext.value) return null
  const t = stack.find((l) => l.id === plannedNext.value.targetId)
  return t ? `${titleOf(t.slug)} → ${plannedNext.value.slug ? titleOf(plannedNext.value.slug) : '…'}` : null
})

// --- history (back/forward: a hard rebuild, user-initiated) -----------------
const history = []
const redo = []
// The *logical* stack: what the mix will be once the in-flight move settles.
// A move inserts a warming layer and only retires the one it replaces later,
// so at snapshot time both are present — capture the resolved set instead
// (warming layers in, the layers they're replacing out) or history bloats
// with phantom duplicates and back() rebuilds the wrong mix.
function logicalLayers() {
  const replaced = new Set(stack.filter((l) => l.replaces != null).map((l) => l.replaces))
  return stack.filter((l) => l.state !== 'dying' && !replaced.has(l.id))
}
function snapshot() {
  history.push(logicalLayers().map((l) => ({ slug: l.slug, kind: l.kind, blend: l.blend, opacity: l.opacity, locked: l.locked })))
  if (history.length > 30) history.shift()
}
function rebuildTo(descriptors) {
  for (const l of [...stack]) retire(l, 1700)
  for (const d of descriptors) insertLayer(makeLayer(d.slug, d.kind, d.blend, d.opacity, d.locked))
  settleUntil = performance.now() + 4000
  dwellLeft = effectiveDwell()
}
function back() {
  if (history.length < 2) return
  redo.push(history.pop()) // stash the state we're leaving so forward can return
  rebuildTo(history[history.length - 1])
  say('back')
}
// Forward: replay a state we backed out of; if there's none, make a new move.
function forward() {
  if (redo.length) {
    const next = redo.pop()
    history.push(next)
    rebuildTo(next)
    say('forward')
  } else {
    mutate()
  }
}

// --- warm-up lifecycle -------------------------------------------------------
// A warming layer goes live once its sketch has announced itself and had a
// moment to render (or after a hard timeout); only then does its counterpart
// begin to fade, so the crossfade never shows a booting black frame.
function settleWarming(now) {
  for (const l of stack) {
    if (l.state !== 'warming') continue
    const el = frames.get(l.id)
    const ready = el?.contentWindow && readyWins.has(el.contentWindow)
    const age = now - l.bornAt
    if ((ready && age > 1400) || age > 6000) {
      l.state = 'live'
      l.liveAt = now // when it started actually showing — for engagement scoring
      if (l.replaces != null) {
        retire(stack.find((x) => x.id === l.replaces))
        l.replaces = null
      }
      // Guarantee the panel gets this layer's controls: if its one-shot
      // sketch:ready raced our bookkeeping (no entry yet), ask it to re-announce.
      const win = el?.contentWindow
      if (win && !layerControls.some((c) => c.win === win)) {
        try { win.postMessage({ type: 'sketch:announce' }, '*') } catch {}
      }
    }
  }
}

// --- FPS watchdog: degrade gracefully, don't cut ----------------------------
const fps = ref(60)
let lowStreak = 0
let frameCount = 0
let winStart = 0
function watchdog() {
  if (fps.value < fpsFloor.value) lowStreak++
  else lowStreak = 0
  // Hold off while effects are still loading (start / reroll / rebuild) — they
  // spike the frame time before they settle and would be culled unfairly.
  if (!lowSkip.value || warmingCount() || performance.now() < settleUntil) return
  const eff = effectsOf()
  const filter = filterOf()
  if (lowStreak >= 3 && (eff.length > 1 || filter)) {
    // thin the mix: drop whichever non-base layer costs the most
    const cands = [...eff.slice(1), ...(filter ? [filter] : [])]
    const worst = cands.sort((a, b) => cost(b.slug) - cost(a.slug))[0]
    retire(worst)
    say(`low fps — thinning ${titleOf(worst.slug)}`)
    lowStreak = 0
  } else if (lowStreak >= 5 && eff.length === 1) {
    // one layer and still struggling: route to something cheap
    const cheap = effectPool.value
      .filter((s) => s.slug !== eff[0].slug && cost(s.slug) <= 2)
    const s = cheap.length ? pick(cheap) : null
    if (s) {
      const l = makeLayer(s.slug, 'effect', 'normal', 1)
      l.replaces = eff[0].id
      insertLayer(l, stack.findIndex((x) => x.id === eff[0].id))
      say(`low fps — routing to ${titleOf(s.slug)}`)
    }
    lowStreak = 0
  }
}

// --- shared mic + beat broadcast -------------------------------------------
const beat = createBeatDetector()
const micOn = ref(false)
let pendingBeat = false
let beatCount = 0
beat.onBeat(() => {
  pendingBeat = true
  // Beat-synced mode advances the show on musical phrases (~every 8 beats)
  // instead of a fixed clock, so changes land on the music.
  if (evolveMode.value === 'Beat-synced' && playing.value && !warmingCount() && ++beatCount >= 8) {
    beatCount = 0
    mutate()
  }
})
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

// --- filter feed: composite the layers below into a filter's source --------
// The feed is sized to the *viewport's* aspect ratio, not a fixed 16:9. If it
// were fixed, cover-fitting the scene into it (here) and then cover-fitting it
// back to full screen (in the filter's source.js) would crop twice — visibly
// zooming the output, badly so on non-16:9 / portrait screens. Matching the
// aspect makes both fits identity, so a filtered mix lines up with the scene.
const feed = new OffscreenCanvas(640, 360)
const feedCtx = feed.getContext('2d')
function sizeFeed() {
  const w = window.innerWidth || 640
  const h = window.innerHeight || 360
  const MAXD = 640 // bound the longest side so the per-frame composite stays cheap
  const fw = w >= h ? MAXD : Math.max(1, Math.round(MAXD * (w / h)))
  const fh = w >= h ? Math.max(1, Math.round(MAXD * (h / w))) : MAXD
  if (feed.width !== fw) feed.width = fw
  if (feed.height !== fh) feed.height = fh
}
function canvasBlend(b) {
  if (b === 'add') return 'lighter'
  if (b === 'normal') return 'source-over'
  return b
}
function coverDraw(ctx, cv, sw, sh, tw, th) {
  const scale = Math.max(tw / sw, th / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(cv, (tw - w) / 2, (th - h) / 2, w, h)
}
function feedFilters() {
  sizeFeed()
  for (let i = 0; i < stack.length; i++) {
    const L = stack[i]
    if (L.kind !== 'filter' || L.state === 'warming' && performance.now() - L.bornAt < 300) continue
    const el = frames.get(L.id)
    if (!el?.contentWindow) continue
    feedCtx.globalCompositeOperation = 'source-over'
    feedCtx.globalAlpha = 1
    feedCtx.fillStyle = '#000'
    feedCtx.fillRect(0, 0, feed.width, feed.height)
    let drew = false
    let first = true
    for (let j = 0; j < i; j++) {
      const under = stack[j]
      if (under.kind !== 'effect' || under.state === 'warming') continue
      let cv = null
      try {
        cv = frames.get(under.id)?.contentDocument?.querySelector('canvas')
      } catch {
        cv = null
      }
      if (!cv || !cv.width) continue
      feedCtx.globalAlpha = under.opacity ?? 1
      feedCtx.globalCompositeOperation = first ? 'source-over' : canvasBlend(under.blend)
      coverDraw(feedCtx, cv, cv.width, cv.height, feed.width, feed.height)
      first = false
      drew = true
    }
    feedCtx.globalAlpha = 1
    feedCtx.globalCompositeOperation = 'source-over'
    if (drew) {
      const bmp = feed.transferToImageBitmap()
      el.contentWindow.postMessage({ type: 'mixer:frame', bitmap: bmp }, '*', [bmp])
    }
  }
}

// --- per-layer params + mappings (same protocol as the viewer) -------------
const layerControls = reactive([]) // [{ id, win, title, schema, values, mappings, open }]
let controlSeq = 1
const INPUT_GROUPS = computed(() => {
  const groups = { audio: [], midi: [], mouse: [], touch: [], tilt: [], time: [], leap: [], artnet: [] }
  for (const s of INPUT_SOURCES) {
    const head = s.split('.')[0]
    const g = head === 'shake' ? 'tilt' : head
    ;(groups[g] ?? (groups[g] = [])).push(s)
  }
  return Object.entries(groups).filter(([, list]) => list.length)
})
function bindFrame(id, el) {
  if (el) frames.set(id, el)
  else frames.delete(id)
}
function titleForWindow(win) {
  for (const l of stack) {
    if (frames.get(l.id)?.contentWindow === win) return titleOf(l.slug)
  }
  return null
}
function pruneControls() {
  const wins = new Set([...frames.values()].map((el) => el.contentWindow))
  for (let i = layerControls.length - 1; i >= 0; i--) {
    if (!wins.has(layerControls[i].win)) layerControls.splice(i, 1)
  }
}
// which layer slug owns this window (for the param cache)
function slugForWindow(win) {
  for (const l of stack) if (frames.get(l.id)?.contentWindow === win) return l.slug
  return null
}
function onMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  readyWins.add(e.source)
  const title = titleForWindow(e.source)
  if (!title) {
    // sketch:ready fires at iframe boot and can race our ref bookkeeping —
    // if we can't resolve which layer this window belongs to yet, ask the
    // sketch to announce again shortly instead of dropping its controls.
    setTimeout(() => { try { e.source?.postMessage({ type: 'sketch:announce' }, '*') } catch {} }, 400)
    return
  }
  const slug = slugForWindow(e.source)
  const cached = slug ? paramCache[slug] : null
  const existing = layerControls.find((c) => c.win === e.source)
  const entry = {
    id: existing?.id ?? controlSeq++, // stable key so mid-edit re-renders don't reset inputs
    win: e.source,
    slug,
    title,
    schema: e.data.schema ?? {},
    values: { ...e.data.values, ...(cached?.values ?? {}) },
    mappings: (cached?.mappings ?? e.data.mappings ?? []).map((m) => ({ ...m })),
    open: existing?.open ?? layerControls.length === 0,
  }
  // Re-apply any options you'd set for this slug before (across back/forward
  // and rerolls) so the effect keeps its look instead of resetting.
  if (cached?.values) for (const [k, v] of Object.entries(cached.values)) e.source.postMessage({ type: 'sketch:set-param', name: k, value: v }, '*')
  if (cached?.mappings) e.source.postMessage({ type: 'sketch:set-mappings', mappings: cached.mappings }, '*')
  const i = layerControls.findIndex((c) => c.win === e.source)
  if (i >= 0) layerControls.splice(i, 1, entry)
  else layerControls.push(entry)
}
function cacheParams(c) {
  if (c.slug) paramCache[c.slug] = { values: { ...c.values }, mappings: c.mappings.map((m) => ({ ...m })) }
}
function setParam(c, name, value) {
  c.values[name] = value
  c.win.postMessage({ type: 'sketch:set-param', name, value }, '*')
  cacheParams(c)
}
function syncMappings(c) {
  c.win.postMessage({ type: 'sketch:set-mappings', mappings: c.mappings }, '*')
  cacheParams(c)
}
function addMapping(c) {
  const firstNumeric = Object.keys(c.schema).find((k) => typeof c.schema[k].min === 'number')
  if (!firstNumeric) return
  c.mappings.push({ source: 'audio.pulse', param: firstNumeric, amount: 0.5, smooth: 0.6 })
  syncMappings(c)
}
function removeMapping(c, i) {
  c.mappings.splice(i, 1)
  syncMappings(c)
}
function numericParams(c) {
  return Object.keys(c.schema).filter((k) => typeof c.schema[k].min === 'number')
}

// Autopilot slowly evolves each live layer's OWN options too, not just which
// sketches are on: once a second it eases one numeric param of one layer toward
// a fresh random target (a per-param goal it re-rolls on arrival), so the look
// keeps morphing even between routing moves. Cached via setParam so it persists.
function driftOptions() {
  const cands = layerControls.filter((c) => numericParams(c).length)
  if (!cands.length) return
  const c = pick(cands)
  const keys = numericParams(c)
  const name = pick(keys)
  const sp = c.schema[name]
  const span = (sp.max - sp.min) || 1
  if (!c._drift) c._drift = {}
  const cur = +c.values[name]
  let target = c._drift[name]
  if (target == null || Math.abs(target - cur) < span * 0.04) c._drift[name] = target = sp.min + Math.random() * span
  const next = cur + (target - cur) * 0.16
  setParam(c, name, +next.toFixed(4))
}

// --- main loop --------------------------------------------------------------
let raf = 0
let lastSecond = 0
let dwellLeft = 0
const dwellShown = ref(0)
// 0→1 fraction elapsed within the current dwell, for the countdown ring.
const dwellProgress = computed(() => {
  const d = Math.max(1, dwell.value)
  return Math.min(1, Math.max(0, 1 - dwellShown.value / d))
})
function loop(now) {
  beat.update(now)
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
  for (const el of frames.values()) el.contentWindow?.postMessage(msg, '*')

  settleWarming(performance.now())
  feedFilters()

  frameCount++
  if (!winStart) winStart = now
  if (now - winStart >= 500) {
    fps.value = Math.round((frameCount * 1000) / (now - winStart))
    frameCount = 0
    winStart = now
  }

  if (now - lastSecond >= 1000) {
    lastSecond = now
    if (playing.value) {
      dwellLeft--
      dwellShown.value = Math.max(0, dwellLeft)
      watchdog()
      if (evolveOptions.value && !warmingCount()) driftOptions()
      // Beat-synced drives itself off beats while the mic is live; fall back to
      // the dwell clock when there's no audio to sync to.
      const beatDriven = evolveMode.value === 'Beat-synced' && micOn.value
      if (dwellLeft <= 0 && !beatDriven) mutate()
    }
  }
  raf = requestAnimationFrame(loop)
}

// Toggle, not just enter — on mobile there's no Esc key, so a button that
// only calls requestFullscreen leaves no way out. Track state and swap the
// icon; support the WebKit-prefixed API (older iOS/Safari) too.
const isFullscreen = ref(false)
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function fullscreen() {
  const el = document.querySelector('.autopilot')
  if (fsElement()) {
    ;(document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
  } else {
    ;(el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el)
  }
}
function onFsChange() {
  isFullscreen.value = !!fsElement()
}

// Keyboard shortcuts for transport, save and audio (ignored while typing in a
// field). Mirrors the shortcuts advertised on the last tutorial slide.
function onKey(e) {
  if (tourActive.value) return
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  const k = e.key.toLowerCase()
  if (e.key === ' ') { e.preventDefault(); playing.value = !playing.value }
  else if (e.key === 'ArrowLeft') back()
  else if (e.key === 'ArrowRight') forward()
  else if (k === 'r') reroll()
  else if (k === 's') saveAsPatch()
  else if (k === 'm') toggleMic()
  else return
}

// --- guided tour -------------------------------------------------------------
const tourActive = ref(false)
const tourSteps = [
  { title: 'Autopilot', body: 'A hands-free show — it evolves an ever-changing mix of effects on its own. It’s already running behind this panel.' },
  { target: '[data-tour="ap-transport"]', title: 'Transport', body: 'Pause, step back to the previous mix, jump forward, save the current look as a Patch, or turn on the mic so the effects react to sound.', pad: 8 },
  { target: '[data-tour="ap-settings"]', title: 'Tune the tour', body: 'How often it changes, the performance budget, output resolution, and which effects are in rotation (shared with Settings).', pad: 8 },
  { title: 'Clean view', body: 'Close this panel (✕) for an unobstructed view — the corner button reopens it. Replay this tour anytime from the ? here.' },
]
function startTour() { panelOpen.value = true; setTimeout(() => (tourActive.value = true), 80) }
function finishTour(payload) { settings.markSeen('autopilot'); if (payload?.disableAll) settings.setTutorials(false) }

onMounted(() => {
  // opening mix: a base layer, usually a partner, maybe a filter — each
  // fades in as it becomes ready
  const base = pickSketch(effectPool.value, perfBudget.value)
  if (base) insertLayer(makeLayer(base.slug, 'effect', 'normal', 1))
  if (chance(0.8)) opAdd()
  if (chance(0.5)) opAddFilter()
  snapshot()
  dwellLeft = effectiveDwell()
  settleUntil = performance.now() + 5000 // let the opening mix finish loading
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  raf = requestAnimationFrame(loop)
  if (settings.shouldAutoTour('autopilot')) setTimeout(startTour, 700)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  beat.stop()
})
</script>

<template>
  <div class="autopilot">
    <!-- one persistent stack; layers crossfade individually as it evolves -->
    <div class="scene">
      <iframe
        v-for="l in stack"
        :key="l.id"
        :ref="(el) => bindFrame(l.id, el)"
        class="layer"
        :class="{ hidden: l.state === 'warming' || l.state === 'dying' }"
        :style="{
          mixBlendMode: l.blend === 'add' ? 'plus-lighter' : l.blend,
          opacity: l.state === 'live' ? l.opacity : 0,
        }"
        :src="srcFor(l)"
        allow="microphone; camera; midi; accelerometer; gyroscope"
      />
    </div>

    <transition name="card-fade">
      <div v-if="note" class="change-card">
        <span class="change-label">now</span>
        <span class="change-text">{{ note }}</span>
      </div>
    </transition>

    <!-- the only thing over the render: one faint corner button that opens the
         panel; it brightens on hover and stays tappable on touch -->
    <v-btn
      v-if="!panelOpen"
      class="panel-toggle"
      icon="mdi-tune-vertical"
      variant="flat" size="small"
      title="Controls"
      @click="panelOpen = true"
    />

    <!-- consolidated options panel: transport + settings + per-layer params -->
    <transition name="ap-panel">
      <div v-if="panelOpen" class="panel" @pointerdown.stop @pointermove.stop>
        <div class="panel-head">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" title="Back to gallery" />
          <span class="panel-title">Autopilot</span>
          <span class="fps" :class="{ low: fps < fpsFloor }">{{ fps }} fps</span>
          <v-btn icon="mdi-help-circle-outline" variant="text" size="small" title="Replay the walkthrough" @click="startTour" />
          <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" variant="text" size="small" :title="isFullscreen ? 'Exit full screen' : 'Full screen'" @click="fullscreen" />
          <v-btn icon="mdi-close" variant="text" size="small" title="Close controls" @click="panelOpen = false" />
        </div>

        <!-- transport -->
        <div class="panel-transport" data-tour="ap-transport">
          <v-btn icon="mdi-skip-previous" variant="text" size="small" title="Previous routing (←)" :disabled="history.length < 2" @click="back" />
          <v-btn :icon="playing ? 'mdi-pause' : 'mdi-play'" variant="text" size="small" :title="playing ? 'Pause (Space)' : 'Resume (Space)'" @click="playing = !playing" />
          <v-btn icon="mdi-skip-next" variant="text" size="small" :title="redo.length ? 'Forward (→)' : 'Next move now (→)'" @click="forward" />
          <!-- countdown with a circular progress ring around the number -->
          <span class="countdown-ring" :title="playing ? 'Time until the next change' : 'Paused'">
            <svg viewBox="0 0 36 36">
              <circle class="ring-bg" cx="18" cy="18" r="15.5" />
              <circle class="ring-fg" cx="18" cy="18" r="15.5"
                :stroke-dasharray="97.4"
                :stroke-dashoffset="97.4 * (1 - dwellProgress)" />
            </svg>
            <span class="ring-num">{{ playing ? dwellShown : '‖' }}</span>
          </span>
          <v-btn icon="mdi-dice-5-outline" variant="text" size="small" title="Full reroll (R)" @click="reroll" />
          <v-btn
            :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
            variant="text" size="small"
            :color="micOn ? 'primary' : undefined"
            title="Mic — audio reactivity (M)"
            @click="toggleMic"
          />
          <v-btn icon="mdi-content-save-outline" variant="text" size="small" title="Save the current mix as a Patch (S)" @click="saveAsPatch" />
          <v-btn icon="mdi-vector-polyline" variant="text" size="small" title="Edit the current mix in the Patch node editor" @click="editInPatch" />
        </div>

        <div class="panel-scroll" data-tour="ap-settings">
          <!-- ── Current mix ──────────────────────────────────────────────── -->
          <button class="drawer-head" @click="toggleSection('mix')">
            <span>Current mix</span><span>{{ sections.mix ? '▾' : '▸' }}</span>
          </button>
          <div v-show="sections.mix" class="drawer-body">
            <div v-if="plannedTitle" class="planned">next → {{ plannedTitle }}</div>
            <div class="mix-list">
              <div v-for="l in liveLayers()" :key="l.id" class="mix-item" :class="{ locked: l.locked, planned: plannedNext?.targetId === l.id }">
                <span class="mix-kind" :title="l.kind">{{ l.kind === 'filter' ? '⧉' : '◆' }}</span>
                <span class="mix-name">{{ titleOf(l.slug) }}</span>
                <button class="mix-btn" :title="l.locked ? 'Unlock' : 'Lock — keep this layer'" @click="toggleLock(l)">{{ l.locked ? '🔒' : '🔓' }}</button>
                <button class="mix-btn" :disabled="l.locked" title="Swap this layer next (preview)" @click="planSwap(l)">⇄</button>
              </div>
              <div v-if="!liveLayers().length" class="waiting">building the mix…</div>
            </div>
          </div>

          <!-- ── Settings ─────────────────────────────────────────────────── -->
          <button class="drawer-head" @click="toggleSection('settings')">
            <span>Settings</span><span>{{ sections.settings ? '▾' : '▸' }}</span>
          </button>
          <div v-show="sections.settings" class="drawer-body">
            <div class="set-row">Evolution mode</div>
            <select class="mode-select" :value="evolveMode" @change="evolveMode = $event.target.value; persistSettings()">
              <option v-for="m in EVOLVE_MODES" :key="m" :value="m">{{ m }}</option>
            </select>
            <p class="set-sub mb-2">{{ MODE_BLURB[evolveMode] }}</p>
            <div class="set-row">Seconds between changes: {{ dwell }}s</div>
            <v-slider v-model="dwell" density="compact" hide-details :min="6" :max="120" :step="1" @end="persistSettings" />
            <div class="set-row">Perf budget: {{ perfBudget }} (bigger = richer mixes)</div>
            <v-slider v-model="perfBudget" density="compact" hide-details :min="4" :max="24" :step="1" @end="persistSettings" />
            <div class="set-row">Resolution</div>
            <v-btn-toggle v-model="resolution" density="compact" mandatory divided class="mt-1 mb-4 res-toggle" @update:model-value="persistSettings">
              <v-btn value="low" size="x-small">Low</v-btn>
              <v-btn value="medium" size="x-small">Med</v-btn>
              <v-btn value="high" size="x-small">High</v-btn>
              <v-btn value="native" size="x-small">Native</v-btn>
            </v-btn-toggle>
            <v-checkbox v-model="evolveOptions" density="compact" hide-details label="Evolve each effect's options over time" @change="persistSettings" />
            <v-checkbox v-model="showNotes" density="compact" hide-details label="Show change title-card" @change="persistSettings" />
            <v-checkbox v-model="lowSkip" density="compact" hide-details label="Auto-thin the mix on low FPS" @change="persistSettings" />
            <div v-if="lowSkip" class="set-row">FPS floor: {{ fpsFloor }}</div>
            <v-slider v-if="lowSkip" v-model="fpsFloor" density="compact" hide-details :min="10" :max="50" :step="1" @end="persistSettings" />
          </div>

          <!-- ── Effects in rotation ──────────────────────────────────────── -->
          <button class="drawer-head" @click="toggleSection('effects')">
            <span>Effects in rotation</span><span>{{ sections.effects ? '▾' : '▸' }}</span>
          </button>
          <div v-show="sections.effects" class="drawer-body">
            <div class="set-row d-flex justify-space-between align-center">
              <span class="set-sub">shared with Settings</span>
              <button class="mini-clear" @click="settings.enableAllEffects()">all</button>
            </div>
            <div class="eff-list">
              <label v-for="s in allEffects" :key="s.slug" class="eff-item">
                <input type="checkbox" :checked="settings.isEffectEnabled(s.slug)" @change="toggleEffect(s.slug)" />
                {{ s.title }}
              </label>
            </div>
          </div>

          <!-- ── Layer params & mappings ──────────────────────────────────── -->
          <button class="drawer-head" @click="toggleSection('layers')">
            <span>Layer params &amp; mappings</span><span>{{ sections.layers ? '▾' : '▸' }}</span>
          </button>
          <div v-show="sections.layers" class="drawer-body">
          <template v-if="layerControls.length">
            <div v-for="c in layerControls" :key="c.id" class="layer-sec">
              <button class="sec-head" @click="c.open = !c.open">
                <span>{{ c.title }}</span><span>{{ c.open ? '▾' : '▸' }}</span>
              </button>
              <div v-if="c.open" class="sec-body">
                <template v-for="(spec, name) in c.schema" :key="name">
                  <label v-if="spec.type === 'bool'" class="chk">
                    <input type="checkbox" :checked="c.values[name]" @change="setParam(c, name, $event.target.checked)" /> {{ spec.label ?? name }}
                  </label>
                  <button v-else-if="spec.type === 'action'" class="act-btn" @click="c.win.postMessage({ type: 'sketch:action', name }, '*')">{{ spec.label ?? name }}</button>
                  <label v-else-if="spec.type === 'select'">
                    {{ spec.label ?? name }}
                    <select :value="c.values[name]" @change="setParam(c, name, $event.target.value)">
                      <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                    </select>
                  </label>
                  <label v-else>
                    {{ spec.label ?? name }}
                    <input type="range" :min="spec.min" :max="spec.max" :step="spec.step ?? 0.01" :value="c.values[name]" @input="setParam(c, name, +$event.target.value)" />
                  </label>
                </template>
                <div class="map-head">
                  <span>Mappings</span>
                  <button class="mini" title="Add mapping" @click="addMapping(c)">+</button>
                </div>
                <div v-for="(m, mi) in c.mappings" :key="mi" class="map-row">
                  <select v-model="m.source" @change="syncMappings(c)">
                    <optgroup v-for="[g, list] in INPUT_GROUPS" :key="g" :label="g">
                      <option v-for="src in list" :key="src" :value="src">{{ src }}</option>
                    </optgroup>
                  </select>
                  <span>→</span>
                  <select v-model="m.param" @change="syncMappings(c)">
                    <option v-for="pn in numericParams(c)" :key="pn" :value="pn">{{ pn }}</option>
                  </select>
                  <input type="range" min="-1" max="1" step="0.05" v-model.number="m.amount" title="amount" @input="syncMappings(c)" />
                  <input type="range" min="0" max="0.98" step="0.02" :value="m.smooth ?? 0" title="smoothing" @input="m.smooth = +$event.target.value; syncMappings(c)" />
                  <button class="mini" title="Remove" @click="removeMapping(c, mi)">×</button>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="waiting">waiting for the mix…</div>
          </div>
        </div>
      </div>
    </transition>

    <TourOverlay v-model="tourActive" :steps="tourSteps" @finish="finishTour" />
  </div>
</template>

<style scoped>
.autopilot { position: fixed; inset: 0; background: #05060a; z-index: 2000; overflow: hidden; }
.scene { position: absolute; inset: 0; isolation: isolate; background: #05060a; }
.layer {
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
  transition: opacity 1.5s ease;
}
/* The change notice: a title card that slides in at the bottom-right. */
.change-card {
  position: absolute; right: 16px; bottom: 16px; z-index: 10; pointer-events: none;
  display: flex; flex-direction: column; gap: 1px; max-width: 46vw;
  padding: 8px 14px; border-radius: 10px;
  background: rgba(14, 16, 24, 0.82); border: 1px solid rgba(255, 190, 120, 0.28);
  border-left: 3px solid rgba(255, 190, 120, 0.9);
  backdrop-filter: blur(6px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}
.change-label {
  font: 600 9px system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
  color: #b98a58;
}
.change-text {
  font: 500 15px system-ui, sans-serif; color: #ffe6c8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-fade-enter-active, .card-fade-leave-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.card-fade-enter-from, .card-fade-leave-to { opacity: 0; transform: translateY(10px); }
/* The lone affordance over the render: a faint corner button that brightens
   on hover and stays tappable on touch. Everything else lives in the panel. */
.panel-toggle {
  position: absolute; top: 10px; right: 10px; z-index: 20;
  opacity: 0.3; transition: opacity 0.25s;
  background: rgba(16, 18, 26, 0.6) !important;
}
.panel-toggle:hover { opacity: 1; }
@media (hover: none) { .panel-toggle { opacity: 0.55; } }

/* Consolidated controls panel — a right-side sheet that holds the transport,
   settings and per-layer params, so nothing else clutters the visuals. */
.panel {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 21;
  width: min(320px, 92vw); display: flex; flex-direction: column;
  background: rgba(14, 16, 24, 0.94); border-left: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
}
.panel-head {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.panel-title { font: 600 13px system-ui, sans-serif; color: #e8ecf5; margin-right: auto; }
.panel-transport {
  display: flex; align-items: center; gap: 2px; padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.panel-scroll { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
/* Collapsible drawer sections. */
.drawer-head {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 7px 10px; margin-top: 2px; border: 0; cursor: pointer;
  background: rgba(255,255,255,0.06); border-radius: 8px;
  font: 700 11px system-ui, sans-serif; color: #e8ecf5; text-transform: uppercase; letter-spacing: 0.04em;
}
.drawer-head:hover { background: rgba(255,255,255,0.1); }
.drawer-body { display: flex; flex-direction: column; gap: 6px; padding: 6px 2px 4px; }
.panel-sub {
  margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08);
  font: 600 11px system-ui, sans-serif; color: #9aa4c0; text-transform: uppercase; letter-spacing: 0.04em;
}
.ap-panel-enter-active, .ap-panel-leave-active { transition: transform 0.28s ease, opacity 0.28s ease; }
.ap-panel-enter-from, .ap-panel-leave-to { transform: translateX(20px); opacity: 0; }

.fps { font: 12px ui-monospace, monospace; color: #8f8; }
.fps.low { color: #f88; }
.countdown { font: 12px ui-monospace, monospace; color: #9aa4c0; min-width: 48px; text-align: right; margin-right: auto; }
/* Countdown with a circular progress ring drawn around the number. */
.countdown-ring { position: relative; width: 30px; height: 30px; margin-right: auto; display: inline-flex; align-items: center; justify-content: center; }
.countdown-ring svg { position: absolute; inset: 0; width: 30px; height: 30px; transform: rotate(-90deg); }
.countdown-ring .ring-bg { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 3; }
.countdown-ring .ring-fg { fill: none; stroke: #7c8cff; stroke-width: 3; stroke-linecap: round; transition: stroke-dashoffset 0.9s linear; }
.ring-num { font: 11px ui-monospace, monospace; color: #cdd3e0; }
.planned { font: 11px system-ui, sans-serif; color: #ffcf9a; background: rgba(60,42,20,0.5); border: 1px solid rgba(255,190,120,0.3); border-radius: 6px; padding: 3px 8px; }
.mix-list { display: flex; flex-direction: column; gap: 3px; margin-bottom: 4px; }
.mix-item { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,0.04); border: 1px solid transparent; }
.mix-item.locked { border-color: rgba(124,140,255,0.5); background: rgba(124,140,255,0.1); }
.mix-item.planned { border-color: rgba(255,190,120,0.5); }
.mix-kind { color: #7c8cff; font-size: 11px; width: 12px; text-align: center; }
.mix-name { flex: 1; font: 11px system-ui, sans-serif; color: #dfe4f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mix-btn { background: transparent; border: 0; cursor: pointer; font-size: 12px; line-height: 1; padding: 2px; opacity: 0.85; }
.mix-btn:hover { opacity: 1; }
.mix-btn:disabled { opacity: 0.3; cursor: default; }
.set-row { font: 12px system-ui, sans-serif; color: #cdd3e0; margin-top: 4px; }
.eff-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow-y: auto; margin-top: 4px; }
.panel .eff-item { display: flex; flex-direction: row; align-items: center; gap: 6px; font: 11px system-ui, sans-serif; color: #cdd3e0; }
.mini-clear { font: 10px system-ui; color: #9aa4c0; background: transparent; border: 1px solid #444; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
.layer-sec { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; overflow: hidden; }
.sec-head {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  padding: 6px 10px; background: rgba(255, 255, 255, 0.06); border: 0; cursor: pointer;
  font: 600 12px system-ui, sans-serif; color: #e8ecf5;
}
.sec-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.panel label { display: flex; flex-direction: column; gap: 2px; font: 11px system-ui, sans-serif; color: #cdd3e0; }
.panel .chk { flex-direction: row; align-items: center; gap: 6px; }
.panel select { background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; font-size: 11px; }
.panel input[type=range] { width: 100%; }
.act-btn { font: 11px system-ui, sans-serif; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 5px 8px; cursor: pointer; }
.act-btn:hover { border-color: #7c8cff; }
/* Resolution toggle: stretch the four buttons to fill the panel so "Native"
   never spills past the edge. */
.mode-select { width: 100%; background: #12141c; color: #e8ecf5; border: 1px solid #3a4056; border-radius: 6px; font: 12px system-ui, sans-serif; padding: 5px 8px; margin-top: 2px; }
.set-sub { font: 11px system-ui, sans-serif; color: #8a90a0; margin: 2px 0 0; }
.res-toggle { display: flex; width: 100%; height: 30px; }
.res-toggle :deep(.v-btn) { flex: 1 1 0; min-width: 0; padding: 0; letter-spacing: 0; }
.map-head { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; }
.map-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 3px; align-items: center; font-size: 10px; color: #cdd3e0; }
.map-row input[type=range] { grid-column: 1 / -1; }
.mini { width: 18px; height: 18px; border-radius: 3px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 12px; line-height: 1; }
.waiting { font: 12px system-ui, sans-serif; color: #9aa4c0; }
</style>
