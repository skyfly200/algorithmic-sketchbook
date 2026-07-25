/**
 * Escher Menagerie — interlocking-creature tessellations in the manner of
 * M.C. Escher's birds, fish and reptiles. A base lattice (square or the
 * three-rhombi "reptile" hexagon) is deformed edge-by-edge into a creature
 * silhouette; because each shared edge is bent by a curve that depends only on
 * that edge, neighbouring tiles always lock together with no gaps — the same
 * "conserved bump" trick Escher used, where the bite taken from one tile becomes
 * the bulge of the next. Each tile is then given an eye and a few wing / fin /
 * limb strokes and coloured by its orientation class, so the field reads as a
 * flock of birds, a school of fish or a lattice of lizards rotating 120° about
 * each vertex. Static: it renders once and holds; change a control (or the
 * seed) to re-deal, and the whole field can be rotated live.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

// palettes as ordered tone lists (light → dark-ish); creatures pick tones by class
const PALS = {
  'Day & Night': ['#e9e6da', '#20242c', '#8b95a1'],
  Reptile: ['#c9a24a', '#3a5a2a', '#7a3b22'],
  Ocean: ['#cfe9ee', '#0e3a4a', '#2f8fa6'],
  Sky: ['#dfe9f2', '#3b5c86', '#9db4d0'],
  Woodcut: ['#e8d5b0', '#2b1a10', '#7a4a24'],
  Sunset: ['#f2c98a', '#3a1030', '#c0417a'],
  Forest: ['#e6ecd0', '#12240f', '#3a6b2e'],
}

const params = rt.params({
  motif: { value: 'Birds', type: 'select', options: ['Birds', 'Fish', 'Lizards', 'Squares', 'Triangles', 'Hexagons', 'Cubes'], label: 'Tessellation' },
  palette: { value: 'Day & Night', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  scale: { value: 120, min: 50, max: 320, step: 1, label: 'Creature size' },
  plump: { value: 1, min: 0.4, max: 1.6, step: 0.02, label: 'Shape depth' },
  features: { value: true, type: 'bool', label: 'Eyes & markings' },
  outline: { value: true, type: 'bool', label: 'Outline' },
  angle: { value: 0, min: 0, max: 180, step: 1, label: 'Rotation' },
})

// --- creature definitions ----------------------------------------------------
// prof: perpendicular offset bumps along an edge, summed gaussians, keyed by the
// edge direction category. The SAME profile is used for every edge of a given
// direction, so the tile is one repeated prototile and the tiling stays gapless.
const MOTIFS = {
  Birds: {
    tiling: 'square', depth: 0.3,
    prof: {
      h: [{ at: 0.5, amp: 0.85, w: 0.26 }, { at: 0.15, amp: -0.35, w: 0.12 }], // wing sweep + shoulder notch
      v: [{ at: 0.7, amp: 0.8, w: 0.15 }, { at: 0.32, amp: -0.55, w: 0.16 }],  // head/beak bulge + neck notch
    },
    orient: () => 0, cls: (i, j) => (i + j) & 1, feat: drawBird, tones: 2,
  },
  Fish: {
    tiling: 'square', depth: 0.32,
    prof: {
      h: [{ at: 0.5, amp: 0.7, w: 0.3 }, { at: 0.82, amp: 0.5, w: 0.1 }],      // body curve + tail flare
      v: [{ at: 0.4, amp: 0.75, w: 0.17 }, { at: 0.72, amp: -0.4, w: 0.13 }],  // nose bump + mouth notch
    },
    orient: (i, j) => (j & 1 ? Math.PI : 0), cls: (i, j) => j & 1, feat: drawFish, tones: 2,
  },
  Lizards: {
    tiling: 'rhombille', depth: 0.26,
    prof: { a: [{ at: 0.28, amp: 0.6, w: 0.1 }, { at: 0.62, amp: -0.55, w: 0.1 }, { at: 0.85, amp: 0.4, w: 0.08 }] }, // limbs
    orient: null, cls: (k) => k % 3, feat: drawLizard, tones: 3,
  },
  // plain geometric tessellations: straight edges, no markings
  Squares: { tiling: 'square', geo: true, orient: () => 0, cls: (i, j) => (i + j) & 1 },
  Triangles: { tiling: 'triangle', geo: true },
  Hexagons: { tiling: 'hexagon', geo: true },
  Cubes: { tiling: 'rhombille', geo: true, orient: () => 0, cls: (k) => k % 3 },
}
const EMPTY = []

// --- luminance helpers to pick a contrasting ink -----------------------------
function lum(hex) {
  if (hex[0] !== '#') return 0.5
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- geometry ----------------------------------------------------------------
const round2 = (v) => Math.round(v * 100) / 100
let W = 0, H = 0, D = 0, PR = 1, MARGIN = 0
let motif = MOTIFS.Birds

function profileVal(bumps, t) {
  let s = 0
  for (const b of bumps) s += b.amp * Math.exp(-((t - b.at) / b.w) * ((t - b.at) / b.w))
  return s
}
function bumpsFor(ang) {
  if (motif.geo) return EMPTY
  if (motif.tiling === 'rhombille') return motif.prof.a
  return Math.abs(Math.sin(ang)) < 0.5 ? motif.prof.h : motif.prof.v
}
// Sample edge A->B with a deterministic offset keyed to the canonical ordering
// of its endpoints, so the two tiles sharing it produce an identical boundary.
function edgeSamples(A, B) {
  let P = A, Q = B, rev = false
  if (A[0] > B[0] || (A[0] === B[0] && A[1] > B[1])) { P = B; Q = A; rev = true }
  const dx = Q[0] - P[0], dy = Q[1] - P[1], len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  let ang = Math.atan2(dy, dx); ang = ((ang % Math.PI) + Math.PI) % Math.PI
  const bumps = bumpsFor(ang)
  const depth = (motif.depth || 0) * params.plump
  const N = 18, out = []
  for (let k = 0; k <= N; k++) {
    const t = k / N
    const off = (k > 0 && k < N) ? profileVal(bumps, t) * depth * len : 0
    out.push([P[0] + dx * t + nx * off, P[1] + dy * t + ny * off])
  }
  if (rev) out.reverse()
  return out
}
function buildPath(poly) {
  const p = new Path2D(); const n = poly.length; let started = false
  for (let e = 0; e < n; e++) {
    const s = edgeSamples(poly[e], poly[(e + 1) % n])
    for (let k = 0; k < s.length; k++) {
      if (e > 0 && k === 0) continue
      if (!started) { p.moveTo(s[k][0], s[k][1]); started = true } else p.lineTo(s[k][0], s[k][1])
    }
  }
  p.closePath(); return p
}
function hexVerts(cx, cy, R) {
  const vs = []
  for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; vs.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]) }
  return vs
}
function addTile(list, poly, orient, cls, size) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, sx = 0, sy = 0
  const rp = []
  for (const v of poly) {
    const x = round2(v[0]), y = round2(v[1]); rp.push([x, y]); sx += x; sy += y
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
  }
  if (maxx < -MARGIN || minx > D + MARGIN || maxy < -MARGIN || miny > D + MARGIN) return
  list.push({ poly: rp, cx: sx / poly.length, cy: sy / poly.length, orient, cls, size })
}
function buildTiling(u) {
  const list = []
  MARGIN = u * (1 + (motif.depth || 0) * params.plump) + 4
  if (motif.tiling === 'rhombille') {
    const R = u, Wd = Math.sqrt(3) * R, Vsp = 1.5 * R
    const cols = Math.ceil(D / Wd) + 3, rows = Math.ceil(D / Vsp) + 3
    for (let j = -2; j < rows; j++) {
      for (let i = -2; i < cols; i++) {
        const cx = i * Wd + (j & 1 ? Wd / 2 : 0), cy = j * Vsp
        const vs = hexVerts(cx, cy, R)
        for (let k = 0; k < 3; k++) {
          const outer = vs[(2 * k + 1) % 6]
          const poly = [[cx, cy], vs[2 * k], outer, vs[(2 * k + 2) % 6]]
          addTile(list, poly, Math.atan2(outer[1] - cy, outer[0] - cx), motif.cls(k), R)
        }
      }
    }
  } else if (motif.tiling === 'triangle') {
    const Hh = u * Math.sqrt(3) / 2
    const cols = Math.ceil(D / u) + 3, rows = Math.ceil(D / Hh) + 3
    for (let j = -2; j < rows; j++) {
      for (let i = -rows - 2; i < cols + 2; i++) {
        const b0 = i * u + j * (u / 2), c0 = j * Hh
        addTile(list, [[b0, c0], [b0 + u, c0], [b0 + u / 2, c0 + Hh]], 0, (i + j) & 1 ? 0 : 1, u)
        addTile(list, [[b0 + u, c0], [b0 + u / 2, c0 + Hh], [b0 + 3 * u / 2, c0 + Hh]], 0, (i + j) & 1 ? 2 : 0, u)
      }
    }
  } else if (motif.tiling === 'hexagon') {
    const R = u, Wd = Math.sqrt(3) * R, Vsp = 1.5 * R
    const cols = Math.ceil(D / Wd) + 3, rows = Math.ceil(D / Vsp) + 3
    for (let j = -2; j < rows; j++) {
      for (let i = -2; i < cols; i++) {
        const cx = i * Wd + (j & 1 ? Wd / 2 : 0), cy = j * Vsp
        addTile(list, hexVerts(cx, cy, R), 0, ((i + 2 * j) % 3 + 3) % 3, R)
      }
    }
  } else {
    const cols = Math.ceil(D / u) + 2, rows = Math.ceil(D / u) + 2
    for (let j = -1; j < rows; j++) {
      for (let i = -1; i < cols; i++) {
        const X = i * u, Y = j * u
        addTile(list, [[X, Y], [X + u, Y], [X + u, Y + u], [X, Y + u]], motif.orient(i, j), motif.cls(i, j), u)
      }
    }
  }
  return list
}

// --- interior features, drawn in a normalised frame (forward = +x, span ~1) ---
function drawBird(g, ink) {
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round'
  g.lineWidth = 0.028
  // wing: a swept chevron across the body
  g.beginPath(); g.moveTo(-0.12, -0.04); g.quadraticCurveTo(0.08, 0.02, 0.22, 0.2); g.stroke()
  g.beginPath(); g.moveTo(-0.16, 0.02); g.quadraticCurveTo(0.0, 0.1, 0.12, 0.26); g.stroke()
  // tail feathers
  g.beginPath(); g.moveTo(-0.3, -0.06); g.lineTo(-0.46, -0.14); g.moveTo(-0.3, 0.0); g.lineTo(-0.47, -0.02); g.stroke()
  // eye
  g.beginPath(); g.arc(0.24, -0.13, 0.05, 0, 6.28); g.fill()
}
function drawFish(g, ink) {
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round'
  g.lineWidth = 0.026
  // gill
  g.beginPath(); g.moveTo(0.16, -0.14); g.quadraticCurveTo(0.1, 0, 0.16, 0.14); g.stroke()
  // pectoral fin
  g.beginPath(); g.moveTo(0.05, 0.06); g.quadraticCurveTo(-0.02, 0.2, -0.12, 0.24); g.stroke()
  // lateral line + a couple scales
  g.lineWidth = 0.016
  g.beginPath(); g.moveTo(0.24, -0.02); g.quadraticCurveTo(-0.05, 0.02, -0.3, 0.0); g.stroke()
  // tail fin rays
  g.lineWidth = 0.022
  g.beginPath(); g.moveTo(-0.32, 0); g.lineTo(-0.48, -0.14); g.moveTo(-0.32, 0.02); g.lineTo(-0.48, 0.16); g.stroke()
  // eye
  g.beginPath(); g.arc(0.28, -0.05, 0.045, 0, 6.28); g.fill()
}
function drawLizard(g, ink) {
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round'
  g.lineWidth = 0.03
  // spine from head (+x, outer) to tail (-x, hub)
  g.beginPath(); g.moveTo(0.32, 0); g.quadraticCurveTo(-0.05, 0.02, -0.34, 0.0); g.stroke()
  // four limbs
  g.beginPath(); g.moveTo(0.12, 0.02); g.lineTo(0.2, 0.16); g.moveTo(0.12, -0.02); g.lineTo(0.2, -0.16); g.stroke()
  g.beginPath(); g.moveTo(-0.14, 0.02); g.lineTo(-0.22, 0.15); g.moveTo(-0.14, -0.02); g.lineTo(-0.22, -0.15); g.stroke()
  // toes
  g.lineWidth = 0.018
  for (const [bx, by, s] of [[0.2, 0.16, 1], [0.2, -0.16, -1], [-0.22, 0.15, 1], [-0.22, -0.15, -1]]) {
    g.beginPath()
    g.moveTo(bx, by); g.lineTo(bx + 0.03, by + 0.05 * s)
    g.moveTo(bx, by); g.lineTo(bx + 0.06, by + 0.03 * s)
    g.stroke()
  }
  // eye near the head
  g.lineWidth = 0.03
  g.beginPath(); g.arc(0.3, -0.05, 0.045, 0, 6.28); g.fill()
}

// --- render ------------------------------------------------------------------
const buf = document.createElement('canvas')
const bx = buf.getContext('2d')
let randTones = PALS['Day & Night']
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
function tones() { return params.palette === 'Random' ? randTones : (PALS[params.palette] ?? PALS['Day & Night']) }

function renderPattern() {
  motif = MOTIFS[params.motif] ?? MOTIFS.Birds
  const T = tones()
  // ink candidates: the lightest and darkest tones, for contrast on any base
  let darkI = 0, lightI = 0
  for (let i = 1; i < T.length; i++) { if (lum(T[i]) < lum(T[darkI])) darkI = i; if (lum(T[i]) > lum(T[lightI])) lightI = i }
  bx.setTransform(1, 0, 0, 1, 0, 0)
  bx.fillStyle = T[0]; bx.fillRect(0, 0, D, D)
  const tiles = buildTiling(params.scale * PR)
  for (const t of tiles) {
    const base = T[t.cls % T.length]
    const ink = lum(base) > 0.5 ? T[darkI] : T[lightI]
    const path = buildPath(t.poly)
    bx.fillStyle = base; bx.fill(path)
    if (params.outline) { bx.strokeStyle = T[darkI]; bx.lineWidth = Math.max(1, PR * 1.1); bx.lineJoin = 'round'; bx.stroke(path) }
    if (params.features && motif.feat) {
      bx.save(); bx.clip(path)
      bx.translate(t.cx, t.cy); bx.rotate(t.orient); bx.scale(t.size, t.size)
      motif.feat(bx, ink)
      bx.restore()
    }
  }
}

function key() {
  return [params.motif, params.palette, params.scale, params.plump, params.features, params.outline, rt.seed, W, H, PR].join('|')
}

function frame(now) {
  rt.tick(now)
  if (params.palette === 'Random' && prevPalette !== 'Random') {
    const h = rt.random(0, 360)
    randTones = [`hsl(${h | 0},28%,86%)`, `hsl(${(h + 200) | 0},40%,18%)`, `hsl(${(h + 130) | 0},45%,46%)`]
    lastKey = ''
  }
  prevPalette = params.palette
  const k = key()
  if (k !== lastKey) { renderPattern(); lastKey = k }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = tones()[0]
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
