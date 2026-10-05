import { describe, it, expect } from 'vitest'
import { shapeSource, applyMapping } from '../sketches/_lib/mapping.js'

const unit = { min: 0, max: 1 }

describe('applyMapping (additive)', () => {
  it('adds source × amount × range to the base', () => {
    expect(applyMapping(0.2, 0.5, { amount: 0.5 }, unit)).toBeCloseTo(0.45)
    expect(applyMapping(1, 1, { amount: 0.5 }, { min: -1, max: 3 })).toBeCloseTo(3)
  })

  it('treats source 0 as no change', () => {
    expect(applyMapping(0.3, 0, { amount: 1 }, unit)).toBe(0.3)
  })

  it('clamps — a mid base driven by a 0..1 pointer loses its lower half', () => {
    // The case centred mappings exist for: the whole left half maps to the base.
    const m = { amount: 1 }
    expect(applyMapping(0.5, 0, m, unit)).toBe(0.5)
    expect(applyMapping(0.5, 0.25, m, unit)).toBe(0.75)
    expect(applyMapping(0.5, 1, m, unit)).toBe(1)
  })
})

describe('applyMapping (centred)', () => {
  const m = { amount: 1, center: true }

  it('makes the source midpoint no change', () => {
    expect(applyMapping(0.5, 0.5, m, unit)).toBe(0.5)
    expect(applyMapping(0.2, 0.5, { amount: 0.7, center: true }, { min: -4, max: 4 })).toBeCloseTo(0.2)
  })

  it('swings a mid base across the full range, both ways', () => {
    expect(applyMapping(0.5, 0, m, unit)).toBe(0)
    expect(applyMapping(0.5, 0.25, m, unit)).toBeCloseTo(0.25)
    expect(applyMapping(0.5, 0.75, m, unit)).toBeCloseTo(0.75)
    expect(applyMapping(0.5, 1, m, unit)).toBe(1)
  })

  it('scales by amount and the param range, and a negative amount inverts', () => {
    expect(applyMapping(1, 1, { amount: 0.5, center: true }, { min: -1, max: 3 })).toBeCloseTo(2)
    expect(applyMapping(0.5, 1, { amount: -1, center: true }, unit)).toBe(0)
  })

  it('still clamps to the param range', () => {
    expect(applyMapping(0.9, 1, m, unit)).toBe(1)
    expect(applyMapping(0.1, 0, m, unit)).toBe(0)
  })
})

describe('shapeSource', () => {
  it('passes the value through with no shaping', () => {
    expect(shapeSource(0.37, {})).toBe(0.37)
  })

  it('gates out the floor and rescales above it', () => {
    expect(shapeSource(0.1, { gate: 0.2 })).toBe(0)
    expect(shapeSource(0.6, { gate: 0.2 })).toBeCloseTo(0.5)
    expect(shapeSource(1, { gate: 0.2 })).toBeCloseTo(1)
  })

  it('curve > 0 boosts quiet input, curve < 0 suppresses it, ends fixed', () => {
    expect(shapeSource(0.25, { curve: 1 })).toBeGreaterThan(0.25)
    expect(shapeSource(0.25, { curve: -1 })).toBeLessThan(0.25)
    expect(shapeSource(0, { curve: 1 })).toBe(0)
    expect(shapeSource(1, { curve: -1 })).toBe(1)
  })
})
