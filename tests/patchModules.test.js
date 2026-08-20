// Unit tests for the pure logic extracted out of PatchView into src/lib/patch/*.
// These run in the plain Node env (no THREE, no canvas, no DOM) so we only touch
// the framework-free exports: shape/point generation, colour maths, the camera
// rebuild signature, the wireframe skeletons and the node catalogue tables.
import { describe, it, expect } from 'vitest'
import { regPoly, starPoly, heartPoly, svgElToPath, POLY_SHAPES, PORTAL_SHAPES } from '../src/lib/patch/shapes.js'
import { hsvToHsl, hsvCss, geoSig, geoWire } from '../src/lib/patch/geometry.js'
import { TYPES, BLENDS, MIX_BLENDS, RESOLUTIONS, PARAM_RANGES, GEO_SHAPES } from '../src/lib/patch/constants.js'

describe('shapes: polygon generators', () => {
  it('regPoly returns n points inside the unit box, first pointing up', () => {
    const tri = regPoly(3)
    expect(tri).toHaveLength(3)
    // first vertex is straight up from centre (0.5, 0.5 - r)
    expect(tri[0][0]).toBeCloseTo(0.5, 3)
    expect(tri[0][1]).toBeLessThan(0.5)
    for (const [x, y] of tri) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1) }
  })
  it('starPoly alternates outer/inner radii and has 2×points vertices', () => {
    const star = starPoly(5)
    expect(star).toHaveLength(10)
    const cd = ([x, y]) => Math.hypot(x - 0.5, y - 0.5)
    expect(cd(star[0])).toBeGreaterThan(cd(star[1])) // outer then inner
  })
  it('heartPoly is a closed-ish ring of 40 normalized points', () => {
    const h = heartPoly()
    expect(h).toHaveLength(40)
    for (const [x, y] of h) { expect(x).toBeGreaterThan(-0.01); expect(x).toBeLessThan(1.01); expect(y).toBeGreaterThan(-0.01); expect(y).toBeLessThan(1.01) }
  })
  it('POLY_SHAPES presets are all non-empty point lists', () => {
    for (const [name, pts] of Object.entries(POLY_SHAPES)) {
      expect(Array.isArray(pts), name).toBe(true)
      expect(pts.length, name).toBeGreaterThanOrEqual(3)
      expect(pts[0], name).toHaveLength(2)
    }
  })
})

describe('shapes: svgElToPath', () => {
  // A tiny stand-in for an SVG DOM element (works without jsdom).
  const el = (tag, attrs) => ({ tagName: tag, getAttribute: (k) => (k in attrs ? String(attrs[k]) : null) })
  it('passes a <path> d straight through', () => {
    expect(svgElToPath(el('path', { d: 'M0 0L1 1Z' }))).toBe('M0 0L1 1Z')
  })
  it('turns a <rect> into a closed path', () => {
    const d = svgElToPath(el('rect', { x: 2, y: 3, width: 4, height: 5 }))
    expect(d).toBe('M2 3h4v5h-4Z')
  })
  it('turns a <polygon> into an M/L path that closes', () => {
    const d = svgElToPath(el('polygon', { points: '0,0 10,0 10,10' }))
    expect(d).toBe('M0 0L10 0L10 10Z')
    // a polyline is the same but open
    expect(svgElToPath(el('polyline', { points: '0,0 10,0 10,10' }))).toBe('M0 0L10 0L10 10')
  })
  it('ignores degenerate shapes and unknown tags', () => {
    expect(svgElToPath(el('rect', { x: 0, y: 0, width: 0, height: 5 }))).toBe('')
    expect(svgElToPath(el('foreignObject', {}))).toBe('')
  })
  it('PORTAL_SHAPES includes rectangle + the fancy shapes', () => {
    expect(PORTAL_SHAPES).toContain('rectangle')
    expect(PORTAL_SHAPES).toContain('heart')
  })
})

describe('geometry: hsv colour maths', () => {
  it('greyscale (s=0) maps to equal-lightness HSL with zero saturation', () => {
    const c = hsvToHsl(0, 0, 50)
    expect(c.s).toBeCloseTo(0, 6)
    expect(c.l).toBeCloseTo(0.5, 6) // v(0.5) * (1 - s/2) with s=0
  })
  it('wraps hue into 0..1 turns', () => {
    expect(hsvToHsl(360, 50, 50).h).toBeCloseTo(0, 6)
    expect(hsvToHsl(-90, 50, 50).h).toBeCloseTo(0.75, 6)
  })
  it('hsvCss emits a valid hsl() string', () => {
    expect(hsvCss(200, 80, 90)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })
})

describe('geometry: camera rebuild signature', () => {
  it('a Shape ignores baked colour/size, so recolouring keeps the same sig', () => {
    const base = { source: 'Shape', shape: 'Cube', material: 'Solid', detail: 2, hue: 10 }
    expect(geoSig(base)).toBe(geoSig({ ...base, hue: 200 }))
  })
  it('a Point cloud bakes colour into the sig, so recolouring rebuilds', () => {
    const base = { source: 'Point cloud', cloud: 'Galaxy', count: 8000, hue: 10 }
    expect(geoSig(base)).not.toBe(geoSig({ ...base, hue: 200 }))
  })
  it('changing the shape always changes the sig', () => {
    const base = { source: 'Shape', shape: 'Cube' }
    expect(geoSig(base)).not.toBe(geoSig({ ...base, shape: 'Sphere' }))
  })
})

describe('geometry: wireframe skeletons', () => {
  it('every catalogue shape produces vertices + edges that index in range', () => {
    for (const shape of GEO_SHAPES) {
      const { V, E } = geoWire(shape)
      expect(V.length, shape).toBeGreaterThan(0)
      expect(E.length, shape).toBeGreaterThan(0)
      for (const [a, b] of E) {
        expect(a, shape).toBeGreaterThanOrEqual(0); expect(a, shape).toBeLessThan(V.length)
        expect(b, shape).toBeGreaterThanOrEqual(0); expect(b, shape).toBeLessThan(V.length)
      }
    }
  })
  it('caches: the same shape returns the identical object', () => {
    expect(geoWire('Cube')).toBe(geoWire('Cube'))
  })
})

describe('constants: node catalogue + option tables', () => {
  it('every node type declares title, input count, colour and icon', () => {
    for (const [type, def] of Object.entries(TYPES)) {
      expect(typeof def.title, type).toBe('string')
      expect(Number.isInteger(def.ins), type).toBe(true)
      expect(def.color, type).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(def.icon, type).toMatch(/^mdi-/)
    }
  })
  it('MIX_BLENDS is BLENDS without "normal"', () => {
    expect(BLENDS).toContain('normal')
    expect(MIX_BLENDS).not.toContain('normal')
    expect(MIX_BLENDS).toHaveLength(BLENDS.length - 1)
  })
  it('RESOLUTIONS has explicit sizes plus a Native option', () => {
    const native = RESOLUTIONS.find((r) => r.native)
    expect(native).toBeTruthy()
    for (const r of RESOLUTIONS.filter((r) => !r.native)) { expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0) }
  })
  it('PARAM_RANGES entries are [min,max] with min < max', () => {
    for (const [node, ranges] of Object.entries(PARAM_RANGES)) {
      for (const [p, [lo, hi]] of Object.entries(ranges)) { expect(lo, `${node}.${p}`).toBeLessThan(hi) }
    }
  })
})
