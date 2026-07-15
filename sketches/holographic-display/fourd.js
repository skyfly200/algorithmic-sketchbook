/**
 * 4D geometry for the holographic display: the six convex regular 4-polytopes
 * (5-cell, tesseract/8-cell, 16-cell, 24-cell, 120-cell, 600-cell) as vertex +
 * edge networks, and a Klein bottle embedded in R⁴. Everything lives in 4D and
 * is rotated in the four "w" planes each frame, then projected down to 3D — so
 * the figures turn through the fourth dimension, swelling and passing through
 * themselves the way a shadow of a higher-dimensional object does.
 */
const PHI = (1 + Math.sqrt(5)) / 2

// --- combinatorial helpers ------------------------------------------------
// All sign combinations of a tuple's non-zero entries.
function signSpread(t) {
  const nz = []
  for (let i = 0; i < t.length; i++) if (t[i] !== 0) nz.push(i)
  const out = []
  for (let m = 0; m < 1 << nz.length; m++) {
    const v = t.slice()
    for (let b = 0; b < nz.length; b++) if (m & (1 << b)) v[nz[b]] = -v[nz[b]]
    out.push(v)
  }
  return out
}
// All index permutations of 0..n-1 (with their parity).
function indexPerms(n) {
  const res = []
  const idx = [...Array(n).keys()]
  const used = new Array(n).fill(false)
  const cur = []
  ;(function bt() {
    if (cur.length === n) { res.push(cur.slice()); return }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue
      used[i] = true; cur.push(i)
      bt()
      cur.pop(); used[i] = false
    }
  })()
  return res
}
function parity(p) {
  let s = 1
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) s = -s
  return s
}
const PERMS4 = indexPerms(4)
const EVEN4 = PERMS4.filter((p) => parity(p) === 1)

// Expand base tuples into a deduped vertex set. mode 'all' uses every
// permutation, 'even' only even permutations; signs are always independent.
function expand(bases, mode) {
  const perms = mode === 'even' ? EVEN4 : PERMS4
  const seen = new Set()
  const out = []
  for (const base of bases) {
    for (const signed of signSpread(base)) {
      for (const p of perms) {
        const v = [signed[p[0]], signed[p[1]], signed[p[2]], signed[p[3]]]
        const key = v.map((x) => (Math.round(x * 1e5) / 1e5).toFixed(5)).join(',')
        if (seen.has(key)) continue
        seen.add(key)
        out.push(v)
      }
    }
  }
  return out
}

// Regular 5-cell (4-simplex): the 5 basis vectors of R⁵ projected onto the
// sum-zero hyperplane, expressed in an orthonormal basis of that hyperplane.
function simplexVerts() {
  // Orthonormal basis {u1..u4} of {x∈R⁵ : Σx=0} via Gram–Schmidt.
  const raw = [
    [1, -1, 0, 0, 0],
    [1, 1, -2, 0, 0],
    [1, 1, 1, -3, 0],
    [1, 1, 1, 1, -4],
  ]
  const basis = raw.map((v) => {
    const n = Math.hypot(...v)
    return v.map((x) => x / n)
  })
  const verts = []
  for (let i = 0; i < 5; i++) {
    const e = [0, 0, 0, 0, 0]
    e[i] = 1
    const mean = 0.2
    const c = e.map((x) => x - mean) // centre on hyperplane
    verts.push(basis.map((u) => u.reduce((s, uk, k) => s + uk * c[k], 0)))
  }
  return verts
}

// Edges: the pairs at the (shared) minimum vertex distance.
function edgesByNearest(verts, factor = 1.05) {
  let min = Infinity
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const d = dist2(verts[i], verts[j])
      if (d > 1e-6 && d < min) min = d
    }
  const lim = min * factor
  const edges = []
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++)
      if (dist2(verts[i], verts[j]) <= lim) edges.push([i, j])
  return edges
}
function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], dw = a[3] - b[3]
  return dx * dx + dy * dy + dz * dz + dw * dw
}
function normalize(verts) {
  let r = 0
  for (const v of verts) r = Math.max(r, Math.hypot(...v))
  return verts.map((v) => v.map((x) => x / r))
}

// --- the six regular 4-polytopes -----------------------------------------
export function polytope(name) {
  let verts
  switch (name) {
    case '5-cell':
      verts = simplexVerts()
      break
    case 'tesseract': // 8-cell / hypercube
      verts = signSpread([1, 1, 1, 1])
      break
    case '16-cell':
      verts = expand([[1, 0, 0, 0]], 'all')
      break
    case '24-cell':
      verts = expand([[1, 1, 0, 0]], 'all')
      break
    case '600-cell':
      verts = [
        ...signSpread([0.5, 0.5, 0.5, 0.5]),
        ...expand([[1, 0, 0, 0]], 'all'),
        ...expand([[PHI / 2, 0.5, 1 / (2 * PHI), 0]], 'even'),
      ]
      break
    case '120-cell':
      verts = [
        ...expand([[0, 0, 2, 2]], 'all'),
        ...expand([[1, 1, 1, Math.sqrt(5)]], 'all'),
        ...expand([[1 / (PHI * PHI), PHI, PHI, PHI]], 'all'),
        ...expand([[1 / PHI, 1 / PHI, 1 / PHI, PHI * PHI]], 'all'),
        ...expand([[0, 1 / (PHI * PHI), 1, PHI * PHI]], 'even'),
        ...expand([[0, 1 / PHI, PHI, Math.sqrt(5)]], 'even'),
        ...expand([[1 / PHI, 1, PHI, 2]], 'even'),
      ]
      break
    default:
      verts = signSpread([1, 1, 1, 1])
  }
  verts = normalize(verts)
  return { verts, edges: edgesByNearest(verts) }
}

// --- Klein bottle embedded in R⁴ (a circle bundle over a circle with a
// half-twist that lives in the extra dimension, so it is embedded — no
// self-intersection — until you project it down to 3D). Returned as a grid
// wireframe so the surface stays legible under additive holographic blending.
export function kleinBottle(segU = 48, segV = 24) {
  const verts = []
  for (let iu = 0; iu <= segU; iu++) {
    const u = (iu / segU) * Math.PI * 2
    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * Math.PI * 2
      const r = 1.1 + Math.cos(v)
      verts.push([
        r * Math.cos(u),
        r * Math.sin(u),
        Math.sin(v) * Math.cos(u / 2),
        Math.sin(v) * Math.sin(u / 2),
      ])
    }
  }
  const row = segV + 1
  const edges = []
  for (let iu = 0; iu <= segU; iu++)
    for (let iv = 0; iv <= segV; iv++) {
      const a = iu * row + iv
      if (iu < segU) edges.push([a, a + row]) // along u
      if (iv < segV) edges.push([a, a + 1]) // along v
    }
  return { verts: normalize(verts), edges }
}

// --- 4D rotation (in the three planes containing w) + projection to 3D -----
export function rotateProject(v, ax, ay, az, dist, out) {
  let x = v[0], y = v[1], z = v[2], w = v[3]
  let c = Math.cos(ax), s = Math.sin(ax) // x–w plane
  let nx = x * c - w * s; w = x * s + w * c; x = nx
  c = Math.cos(ay); s = Math.sin(ay) // y–w plane
  let ny = y * c - w * s; w = y * s + w * c; y = ny
  c = Math.cos(az); s = Math.sin(az) // z–w plane
  let nz = z * c - w * s; w = z * s + w * c; z = nz
  const k = dist / (dist - w) // perspective projection 4D→3D
  out[0] = x * k
  out[1] = y * k
  out[2] = z * k
  return w // depth in w, for glow
}
