// Render scheduling for stacked-iframe compositors (Mixer, Autopilot).
//
// Each layer is a whole sketch in its own iframe, so cost is the sum of what is
// running. Patch solves this with a node graph (lib/patch/scheduler.js). A stack
// is a simpler graph: layers composite bottom to top, and a filter layer reads
// the composite of everything below it. This module reuses Patch's
// RateController and the `sketch:throttle` message for two jobs:
//
//   planStack      which layers can still change the picture (the rest idle)
//   StackThrottle  step live layers down in frame rate under load, and back up

import { RateController, BACKGROUND_FPS } from './patch/scheduler.js'

// Sketch pages whose canvas can show what is beneath them. Every other embedded
// sketch page paints an opaque body background, so a normal-blend layer covers.
export const TRANSPARENT_SKETCHES = new Set(['bright-waves-logo'])

/**
 * A layer covers everything below it when it paints every pixel, composites with
 * 'normal' at (nearly) full opacity and is not shrunk by zoom.
 */
export function layerCovers(layer, { opaque = true } = {}) {
  if (!layer.on || !layer.slug || !opaque) return false
  if ((layer.blend ?? 'normal') !== 'normal') return false
  if ((layer.opacity ?? 1) < 0.98) return false
  return (layer.zoom ?? 1) >= 1
}

/**
 * Which layers can change the picture. Layer index 0 is the bottom. A layer is
 * live when the screen sees it, or when a live filter above it does: a filter
 * reads the layers below it, but only down to the nearest covering layer.
 *
 * @param layers  [{ slug, on, blend, opacity, zoom }]
 * @param opts    isFilter(layer), opaque(layer): both default to "no" / "yes"
 * @returns       { live: Set<index>, dist: Map<index, hops from the top> }
 */
export function planStack(layers, { isFilter = () => false, opaque = () => true } = {}) {
  const n = layers.length
  const covers = layers.map((l) => layerCovers(l, { opaque: opaque(l) }))
  // nearest covering layer above each index (n when none)
  const coverAbove = new Array(n).fill(n)
  let nearest = n
  for (let i = n - 1; i >= 0; i--) {
    coverAbove[i] = nearest
    if (covers[i]) nearest = i
  }
  const live = new Set()
  const liveFilters = []
  for (let i = n - 1; i >= 0; i--) {
    const l = layers[i]
    if (!l.on || !l.slug) continue
    const seenByScreen = coverAbove[i] === n
    const seenByFilter = liveFilters.some((k) => coverAbove[i] >= k)
    if (!seenByScreen && !seenByFilter) continue
    live.add(i)
    if (isFilter(l)) liveFilters.push(i)
  }
  const dist = new Map([...live].map((i) => [i, n - 1 - i]))
  return { live, dist }
}

/**
 * Keeps one RateController and tells each layer's iframe how fast to run.
 * Items: [{ key, el, live, dist, cost, protect, throttleable }]. Culled layers
 * idle at BACKGROUND_FPS. Messages go out on change, and again every couple of
 * seconds in case an iframe was not listening yet.
 */
export class StackThrottle {
  constructor(opts) {
    this.ctl = new RateController(opts)
    this.sent = new WeakMap() // iframe element -> { fps, at }
  }

  update({ now, items, measuredFps, targetFps = 60 }) {
    const byKey = new Map(items.map((it) => [it.key, it]))
    const live = new Set(items.filter((it) => it.live).map((it) => it.key))
    const dist = new Map(items.map((it) => [it.key, it.dist ?? 1]))
    const protect = new Set(items.filter((it) => it.protect).map((it) => it.key))
    const rates = this.ctl.update({
      now, live, dist, protect, measuredFps, targetFps,
      costOf: (k) => byKey.get(k)?.cost ?? 1,
      throttleable: (k) => !!byKey.get(k)?.throttleable,
    })
    for (const it of items) {
      if (!it.el || !it.throttleable) continue
      const want = it.live ? (rates.get(it.key) ?? 60) : BACKGROUND_FPS
      const prev = this.sent.get(it.el)
      if (prev && prev.fps === want && now - prev.at < 2000) continue
      this.sent.set(it.el, { fps: want, at: now })
      try { it.el.contentWindow?.postMessage({ type: 'sketch:throttle', fps: want >= 58 ? 0 : want }, '*') } catch {}
    }
    return rates
  }

  // Lift every limit (for example when the view closes or the stack is paused).
  release(items) {
    for (const it of items) {
      if (!it.el || !this.sent.has(it.el)) continue
      this.sent.delete(it.el)
      try { it.el.contentWindow?.postMessage({ type: 'sketch:throttle', fps: 0 }, '*') } catch {}
    }
  }
}
