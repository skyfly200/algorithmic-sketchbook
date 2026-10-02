import { describe, it, expect } from 'vitest'
import { StaticTracker, hashPixels } from '../src/lib/patch/idle.js'

// Drive a tracker the way the compositor does: tick, sample when asked, observe.
function run(tr, id, from, to, hashAt, step = 16) {
  for (let t = from; t <= to; t += step) {
    tr.tick(id, t)
    if (tr.wantSample(id, t)) tr.observe(id, hashAt(t), t)
  }
}

describe('hashPixels', () => {
  it('is stable and ignores the lowest bits', () => {
    const a = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    const b = new Uint8ClampedArray([11, 21, 31, 255, 41, 51, 61, 255])
    expect(hashPixels(a)).toBe(hashPixels(a))
    expect(hashPixels(a)).toBe(hashPixels(b))
    expect(hashPixels(a)).not.toBe(hashPixels(new Uint8ClampedArray([100, 20, 30, 255, 40, 50, 60, 255])))
  })
})

describe('StaticTracker', () => {
  it('freezes a node whose picture stops changing', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 3000, () => 7)
    expect(tr.isFrozen(1)).toBe(true)
  })

  it('never freezes a node that keeps changing', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 6000, (t) => Math.floor(t / 250))
    expect(tr.isFrozen(1)).toBe(false)
  })

  it('needs the picture to stay identical for the whole freeze window', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 700, () => 7)
    expect(tr.isFrozen(1)).toBe(false)
    run(tr, 1, 716, 1200, () => 8) // it moved: the clock restarts
    expect(tr.isFrozen(1)).toBe(false)
  })

  it('probes a frozen node and thaws it when it moved', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 3000, () => 7)
    expect(tr.isFrozen(1)).toBe(true)
    let probed = false
    let thawed = false
    for (let t = 3000; t <= 6000 && !thawed; t += 16) {
      tr.tick(1, t)
      if (tr.phase(1) === 'probing') probed = true
      if (tr.wantSample(1, t)) {
        tr.observe(1, 99, t) // the picture changed while it was asleep
        thawed = tr.phase(1) === 'live'
      }
    }
    expect(probed).toBe(true)
    expect(thawed).toBe(true)
    expect(tr.isFrozen(1)).toBe(false)
  })

  it('goes back to frozen when a probe finds nothing new', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 6000, () => 7)
    expect(tr.isFrozen(1) || tr.phase(1) === 'probing').toBe(true)
    expect(tr.frozenIds().length + (tr.phase(1) === 'probing' ? 1 : 0)).toBe(1)
  })

  it('wake() restarts a frozen node as live', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 3000, () => 7)
    tr.wake(1, 3000)
    expect(tr.isFrozen(1)).toBe(false)
    expect(tr.phase(1)).toBe('live')
    run(tr, 1, 3016, 3500, () => 7)
    expect(tr.isFrozen(1)).toBe(false) // has to earn the freeze again
  })

  it('wakeAll() and forget()', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 3000, () => 7)
    run(tr, 2, 0, 3000, () => 7)
    expect(tr.frozenIds().sort()).toEqual([1, 2])
    tr.wakeAll(3000)
    expect(tr.frozenIds()).toEqual([])
    tr.forget(1)
    expect(tr.phase(1)).toBe('live')
  })

  it('does not ask for samples while frozen', () => {
    const tr = new StaticTracker()
    run(tr, 1, 0, 3000, () => 7)
    expect(tr.wantSample(1, 3050)).toBe(false)
  })
})
