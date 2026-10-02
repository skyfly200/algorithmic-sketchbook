import { describe, it, expect } from 'vitest'
import { planBake, seamWeight, loopFrame, bakeKey, bakeEligibility, BakeAdvisor, BakeBudget } from '../src/lib/patch/bake.js'

describe('planBake', () => {
  it('counts warmup, loop and seam frames', () => {
    const p = planBake({ fps: 30, seconds: 6, seamSeconds: 0.75, warmupSeconds: 1.5 })
    expect(p).toMatchObject({ fps: 30, frames: 180, seam: 23, warmup: 45, total: 248 })
    expect(p.stepMs).toBeCloseTo(33.33, 1)
  })
  it('keeps the seam within half the loop', () => {
    expect(planBake({ fps: 10, seconds: 1, seamSeconds: 5 }).seam).toBe(5)
  })
  it('allows no seam', () => expect(planBake({ seamSeconds: 0 }).seam).toBe(0))
})

describe('seamWeight', () => {
  it('rises from the continuation toward the loop start', () => {
    const K = 20
    const w = Array.from({ length: K }, (_, j) => seamWeight(j, K))
    for (let j = 1; j < K; j++) expect(w[j]).toBeGreaterThanOrEqual(w[j - 1])
    expect(w[0]).toBeLessThan(0.05)
    expect(w[K - 1]).toBeGreaterThan(0.95)
  })
  it('is 1 with no seam', () => expect(seamWeight(0, 0)).toBe(1))
})

describe('loopFrame', () => {
  it('wraps around the loop', () => {
    expect(loopFrame(0, 0, 30, 180)).toBe(0)
    expect(loopFrame(1000, 0, 30, 180)).toBe(30)
    expect(loopFrame(6000, 0, 30, 180)).toBe(0)
    expect(loopFrame(6034, 0, 30, 180)).toBe(1)
  })
  it('handles a clock before the start', () => expect(loopFrame(-34, 0, 30, 180)).toBe(178))
})

describe('bakeKey', () => {
  const base = { slug: 'plasma', seed: 'a', values: { a: 1, b: 2 }, state: null, mappingCount: 0, linkCount: 0, width: 384, height: 216 }
  it('ignores key order', () => expect(bakeKey(base)).toBe(bakeKey({ ...base, values: { b: 2, a: 1 } })))
  it('changes with anything that changes the picture', () => {
    const k = bakeKey(base)
    for (const change of [{ slug: 'x' }, { seed: 'b' }, { values: { a: 2, b: 2 } }, { state: { c: 1 } }, { mappingCount: 1 }, { linkCount: 1 }, { width: 640 }, { height: 360 }]) {
      expect(bakeKey({ ...base, ...change })).not.toBe(k)
    }
  })
})

describe('bakeEligibility', () => {
  const ok = { isEffect: true, hasSlug: true, modulated: false, micOn: false, ready: true }
  it('accepts a plain effect', () => expect(bakeEligibility(ok).ok).toBe(true))
  it('explains each refusal', () => {
    for (const bad of [{ isEffect: false }, { modulated: true }, { micOn: true }, { ready: false }]) {
      const r = bakeEligibility({ ...ok, ...bad })
      expect(r.ok).toBe(false)
      expect(r.reason.length).toBeGreaterThan(10)
    }
  })
})

describe('BakeAdvisor', () => {
  const feed = (a, id, n, fps = 20, want = 60) => { for (let i = 0; i < n; i++) a.report(id, fps, want) }
  it('picks a node that stays well below its rate once it has been stable', () => {
    const a = new BakeAdvisor()
    a.observeKey(1, 'k', 0)
    feed(a, 1, 3)
    expect(a.pick(1000, [1])).toBeNull() // not stable long enough
    expect(a.pick(3500, [1])).toBe(1)
  })
  it('ignores a node that keeps up or only dips once', () => {
    const a = new BakeAdvisor()
    a.observeKey(1, 'k', 0)
    feed(a, 1, 2); a.report(1, 59, 60); feed(a, 1, 2)
    expect(a.pick(9000, [1])).toBeNull()
  })
  it('compares against the rate the node was given', () => {
    const a = new BakeAdvisor()
    a.observeKey(1, 'k', 0)
    feed(a, 1, 5, 10, 10) // throttled to 10 fps and doing 10 fps: fine
    expect(a.pick(9000, [1])).toBeNull()
  })
  it('restarts when the node changes', () => {
    const a = new BakeAdvisor()
    a.observeKey(1, 'k', 0)
    feed(a, 1, 4)
    a.observeKey(1, 'k2', 5000)
    expect(a.pick(5100, [1])).toBeNull()
  })
  it('leaves a node alone after the user sent it back, until it changes', () => {
    const a = new BakeAdvisor()
    a.observeKey(1, 'k', 0)
    feed(a, 1, 4)
    a.block(1)
    expect(a.pick(9000, [1])).toBeNull()
    a.observeKey(1, 'k2', 9000)
    feed(a, 1, 4)
    expect(a.pick(13000, [1])).toBe(1)
  })
  it('only considers the candidates it is given, slowest first', () => {
    const a = new BakeAdvisor()
    for (const id of [1, 2]) a.observeKey(id, 'k', 0)
    feed(a, 1, 4, 30); feed(a, 2, 4, 10)
    expect(a.pick(9000, [1, 2])).toBe(2)
    expect(a.pick(9000, [1])).toBe(1)
  })
})

describe('BakeBudget', () => {
  it('evicts the least recently used', () => {
    const b = new BakeBudget(100)
    expect(b.add(1, 40, 0)).toEqual([])
    expect(b.add(2, 40, 10)).toEqual([])
    b.touch(1, 20)
    expect(b.add(3, 40, 30)).toEqual([2])
    expect(b.total).toBe(80)
  })
  it('never evicts the recording just added', () => {
    const b = new BakeBudget(10)
    expect(b.add(1, 50, 0)).toEqual([])
    expect(b.total).toBe(50)
  })
})
