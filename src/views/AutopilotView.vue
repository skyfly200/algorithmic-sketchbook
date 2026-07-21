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
import { useSketchStore } from '../stores/sketches'
import { createBeatDetector } from '../../sketches/_lib/beat.js'
import { INPUT_SOURCES } from '../../sketches/_lib/runtime.js'
import perfScores from '../registry/perf.json'

const store = useSketchStore()
const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone',
  'channel-offset', 'delay', 'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope',
  'fog', 'mist', 'glow', 'strobe', 'color-filter', 'crt', 'uv-light', 'polarization', 'light-leaves',
]
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
const effectPool = computed(() =>
  enabledEffects.value.size
    ? allEffects.value.filter((s) => enabledEffects.value.has(s.slug))
    : allEffects.value,
)
const filterPool = computed(() =>
  store.sketches.filter((s) => s.type === 'local' && s.embed && FILTER_SLUGS.includes(s.slug)),
)

// --- settings (persisted) ---------------------------------------------------
const SET_KEY = 'sketchbook-autopilot'
const savedSet = (() => {
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
const enabledEffects = ref(new Set(savedSet.enabledEffects ?? []))
const playing = ref(true)
// The rendered view stays clean: every control lives inside one panel opened
// from a single, unobtrusive corner button — nothing else overlays the visuals.
const panelOpen = ref(false)
function persistSettings() {
  localStorage.setItem(SET_KEY, JSON.stringify({
    dwell: dwell.value, lowSkip: lowSkip.value, fpsFloor: fpsFloor.value, perfBudget: perfBudget.value,
    resolution: resolution.value, enabledEffects: [...enabledEffects.value],
  }))
}
function toggleEffect(slug) {
  // Empty set means "all on"; the first uncheck materialises the full set so
  // the toggle removes exactly that one and keeps the rest.
  const set = enabledEffects.value.size ? new Set(enabledEffects.value) : new Set(allEffects.value.map((s) => s.slug))
  set.has(slug) ? set.delete(slug) : set.add(slug)
  // if everything ended up ticked again, collapse back to the "all" sentinel
  enabledEffects.value = set.size === allEffects.value.length ? new Set() : set
  persistSettings()
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

// --- learned interest --------------------------------------------------------
// Autopilot learns what you like from what you keep vs. skip: a layer you let
// play accrues weight, one you skip past quickly loses it, and the router then
// favours the higher-weighted sketches. Persisted, so the taste carries over.
const INTEREST_KEY = 'sketchbook-autopilot-interest'
const interest = (() => {
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
  note.value = text
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => (note.value = ''), 2600)
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
function saveAsPatch() {
  const layers = liveLayers()
  const effs = layers.filter((l) => l.kind === 'effect')
  const filt = layers.find((l) => l.kind === 'filter')
  if (!effs.length) return
  const nodes = []
  const edges = []
  let id = 1
  const mk = (type, params, x, y) => { const n = { id: id++, type, x, y, params }; nodes.push(n); return n }
  // effect source nodes down the left
  const effNodes = effs.map((l, i) => mk('effect', { slug: l.slug }, 40, 60 + i * 150))
  // fold them together with blends: base, then blend each next on top
  let composite = effNodes[0]
  for (let i = 1; i < effNodes.length; i++) {
    const b = mk('blend', { mode: effs[i].blend === 'normal' ? 'screen' : effs[i].blend, mix: effs[i].opacity ?? 1 }, 250 + i * 40, 60 + i * 150)
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

  const SAVED_KEY = 'sketchbook-patch-saved'
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(SAVED_KEY)) || [] } catch {}
  const names = effs.map((l) => titleOf(l.slug)).join(' + ')
  saved.push({ id: Date.now().toString(36), name: `Autopilot: ${names}`.slice(0, 60), nodes, edges, links: [] })
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  say('saved as a patch')
}

function pickSketch(pool, budgetLeft) {
  const inStack = new Set(stack.map((l) => l.slug))
  const fresh = pool.filter((s) => !inStack.has(s.slug) && !recent.includes(s.slug))
  let cands = fresh.filter((s) => cost(s.slug) <= budgetLeft)
  if (!cands.length) {
    // nothing fresh fits — fall back to the cheapest few available
    cands = pool
      .filter((s) => !inStack.has(s.slug))
      .sort((a, b) => cost(a.slug) - cost(b.slug))
      .slice(0, 5)
  }
  return weightedPick(cands)
}

function makeLayer(slug, kind, blend, opacity) {
  return {
    id: nextId++,
    slug,
    kind,
    blend,
    opacity,
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
function opReplace(target) {
  const freed = cost(target.slug)
  const s = pickSketch(target.kind === 'filter' ? filterPool.value : effectPool.value,
    perfBudget.value - stackCost() + freed)
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
  say(`+ ${titleOf(s.slug)}`)
  return true
}
function opRemove() {
  const eff = effectsOf()
  if (eff.length < 2) return false
  retire(eff[eff.length - 1])
  say(`− ${titleOf(eff[eff.length - 1].slug)}`)
  return true
}
function opAddFilter() {
  const s = pickSketch(filterPool.value, perfBudget.value - stackCost())
  if (!s) return false
  insertLayer(makeLayer(s.slug, 'filter', 'normal', 1))
  say(`filter: ${titleOf(s.slug)}`)
  return true
}
function opDropFilter() {
  const f = filterOf()
  if (!f) return false
  retire(f)
  say(`− filter ${titleOf(f.slug)}`)
  return true
}
function opRestyle() {
  const eff = effectsOf()
  const nonBase = eff.slice(1)
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

// One routing move: weighted pick among whatever is currently possible.
function mutate() {
  if (warmingCount()) return // let the network settle first
  const eff = effectsOf()
  const filter = filterOf()
  const budgetLeft = perfBudget.value - stackCost()
  const moves = []
  if (eff.length) moves.push([() => opReplace(pick(eff)), 5])
  if (eff.length < 3 && budgetLeft >= 2) moves.push([opAdd, 2.2])
  if (eff.length > 1) moves.push([opRemove, 1.4])
  if (filter) {
    moves.push([() => opReplace(filter), 2])
    moves.push([opDropFilter, 0.8])
  } else if (budgetLeft >= 1) {
    moves.push([opAddFilter, 2])
  }
  if (eff.length > 1) moves.push([opRestyle, 1.6])
  let total = moves.reduce((a, [, w]) => a + w, 0)
  let r = Math.random() * total
  for (const [fn, w] of moves) {
    r -= w
    if (r <= 0) {
      if (!fn()) continue
      break
    }
  }
  redo.length = 0 // a fresh move starts a new branch — old redo is void
  snapshot()
  dwellLeft = dwell.value
}

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
  history.push(logicalLayers().map((l) => ({ slug: l.slug, kind: l.kind, blend: l.blend, opacity: l.opacity })))
  if (history.length > 30) history.shift()
}
function rebuildTo(descriptors) {
  for (const l of [...stack]) retire(l, 1700)
  for (const d of descriptors) insertLayer(makeLayer(d.slug, d.kind, d.blend, d.opacity))
  dwellLeft = dwell.value
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
  if (!lowSkip.value || warmingCount()) return
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
const layerControls = reactive([]) // [{ win, title, schema, values, mappings, open }]
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
function onMessage(e) {
  if (e.data?.type !== 'sketch:ready') return
  readyWins.add(e.source)
  const title = titleForWindow(e.source)
  if (!title) return
  const entry = {
    win: e.source,
    title,
    schema: e.data.schema ?? {},
    values: { ...e.data.values },
    mappings: (e.data.mappings ?? []).map((m) => ({ ...m })),
    open: layerControls.length === 0,
  }
  const i = layerControls.findIndex((c) => c.win === e.source)
  if (i >= 0) layerControls.splice(i, 1, entry)
  else layerControls.push(entry)
}
function setParam(c, name, value) {
  c.values[name] = value
  c.win.postMessage({ type: 'sketch:set-param', name, value }, '*')
}
function syncMappings(c) {
  c.win.postMessage({ type: 'sketch:set-mappings', mappings: c.mappings }, '*')
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

// --- main loop --------------------------------------------------------------
let raf = 0
let lastSecond = 0
let dwellLeft = 0
const dwellShown = ref(0)
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
      if (dwellLeft <= 0) mutate()
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

onMounted(() => {
  // opening mix: a base layer, usually a partner, maybe a filter — each
  // fades in as it becomes ready
  const base = pickSketch(effectPool.value, perfBudget.value)
  if (base) insertLayer(makeLayer(base.slug, 'effect', 'normal', 1))
  if (chance(0.8)) opAdd()
  if (chance(0.5)) opAddFilter()
  snapshot()
  dwellLeft = dwell.value
  window.addEventListener('message', onMessage)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('message', onMessage)
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

    <div v-if="note" class="skip-note">{{ note }}</div>

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
          <v-btn :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" variant="text" size="small" :title="isFullscreen ? 'Exit full screen' : 'Full screen'" @click="fullscreen" />
          <v-btn icon="mdi-close" variant="text" size="small" title="Close controls" @click="panelOpen = false" />
        </div>

        <!-- transport -->
        <div class="panel-transport">
          <v-btn icon="mdi-skip-previous" variant="text" size="small" title="Back to the previous routing" :disabled="history.length < 2" @click="back" />
          <v-btn :icon="playing ? 'mdi-pause' : 'mdi-play'" variant="text" size="small" :title="playing ? 'Pause the tour' : 'Resume'" @click="playing = !playing" />
          <v-btn icon="mdi-skip-next" variant="text" size="small" :title="redo.length ? 'Forward' : 'Next routing move now'" @click="forward" />
          <span class="countdown">{{ playing ? dwellShown + 's' : 'paused' }}</span>
          <v-btn
            :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'"
            variant="text" size="small"
            :color="micOn ? 'primary' : undefined"
            title="Mic — every layer's audio mappings react"
            @click="toggleMic"
          />
          <v-btn icon="mdi-content-save-outline" variant="text" size="small" title="Save the current mix as a Patch routing" @click="saveAsPatch" />
        </div>

        <div class="panel-scroll">
          <!-- settings -->
          <div class="set-row">Seconds between changes: {{ dwell }}s</div>
          <v-slider v-model="dwell" density="compact" hide-details :min="6" :max="120" :step="1" @end="persistSettings" />
          <div class="set-row">Perf budget: {{ perfBudget }} (bigger = richer mixes)</div>
          <v-slider v-model="perfBudget" density="compact" hide-details :min="4" :max="24" :step="1" @end="persistSettings" />
          <div class="set-row">Resolution</div>
          <v-btn-toggle v-model="resolution" density="compact" mandatory divided class="mt-1 mb-4" @update:model-value="persistSettings">
            <v-btn value="low" size="x-small">Low</v-btn>
            <v-btn value="medium" size="x-small">Med</v-btn>
            <v-btn value="high" size="x-small">High</v-btn>
            <v-btn value="native" size="x-small">Native</v-btn>
          </v-btn-toggle>
          <v-checkbox v-model="lowSkip" density="compact" hide-details label="Auto-thin the mix on low FPS" @change="persistSettings" />
          <div v-if="lowSkip" class="set-row">FPS floor: {{ fpsFloor }}</div>
          <v-slider v-if="lowSkip" v-model="fpsFloor" density="compact" hide-details :min="10" :max="50" :step="1" @end="persistSettings" />
          <div class="set-row d-flex justify-space-between align-center">
            <span>Effects in rotation</span>
            <button class="mini-clear" @click="enabledEffects = new Set(); persistSettings()">all</button>
          </div>
          <div class="eff-list">
            <label v-for="s in allEffects" :key="s.slug" class="eff-item">
              <input type="checkbox" :checked="!enabledEffects.size || enabledEffects.has(s.slug)" @change="toggleEffect(s.slug)" />
              {{ s.title }}
            </label>
          </div>

          <!-- per-layer params + mappings -->
          <div class="panel-sub">Layer params &amp; mappings</div>
          <template v-if="layerControls.length">
            <div v-for="c in layerControls" :key="c.title + layerControls.indexOf(c)" class="layer-sec">
              <button class="sec-head" @click="c.open = !c.open">
                <span>{{ c.title }}</span><span>{{ c.open ? '▾' : '▸' }}</span>
              </button>
              <div v-if="c.open" class="sec-body">
                <template v-for="(spec, name) in c.schema" :key="name">
                  <label v-if="spec.type === 'bool'" class="chk">
                    <input type="checkbox" :checked="c.values[name]" @change="setParam(c, name, $event.target.checked)" /> {{ spec.label ?? name }}
                  </label>
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
    </transition>
  </div>
</template>

<style scoped>
.autopilot { position: fixed; inset: 0; background: #05060a; z-index: 2000; overflow: hidden; }
.scene { position: absolute; inset: 0; isolation: isolate; background: #05060a; }
.layer {
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
  transition: opacity 1.5s ease;
}
.skip-note {
  position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 10;
  padding: 6px 14px; border-radius: 999px; pointer-events: none;
  font: 13px system-ui, sans-serif; color: #ffcf9a;
  background: rgba(30, 22, 12, 0.85); border: 1px solid rgba(255, 190, 120, 0.4);
}
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
.panel-sub {
  margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08);
  font: 600 11px system-ui, sans-serif; color: #9aa4c0; text-transform: uppercase; letter-spacing: 0.04em;
}
.ap-panel-enter-active, .ap-panel-leave-active { transition: transform 0.28s ease, opacity 0.28s ease; }
.ap-panel-enter-from, .ap-panel-leave-to { transform: translateX(20px); opacity: 0; }

.fps { font: 12px ui-monospace, monospace; color: #8f8; }
.fps.low { color: #f88; }
.countdown { font: 12px ui-monospace, monospace; color: #9aa4c0; min-width: 48px; text-align: right; margin-right: auto; }
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
.map-head { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font: 600 10px system-ui; color: #9aa4c0; text-transform: uppercase; }
.map-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 3px; align-items: center; font-size: 10px; color: #cdd3e0; }
.map-row input[type=range] { grid-column: 1 / -1; }
.mini { width: 18px; height: 18px; border-radius: 3px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 12px; line-height: 1; }
.waiting { font: 12px system-ui, sans-serif; color: #9aa4c0; }
</style>
