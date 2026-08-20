// Point-cloud / LiDAR ingest — the pure, framework-free half of the Geodata &
// Geometry nodes' point pipeline. Everything here takes raw bytes/text or plain
// numbers and returns typed arrays; the THREE.js object builders that consume
// these live in the view. Kept separate so the parsing can be unit-tested and
// so the Patch view isn't carrying binary-format logic inline.
//
// (LAZ — compressed LiDAR — is decoded in ./laz.js via a lazily-loaded WASM
// module; it hands its raw points to finalizePoints() here.)

// Colour a point by normalised height: teal → green → tan → snow.
export function heightRamp(t) {
  t = Math.max(0, Math.min(1, t))
  const stops = [[0.08, 0.22, 0.36], [0.16, 0.5, 0.4], [0.55, 0.56, 0.33], [0.92, 0.92, 0.88]]
  const f = t * (stops.length - 1), i = Math.floor(f), u = f - i
  const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

// Warm grayscale ramp for LiDAR return intensity — dim returns read dark, strong
// returns read bright, the way raw LiDAR is conventionally shaded.
export function intensityRamp(t) {
  t = Math.max(0, Math.min(1, t))
  const g = 0.12 + 0.88 * Math.pow(t, 0.7)
  return [g, g * 0.97, g * 0.9]
}

// Centre + uniformly scale raw points to fit the view. Colour priority when no
// per-point RGB is supplied: LiDAR return intensity (if the scan actually varies
// it), else height. Shared by the LAS and LAZ decoders.
export function finalizePoints(xs, w, colorsIn, intenIn) {
  let cx = 0, cy = 0, cz = 0, mx = 0
  for (let i = 0; i < w * 3; i += 3) { cx += xs[i]; cy += xs[i + 1]; cz += xs[i + 2] }
  cx /= w; cy /= w; cz /= w
  for (let i = 0; i < w * 3; i += 3) mx = Math.max(mx, Math.hypot(xs[i] - cx, xs[i + 1] - cy, xs[i + 2] - cz))
  const scl = mx > 0 ? 1.2 / mx : 1
  const pos = new Float32Array(w * 3)
  for (let i = 0; i < w * 3; i += 3) { pos[i] = (xs[i] - cx) * scl; pos[i + 1] = (xs[i + 1] - cy) * scl; pos[i + 2] = (xs[i + 2] - cz) * scl }
  let colors = colorsIn ? Float32Array.from(colorsIn) : null
  if (!colors) {
    colors = new Float32Array(w * 3)
    // Does the intensity channel carry real signal? (many exporters leave it 0.)
    let imin = Infinity, imax = -Infinity
    if (intenIn) for (let i = 0; i < w; i++) { const v = intenIn[i]; if (v < imin) imin = v; if (v > imax) imax = v }
    if (intenIn && imax > imin) { // colour by return strength
      const ir = imax - imin
      for (let i = 0; i < w; i++) { const c = intensityRamp((intenIn[i] - imin) / ir); colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2] }
    } else { // no usable intensity → colour by height
      let ymin = Infinity, ymax = -Infinity
      for (let i = 1; i < w * 3; i += 3) { if (pos[i] < ymin) ymin = pos[i]; if (pos[i] > ymax) ymax = pos[i] }
      const yr = (ymax - ymin) || 1
      for (let i = 0; i < w * 3; i += 3) { const c = heightRamp((pos[i + 1] - ymin) / yr); colors[i] = c[0]; colors[i + 1] = c[1]; colors[i + 2] = c[2] }
    }
  }
  return { positions: pos, colors, count: w }
}

// Native parser for LAS (LASF) point clouds — the standard uncompressed LiDAR
// format. Reads point formats 0–10 (X/Y/Z always at the record start; intensity
// always at offset 12; RGB where the format carries it), applies the header
// scale/offset, remaps LAS z-up to three.js y-up, subsamples very large files,
// and colours by intensity (falling back to height) when the scan has no RGB.
// LAZ (compressed) is detected and reported separately ({ err: 'laz' }).
export function parseLas(buf) {
  const dv = new DataView(buf)
  if (dv.getUint8(0) !== 0x4C || dv.getUint8(1) !== 0x41 || dv.getUint8(2) !== 0x53 || dv.getUint8(3) !== 0x46) return { err: 'not-las' }
  const verMinor = dv.getUint8(25)
  const offsetToPts = dv.getUint32(96, true)
  const fmtByte = dv.getUint8(104)
  if (fmtByte & 0xC0) return { err: 'laz' } // high bits set → LAZ compressed
  const fmt = fmtByte & 0x3f
  const recLen = dv.getUint16(105, true)
  let numPts = dv.getUint32(107, true)
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true)
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true)
  if (verMinor >= 4) { try { const n64 = dv.getBigUint64(247, true); if (n64 > 0n) numPts = Number(n64) } catch { /* keep legacy count */ } }
  if (!numPts || !recLen) return { err: 'empty' }
  const rgbOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt]
  const cap = 2_500_000
  const stride = numPts > cap ? Math.ceil(numPts / cap) : 1
  const outMax = Math.floor((numPts + stride - 1) / stride)
  const xs = new Float64Array(outMax * 3)
  const cs = rgbOff != null ? new Float32Array(outMax * 3) : null
  const inten = new Uint16Array(outMax) // return strength, offset 12 in every format
  let w = 0
  for (let i = 0; i < numPts; i += stride) {
    const base = offsetToPts + i * recLen
    if (base + 14 > buf.byteLength) break
    const X = dv.getInt32(base, true) * sx + ox
    const Y = dv.getInt32(base + 4, true) * sy + oy
    const Z = dv.getInt32(base + 8, true) * sz + oz
    xs[w * 3] = X; xs[w * 3 + 1] = Z; xs[w * 3 + 2] = -Y // LAS z-up → three y-up
    inten[w] = dv.getUint16(base + 12, true)
    if (cs) { const ro = base + rgbOff; const r = dv.getUint16(ro, true), g = dv.getUint16(ro + 2, true), b = dv.getUint16(ro + 4, true); const d = (r > 255 || g > 255 || b > 255) ? 65535 : 255; cs[w * 3] = r / d; cs[w * 3 + 1] = g / d; cs[w * 3 + 2] = b / d }
    w++
  }
  if (!w) return { err: 'empty' }
  return finalizePoints(xs.subarray(0, w * 3), w, cs ? cs.subarray(0, w * 3) : null, inten.subarray(0, w))
}

// Parse an imported .ply (ASCII) or .xyz point file → {positions, colors},
// centred and scaled to fit the unit-ish view.
export function parsePointFile(text) {
  const lines = text.split(/\r?\n/)
  const xs = [], cs = []
  let hasColor = false
  if (/^ply\b/i.test(text.trimStart())) {
    let i = 0, count = 0, props = []
    for (; i < lines.length; i++) {
      const l = lines[i].trim()
      if (/^element\s+vertex\s+(\d+)/i.test(l)) count = +RegExp.$1
      else if (/^property\s+\S+\s+(\S+)/i.test(l)) props.push(RegExp.$1.toLowerCase())
      else if (/^end_header/i.test(l)) { i++; break }
    }
    const ix = props.indexOf('x'), iy = props.indexOf('y'), iz = props.indexOf('z')
    const ir = props.findIndex((p) => p === 'red' || p === 'r'), ig = props.findIndex((p) => p === 'green' || p === 'g'), ib = props.findIndex((p) => p === 'blue' || p === 'b')
    hasColor = ir >= 0 && ig >= 0 && ib >= 0
    for (let k = 0; k < count && i < lines.length; k++, i++) {
      const t = lines[i].trim().split(/\s+/).map(Number); if (t.length < 3) continue
      xs.push(t[ix], t[iy], t[iz])
      if (hasColor) cs.push(t[ir] / 255, t[ig] / 255, t[ib] / 255)
    }
  } else {
    for (const l of lines) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const v = t.split(/[\s,]+/).map(Number); if (v.length < 3 || v.some((x) => !isFinite(x))) continue
      xs.push(v[0], v[1], v[2])
      if (v.length >= 6) { hasColor = true; const s = v[3] > 1 ? 255 : 1; cs.push(v[3] / s, v[4] / s, v[5] / s) }
    }
  }
  const n = xs.length / 3
  if (n < 1) return null
  // centre + uniform scale to ~[-1.2,1.2]
  let cx = 0, cy = 0, cz = 0, mx = 0
  for (let i = 0; i < xs.length; i += 3) { cx += xs[i]; cy += xs[i + 1]; cz += xs[i + 2] }
  cx /= n; cy /= n; cz /= n
  for (let i = 0; i < xs.length; i += 3) { mx = Math.max(mx, Math.hypot(xs[i] - cx, xs[i + 1] - cy, xs[i + 2] - cz)) }
  const sc = mx > 0 ? 1.2 / mx : 1
  const pos = new Float32Array(xs.length)
  for (let i = 0; i < xs.length; i += 3) { pos[i] = (xs[i] - cx) * sc; pos[i + 1] = (xs[i + 1] - cy) * sc; pos[i + 2] = (xs[i + 2] - cz) * sc }
  return { positions: pos, colors: hasColor ? Float32Array.from(cs) : null, count: n }
}

// Voxel grid → the filled cell centres and grid resolution N. The THREE
// InstancedMesh that renders them is built in the view.
export function genVoxels(type, res) {
  const N = Math.max(6, Math.min(46, Math.round(res || 18)))
  const cells = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = i / (N - 1) * 2 - 1, y = j / (N - 1) * 2 - 1, z = k / (N - 1) * 2 - 1
    let fill = false
    if (type === 'Terrain') { fill = y < (Math.sin(x * 2.5) * Math.cos(z * 2.3)) * 0.42 }
    else if (type === 'Gyroid') { const g = Math.sin(x * 3) * Math.cos(y * 3) + Math.sin(y * 3) * Math.cos(z * 3) + Math.sin(z * 3) * Math.cos(x * 3); fill = Math.abs(g) < 0.55 }
    else if (type === 'Shell') { const r = x * x + y * y + z * z; fill = r < 0.85 && r > 0.5 }
    else fill = (x * x + y * y + z * z) < 0.85 // Sphere
    if (fill) cells.push(x, y, z)
  }
  return { cells: Float32Array.from(cells), N }
}
