// Tests for the colour-theory maths behind the palette system: conversions must
// round-trip, harmonies must return the right count of valid hex colours, and
// gradient helpers must emit sane CSS.
import { describe, it, expect } from 'vitest'
import {
  clamp, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, hexToHsl, hslToHex,
  HARMONIES, harmony, gradientStops, gradientCss,
} from '../src/lib/colorTheory.js'

const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s)

describe('colorTheory: conversions', () => {
  it('clamps to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
  it('hexToRgb parses long and short hex', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0])
    expect(hexToRgb('#f80')).toEqual([255, 136, 0])
    expect(hexToRgb('008000')).toEqual([0, 128, 0])
  })
  it('rgbToHex clamps and pads', () => {
    expect(rgbToHex(255, 136, 0)).toBe('#ff8800')
    expect(rgbToHex(-5, 300, 0)).toBe('#00ff00')
    expect(rgbToHex(0, 0, 5)).toBe('#000005')
  })
  it('rgb↔hex round-trips for a spread of colours', () => {
    for (const hex of ['#000000', '#ffffff', '#123456', '#abcdef', '#7f7f7f']) {
      const [r, g, b] = hexToRgb(hex)
      expect(rgbToHex(r, g, b)).toBe(hex)
    }
  })
  it('primary hues map to the expected wheel angles', () => {
    expect(rgbToHsl(255, 0, 0)[0]).toBeCloseTo(0, 1)
    expect(rgbToHsl(0, 255, 0)[0]).toBeCloseTo(120, 1)
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240, 1)
    // greys have zero saturation
    expect(rgbToHsl(128, 128, 128)[1]).toBeCloseTo(0, 6)
  })
  it('hex→hsl→hex round-trips closely', () => {
    for (const hex of ['#3366cc', '#e91e63', '#00bcd4', '#8bc34a']) {
      const [h, s, l] = hexToHsl(hex)
      const back = hslToHex(h, s, l)
      // allow ±1 per channel for the double rounding
      const a = hexToRgb(hex), b = hexToRgb(back)
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i]), `${hex} ch${i}`).toBeLessThanOrEqual(1)
    }
  })
  it('hslToRgb handles hue wrap-around', () => {
    expect(hslToRgb(360, 100, 50)).toEqual(hslToRgb(0, 100, 50))
    expect(hslToRgb(-120, 100, 50)).toEqual(hslToRgb(240, 100, 50))
  })
})

describe('colorTheory: harmonies', () => {
  it('each named harmony returns valid hex colours including the base hue', () => {
    for (const type of HARMONIES) {
      const set = harmony('#3366cc', type)
      expect(set.length, type).toBeGreaterThanOrEqual(3)
      for (const c of set) expect(isHex(c), `${type} → ${c}`).toBe(true)
    }
  })
  it('complementary puts its second colour ~180° opposite', () => {
    const [base, comp] = harmony('#ff0000', 'Complementary')
    const dh = Math.abs(hexToHsl(base)[0] - hexToHsl(comp)[0])
    expect(Math.min(dh, 360 - dh)).toBeCloseTo(180, 0)
  })
  it('monochromatic keeps one hue and varies lightness', () => {
    const set = harmony('#3366cc', 'Monochromatic')
    const hues = set.map((c) => hexToHsl(c)[0])
    for (const h of hues) expect(Math.abs(h - hues[0])).toBeLessThan(2)
    const ls = set.map((c) => hexToHsl(c)[2])
    expect(Math.max(...ls)).toBeGreaterThan(Math.min(...ls))
  })
  it('an unknown harmony falls back to just the base', () => {
    expect(harmony('#123456', 'Nope')).toHaveLength(1)
  })
})

describe('colorTheory: gradients', () => {
  it('gradientStops spaces colours evenly from 0..1', () => {
    expect(gradientStops(['#000', '#fff'])).toEqual([
      { pos: 0, color: '#000' }, { pos: 1, color: '#fff' },
    ])
    expect(gradientStops(['#a']).map((s) => s.pos)).toEqual([0])
    const three = gradientStops(['#a', '#b', '#c']).map((s) => s.pos)
    expect(three[1]).toBeCloseTo(0.5, 6)
  })
  it('gradientCss sorts by position and formats percentages', () => {
    const css = gradientCss([{ pos: 1, color: 'red' }, { pos: 0, color: 'blue' }], 45)
    expect(css).toBe('linear-gradient(45deg, blue 0%, red 100%)')
  })
})
