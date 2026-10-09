import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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

// Every pointer / tilt source rests at 0.5 (screen centre, a level device), so an
// additive mapping from one can only push its param one way and moves it off its
// base when the input is idle. Each sketch's default pointer / tilt mappings must
// be centred, onto a param whose base leaves room to swing both ways.
describe('sketch default mappings', () => {
  const sketches = readdirSync('sketches')
    .filter((s) => !s.startsWith('_') && existsSync(`sketches/${s}/sketch.js`))
    .map((slug) => ({ slug, src: readFileSync(`sketches/${slug}/sketch.js`, 'utf8') }))
  const pointerMappings = sketches.flatMap(({ slug, src }) =>
    [...src.matchAll(/rt\.mapInput\(\s*'((?:mouse|tilt)\.[xy])',\s*'(\w+)',([^)]*)\)/g)].map(
      ([, source, param, rest]) => ({ slug, src, source, param, rest }),
    ),
  )

  it('finds the pointer and tilt mappings', () => {
    expect(pointerMappings.length).toBeGreaterThanOrEqual(12)
  })

  it.each(pointerMappings.map((m) => [`${m.slug}: ${m.source} -> ${m.param}`, m]))(
    '%s is centred on a mid-range base',
    (_, { src, param, rest }) => {
      expect(rest).toMatch(/center:\s*true/)
      const decl = src.match(new RegExp(`\\b${param}:\\s*\\{([^}]*)\\}`))
      expect(decl, `param ${param} declared`).toBeTruthy()
      const num = (k) => Number(decl[1].match(new RegExp(`\\b${k}:\\s*(-?[\\d.]+)`))?.[1])
      const [min, max] = [num('min'), num('max')]
      const value = num('value') // NaN when the base is randomised
      expect(max).toBeGreaterThan(min)
      if (!Number.isNaN(value)) {
        expect(value).toBeGreaterThan(min)
        expect(value).toBeLessThan(max)
      }
    },
  )
})

describe('sketch default mappings: amounts and timing', () => {
  const sketches = readdirSync('sketches')
    .filter((s) => !s.startsWith('_') && existsSync(`sketches/${s}/sketch.js`))
    .map((slug) => ({ slug, src: readFileSync(`sketches/${slug}/sketch.js`, 'utf8') }))
  const mappings = sketches.flatMap(({ slug, src }) =>
    [...src.matchAll(/rt\.mapInput\(\s*'([\w.]+)',\s*'(\w+)',\s*(-?[\d.]+)/g)].map(
      ([, source, param, amount]) => ({ slug, src, source, param, amount: Number(amount) }),
    ),
  )
  // impulses (a beat, an onset, a shake) may deliberately kick a param to its end
  const impulse = /^(audio\.pulse|beat\.pulse|audio\.flux|shake|touch\.down|midi\.note)$/

  it('finds the default mappings', () => {
    expect(mappings.length).toBeGreaterThan(100)
  })

  // amount is a fraction of the param's range (-1..1), not a value in its units:
  // color-filter's 'hue' at 60 and polarization's 'analyzer' at 90 meant degrees
  // and pinned the param at its max on the faintest signal
  it.each(mappings.filter((m) => !impulse.test(m.source)).map((m) => [`${m.slug}: ${m.source} -> ${m.param} (${m.amount})`, m]))(
    '%s has an amount within -1..1',
    (_, { amount }) => {
      expect(Math.abs(amount)).toBeLessThanOrEqual(1)
    },
  )

  // t × param jumps the phase by t × Δparam whenever a mapped param moves (many
  // cycles after a few minutes); integrate with rt.phase(key, rate) instead
  it.each(mappings.map((m) => [`${m.slug}: ${m.param}`, m]))(
    '%s is not used as a rate multiplied by the clock',
    (_, { src, param }) => {
      const clock = String.raw`\b(?:t|time|u_time)\b`
      const p = String.raw`\bparams\.${param}\b`
      expect(src).not.toMatch(new RegExp(`${clock}\\s*\\*[^;,)\\n]{0,24}${p}`))
      expect(src).not.toMatch(new RegExp(`${p}[^;,(\\n]{0,24}\\*\\s*${clock}`))
      expect(src).not.toMatch(new RegExp(`\\bu_time\\s*\\*[^;,)\\n]{0,12}\\bu_${param}\\b`))
    },
  )
})
