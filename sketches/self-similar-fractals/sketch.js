/**
 * Self-Similar Fractals — three classic self-similar figures that repeat their
 * own shape at every scale. The Sierpinski triangle recursively removes the
 * middle of each triangle; the Koch snowflake pushes a bump out of the middle
 * of every edge, forever; and the Barnsley fern is drawn by the chaos game —
 * hundreds of thousands of dots, each mapped from the last by one of four affine
 * transforms — growing a fern frond by frond. Pick a figure, a depth (or watch
 * the fern fill in), a palette, and spin the whole thing. Rendered once to a
 * buffer and blitted so it stays crisp while it turns.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PALS = {
  Emerald: { base: 135, span: 60 },
  Fire: { base: 6, span: 46 },
  Ice: { base: 188, span: 55 },
  Gold: { base: 42, span: 24 },
  Violet: { base: 268, span: 64 },
  Rainbow: { rainbow: true },
  Mono: { mono: true },
}
const params = rt.params({
  fractal: { value: 'Sierpinski triangle', type: 'select', options: ['Sierpinski triangle', 'Koch snowflake', 'Barnsley fern'], label: 'Figure' },
  depth: { value: 6, min: 1, max: 11, step: 1, label: 'Recursion depth' },
  zoom: { value: 1, min: 1, max: 50, step: 0.5, label: 'Zoom' },
  palette: { value: 'Emerald', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  spin: { value: 6, min: -60, max: 60, step: 1, label: 'Spin (°/s)' },
  angle: { value: 0, min: 0, max: 360, step: 1, label: 'Rotation' },
})

const TAU = Math.PI * 2, DEG = Math.PI / 180
const buf = document.createElement('canvas')
const bx = buf.getContext('2d')
let W = 0, H = 0, D = 0, PR = 1
let randPal = { base: 200, span: 60 }

function palDef() { return params.palette === 'Random' ? randPal : (PALS[params.palette] ?? PALS.Emerald) }
function pcol(tt, l, a = 1) {
  const p = palDef()
  if (p.mono) return `hsla(0,0%,${l}%,${a})`
  if (p.rainbow) return `hsla(${(tt * 360) % 360},80%,${l}%,${a})`
  return `hsla(${p.base + tt * p.span},76%,${l}%,${a})`
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  D = Math.ceil(Math.hypot(W, H))
  buf.width = D; buf.height = D
  lastKey = ''
}

// --- Sierpinski triangle: recursive corner sub-triangles --------------------
function sierp(g, p1, p2, p3, d) {
  if (d === 0) {
    const tt = 1 - ((p1[1] + p2[1] + p3[1]) / 3) / D
    g.fillStyle = pcol(tt, 55, 1)
    g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath(); g.fill()
    return
  }
  const m12 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
  const m23 = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2]
  const m31 = [(p3[0] + p1[0]) / 2, (p3[1] + p1[1]) / 2]
  sierp(g, p1, m12, m31, d - 1)
  sierp(g, m12, p2, m23, d - 1)
  sierp(g, m31, m23, p3, d - 1)
}

// --- Koch snowflake: recursive edge bumps -----------------------------------
function kochEdge(ax, ay, bx2, by2, d, out) {
  if (d === 0) { out.push([bx2, by2]); return }
  const dx = (bx2 - ax) / 3, dy = (by2 - ay) / 3
  const x1 = ax + dx, y1 = ay + dy
  const x2 = ax + 2 * dx, y2 = ay + 2 * dy
  const seg = Math.hypot(dx, dy)
  const ang = Math.atan2(by2 - ay, bx2 - ax) - Math.PI / 3
  const px = x1 + Math.cos(ang) * seg, py = y1 + Math.sin(ang) * seg
  kochEdge(ax, ay, x1, y1, d - 1, out)
  kochEdge(x1, y1, px, py, d - 1, out)
  kochEdge(px, py, x2, y2, d - 1, out)
  kochEdge(x2, y2, bx2, by2, d - 1, out)
}
function koch(g, d, R = D * 0.4) {
  const cx = D / 2, cy = D / 2
  const v = []
  for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * TAU / 3; v.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]) }
  const out = [v[0]]
  for (let k = 0; k < 3; k++) kochEdge(v[k][0], v[k][1], v[(k + 1) % 3][0], v[(k + 1) % 3][1], d, out)
  g.beginPath(); g.moveTo(out[0][0], out[0][1])
  for (let i = 1; i < out.length; i++) g.lineTo(out[i][0], out[i][1])
  g.closePath()
  const gr = g.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.05)
  gr.addColorStop(0, pcol(0.1, 62, 0.9)); gr.addColorStop(0.7, pcol(0.6, 48, 0.75)); gr.addColorStop(1, pcol(1, 40, 0.6))
  g.fillStyle = gr; g.fill()
  g.strokeStyle = pcol(0.15, 82, 0.95); g.lineWidth = Math.max(1, PR * 1.1); g.lineJoin = 'round'; g.stroke()
}

// --- Barnsley fern: the chaos game, accumulated over frames -----------------
let fx = 0, fy = 0, fcount = 0
// point target grows with zoom so the fern keeps its density when magnified
function fernTarget() { return Math.min(900000, Math.round(240000 * Math.sqrt(params.zoom))) }
function fernReset() { fx = 0; fy = 0; fcount = 0 }
function fernStep(g, iter) {
  g.globalCompositeOperation = 'lighter'
  const z = params.zoom
  const sX = D * 0.088 * z, sY = D * 0.092 * z, ox = D / 2, oy = D / 2 + 5.27 * sY // zoom toward the fern body
  const ps = Math.max(PR, PR * Math.min(3, Math.sqrt(z) * 0.7)) // fatten points when zoomed to hide gaps
  for (let i = 0; i < iter; i++) {
    const r = rt.rng()
    let nx, ny
    if (r < 0.01) { nx = 0; ny = 0.16 * fy }
    else if (r < 0.86) { nx = 0.85 * fx + 0.04 * fy; ny = -0.04 * fx + 0.85 * fy + 1.6 }
    else if (r < 0.93) { nx = 0.2 * fx - 0.26 * fy; ny = 0.23 * fx + 0.22 * fy + 1.6 }
    else { nx = -0.15 * fx + 0.28 * fy; ny = 0.26 * fx + 0.24 * fy + 0.44 }
    fx = nx; fy = ny
    const px = ox + fx * sX, py = oy - fy * sY
    if (px < -8 || px > D + 8 || py < -8 || py > D + 8) continue // cull off-buffer when zoomed
    const tt = fy / 10
    g.fillStyle = pcol(0.3 + tt * 0.55, 40 + tt * 22, 0.5)
    g.fillRect(px, py, ps, ps)
  }
  g.globalCompositeOperation = 'source-over'
  fcount += iter
}

// deeper recursion as you zoom in, so magnifying reveals crisp new structure
// rather than pixels; capped per figure to keep the one-time render tractable.
function effDepth(cap) { return Math.min(cap, Math.round(params.depth) + Math.floor(Math.log2(Math.max(1, params.zoom)))) }

function renderStatic() {
  bx.setTransform(1, 0, 0, 1, 0, 0)
  bx.clearRect(0, 0, D, D)
  if (params.fractal === 'Sierpinski triangle') {
    const cx = D / 2, cy = D / 2, R = D * 0.46 * params.zoom
    const v = []
    for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * TAU / 3; v.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]) }
    sierp(bx, v[0], v[1], v[2], effDepth(12))
  } else if (params.fractal === 'Koch snowflake') {
    koch(bx, effDepth(7), D * 0.4 * params.zoom)
  } else {
    fernReset() // fern fills in progressively in frame()
  }
}

function key() { return [params.fractal, params.depth, params.zoom, params.palette, W, H, PR].join('|') }
let lastKey = '', rot = 0, prevPalette = '', last = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now
  rot += params.spin * dt
  if (params.palette === 'Random' && prevPalette !== 'Random') { randPal = { base: rt.random(0, 360), span: rt.random(30, 80) }; lastKey = '' }
  prevPalette = params.palette
  const k = key()
  if (k !== lastKey) { renderStatic(); lastKey = k }
  if (params.fractal === 'Barnsley fern' && fcount < fernTarget()) fernStep(bx, 4500)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((rot + params.angle) * DEG)
  ctx.drawImage(buf, -D / 2, -D / 2)
  ctx.restore()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
