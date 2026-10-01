// Mixer / Autopilot stack scheduling: which layers can change the picture, and
// the throttle messages sent to each layer's iframe.
import { describe, it, expect } from 'vitest'
import { planStack, layerCovers, StackThrottle } from '../src/lib/stackScheduler.js'
import { BACKGROUND_FPS } from '../src/lib/patch/scheduler.js'

const L = (slug, o = {}) => ({ slug, on: true, blend: 'normal', opacity: 1, zoom: 1, ...o })
const isFilter = (l) => l.slug.startsWith('f-')
const live = (layers, opts = { isFilter }) => [...planStack(layers, opts).live].sort()

describe('layerCovers', () => {
  it('needs normal blend, near-full opacity, no shrink and an opaque page', () => {
    expect(layerCovers(L('a'))).toBe(true)
    expect(layerCovers(L('a', { blend: 'screen' }))).toBe(false)
    expect(layerCovers(L('a', { opacity: 0.9 }))).toBe(false)
    expect(layerCovers(L('a', { zoom: 0.8 }))).toBe(false)
    expect(layerCovers(L('a', { on: false }))).toBe(false)
    expect(layerCovers(L('a'), { opaque: false })).toBe(false)
  })
})

describe('planStack', () => {
  it('keeps every layer when none covers', () => {
    expect(live([L('a'), L('b', { blend: 'screen' }), L('c', { opacity: 0.8 })])).toEqual([0, 1, 2])
  })

  it('culls layers under a covering layer', () => {
    const p = planStack([L('a'), L('b'), L('c')], { isFilter })
    expect([...p.live].sort()).toEqual([2])
  })

  it('keeps layers above the cover and the cover itself', () => {
    expect(live([L('a'), L('b'), L('c', { blend: 'add' })])).toEqual([1, 2])
  })

  it('ignores off layers when looking for a cover', () => {
    expect(live([L('a'), L('b', { on: false }), L('c', { blend: 'add' })])).toEqual([0, 2])
  })

  it('does not treat a transparent page as a cover', () => {
    const opaque = (l) => l.slug !== 'logo'
    expect(live([L('a'), L('logo')], { isFilter, opaque })).toEqual([0, 1])
  })

  it('keeps layers a live filter reads, down to the nearest cover', () => {
    // a (hidden by b), b covers, c on top, filter reads b and c only
    expect(live([L('a'), L('b'), L('c', { blend: 'add' }), L('f-x', { blend: 'screen' })])).toEqual([1, 2, 3])
  })

  it('keeps the layers under a covering filter, since it reads them', () => {
    expect(live([L('a'), L('b', { blend: 'add' }), L('f-x')])).toEqual([0, 1, 2])
  })

  it('culls a filter that is itself hidden, and its feeders', () => {
    expect(live([L('a'), L('f-x'), L('c')])).toEqual([2])
  })

  it('reports hops from the top layer', () => {
    const p = planStack([L('a'), L('b', { blend: 'add' })], { isFilter })
    expect(p.dist.get(1)).toBe(0)
    expect(p.dist.get(0)).toBe(1)
  })
})

describe('StackThrottle', () => {
  const frame = () => {
    const msgs = []
    return { msgs, contentWindow: { postMessage: (m) => msgs.push(m) } }
  }
  const item = (key, el, o = {}) => ({ key, el, live: true, dist: 1, cost: 1, throttleable: true, ...o })

  it('idles culled layers and leaves live layers at full rate', () => {
    const a = frame()
    const b = frame()
    const t = new StackThrottle()
    t.update({ now: 0, items: [item(0, a, { live: false }), item(1, b)], measuredFps: 60 })
    expect(a.msgs).toEqual([{ type: 'sketch:throttle', fps: BACKGROUND_FPS }])
    expect(b.msgs).toEqual([{ type: 'sketch:throttle', fps: 0 }])
  })

  it('sends only changes, with a refresh every 2 s', () => {
    const a = frame()
    const t = new StackThrottle()
    const items = [item(0, a)]
    t.update({ now: 0, items, measuredFps: 60 })
    t.update({ now: 1000, items, measuredFps: 60 })
    expect(a.msgs).toHaveLength(1)
    t.update({ now: 2500, items, measuredFps: 60 })
    expect(a.msgs).toHaveLength(2)
  })

  it('steps the costliest far layer down first under load', () => {
    const near = frame()
    const far = frame()
    const t = new StackThrottle()
    const items = [item(0, far, { dist: 3, cost: 8 }), item(1, near, { dist: 0, cost: 1 })]
    t.update({ now: 0, items, measuredFps: 30 })
    expect(far.msgs.at(-1).fps).toBe(30)
    expect(near.msgs.at(-1).fps).toBe(0)
  })

  it('never throttles protected layers below 30 fps', () => {
    const a = frame()
    const t = new StackThrottle()
    const items = [item(0, a, { protect: true })]
    for (let i = 0; i < 10; i++) t.update({ now: i * 600, items, measuredFps: 10 })
    expect(Math.min(...a.msgs.map((m) => m.fps || 60))).toBe(30)
  })

  it('skips layers that cannot be throttled', () => {
    const a = frame()
    const t = new StackThrottle()
    t.update({ now: 0, items: [item(0, a, { throttleable: false, live: false })], measuredFps: 60 })
    expect(a.msgs).toHaveLength(0)
  })

  it('release lifts the limits', () => {
    const a = frame()
    const t = new StackThrottle()
    const items = [item(0, a, { live: false })]
    t.update({ now: 0, items, measuredFps: 60 })
    t.release(items)
    expect(a.msgs.at(-1)).toEqual({ type: 'sketch:throttle', fps: 0 })
  })
})
