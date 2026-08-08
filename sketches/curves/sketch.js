// Curves — a Photoshop-style curves colour corrector for a live source. Drag
// control points on the on-canvas graph to reshape the tone response; pick the
// RGB master or an individual R / G / B channel with the tabs. Each channel's
// points are fitted with a smooth monotone spline into a 256-entry lookup table,
// so the whole grade is a single table read per channel. A luminance histogram
// sits behind the curve so you can see what you're pushing.
//
// Editing (on the graph): click empty space to add a point, drag a point to move
// it, double-click a point (or drag it off the top/bottom) to delete it. The two
// end points can only move up/down. Contrast, brightness and amount are also live
// sliders (mappable) that compose on top of the hand-drawn master curve.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const preview = new URLSearchParams(location.search).get('preview') === '1'

const CHANS = ['RGB', 'Red', 'Green', 'Blue']
const KEY = { RGB: 'rgb', Red: 'r', Green: 'g', Blue: 'b' }
const params = rt.params({
  channel: { value: 'RGB', type: 'select', options: CHANS, label: 'Channel' },
  contrast: { value: 0, min: -1, max: 1, step: 0.02, label: 'Contrast' },
  brightness: { value: 0, min: -1, max: 1, step: 0.02, label: 'Brightness' },
  amount: { value: 1, min: 0, max: 1, step: 0.02, label: 'Amount' },
  showEditor: { value: true, type: 'bool', label: 'Show curve editor' },
  histogram: { value: true, type: 'bool', label: 'Histogram' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
  reset: { type: 'action', label: 'Reset all curves' },
})

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })

// per-channel control points, x & y in 0..1, sorted by x; identity by default
const curves = { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }
rt.onAction('reset', () => { for (const k of Object.keys(curves)) curves[k] = [[0, 0], [1, 1]] })

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// --- monotone cubic (Fritsch–Carlson): smooth curve with no overshoot ---
function fit(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0])
  const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1])
  const m = [], t = new Array(n)
  for (let i = 0; i < n - 1; i++) m[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0 }
    else { const a = t[i] / m[i], b = t[i + 1] / m[i], h = Math.hypot(a, b); if (h > 3) { const s = 3 / h; t[i] = s * a * m[i]; t[i + 1] = s * b * m[i] } }
  }
  return { xs, ys, t, n }
}
function evalFit(f, x) {
  const { xs, ys, t, n } = f
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let k = 0; while (k < n - 1 && x > xs[k + 1]) k++
  const h = xs[k + 1] - xs[k], s = (x - xs[k]) / h, s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * ys[k] + (s3 - 2 * s2 + s) * h * t[k] + (-2 * s3 + 3 * s2) * ys[k + 1] + (s3 - s2) * h * t[k + 1]
}
// programmatic tone from the contrast/brightness sliders, folded into the master
function tone(x) {
  let y = x + params.brightness * 0.4
  y = (y - 0.5) * (1 + params.contrast * 1.1) + 0.5
  return clamp01(y)
}

// composed final LUTs: per-channel curve → master curve → tone → amount blend
const finalR = new Uint8ClampedArray(256), finalG = new Uint8ClampedArray(256), finalB = new Uint8ClampedArray(256)
const handLUT = { rgb: new Float32Array(256), r: new Float32Array(256), g: new Float32Array(256), b: new Float32Array(256) }
function buildLUTs() {
  for (const k of Object.keys(curves)) { const f = fit(curves[k]); for (let i = 0; i < 256; i++) handLUT[k][i] = clamp01(evalFit(f, i / 255)) }
  const am = params.amount
  const master = (v01) => tone(handLUT.rgb[Math.round(clamp01(v01) * 255)])
  for (let i = 0; i < 256; i++) {
    finalR[i] = (i + (master(handLUT.r[i]) * 255 - i) * am) + 0.5
    finalG[i] = (i + (master(handLUT.g[i]) * 255 - i) * am) + 0.5
    finalB[i] = (i + (master(handLUT.b[i]) * 255 - i) * am) + 0.5
  }
}

let W = 0, H = 0, PR = 1, bw = 0, bh = 0
const hist = new Float32Array(256)
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  const cap = 720, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}

// --- editor geometry (device px) ---
function graphRect() {
  const M = 16 * PR
  const g = Math.min(W * 0.4, H * 0.42, 340 * PR)
  const tabH = 22 * PR
  const gx = M + 10 * PR, gy = H - M - g
  return { g, tabH, gx, gy, panelX: M, panelY: gy - tabH - 8 * PR, panelW: g + 20 * PR, panelH: g + tabH + 18 * PR }
}
const toScreen = (R, px, py) => [R.gx + px * R.g, R.gy + (1 - py) * R.g]
const toGraph = (R, sx, sy) => [clamp01((sx - R.gx) / R.g), clamp01(1 - (sy - R.gy) / R.g)]

function drawEditor() {
  const R = graphRect()
  const key = KEY[params.channel]
  ctx.save()
  // panel
  ctx.fillStyle = 'rgba(12,14,20,0.78)'
  roundRect(R.panelX, R.panelY, R.panelW, R.panelH, 8 * PR); ctx.fill()
  // channel tabs
  const tw = R.g / 4
  ctx.font = `${Math.round(11 * PR)}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
  const tabCol = ['#e8ecf5', '#ff6b6b', '#5bd66b', '#5aa0ff']
  for (let i = 0; i < 4; i++) {
    const x = R.gx + i * tw, on = params.channel === CHANS[i]
    ctx.fillStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)'
    roundRect(x + 2 * PR, R.panelY + 4 * PR, tw - 4 * PR, R.tabH - 4 * PR, 4 * PR); ctx.fill()
    ctx.fillStyle = on ? tabCol[i] : 'rgba(200,208,222,0.6)'
    ctx.fillText(['RGB', 'R', 'G', 'B'][i], x + tw / 2, R.panelY + R.tabH / 2 + 1 * PR)
  }
  // graph frame + grid
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(R.gx, R.gy, R.g, R.g)
  // histogram
  if (params.histogram) {
    let mx = 1; for (let i = 0; i < 256; i++) if (hist[i] > mx) mx = hist[i]
    ctx.fillStyle = 'rgba(150,165,190,0.28)'
    for (let i = 0; i < 256; i++) { const h = (Math.log1p(hist[i]) / Math.log1p(mx)) * R.g; ctx.fillRect(R.gx + (i / 255) * R.g, R.gy + R.g - h, Math.max(1, R.g / 256), h) }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1 * PR
  for (let i = 1; i < 4; i++) { const f = i / 4; ctx.beginPath(); ctx.moveTo(R.gx + f * R.g, R.gy); ctx.lineTo(R.gx + f * R.g, R.gy + R.g); ctx.moveTo(R.gx, R.gy + f * R.g); ctx.lineTo(R.gx + R.g, R.gy + f * R.g); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(R.gx, R.gy + R.g); ctx.lineTo(R.gx + R.g, R.gy); ctx.stroke() // identity diagonal
  // curve line for the active channel
  const chCol = { rgb: '#f2f5fb', r: '#ff6b6b', g: '#5bd66b', b: '#5aa0ff' }[key]
  ctx.strokeStyle = chCol; ctx.lineWidth = 2 * PR; ctx.beginPath()
  for (let i = 0; i <= 128; i++) { const x = i / 128, y = handLUT[key][Math.round(x * 255)]; const [sx, sy] = toScreen(R, x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy) }
  ctx.stroke()
  // control points
  for (let i = 0; i < curves[key].length; i++) {
    const [sx, sy] = toScreen(R, curves[key][i][0], curves[key][i][1])
    const active = drag && drag.key === key && drag.i === i
    ctx.beginPath(); ctx.arc(sx, sy, (active ? 6 : 4.5) * PR, 0, Math.PI * 2)
    ctx.fillStyle = active ? '#fff' : chCol; ctx.fill()
    ctx.lineWidth = 1.5 * PR; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke()
  }
  ctx.restore()
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

// --- editing (pointer) ---
let drag = null // { key, i, off }
function evPos(e) { const rc = canvas.getBoundingClientRect(); return [(e.clientX - rc.left) / rc.width * W, (e.clientY - rc.top) / rc.height * H] }
function onDown(e) {
  if (!params.showEditor) return
  const [x, y] = evPos(e)
  const R = graphRect()
  // channel tabs
  if (y >= R.panelY && y <= R.panelY + R.tabH && x >= R.gx && x <= R.gx + R.g) {
    const i = Math.max(0, Math.min(3, Math.floor((x - R.gx) / (R.g / 4))))
    rt.setParams({ channel: CHANS[i] }); e.preventDefault(); return
  }
  if (x < R.gx - 10 * PR || x > R.gx + R.g + 10 * PR || y < R.gy - 10 * PR || y > R.gy + R.g + 10 * PR) return
  const key = KEY[params.channel], pts = curves[key]
  // grab an existing point?
  for (let i = 0; i < pts.length; i++) { const [sx, sy] = toScreen(R, pts[i][0], pts[i][1]); if (Math.hypot(sx - x, sy - y) < 12 * PR) { drag = { key, i, off: false }; e.preventDefault(); return } }
  // else add a point at this x
  const [gx, gy] = toGraph(R, x, y)
  let idx = pts.findIndex((p) => p[0] > gx); if (idx < 0) idx = pts.length
  pts.splice(idx, 0, [gx, gy])
  drag = { key, i: idx, off: false }
  e.preventDefault()
}
function onMove(e) {
  if (!drag) return
  const [x, y] = evPos(e)
  const R = graphRect()
  const pts = curves[drag.key], p = pts[drag.i]
  let [gx, gy] = toGraph(R, x, y)
  const isEnd = drag.i === 0 || drag.i === pts.length - 1
  if (isEnd) gx = p[0] // end points keep their x
  else {
    const lo = pts[drag.i - 1][0] + 0.005, hi = pts[drag.i + 1][0] - 0.005
    gx = Math.max(lo, Math.min(hi, gx))
    // pulled far off the top/bottom → mark for deletion on release
    drag.off = (y < R.gy - 34 * PR || y > R.gy + R.g + 34 * PR)
  }
  p[0] = gx; p[1] = gy
  e.preventDefault()
}
function onUp() {
  if (!drag) return
  const pts = curves[drag.key]
  if (drag.off && drag.i > 0 && drag.i < pts.length - 1) pts.splice(drag.i, 1)
  drag = null
}
function onDbl(e) {
  if (!params.showEditor) return
  const [x, y] = evPos(e); const R = graphRect(); const pts = curves[KEY[params.channel]]
  for (let i = 1; i < pts.length - 1; i++) { const [sx, sy] = toScreen(R, pts[i][0], pts[i][1]); if (Math.hypot(sx - x, sy - y) < 12 * PR) { pts.splice(i, 1); e.preventDefault(); return } }
}
canvas.addEventListener('pointerdown', onDown)
window.addEventListener('pointermove', onMove)
window.addEventListener('pointerup', onUp)
canvas.addEventListener('dblclick', onDbl)

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  buildLUTs()
  const img = bctx.getImageData(0, 0, bw, bh)
  const d = img.data
  hist.fill(0)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    hist[(r * 0.299 + g * 0.587 + b * 0.114) | 0]++
    d[i] = finalR[r]; d[i + 1] = finalG[g]; d[i + 2] = finalB[b]
  }
  bctx.putImageData(img, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)

  if (params.showEditor) drawEditor()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
