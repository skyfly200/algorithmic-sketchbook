// Autopilot for the Patch editor — the logic that auto-evolves the graph on a
// clock: swap an effect/filter slug, restyle a blend, or regrow a branch, while
// respecting a perf budget and an FPS floor. Lifted out of PatchView into a
// composable so the transport state and the move engine live in one place; the
// graph-mutating primitives it needs are injected via `ctx`, and <AutopilotBar>
// renders the returned state.
import { reactive, watch, onScopeDispose } from 'vue'

// ctx: { nodes, edges, TYPES, BLENDS, fps() (getter → current fps), slugPool(n),
//        slugCost(slug), graphCost(), persist(), randomPatch(),
//        rerollUpstream(node), undo() }
export function useAutopilot(ctx) {
  const state = reactive({
    on: false,
    paused: false,
    panelOpen: false,
    everySec: 12,   // dwell between moves
    fpsFloor: 15,   // below this, cheapen the graph instead of adding churn
    budget: 12,     // keep the graph's total render cost under this
    left: 0,        // whole seconds until the next move
    total: 1,       // length of the current dwell, for the ring
    // countdown ring fill 0..1 (getter → reactive, unwraps cleanly in templates)
    get progress() { return Math.min(1, Math.max(0, 1 - this.left / Math.max(1, this.total))) },
  })
  let timer = 0
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)]

  function resetClock() { state.total = Math.max(2, state.everySec); state.left = state.total }

  // Would autopilot ever mutate this node? (only those get the "keep" pin UI.)
  function canTouch(n) {
    if (n.type === 'output') return false
    return n.type === 'effect' || n.type === 'filter' || n.type === 'blend' || ctx.TYPES[n.type].ins > 0
  }

  function step() {
    if (!state.on) return
    const { nodes, edges, TYPES, BLENDS, slugPool, slugCost, graphCost, persist, randomPatch, rerollUpstream } = ctx
    const fpsNow = ctx.fps()
    const swappable = nodes.filter((n) => (n.type === 'effect' || n.type === 'filter') && !n.locked && !n.keep)

    // Perf watchdog: under the FPS floor, don't add churn — swap the most
    // expensive unlocked node for a cheaper sketch and stop for this tick.
    if (fpsNow > 0 && fpsNow < state.fpsFloor && swappable.length) {
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
    const move = rnd(bag)
    if (move === 'swap') {
      const n = rnd(swappable)
      const opts = slugPool(n)
      if (!opts.length) return
      // respect the perf budget: prefer replacements that keep total cost in check
      const headroom = state.budget - (graphCost() - slugCost(n.params.slug))
      let pool = opts.filter((o) => slugCost(o.slug) <= Math.max(2, headroom))
      if (!pool.length) pool = [...opts].sort((a, b) => slugCost(a.slug) - slugCost(b.slug)).slice(0, Math.max(1, Math.ceil(opts.length * 0.3)))
      let s = n.params.slug
      for (let k = 0; k < 6 && s === n.params.slug; k++) s = pool[Math.floor(Math.random() * pool.length)]?.slug ?? s
      n.params.slug = s
      persist()
    } else if (move === 'blend') {
      const n = rnd(blends)
      n.params.mode = rnd(BLENDS)
      n.params.mix = +(0.35 + Math.random() * 0.6).toFixed(2)
      persist()
    } else {
      rerollUpstream(rnd(branchable))
    }
  }

  // A 1 Hz clock drives the countdown ring; at zero we make a move and re-arm.
  // Pausing stops the decrement but keeps autopilot engaged.
  function arm() {
    clearInterval(timer)
    if (!state.on) return
    resetClock()
    timer = setInterval(() => {
      if (state.paused) return
      state.left--
      if (state.left <= 0) { step(); resetClock() }
    }, 1000)
  }
  function toggle() {
    state.on = !state.on
    if (state.on) {
      state.paused = false
      if (!ctx.nodes.some((n) => n.type === 'effect' || n.type === 'filter')) ctx.randomPatch()
      state.panelOpen = true // surface the transport panel when it engages
    }
    arm()
  }
  function playPause() { state.paused = !state.paused }
  function nextNow() { if (!state.on) return; step(); resetClock() }
  function prev() { ctx.undo() }
  function reroll() { ctx.randomPatch(); resetClock() }

  watch(() => state.everySec, () => { if (state.on) arm() })
  onScopeDispose(() => clearInterval(timer))

  return { state, canTouch, toggle, playPause, nextNow, prev, reroll, arm, resetClock, step }
}
