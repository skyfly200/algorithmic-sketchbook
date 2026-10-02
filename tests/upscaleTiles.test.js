import { describe, it, expect } from 'vitest'
import { planAxis, planTiles, checkOutput, estimateRemaining } from '../src/lib/upscale/tiles.js'

// The keep ranges must tile [0, n) exactly, each inside its own tile.
function expectCovers(axis, n) {
  let at = 0
  for (const t of axis) {
    expect(t.keepFrom).toBe(at)
    expect(t.keepTo).toBeGreaterThan(t.keepFrom)
    expect(t.keepFrom).toBeGreaterThanOrEqual(t.start)
    expect(t.keepTo).toBeLessThanOrEqual(t.start + t.size)
    at = t.keepTo
  }
  expect(at).toBe(n)
}

describe('planAxis', () => {
  it('is empty for a zero length', () => expect(planAxis(0, 64, 8)).toEqual([]))
  it('uses one padded tile for a short axis', () => {
    expect(planAxis(50, 64, 8)).toEqual([{ start: 0, size: 56, keepFrom: 0, keepTo: 50 }])
    expect(planAxis(64, 64, 8)).toEqual([{ start: 0, size: 64, keepFrom: 0, keepTo: 64 }])
    expect(planAxis(3, 64, 8)).toEqual([{ start: 0, size: 8, keepFrom: 0, keepTo: 3 }])
  })
  it('covers lengths that are and are not tile multiples', () => {
    for (const n of [65, 80, 100, 128, 129, 200, 257, 1000, 1921]) {
      const axis = planAxis(n, 64, 8)
      expectCovers(axis, n)
      for (const t of axis) { expect(t.size).toBe(64); expect(t.start).toBeGreaterThanOrEqual(0); expect(t.start + t.size).toBeLessThanOrEqual(n) }
    }
  })
  it('gives every interior edge at least the overlap of context', () => {
    const axis = planAxis(500, 64, 8)
    axis.forEach((t, i) => {
      if (i > 0) expect(t.keepFrom - t.start).toBeGreaterThanOrEqual(8)
      if (i < axis.length - 1) expect(t.start + t.size - t.keepTo).toBeGreaterThanOrEqual(8)
    })
  })
  it('rejects an overlap that leaves no step', () => expect(() => planAxis(500, 16, 8)).toThrow())
})

describe('planTiles', () => {
  it('plans a grid whose keep rects partition the image', () => {
    const w = 150, h = 90
    const tiles = planTiles(w, h, { tile: 64, overlap: 8 })
    const hit = new Uint8Array(w * h)
    for (const t of tiles) for (let y = t.keep.y; y < t.keep.y + t.keep.h; y++) for (let x = t.keep.x; x < t.keep.x + t.keep.w; x++) hit[y * w + x]++
    expect(hit.every((v) => v === 1)).toBe(true)
  })
  it('is a single tile for a small image', () => expect(planTiles(40, 40)).toHaveLength(1))
})

describe('checkOutput', () => {
  it('allows a normal upscale', () => expect(checkOutput(1000, 800, 2)).toMatchObject({ ok: true, width: 2000, height: 1600 }))
  it('refuses past the limit and says why', () => {
    const r = checkOutput(1200, 900, 4)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/4800/)
  })
})

describe('estimateRemaining', () => {
  it('needs a finished tile first', () => expect(estimateRemaining(0, 10, 0)).toBeNull())
  it('extrapolates', () => expect(estimateRemaining(2, 10, 4000)).toBe(16000))
})
