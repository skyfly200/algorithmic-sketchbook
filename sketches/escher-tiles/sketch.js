/**
 * Escher Tiles — a generator of interlocking tessellations in the spirit of
 * M.C. Escher, now with a whole block of polygon patterns to fill.
 *
 * A base tiling (square, triangle, hexagon, tumbling-block rhombi, or
 * octagon+square) covers the plane. Its straight edges can be left as clean
 * polygons or deformed into arcs / zigzags / scallops — the deformation is a
 * function of each shared edge only, so neighbouring tiles always match with no
 * gaps (the "translation" trick behind Escher's interlocking creatures). On top
 * of that every tile can be filled with a polygon motif — concentric rings,
 * radial fans, pinwheels, nested stars, midpoint subdivisions — so the entire
 * tessellated block reads as a dense field of polygons. Static: it renders once
 * and holds; change a control (or the seed) to re-deal a new pattern.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

// palettes: [ink, paper, accent1, accent2, accent3]
const PALS = {
  'Escher B/W': ['#15150f', '#f2efe5', '#9a968b', '#c9c5b8', '#6f6b60'],
  Woodcut: ['#2b1a10', '#e8d5b0', '#7a4a24', '#b07b45', '#d8a86a'],
  Ocean: ['#0b2b3a', '#dfeef2', '#2f7f96', '#8fc3ce', '#155e75'],
  Sunset: ['#3a1030', '#ffe6c0', '#c0417a', '#f2a25c', '#8a2d5f'],
  Forest: ['#12240f', '#e6ecd0', '#3a6b2e', '#8fae5a', '#5c8a3a'],
  Neon: ['#0a0a18', '#e8f0ff', '#ff2d95', '#12d8fa', '#a06bff'],
  Terracotta: ['#2a130c', '#f3e2cf', '#c65b34', '#e0925a', '#8a3a22'],
  Copper: ['#160f0a', '#f0d9bf', '#b5732e', '#d99a4e', '#7a4a1e'],
  Ink: ['#0d0d10', '#e9e9ee', '#3a3a44', '#8a8a99', '#5a5a66'],
}

const params = rt.params({
  tiling: { value: 'Square', type: 'select', options: ['Square', 'Triangles', 'Hexagons', 'Rhombi', 'Octagons'], label: 'Tiling' },
  fill: { value: 'Solid', type: 'select', options: ['Solid', 'Concentric', 'Rings', 'Radial', 'Pinwheel', 'Subdivide', 'Star', 'Nested'], label: 'Fill pattern' },
  edges: { value: 'Straight', type: 'select', options: ['Straight', 'Arcs', 'Zigzag', 'Scallop'], label: 'Edge style' },
  coloring: { value: 'Two-tone', type: 'select', options: ['Two-tone', 'Multi', 'Gradient', 'Rainbow', 'Outline'], label: 'Colouring' },
  palette: { value: 'Escher B/W', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  scale: { value: 96, min: 34, max: 260, step: 1, label: 'Tile size' },
  depth: { value: 0.28, min: 0, max: 0.46, step: 0.01, label: 'Edge depth' },
  arcs: { value: 2, min: 1, max: 5, step: 1, label: 'Arcs per edge' },
  layers: { value: 4, min: 1, max: 7, step: 1, label: 'Pattern density' },
  wobble: { value: 0.55, min: 0, max: 1, step: 0.02, label: 'Irregularity' },
  outline: { value: true, type: 'bool', label: 'Outline' },
  angle: { value: 0, min: 0, max: 180, step: 1, label: 'Rotation' },
})

// --- seeded per-direction arc amplitudes (stable per render) -----------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const AMP = new Map()
function seededAmp(bucket) {
  if (AMP.has(bucket)) return AMP.get(bucket)
  const v = mulberry32(((rt.seed | 0) ^ (bucket * 0x9e3779b1)) >>> 0)() * 2 - 1
  AMP.set(bucket, v)
  return v
}

// Sample one edge A->B. The offset curve is keyed to the *canonical* ordering of
// the endpoints (and the edge direction), so the two tiles sharing this edge
// generate an identical boundary — no gaps, automatic interlock.
function edgeSamples(A, B) {
  let P = A, Q = B, rev = false
  if (A[0] > B[0] || (A[0] === B[0] && A[1] > B[1])) { P = B; Q = A; rev = true }
  const dx = Q[0] - P[0], dy = Q[1] - P[1], len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  let ang = Math.atan2(dy, dx); ang = ((ang % Math.PI) + Math.PI) % Math.PI
  const bucket = Math.round(ang / (Math.PI / 12))
  const amp = seededAmp(bucket)
  const style = params.edges, depth = params.depth, arcs = Math.round(params.arcs), wob = params.wobble
  const N = 16, out = []
  for (let k = 0; k <= N; k++) {
    const t = k / N; let off = 0
    if (k > 0 && k < N && depth > 0 && style !== 'Straight') {
      if (style === 'Arcs') {
        let seg = Math.floor(t * arcs); if (seg >= arcs) seg = arcs - 1
        const lt = t * arcs - seg
        const uni = seg % 2 ? -1 : 1
        const a = uni * (1 - wob) + amp * wob
        off = a * depth * len * Math.sin(lt * Math.PI)
      } else if (style === 'Zigzag') {
        const tri = 1 - Math.abs(((t * arcs) % 1) * 2 - 1)
        off = amp * depth * len * (tri - 0.5)
      } else if (style === 'Scallop') {
        off = Math.sin(t * Math.PI * arcs) * depth * len * Math.abs(amp) * 0.9
      }
    }
    out.push([P[0] + dx * t + nx * off, P[1] + dy * t + ny * off])
  }
  if (rev) out.reverse()
  return out
}

function buildPath(poly, straight) {
  const p = new Path2D()
  if (straight) {
    p.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1])
    p.closePath(); return p
  }
  const n = poly.length
  let started = false
  for (let e = 0; e < n; e++) {
    const s = edgeSamples(poly[e], poly[(e + 1) % n])
    for (let k = 0; k < s.length; k++) {
      if (e > 0 && k === 0) continue // join point already emitted
      if (!started) { p.moveTo(s[k][0], s[k][1]); started = true }
      else p.lineTo(s[k][0], s[k][1])
    }
  }
  p.closePath(); return p
}

// --- small polygon helpers ---------------------------------------------------
function poly2path(poly) {
  const p = new Path2D()
  p.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1])
  p.closePath(); return p
}
function scaleP(poly, cx, cy, f) { return poly.map((v) => [cx + (v[0] - cx) * f, cy + (v[1] - cy) * f]) }
function rotP(poly, cx, cy, f, a) {
  const c = Math.cos(a), s = Math.sin(a)
  return poly.map((v) => { const x = (v[0] - cx) * f, y = (v[1] - cy) * f; return [cx + x * c - y * s, cy + x * s + y * c] })
}
function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }

// --- tilings: each returns tiles {poly, cx, cy, tint, kind} -------------------
const round2 = (v) => Math.round(v * 100) / 100
let W = 0, H = 0, D = 0, PR = 1, MARGIN = 0

function addTile(list, poly, tint, kind) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, sx = 0, sy = 0
  const rp = []
  for (const v of poly) {
    const x = round2(v[0]), y = round2(v[1])
    rp.push([x, y]); sx += x; sy += y
    if (x < minx) minx = x; if (x > maxx) maxx = x
    if (y < miny) miny = y; if (y > maxy) maxy = y
  }
  if (maxx < -MARGIN || minx > D + MARGIN || maxy < -MARGIN || miny > D + MARGIN) return
  list.push({ poly: rp, cx: sx / poly.length, cy: sy / poly.length, tint, kind: kind || 'p' })
}

function hexVerts(cx, cy, R) {
  const vs = []
  for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; vs.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]) }
  return vs
}

function buildTiling(kind, u) {
  const list = []
  MARGIN = u * (1 + params.depth) + 4
  if (kind === 'Triangles') {
    const Hh = u * Math.sqrt(3) / 2
    const cols = Math.ceil(D / u) + 3, rows = Math.ceil(D / Hh) + 3
    for (let j = -2; j < rows; j++) {
      for (let i = -rows - 2; i < cols + 2; i++) {
        const bx0 = i * u + j * (u / 2), by0 = j * Hh
        addTile(list, [[bx0, by0], [bx0 + u, by0], [bx0 + u / 2, by0 + Hh]], i + j)
        addTile(list, [[bx0 + u, by0], [bx0 + u / 2, by0 + Hh], [bx0 + 3 * u / 2, by0 + Hh]], i + j + 1)
      }
    }
  } else if (kind === 'Hexagons' || kind === 'Rhombi') {
    const R = u, Wd = Math.sqrt(3) * R, Vsp = 1.5 * R
    const cols = Math.ceil(D / Wd) + 3, rows = Math.ceil(D / Vsp) + 3
    for (let j = -2; j < rows; j++) {
      for (let i = -2; i < cols; i++) {
        const cx = i * Wd + (j & 1 ? Wd / 2 : 0), cy = j * Vsp
        const vs = hexVerts(cx, cy, R)
        if (kind === 'Hexagons') addTile(list, vs, i + 2 * j)
        else for (let k = 0; k < 3; k++) addTile(list, [[cx, cy], vs[2 * k], vs[(2 * k + 1) % 6], vs[(2 * k + 2) % 6]], k, 'r')
      }
    }
  } else if (kind === 'Octagons') {
    const c = u / (2 + Math.SQRT2)
    const cols = Math.ceil(D / u) + 2, rows = Math.ceil(D / u) + 2
    for (let j = -1; j < rows; j++) {
      for (let i = -1; i < cols; i++) {
        const X = i * u, Y = j * u
        addTile(list, [[X + c, Y], [X + u - c, Y], [X + u, Y + c], [X + u, Y + u - c], [X + u - c, Y + u], [X + c, Y + u], [X, Y + u - c], [X, Y + c]], i + j, 'oct')
        addTile(list, [[X + c, Y], [X, Y + c], [X - c, Y], [X, Y - c]], i + j, 'sq')
      }
    }
  } else {
    const cols = Math.ceil(D / u) + 2, rows = Math.ceil(D / u) + 2
    for (let j = -1; j < rows; j++) {
      for (let i = -1; i < cols; i++) {
        const X = i * u, Y = j * u
        addTile(list, [[X, Y], [X + u, Y], [X + u, Y + u], [X, Y + u]], i + j)
      }
    }
  }
  return list
}

// --- colouring ---------------------------------------------------------------
function tileColors(t, P) {
  const c = params.coloring
  if (t.kind === 'sq' && c !== 'Gradient' && c !== 'Rainbow') return { base: P[2], accent: P[3], line: P[0] }
  if (c === 'Outline') return { base: P[1], accent: P[0], line: P[0] }
  if (c === 'Gradient') {
    const l = 0.5 + 0.4 * Math.sin((t.cx + t.cy) * 0.006)
    const h = (((t.cx * 0.16 + t.cy * 0.11) | 0) % 360 + 360) % 360
    return { base: `hsl(${h},40%,${(26 + l * 30) | 0}%)`, accent: `hsl(${h},52%,${(58 + l * 22) | 0}%)`, line: P[0] }
  }
  if (c === 'Rainbow') {
    const h = ((t.tint * 37) % 360 + 360) % 360
    return { base: `hsl(${h},58%,52%)`, accent: `hsl(${(h + 180) % 360},58%,62%)`, line: P[0] }
  }
  if (c === 'Multi') {
    const opts = [P[0], P[2], P[3], P[4]]
    return { base: opts[((t.tint % 4) + 4) % 4], accent: P[1], line: P[0] }
  }
  const odd = t.tint & 1
  return { base: odd ? P[0] : P[1], accent: odd ? P[1] : P[0], line: P[0] }
}

// --- interior polygon motifs -------------------------------------------------
function drawInterior(g, t, base, accent) {
  const poly = t.poly, cx = t.cx, cy = t.cy, n = poly.length
  const layers = Math.round(params.layers)
  switch (params.fill) {
    case 'Concentric':
      for (let k = 1; k <= layers; k++) { g.fillStyle = k & 1 ? accent : base; g.fill(poly2path(scaleP(poly, cx, cy, 1 - k / (layers + 1)))) }
      break
    case 'Rings':
      g.lineWidth = Math.max(1, PR * 1.4)
      for (let k = 1; k <= layers; k++) { g.strokeStyle = k & 1 ? accent : base; g.stroke(poly2path(scaleP(poly, cx, cy, 1 - k / (layers + 1)))) }
      break
    case 'Radial':
      for (let i = 0; i < n; i++) {
        const p = new Path2D(); p.moveTo(cx, cy); p.lineTo(poly[i][0], poly[i][1]); p.lineTo(poly[(i + 1) % n][0], poly[(i + 1) % n][1]); p.closePath()
        g.fillStyle = i & 1 ? accent : base; g.fill(p)
      }
      break
    case 'Pinwheel':
      for (let i = 0; i < n; i++) {
        const m1 = mid(poly[i], poly[(i + 1) % n])
        const a = new Path2D(); a.moveTo(cx, cy); a.lineTo(poly[i][0], poly[i][1]); a.lineTo(m1[0], m1[1]); a.closePath()
        g.fillStyle = accent; g.fill(a)
        const b = new Path2D(); b.moveTo(cx, cy); b.lineTo(m1[0], m1[1]); b.lineTo(poly[(i + 1) % n][0], poly[(i + 1) % n][1]); b.closePath()
        g.fillStyle = base; g.fill(b)
      }
      break
    case 'Subdivide': {
      let cur = poly
      for (let k = 0; k < Math.max(1, layers - 1); k++) {
        const mids = cur.map((v, i) => mid(v, cur[(i + 1) % cur.length]))
        g.fillStyle = k & 1 ? base : accent; g.fill(poly2path(mids)); cur = mids
      }
      break
    }
    case 'Star':
      if (n < 5) { g.fillStyle = accent; g.fill(poly2path(rotP(poly, cx, cy, 0.62, Math.PI / (n === 3 ? 3 : 4)))) }
      else {
        const p = new Path2D(); let idx = 0; p.moveTo(poly[0][0], poly[0][1])
        for (let s = 0; s < n; s++) { idx = (idx + 2) % n; p.lineTo(poly[idx][0], poly[idx][1]) }
        p.closePath(); g.fillStyle = accent; g.fill(p)
      }
      break
    case 'Nested':
      for (let k = 1; k <= layers; k++) { g.fillStyle = k & 1 ? accent : base; g.fill(poly2path(rotP(poly, cx, cy, 1 - k / (layers + 1.2), k * 0.35))) }
      break
    default:
      break
  }
}

function drawTile(g, t, P) {
  const { base, accent, line } = tileColors(t, P)
  const straight = params.edges === 'Straight' || params.depth === 0
  const path = buildPath(t.poly, straight)
  g.fillStyle = base; g.fill(path)
  if (params.fill !== 'Solid') { g.save(); g.clip(path); drawInterior(g, t, base, accent); g.restore() }
  if (params.outline || params.coloring === 'Outline') {
    g.strokeStyle = line; g.lineWidth = Math.max(1, PR * 1.1); g.lineJoin = 'round'; g.stroke(path)
  }
}

// --- buffer + render ---------------------------------------------------------
const buf = document.createElement('canvas')
const bx = buf.getContext('2d')
let randPal = PALS['Escher B/W']
let prevPalette = ''
let lastKey = ''

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  D = Math.ceil(Math.hypot(W, H))
  buf.width = D; buf.height = D
  lastKey = ''
}
function pal() { return params.palette === 'Random' ? randPal : (PALS[params.palette] ?? PALS['Escher B/W']) }

function renderPattern() {
  AMP.clear()
  const P = pal()
  bx.setTransform(1, 0, 0, 1, 0, 0)
  bx.fillStyle = P[1]; bx.fillRect(0, 0, D, D)
  const tiles = buildTiling(params.tiling, params.scale * PR)
  for (const t of tiles) drawTile(bx, t, P)
}

function key() {
  return [params.tiling, params.fill, params.edges, params.coloring, params.palette, params.scale, params.depth, params.arcs, params.layers, params.wobble, params.outline, rt.seed, W, H, PR].join('|')
}

function frame(now) {
  rt.tick(now)
  if (params.palette === 'Random' && prevPalette !== 'Random') {
    const h = rt.random(0, 360)
    randPal = [
      `hsl(${h | 0},35%,15%)`, `hsl(${(h + 40) | 0},30%,90%)`,
      `hsl(${(h + 180) | 0},48%,48%)`, `hsl(${(h + 90) | 0},42%,64%)`, `hsl(${(h + 260) | 0},44%,40%)`,
    ]
    lastKey = ''
  }
  prevPalette = params.palette
  const k = key()
  if (k !== lastKey) { renderPattern(); lastKey = k }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal()[1]
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((params.angle * Math.PI) / 180)
  ctx.drawImage(buf, -D / 2, -D / 2)
  ctx.restore()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
