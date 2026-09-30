// Two-deck compositor state for the Patch editor — like a DJ's two decks, but
// for video. Each deck holds a complete patch graph with its own Output node;
// a master crossfader blends the two onto the stage. You edit one deck while the
// other is on air, fork a patch across to experiment, cue a new effect on the
// off-air deck, then fade it in.
//
// Why `nodes` / `edges` / `links` are scoped arrays: the view has ~300 reads and
// writes of those three names. They point at the deck "in scope" (the edited
// deck, or the deck the compositor is evaluating mid-pass via withDeck), so all
// of that code — editors, renderers, link evaluation — works per deck unchanged.
//
// Node ids are unique across BOTH decks (one shared allocator in the view), so
// the runtime maps keyed by id (canvases, iframes, effect params) never collide.
import { reactive, ref } from 'vue'
import { scopedArray } from '../lib/patch/scoped.js'

export const MASTER_BLENDS = ['Mix', 'Add', 'Screen', 'Multiply', 'Difference']
const BLEND_OP = { Mix: 'source-over', Add: 'lighter', Screen: 'screen', Multiply: 'multiply', Difference: 'difference' }

// initial: { a:{nodes,edges,links}, b:{nodes,edges,links}|null, mix:{…}|null }
export function useDecks(initial = {}) {
  const mk = (name, g) => ({
    name,
    nodes: reactive(g?.nodes ?? []),
    edges: reactive(g?.edges ?? []),
    links: reactive(g?.links ?? []),
  })
  const decks = [mk('A', initial.a), mk('B', initial.b)]
  const editIdx = ref(0)
  let cur = decks[0]

  const track = () => void editIdx.value // scope changes re-run readers
  const nodes = scopedArray(() => cur.nodes, track)
  const edges = scopedArray(() => cur.edges, track)
  const links = scopedArray(() => cur.links, track)

  function setEdit(i) { editIdx.value = i; cur = decks[i] }
  // Run fn with deck d in scope (the compositor does this per deck per pass).
  function withDeck(d, fn) {
    const prev = cur
    cur = d
    try { return fn() } finally { cur = prev }
  }
  const editDeck = () => decks[editIdx.value]
  // the deck that is NOT in scope (relative to scope, so withDeck() callers see their own 'other')
  const otherDeck = () => (cur === decks[0] ? decks[1] : decks[0])
  const scopeIdx = () => (cur === decks[0] ? 0 : 1)

  // --- id bookkeeping (ids are global across decks) ---------------------------
  const allNodes = () => decks.flatMap((d) => d.nodes)
  const maxId = () => allNodes().reduce((m, n) => Math.max(m, n.id), 0)
  const idsOf = (d) => new Set(d.nodes.map((n) => n.id))
  const hasOutput = (d) => d.nodes.some((n) => n.type === 'output')

  // --- master crossfader ------------------------------------------------------
  // pos 0 = all deck A … 1 = all deck B. `enabled` gates the whole feature: off,
  // deck B is ignored and the editor behaves as a single-graph patch.
  const mix = reactive({
    enabled: false,
    pos: 0,
    blend: 'Mix',
    fadeSecs: 4,
    fading: null, // { from, to, t0, dur } while an AUTO fade runs
    ...(initial.mix || {}),
  })
  mix.fading = null
  if (!MASTER_BLENDS.includes(mix.blend)) mix.blend = 'Mix'

  // How much of deck i reaches the master (drives whether it must render).
  function airWeight(i) {
    if (!mix.enabled) return i === 0 ? 1 : 0
    return i === 1 ? mix.pos : mix.blend === 'Mix' ? 1 - mix.pos : 1
  }
  const onAirIdx = () => (mix.pos >= 0.5 ? 1 : 0)
  function cut(to) { mix.fading = null; mix.pos = to }
  // preroll (ms): hold the fader while the incoming deck resumes from pause.
  function fadeTo(to, secs, now = performance.now(), preroll = 0) {
    mix.fading = { from: mix.pos, to, t0: now + preroll, dur: Math.max(0.05, secs) * 1000 }
  }
  // Advance an AUTO fade (smoothstep). Returns true on the frame it completes.
  function tickFade(now) {
    const f = mix.fading
    if (!f) return false
    const t = (now - f.t0) / f.dur
    if (t <= 0) return false
    if (t >= 1) { mix.pos = f.to; mix.fading = null; return true }
    mix.pos = f.from + (f.to - f.from) * (t * t * (3 - 2 * t))
    return false
  }

  // Composite the two deck outputs (canvases) into `dst`'s 2D context at size
  // w×h. Only called when both decks contribute; callers short-circuit the
  // single-deck case so the common path costs nothing.
  function compose(cx, w, h, a, b) {
    const f = mix.pos
    cx.globalAlpha = 1
    cx.globalCompositeOperation = 'source-over'
    cx.fillStyle = '#000'
    cx.fillRect(0, 0, w, h)
    if (mix.blend === 'Mix') {
      if (a && f < 1) { cx.globalAlpha = 1 - f; cx.drawImage(a, 0, 0, w, h) }
      if (b && f > 0) { cx.globalAlpha = f; cx.globalCompositeOperation = 'lighter'; cx.drawImage(b, 0, 0, w, h) }
    } else {
      if (a) cx.drawImage(a, 0, 0, w, h)
      if (b && f > 0) { cx.globalAlpha = f; cx.globalCompositeOperation = BLEND_OP[mix.blend]; cx.drawImage(b, 0, 0, w, h) }
    }
    cx.globalAlpha = 1
    cx.globalCompositeOperation = 'source-over'
  }

  // --- persistence ------------------------------------------------------------
  const serialize = () => ({
    deckB: { nodes: decks[1].nodes, edges: decks[1].edges, links: decks[1].links },
    mix: { enabled: mix.enabled, pos: mix.pos, blend: mix.blend, fadeSecs: mix.fadeSecs },
  })

  return {
    decks, editIdx, nodes, edges, links, mix,
    setEdit, withDeck, editDeck, otherDeck, scopeIdx,
    allNodes, maxId, idsOf, hasOutput,
    airWeight, onAirIdx, cut, fadeTo, tickFade, compose, serialize,
  }
}
