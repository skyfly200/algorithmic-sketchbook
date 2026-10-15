import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFrameRing } from '../sketches/_lib/framering.js'

// Minimal canvas stand-in: a frame is tagged with the label of the last thing drawn into it.
function fakeCanvas() {
  const c = { width: 0, height: 0, tag: null }
  c.getContext = () => ({
    clearRect() { c.tag = null },
    drawImage(src) { c.tag = src.tag ?? src },
  })
  return c
}
let created = 0
beforeEach(() => {
  created = 0
  globalThis.document = { createElement: () => { created++; return fakeCanvas() } }
})
afterEach(() => { delete globalThis.document })

const push = (ring, label) => ring.push((x) => x.drawImage(label))

describe('createFrameRing', () => {
  it('returns the frame d pushes ago, blank before it was written', () => {
    const ring = createFrameRing()
    ring.resize(64, 36)
    ring.need(3)
    expect(ring.get(3).tag).toBe(null)
    for (const f of ['a', 'b', 'c', 'd']) push(ring, f)
    expect(ring.get(1).tag).toBe('d')
    expect(ring.get(3).tag).toBe('b')
  })

  it('holds only as many frames as the delay needs, keeping history when it grows', () => {
    const ring = createFrameRing()
    ring.resize(64, 36)
    ring.need(2)
    expect(ring.length).toBe(2)
    for (const f of ['a', 'b', 'c']) push(ring, f)
    ring.need(5)
    expect(ring.length).toBe(5)
    expect(ring.get(1).tag).toBe('c')
    expect(ring.get(2).tag).toBe('b')
    expect(ring.get(5).tag).toBe(null)
    push(ring, 'd')
    expect(ring.get(3).tag).toBe('b')
  })

  it('shrinks only after the lower need has lasted, keeping the newest frames', () => {
    const ring = createFrameRing({ shrinkAfter: 3 })
    ring.resize(64, 36)
    ring.need(6)
    for (const f of ['a', 'b', 'c', 'd']) push(ring, f)
    ring.need(2); ring.need(2)
    expect(ring.length).toBe(6)
    ring.need(2)
    expect(ring.length).toBe(2)
    expect(ring.get(1).tag).toBe('d')
    expect(ring.get(2).tag).toBe('c')
  })

  it('stores frames smaller when they would pass the memory cap', () => {
    const ring = createFrameRing({ maxBytes: 4 * 100 * 100 * 4 })
    ring.resize(200, 100)
    ring.need(2)
    expect([ring.width, ring.height]).toEqual([200, 100])
    ring.need(8) // 8 x 200 x 100 x 4 = 4x the cap → half size each way
    expect([ring.width, ring.height]).toEqual([100, 50])
    expect(ring.length * ring.width * ring.height * 4).toBeLessThanOrEqual(4 * 100 * 100 * 4)
  })

  it('clamps a delay longer than the history to the oldest frame', () => {
    const ring = createFrameRing()
    ring.resize(8, 8)
    ring.need(2)
    push(ring, 'a'); push(ring, 'b'); push(ring, 'c')
    expect(ring.get(9).tag).toBe('b')
  })
})
