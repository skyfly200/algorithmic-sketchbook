import { describe, it, expect } from 'vitest'
import { heightRamp, intensityRamp, finalizePoints, parseLas, parsePointFile, genVoxels } from '../src/lib/points.js'

describe('heightRamp / intensityRamp', () => {
  it('clamp to the endpoint colours', () => {
    expect(heightRamp(-5)).toEqual(heightRamp(0))
    expect(heightRamp(9)).toEqual(heightRamp(1))
    expect(intensityRamp(-1)[0]).toBeCloseTo(0.12, 5)
    expect(intensityRamp(2)[0]).toBeCloseTo(1.0, 5)
  })
  it('intensity is monotonic in t', () => {
    expect(intensityRamp(0.8)[0]).toBeGreaterThan(intensityRamp(0.2)[0])
  })
})

describe('finalizePoints', () => {
  const pts = new Float64Array([0, 0, 0, 2, 0, 0, 0, 2, 0]) // 3 points
  it('centres and scales into ~unit space', () => {
    const r = finalizePoints(pts, 3, null, null)
    expect(r.count).toBe(3)
    // centroid moves to origin; furthest point sits at radius 1.2
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < 9; i += 3) { cx += r.positions[i]; cy += r.positions[i + 1]; cz += r.positions[i + 2] }
    expect(cx / 3).toBeCloseTo(0, 5)
    expect(cy / 3).toBeCloseTo(0, 5)
    let mx = 0
    for (let i = 0; i < 9; i += 3) mx = Math.max(mx, Math.hypot(r.positions[i], r.positions[i + 1], r.positions[i + 2]))
    expect(mx).toBeCloseTo(1.2, 5)
  })
  it('passes RGB straight through when provided', () => {
    const cols = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    const r = finalizePoints(pts, 3, cols, null)
    expect(Array.from(r.colors)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
  it('colours by intensity when it varies and there is no RGB', () => {
    const inten = new Uint16Array([0, 4000, 8000])
    const r = finalizePoints(pts, 3, null, inten)
    // brightest point should be the highest-intensity one (index 2)
    const lum = (i) => r.colors[i * 3]
    expect(lum(2)).toBeGreaterThan(lum(0))
    expect(lum(1)).toBeGreaterThan(lum(0))
  })
  it('falls back to height colouring when intensity is flat', () => {
    const flat = new Uint16Array([0, 0, 0])
    const r = finalizePoints(pts, 3, null, flat)
    // height ramp gives non-grayscale colours (r != g somewhere)
    let anyChroma = false
    for (let i = 0; i < 9; i += 3) if (Math.abs(r.colors[i] - r.colors[i + 1]) > 1e-3) anyChroma = true
    expect(anyChroma).toBe(true)
  })
})

describe('parseLas', () => {
  it('rejects non-LAS bytes', () => {
    expect(parseLas(new Uint8Array([1, 2, 3, 4]).buffer).err).toBe('not-las')
  })
  it('flags LAZ-compressed files', () => {
    const buf = new ArrayBuffer(400)
    const dv = new DataView(buf)
    dv.setUint8(0, 0x4c); dv.setUint8(1, 0x41); dv.setUint8(2, 0x53); dv.setUint8(3, 0x46) // LASF
    dv.setUint8(104, 0x80 | 0) // high bit set → compressed
    expect(parseLas(buf).err).toBe('laz')
  })
  it('parses a minimal uncompressed format-0 tile and colours by intensity', () => {
    const offset = 300, recLen = 20, n = 3
    const buf = new ArrayBuffer(offset + recLen * n)
    const dv = new DataView(buf)
    dv.setUint8(0, 0x4c); dv.setUint8(1, 0x41); dv.setUint8(2, 0x53); dv.setUint8(3, 0x46)
    dv.setUint8(25, 2) // version minor 1.2
    dv.setUint32(96, offset, true) // offset to point data
    dv.setUint8(104, 0) // point format 0
    dv.setUint16(105, recLen, true) // record length
    dv.setUint32(107, n, true) // legacy point count
    for (const o of [131, 139, 147]) dv.setFloat64(o, 1, true) // scale = 1
    for (const o of [155, 163, 171]) dv.setFloat64(o, 0, true) // offset = 0
    const P = [[0, 0, 0, 10], [10, 0, 0, 500], [0, 10, 0, 3000]]
    P.forEach(([x, y, z, inten], i) => {
      const b = offset + i * recLen
      dv.setInt32(b, x, true); dv.setInt32(b + 4, y, true); dv.setInt32(b + 8, z, true)
      dv.setUint16(b + 12, inten, true)
    })
    const r = parseLas(buf)
    expect(r.err).toBeUndefined()
    expect(r.count).toBe(3)
    expect(r.colors).toBeTruthy()
    // highest intensity (point 2) reads brightest
    expect(r.colors[2 * 3]).toBeGreaterThan(r.colors[0])
  })
})

describe('parsePointFile', () => {
  it('parses whitespace xyz with colour', () => {
    const r = parsePointFile('0 0 0 255 0 0\n2 0 0 0 255 0\n0 2 0 0 0 255\n')
    expect(r.count).toBe(3)
    expect(r.colors).toBeTruthy()
    expect(r.colors[0]).toBeCloseTo(1, 5) // 255/255
  })
  it('parses ASCII PLY headers', () => {
    const ply = ['ply', 'format ascii 1.0', 'element vertex 2',
      'property float x', 'property float y', 'property float z',
      'end_header', '0 0 0', '1 1 1'].join('\n')
    const r = parsePointFile(ply)
    expect(r.count).toBe(2)
    expect(r.colors).toBeNull()
  })
  it('returns null for empty input', () => {
    expect(parsePointFile('# just a comment\n')).toBeNull()
  })
})

describe('genVoxels', () => {
  it('clamps resolution and fills a sphere', () => {
    const r = genVoxels('Sphere', 4) // below min → clamps to 6
    expect(r.N).toBe(6)
    expect(r.cells.length).toBeGreaterThan(0)
    expect(r.cells.length % 3).toBe(0)
  })
  it('shell has fewer filled cells than a solid sphere', () => {
    const solid = genVoxels('Sphere', 20).cells.length
    const shell = genVoxels('Shell', 20).cells.length
    expect(shell).toBeLessThan(solid)
  })
})
