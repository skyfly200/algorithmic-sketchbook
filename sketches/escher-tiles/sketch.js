/**
 * Escher Tiles — a generator of interlocking tessellations in the spirit of
 * M.C. Escher. It starts from a square (polygon) lattice, then replaces the
 * straight edges with arcs: each bump carved out of one edge is added to the
 * opposite edge, so every tile is identical and they lock together with no gaps
 * — the "translation" method Escher used for his bird and fish tilings. Two-,
 * four-tone or gradient colourings make the interlocking lobes pop, and an
 * optional eye motif hints at a creature. Static: it renders once and holds;
 * change a control (or the seed) to re-deal a new tiling.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PALS = {
  'Escher B/W': ['#15150f', '#f2efe5', '#9a968b', '#c9c5b8'],
  Woodcut: ['#2b1a10', '#e8d5b0', '#7a4a24', '#b07b45'],
  Ocean: ['#0b2b3a', '#dfeef2', '#2f7f96', '#8fc3ce'],
  Sunset: ['#3a1030', '#ffe6c0', '#c0417a', '#f2a25c'],
  Forest: ['#12240f', '#e6ecd0', '#3a6b2e', '#8fae5a'],
}
const params = rt.params({
  coloring: { value: 'Two-tone', type: 'select', options: ['Two-tone', 'Four-tone', 'Gradient', 'Outline'], label: 'Colouring' },
  palette: { value: 'Escher B/W', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  scale: { value: 82, min: 34, max: 220, step: 1, label: 'Tile size' },
  aspect: { value: 1, min: 0.5, max: 2, step: 0.02, label: 'Aspect' },
  lobes: { value: 2, min: 1, max: 4, step: 1, label: 'Arcs per edge' },
  bump: { value: 0.32, min: 0, max: 0.48, step: 0.01, label: 'Interlock depth' },
  wobble: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Irregularity' },
  outline: { value: true, type: 'bool', label: 'Outline' },
  motif: { value: false, type: 'bool', label: 'Eye motif' },
  angle: { value: 0, min: 0, max: 180, step: 1, label: 'Rotation' },
})

// --- seeded amplitudes for the edge arcs (stable per seed) ------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let ampsH = [], ampsV = [], ampsKey = ''
function ensureAmps(lobes) {
  const k = lobes + '|' + rt.seed
  if (k === ampsKey) return
  const rnd = mulberry32((rt.seed | 0) ^ 0x9e3779b9)
  ampsH = []; ampsV = []
  for (let i = 0; i < lobes; i++) { ampsH.push(rnd() * 2 - 1); ampsV.push(rnd() * 2 - 1) }
  ampsKey = k
}
// perpendicular offset along an edge at parameter t (arc = half-sine bump). Each
// lobe alternates in/out (uniform) blended with a per-lobe random amount.
function edgeOff(t, amps, lobes, bump, wobble, cell) {
  let seg = Math.floor(t * lobes); if (seg >= lobes) seg = lobes - 1
  const local = t * lobes - seg
  const uni = seg % 2 ? -1 : 1
  const a = uni * (1 - wobble) + amps[seg] * wobble
  return a * bump * cell * Math.sin(local * Math.PI)
}
// one tile's boundary as a point list. Bottom edge == top edge (same H curve),
// left == right (same V curve), so the tile tessellates by translation.
function tilePath(cw, ch, lobes, bump, wobble) {
  const N = 22, pts = []
  const H = (t) => edgeOff(t, ampsH, lobes, bump, wobble, ch)
  const V = (t) => edgeOff(t, ampsV, lobes, bump, wobble, cw)
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push([t * cw, H(t)]) }        // bottom
  for (let i = 1; i <= N; i++) { const t = i / N; pts.push([cw + V(t), t * ch]) }    // right
  for (let i = N - 1; i >= 0; i--) { const t = i / N; pts.push([t * cw, ch + H(t)]) } // top
  for (let i = N - 1; i >= 1; i--) { const t = i / N; pts.push([V(t), t * ch]) }      // left
  return pts
}

const buf = document.createElement('canvas')
const bx = buf.getContext('2d')
let W = 0, H = 0, D = 0, PR = 1
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

function colorFor(i, j, P) {
  const c = params.coloring
  if (c === 'Four-tone') return P[(i & 1) + 2 * (j & 1)]
  if (c === 'Gradient') {
    const h = (i * 17 + j * 31) % 360
    return `hsl(${h}, 45%, ${((i + j) & 1) ? 62 : 42}%)`
  }
  if (c === 'Outline') return P[1] // light fill, dark outline
  return P[(i + j) & 1] // Two-tone
}

function renderPattern() {
  const P = pal()
  const lobes = Math.round(params.lobes)
  ensureAmps(lobes)
  bx.setTransform(1, 0, 0, 1, 0, 0)
  bx.fillStyle = P[1]
  bx.fillRect(0, 0, D, D)

  const cw = params.scale * params.aspect * PR
  const ch = params.scale * PR
  const shape = tilePath(cw, ch, lobes, params.bump, params.wobble)
  const m = Math.ceil(Math.max(cw, ch) * (1 + params.bump)) // margin so bumps never clip
  const cols = Math.ceil(D / cw) + 3
  const rows = Math.ceil(D / ch) + 3
  bx.lineJoin = 'round'
  bx.lineWidth = Math.max(1, PR * 1.2)
  for (let j = -2; j < rows; j++) {
    for (let i = -2; i < cols; i++) {
      const ox = i * cw, oy = j * ch
      if (ox > D + m || oy > D + m) continue
      bx.save()
      bx.translate(ox, oy)
      bx.beginPath()
      bx.moveTo(shape[0][0], shape[0][1])
      for (let k = 1; k < shape.length; k++) bx.lineTo(shape[k][0], shape[k][1])
      bx.closePath()
      if (params.coloring !== 'Outline') { bx.fillStyle = colorFor(i, j, P); bx.fill() }
      if (params.outline || params.coloring === 'Outline') { bx.strokeStyle = P[0]; bx.stroke() }
      // a small eye near the tile's shoulder, to hint at a creature
      if (params.motif) {
        const ex = cw * 0.32, ey = ch * 0.42
        bx.fillStyle = params.coloring === 'Outline' ? P[0] : (colorFor(i, j, P) === P[0] ? P[1] : P[0])
        bx.beginPath(); bx.arc(ex, ey, Math.max(1.5, Math.min(cw, ch) * 0.05), 0, Math.PI * 2); bx.fill()
      }
      bx.restore()
    }
  }
}

function key() {
  return [params.coloring, params.palette, params.scale, params.aspect, params.lobes, params.bump, params.wobble, params.outline, params.motif, rt.seed, W, H, PR].join('|')
}

function frame(now) {
  rt.tick(now)
  if (params.palette === 'Random' && prevPalette !== 'Random') {
    const h = rt.random(0, 360)
    randPal = [`hsl(${h | 0},35%,16%)`, `hsl(${(h + 40) | 0},30%,90%)`, `hsl(${(h + 180) | 0},45%,45%)`, `hsl(${(h + 90) | 0},40%,65%)`]
    lastKey = ''
  }
  prevPalette = params.palette
  const k = key()
  if (k !== lastKey) { renderPattern(); lastKey = k }
  // blit the static tiling, rotated about the centre (live)
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
