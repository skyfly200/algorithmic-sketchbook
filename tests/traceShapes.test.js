// Tests for the photo → polygon shape tracer (src/lib/patch/traceShapes.js):
// the Otsu split, foreground/background polarity, connected-component labelling,
// Moore boundary trace and RDP simplification that turn a picture into a few
// draggable matte polygons.
import { describe, it, expect } from 'vitest'
import { toGray, otsu, foregroundMask, components, rdp, extractShapes } from '../src/lib/patch/traceShapes.js'

// Build an ImageData-like { data, width, height }. paint(x,y) → 0..255 luma.
function img(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y), p = (y * width + x) * 4
      data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255
    }
  }
  return { data, width, height }
}
// filled axis-aligned rectangle test: is (x,y) inside [x0,x1)×[y0,y1)?
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1

describe('toGray / otsu', () => {
  it('reduces RGBA to one luma byte per pixel', () => {
    const g = toGray(img(2, 1, () => 128))
    expect(g.length).toBe(2)
    expect(g[0]).toBe(128)
  })
  it('picks a threshold between two well-separated classes', () => {
    const g = toGray(img(40, 40, (x) => (x < 20 ? 20 : 220)))
    const t = otsu(g)
    // sits at/above the low cluster and below the high one, so `> thr` splits them
    expect(t).toBeGreaterThanOrEqual(20)
    expect(t).toBeLessThan(220)
  })
})

describe('foregroundMask polarity', () => {
  it('treats the bright border as background (dark subject on light field)', () => {
    const im = img(30, 30, (x, y) => (inRect(x, y, 10, 10, 20, 20) ? 20 : 230))
    const g = toGray(im)
    const fg = foregroundMask(g, 30, 30, otsu(g))
    expect(fg[15 * 30 + 15]).toBe(1) // centre of the dark square is foreground
    expect(fg[0]).toBe(0)            // the light border is background
  })
  it('inverts when the subject is light on a dark field', () => {
    const im = img(30, 30, (x, y) => (inRect(x, y, 10, 10, 20, 20) ? 230 : 20))
    const g = toGray(im)
    const fg = foregroundMask(g, 30, 30, otsu(g))
    expect(fg[15 * 30 + 15]).toBe(1)
    expect(fg[0]).toBe(0)
  })
})

describe('components', () => {
  it('labels two separated blobs as two components', () => {
    const im = img(40, 20, (x, y) => (inRect(x, y, 2, 2, 8, 8) || inRect(x, y, 30, 10, 36, 16) ? 240 : 10))
    const g = toGray(im)
    const fg = foregroundMask(g, 40, 20, otsu(g))
    const comps = components(fg, 40, 20)
    expect(comps.length).toBe(2)
    expect(comps.every((c) => c.area >= 30)).toBe(true)
  })
})

describe('rdp', () => {
  it('reduces a straight, densely sampled line to its endpoints', () => {
    const line = Array.from({ length: 20 }, (_, i) => [i, 0])
    expect(rdp(line, 0.5)).toEqual([[0, 0], [19, 0]])
  })
  it('keeps a corner that sticks out beyond epsilon', () => {
    const bent = [[0, 0], [5, 5], [10, 0]]
    expect(rdp(bent, 1)).toEqual([[0, 0], [5, 5], [10, 0]])
  })
})

describe('extractShapes', () => {
  it('turns a filled square into one ~4-corner polygon in 0..1 coords', () => {
    const im = img(100, 100, (x, y) => (inRect(x, y, 25, 25, 75, 75) ? 240 : 10))
    const shapes = extractShapes(im)
    expect(shapes.length).toBe(1)
    const p = shapes[0].points
    expect(p.length).toBeGreaterThanOrEqual(3)
    expect(p.length).toBeLessThanOrEqual(6)
    for (const [x, y] of p) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1)
    }
    // roughly a quarter of the frame (0.5 × 0.5)
    expect(shapes[0].area).toBeGreaterThan(0.2)
    expect(shapes[0].area).toBeLessThan(0.3)
  })

  it('returns two shapes for two blobs, largest first', () => {
    const im = img(120, 80, (x, y) =>
      (inRect(x, y, 10, 10, 50, 60) || inRect(x, y, 80, 30, 100, 55) ? 240 : 10))
    const shapes = extractShapes(im)
    expect(shapes.length).toBe(2)
    expect(shapes[0].area).toBeGreaterThanOrEqual(shapes[1].area)
  })

  it('ignores tiny specks below the min-area floor', () => {
    const im = img(100, 100, (x, y) =>
      (inRect(x, y, 20, 20, 70, 70) || inRect(x, y, 90, 90, 92, 92) ? 240 : 10))
    const shapes = extractShapes(im, { minAreaFrac: 0.01 })
    expect(shapes.length).toBe(1)
  })

  it('returns nothing for a blank frame', () => {
    expect(extractShapes(img(40, 40, () => 128))).toEqual([])
  })
})
