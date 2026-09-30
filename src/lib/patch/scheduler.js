// Patch render scheduler. Framework-free, so it can be tested on its own.
//
// Every effect / filter node in a Patch is a full sketch running in its own
// iframe, so the cost of a patch is the sum of everything that is *running*,
// not just of what reaches the screen. This module decides, each moment:
//
//   1. Which nodes are LIVE — able to influence the Output. Anything else (a
//      dangling branch, or a layer hidden behind an opaque blend) is culled.
//   2. How fast each live node needs to run. Under load the least important,
//      most expensive nodes are stepped down through FPS_STEPS first; nodes near
//      the Output, selected, or being edited are protected. When there is
//      headroom again they are stepped back up.
//
// Culled nodes are not left running at full speed: the caller pauses them, or
// lets them tick over at BACKGROUND_FPS, one at a time (see backgroundSlot).

export const FPS_STEPS = [60, 30, 20, 15, 10, 6]
export const BACKGROUND_FPS = 3

// Node types whose frame is fully opaque (the compositor fills a node black
// before it renders, and these paint the whole frame). Text, sprites, polygons
// and masks leave transparency, so they never occlude what is beneath them.
const OPAQUE = new Set(['effect', 'filter', 'media', 'geodata', 'vcam'])

// Which input port of a Blend is its base layer (the other is composited on top).
const basePort = (n) => (n.params?.swap ? 1 : 0)

/**
 * The base layer of a Blend is invisible when the top layer fully covers it:
 * normal mode, mix at (or within a hair of) 1, and an opaque source on top.
 * `mixOf(node)` should return the live (link-modulated) mix.
 */
export function blendHidesBase(node, edges, nodeById, mixOf = (n) => n.params?.mix ?? 1) {
  if (node.type !== 'blend') return false
  if ((node.params?.mode ?? 'screen') !== 'normal') return false
  if ((mixOf(node) ?? 1) < 0.98) return false
  const top = edges.find((e) => e.to === node.id && e.port === 1 - basePort(node))
  const src = top && nodeById.get(top.from)
  return !!src && OPAQUE.has(src.type)
}

/**
 * Walk the graph upstream from every Output and collect the nodes that can
 * affect it, along with their hop distance from the Output (0 = the Output).
 * Video edges are followed except into a base layer that is hidden behind an
 * opaque top layer. Control links whose target is live keep their source live
 * too (an Input / XY / Tracker driving a live node must keep running).
 */
export function liveNodes({ nodes, edges, links = [], mixOf }) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dist = new Map()
  const queue = []
  for (const n of nodes) if (n.type === 'output') { dist.set(n.id, 0); queue.push(n.id) }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    const node = byId.get(id)
    if (!node) continue
    const d = dist.get(id)
    const hidden = blendHidesBase(node, edges, byId, mixOf) ? basePort(node) : -1
    const feeds = []
    for (const e of edges) if (e.to === id && e.port !== hidden) feeds.push(e.from)
    for (const l of links) if (l.node === id) feeds.push(l.from)
    for (const from of feeds) {
      if (!dist.has(from) && byId.has(from)) { dist.set(from, d + 1); queue.push(from) }
    }
  }
  return { live: new Set(dist.keys()), dist }
}

/**
 * Frame-rate controller. Call update() often (it rate-limits itself); it returns
 * a Map of nodeId -> fps for the live nodes. `measuredFps` is the compositor's
 * achieved frame rate: below `low` the lowest-priority node steps down one tier,
 * and once it has held above `high` for a while one node steps back up.
 */
export class RateController {
  // low / high are fractions of the target (display) frame rate
  constructor({ low = 0.83, high = 0.95, everyMs = 500, calmTicks = 4 } = {}) {
    this.low = low
    this.high = high
    this.everyMs = everyMs
    this.calmTicks = calmTicks
    this.tier = new Map() // id -> index into FPS_STEPS
    this.calm = 0
    this.last = -Infinity
    this.rates = new Map()
  }

  /**
   * @param live       Set of live node ids
   * @param dist       Map id -> hops from the Output
   * @param protect    Set of ids never dropped below 30 fps (selected, being dragged…)
   * @param costOf     id -> relative cost (bigger = pricier); defaults to 1
   * @param measuredFps the compositor's current fps
   * @param targetFps  the display's refresh rate (60 unless told otherwise)
   * @param throttleable id -> whether the node can be slowed at all
   */
  update({ now, live, dist, protect = new Set(), costOf = () => 1, measuredFps, targetFps = 60, throttleable }) {
    for (const id of [...this.tier.keys()]) if (!live.has(id)) this.tier.delete(id)
    const can = (id) => (throttleable ? throttleable(id) : true)
    const maxTier = (id) => (protect.has(id) ? 1 : FPS_STEPS.length - 1)
    // importance: near the Output and protected nodes matter most; cost breaks ties
    const priority = (id) => ((protect.has(id) ? 100 : 0) + 10 / (1 + (dist.get(id) ?? 9))) / Math.max(0.5, costOf(id))

    if (now - this.last >= this.everyMs && measuredFps > 0) {
      this.last = now
      const cands = [...live].filter(can)
      if (measuredFps < this.low * targetFps) {
        this.calm = 0
        const pick = cands.filter((id) => (this.tier.get(id) ?? 0) < maxTier(id)).sort((a, b) => priority(a) - priority(b))[0]
        if (pick !== undefined) this.tier.set(pick, (this.tier.get(pick) ?? 0) + 1)
      } else if (measuredFps >= this.high * targetFps) {
        if (++this.calm >= this.calmTicks) {
          this.calm = 0
          const pick = cands.filter((id) => (this.tier.get(id) ?? 0) > 0).sort((a, b) => priority(b) - priority(a))[0]
          if (pick !== undefined) this.tier.set(pick, this.tier.get(pick) - 1)
        }
      } else this.calm = 0
    }
    this.rates = new Map()
    for (const id of live) this.rates.set(id, FPS_STEPS[Math.min(this.tier.get(id) ?? 0, FPS_STEPS.length - 1)])
    return this.rates
  }
}

/**
 * Round-robin slot for background (culled) nodes: on each compositor pass only
 * one of every `size` background nodes is refreshed, so a pile of idle previews
 * costs one node's worth of work per frame rather than all of them.
 */
export function backgroundSlot(index, frame, size = 6) {
  return frame % Math.max(1, size) === index % Math.max(1, size)
}
