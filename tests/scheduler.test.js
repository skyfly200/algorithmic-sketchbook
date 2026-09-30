import { describe, it, expect } from 'vitest'
import { liveNodes, blendHidesBase, RateController, FPS_STEPS, backgroundSlot } from '../src/lib/patch/scheduler.js'

const n = (id, type, params = {}) => ({ id, type, params })
const e = (from, to, port = 0) => ({ from, to, port })

describe('liveNodes', () => {
  it('keeps everything on the path to the output and culls the rest', () => {
    const nodes = [n(1, 'effect'), n(2, 'filter'), n(3, 'output'), n(4, 'effect'), n(5, 'filter')]
    const edges = [e(1, 2), e(2, 3), e(4, 5)] // 4 -> 5 goes nowhere
    const { live, dist } = liveNodes({ nodes, edges })
    expect([...live].sort()).toEqual([1, 2, 3])
    expect(dist.get(3)).toBe(0)
    expect(dist.get(2)).toBe(1)
    expect(dist.get(1)).toBe(2)
  })

  it('culls the base of an opaque normal blend, keeps it for a screen blend', () => {
    const nodes = [n(1, 'effect'), n(2, 'effect'), n(3, 'blend', { mode: 'normal' }), n(4, 'output')]
    const edges = [e(1, 3, 0), e(2, 3, 1), e(3, 4)]
    expect(liveNodes({ nodes, edges }).live.has(1)).toBe(false) // base hidden by effect 2
    expect(liveNodes({ nodes, edges }).live.has(2)).toBe(true)
    nodes[2].params.mode = 'screen'
    expect(liveNodes({ nodes, edges }).live.has(1)).toBe(true)
  })

  it('respects swap, a partial mix, and transparent top layers', () => {
    const edges = [e(1, 3, 0), e(2, 3, 1), e(3, 4)]
    const base = [n(1, 'effect'), n(2, 'effect'), n(4, 'output')]
    // swapped: port 1 is the base, so effect 2 is the hidden one
    let nodes = [...base, n(3, 'blend', { mode: 'normal', swap: true })]
    let r = liveNodes({ nodes, edges }).live
    expect(r.has(2)).toBe(false)
    expect(r.has(1)).toBe(true)
    // a half-mixed top doesn't hide the base
    nodes = [...base, n(3, 'blend', { mode: 'normal', mix: 0.5 })]
    expect(liveNodes({ nodes, edges }).live.has(1)).toBe(true)
    // a live (link-modulated) mix overrides the stored one
    nodes = [...base, n(3, 'blend', { mode: 'normal', mix: 1 })]
    expect(liveNodes({ nodes, edges, mixOf: () => 0.4 }).live.has(1)).toBe(true)
    // a text layer on top is not opaque
    nodes = [n(1, 'effect'), n(2, 'text'), n(3, 'blend', { mode: 'normal' }), n(4, 'output')]
    expect(liveNodes({ nodes, edges }).live.has(1)).toBe(true)
  })

  it('keeps control sources that drive a live node', () => {
    const nodes = [n(1, 'effect'), n(2, 'output'), n(7, 'input')]
    const edges = [e(1, 2)]
    const links = [{ from: 7, node: 1, param: 'speed' }]
    expect(liveNodes({ nodes, edges, links }).live.has(7)).toBe(true)
    expect(liveNodes({ nodes, edges, links: [] }).live.has(7)).toBe(false)
  })

  it('tolerates cycles and a graph with no output', () => {
    const nodes = [n(1, 'filter'), n(2, 'filter'), n(3, 'output')]
    const edges = [e(1, 2), e(2, 1), e(2, 3)]
    expect(liveNodes({ nodes, edges }).live.size).toBe(3)
    expect(liveNodes({ nodes: [n(1, 'effect')], edges: [] }).live.size).toBe(0)
  })
})

describe('blendHidesBase', () => {
  it('is false for non-blend nodes', () => {
    expect(blendHidesBase(n(1, 'effect'), [], new Map())).toBe(false)
  })
})

describe('RateController', () => {
  const live = new Set([1, 2, 3])
  const dist = new Map([[1, 3], [2, 2], [3, 1]]) // 3 is next to the output
  const step = (rc, t, fps, extra = {}) => rc.update({ now: t, live, dist, measuredFps: fps, ...extra })

  it('starts everything at full rate', () => {
    const rc = new RateController()
    expect([...step(rc, 0, 60).values()]).toEqual([60, 60, 60])
  })

  it('under load, steps the least important node down first', () => {
    const rc = new RateController()
    step(rc, 0, 30)
    expect(rc.rates.get(1)).toBe(FPS_STEPS[1]) // farthest from output
    expect(rc.rates.get(2)).toBe(60)
    expect(rc.rates.get(3)).toBe(60)
    step(rc, 500, 30)
    expect(rc.rates.get(1)).toBe(FPS_STEPS[2]) // keeps dropping the same lowest-priority node
  })

  it('prefers to throttle the costlier node among equals', () => {
    const rc = new RateController()
    const d = new Map([[1, 2], [2, 2], [3, 2]])
    rc.update({ now: 0, live, dist: d, measuredFps: 30, costOf: (id) => (id === 2 ? 10 : 1) })
    expect(rc.rates.get(2)).toBe(FPS_STEPS[1])
  })

  it('protects selected nodes: never below 30 fps', () => {
    const rc = new RateController()
    const protect = new Set([1, 2, 3])
    for (let i = 0; i < 20; i++) step(rc, i * 500, 20, { protect })
    for (const id of live) expect(rc.rates.get(id)).toBeGreaterThanOrEqual(30)
  })

  it('never goes below the last tier', () => {
    const rc = new RateController()
    for (let i = 0; i < 50; i++) step(rc, i * 500, 10)
    for (const id of live) expect(rc.rates.get(id)).toBe(FPS_STEPS[FPS_STEPS.length - 1])
  })

  it('recovers one node at a time once the frame rate has been healthy for a while', () => {
    const rc = new RateController()
    for (let i = 0; i < 6; i++) step(rc, i * 500, 20) // drive them down
    const low = [...rc.rates.values()].reduce((a, b) => a + b, 0)
    for (let i = 6; i < 6 + 4; i++) step(rc, i * 500, 60) // calm, but not yet long enough
    const mid = [...rc.rates.values()].reduce((a, b) => a + b, 0)
    for (let i = 10; i < 40; i++) step(rc, i * 500, 60)
    const high = [...rc.rates.values()].reduce((a, b) => a + b, 0)
    expect(mid).toBeGreaterThanOrEqual(low)
    expect(high).toBeGreaterThan(low)
  })

  it('only reacts once per interval and forgets culled nodes', () => {
    const rc = new RateController()
    step(rc, 0, 20)
    step(rc, 100, 20) // too soon: no second step
    expect(rc.rates.get(1)).toBe(FPS_STEPS[1])
    rc.update({ now: 1000, live: new Set([2, 3]), dist, measuredFps: 60 })
    expect(rc.rates.has(1)).toBe(false)
  })

  it('does not throttle nodes the caller says are not throttleable', () => {
    const rc = new RateController()
    step(rc, 0, 20, { throttleable: (id) => id !== 1 })
    expect(rc.rates.get(1)).toBe(60)
    expect(rc.rates.get(2)).toBe(FPS_STEPS[1])
  })
})

describe('backgroundSlot', () => {
  it('gives each background node one turn in every `size` frames', () => {
    const hits = Array.from({ length: 12 }, (_, f) => [0, 1, 2].filter((i) => backgroundSlot(i, f, 6)))
    for (let i = 0; i < 3; i++) expect(hits.filter((h) => h.includes(i)).length).toBe(2)
    for (const h of hits) expect(h.length).toBeLessThanOrEqual(1)
  })
})
