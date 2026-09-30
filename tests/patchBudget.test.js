// The Patch cost model (src/lib/patch/budget.js) + capability heuristics + the
// O(V+E) topo order. Pure functions — no clocks, no DOM — so these assert the
// model's *shape* (linear in pixels, additive per node, decks multiply) rather
// than any one machine's speed.
import { describe, it, expect } from 'vitest'
import { deckCost, classifyTier, maxFrames, planDecks, TIERS, REF_PIXELS, IFRAME_BASE_MB } from '../src/lib/patch/budget.js'
import { classifyGpu, probeCapability } from '../src/lib/patch/capability.js'
import { evalOrder, makeOrderCache } from '../src/lib/patch/graph.js'

const fx = (id, slug = 'a', type = 'effect') => ({ id, type, params: { slug } })
const out = (id) => ({ id, type: 'output', params: {} })
const info = (w) => () => ({ weight: w, three: false })

describe('deckCost', () => {
  it('gpu work scales linearly with pixels', () => {
    const g = [fx(1), fx(2), out(3)]
    const a = deckCost(g, { pixels: REF_PIXELS, info: info(4) }).gpu
    const b = deckCost(g, { pixels: REF_PIXELS * 4, info: info(4) }).gpu
    expect(b).toBeCloseTo(a * 4, 1)
  })
  it('is additive per node and counts one iframe per effect/filter', () => {
    const one = deckCost([fx(1), out(2)], { info: info(4) })
    const two = deckCost([fx(1), fx(2), out(3)], { info: info(4) })
    expect(two.fx).toBe(2)
    expect(two.gpu - one.gpu).toBeCloseTo(4, 1)
    expect(two.ram).toBeGreaterThan(one.ram + IFRAME_BASE_MB - 1)
  })
  it('filters cost more than generators, three.js sketches more RAM', () => {
    const gen = deckCost([fx(1)], { info: info(4) })
    const fil = deckCost([fx(1, 'a', 'filter')], { info: info(4) })
    expect(fil.gpu).toBeGreaterThan(gen.gpu)
    const t3 = deckCost([fx(1)], { info: () => ({ weight: 4, three: true }) })
    expect(t3.ram).toBeGreaterThan(gen.ram)
  })
})

describe('tiers', () => {
  it('the weakest signal decides', () => {
    expect(classifyTier({ gpu: 'discrete', cores: 16, memGB: 16 })).toBe('recommended')
    expect(classifyTier({ gpu: 'discrete', cores: 16, memGB: 2 })).toBe('minimum')
    expect(classifyTier({ gpu: 'software', cores: 16, memGB: 16 })).toBe('minimum')
    expect(classifyTier({ gpu: 'integrated', cores: 4, memGB: 8 })).toBe('baseline')
  })
  it('limits are monotonic', () => {
    const { minimum: a, baseline: b, recommended: c } = TIERS
    expect(a.capacity).toBeLessThan(b.capacity); expect(b.capacity).toBeLessThan(c.capacity)
    expect(a.maxPixels).toBeLessThan(c.maxPixels)
  })
  it('frame count is memory-bound and shrinks with resolution', () => {
    expect(maxFrames(8, REF_PIXELS)).toBeGreaterThan(maxFrames(4, REF_PIXELS))
    expect(maxFrames(8, 1920 * 1080)).toBeLessThan(maxFrames(8, REF_PIXELS))
  })
})

describe('planDecks', () => {
  const small = deckCost([fx(1), out(2)], { info: info(3) })
  it('runs both decks live when 2× the on-air cost fits', () => {
    const p = planDecks('recommended', { on: small, off: small }, { cap: { memGB: 16 } })
    expect(p.liveFade).toBe(true)
    expect(p.offAirMode).toBe('cued')
  })
  it('falls back to a paused off-air deck on a minimum machine', () => {
    const p = planDecks('minimum', { on: small, off: small }, { cap: { memGB: 4 } })
    expect(p.liveFade).toBe(false)
    expect(p.offAirMode).toBe('paused')
    expect(p.warnings.join(' ')).toMatch(/two decks/i)
  })
  it('warns when the on-air deck alone is over budget', () => {
    const heavy = deckCost(Array.from({ length: 12 }, (_, i) => fx(i + 1)), { info: info(12) })
    const p = planDecks('baseline', { on: heavy, off: small }, { cap: { memGB: 8 } })
    expect(p.warnings.join(' ')).toMatch(/over this machine/)
    expect(p.load).toBeGreaterThan(1)
  })
})

describe('capability probe', () => {
  it('classifies GPU renderer strings', () => {
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)')).toBe('software')
    expect(classifyGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software')
    expect(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)')).toBe('discrete')
    expect(classifyGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)')).toBe('discrete')
    expect(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620)')).toBe('integrated')
    expect(classifyGpu('')).toBe('integrated')
  })
  it('falls back to safe defaults when the browser hides signals', () => {
    expect(probeCapability({ nav: {}, renderer: '' })).toMatchObject({ gpu: 'integrated', cores: 4, memGB: 4 })
  })
})

describe('evalOrder is O(V+E) and memoised', () => {
  const chain = (n) => ({
    nodes: Array.from({ length: n }, (_, i) => ({ id: i + 1, type: 'effect', params: {} })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: i + 1, to: i + 2 })),
  })
  it('orders a long chain (and handles 20k nodes without quadratic blow-up)', () => {
    const { nodes, edges } = chain(20000)
    const t0 = Date.now()
    const order = evalOrder(nodes, edges)
    expect(order.map((n) => n.id).slice(0, 3)).toEqual([1, 2, 3])
    expect(order).toHaveLength(20000)
    expect(Date.now() - t0).toBeLessThan(1500) // a quadratic sort would be orders of magnitude slower
  })
  it('the cache re-sorts only when wiring changes', () => {
    const { nodes, edges } = chain(5)
    const order = makeOrderCache()
    expect(order(nodes, edges).map((n) => n.id)).toEqual([1, 2, 3, 4, 5])
    nodes[0].x = 999 // position/param edits don't change order
    expect(order(nodes, edges).map((n) => n.id)).toEqual([1, 2, 3, 4, 5])
    edges.reverse(); edges.push({ from: 5, to: 1 }) // a cycle: still terminates, leftovers appended
    expect(order(nodes, edges)).toHaveLength(5)
  })
})
