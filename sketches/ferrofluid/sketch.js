/**
 * Ferrofluid Field — a puddle of magnetic fluid under a field. As the field
 * rises the surface goes unstable (the Rosensweig / normal-field instability)
 * and erupts into a lattice of glossy black spikes standing along the field
 * lines, tallest where the field is strongest. Move the mouse: it's a magnet
 * that drags the peaks up and toward it. Spikes are drawn as tapered specular
 * cones, sorted back-to-front over a dark reflective mound.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  field: { value: 0.6, min: 0, max: 1.2, step: 0.02, label: 'Field strength' },
  spikes: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Spike density' },
  magnet: { value: 0.7, min: 0, max: 2, step: 0.05, label: 'Magnet pull' },
  wobble: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Wobble' },
  hue: { value: +rt.random(0.55, 0.68).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Sheen hue' },
})
// Music: beats surge the field, loudness excites the wobble.
rt.mapInput('audio.pulse', 'field', 0.5)
rt.mapInput('audio.volume', 'wobble', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W, H, minDim, cx, cy, R
let sites = []
const mouse = { x: -1e4, y: -1e4, on: false }

function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return `rgb(${f(0)}, ${f(8)}, ${f(4)})`
}

function build() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  minDim = Math.min(W, H)
  cx = W / 2
  cy = H * 0.62
  R = minDim * 0.34
  // Hex lattice of spike sites filling the puddle disc.
  sites = []
  const step = (minDim * 0.05) / params.spikes
  const rowH = step * 0.866
  for (let y = -R, row = 0; y <= R; y += rowH, row++) {
    const xoff = row % 2 ? step / 2 : 0
    for (let x = -R; x <= R; x += step) {
      const px = x + xoff
      const rr = Math.hypot(px, y)
      if (rr > R) continue
      sites.push({ x: cx + px, y: cy + y, r: rr / R, ph: rt.random(0, 6.28), n: rt.random(0.7, 1.15) })
    }
  }
}
let builtSpikes = 1
function resize() {
  build()
  builtSpikes = params.spikes
}

function drawSpike(bx, by, h, w, lean, rim) {
  const tipx = bx + lean
  const tipy = by - h
  ctx.beginPath()
  ctx.moveTo(bx - w, by)
  ctx.quadraticCurveTo(bx - w * 0.5, by - h * 0.55, tipx, tipy)
  ctx.quadraticCurveTo(bx + w * 0.5, by - h * 0.55, bx + w, by)
  ctx.closePath()
  const g = ctx.createLinearGradient(bx, by, tipx, tipy)
  g.addColorStop(0, '#04060a')
  g.addColorStop(0.55, '#0a1018')
  g.addColorStop(1, rim)
  ctx.fillStyle = g
  ctx.fill()
  // Specular sheen down the left flank.
  ctx.beginPath()
  ctx.moveTo(bx - w * 0.72, by)
  ctx.quadraticCurveTo(bx - w * 0.4, by - h * 0.6, tipx - w * 0.08, tipy)
  ctx.strokeStyle = rim
  ctx.globalAlpha = 0.5
  ctx.lineWidth = Math.max(1, w * 0.16)
  ctx.stroke()
  ctx.globalAlpha = 1
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  lastNow = now
  if (params.spikes !== builtSpikes) resize()

  // Backdrop + reflective puddle mound.
  ctx.fillStyle = '#030407'
  ctx.fillRect(0, 0, W, H)
  const mound = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R * 1.15)
  mound.addColorStop(0, '#161d28')
  mound.addColorStop(0.6, '#0a0e15')
  mound.addColorStop(1, 'rgba(3,4,7,0)')
  ctx.fillStyle = mound
  ctx.beginPath()
  ctx.ellipse(cx, cy, R * 1.1, R * 0.62, 0, 0, Math.PI * 2)
  ctx.fill()

  const rim = hsl(params.hue, 0.7, 0.62)
  const field = params.field
  const maxH = minDim * 0.26
  const baseW = ((minDim * 0.05) / params.spikes) * 0.62

  // Compute each spike's height, then draw back-to-front.
  for (const s of sites) {
    // Field intensity: strong at centre, fades out; the mouse magnet adds a
    // sharp local boost and a lean toward the cursor.
    let inten = field * (1 - s.r * 0.8) * s.n
    s.lean = 0
    if (params.magnet > 0) {
      const dx = mouse.x - s.x
      const dy = mouse.y - s.y
      const md = Math.hypot(dx, dy)
      const boost = params.magnet * Math.exp(-((md / (minDim * 0.18)) ** 2))
      inten += boost
      if (md > 1) { s.lean = (dx / md) * boost * minDim * 0.04 }
    }
    inten += params.wobble * 0.12 * Math.sin(t * 3 + s.ph)
    s.h = Math.max(0, inten - 0.18) // threshold: below it the surface is still flat
  }
  sites.sort((a, b) => a.y - b.y)
  for (const s of sites) {
    if (s.h <= 0.01) continue
    const h = Math.min(maxH, s.h * maxH)
    const w = baseW * (0.7 + 0.5 * Math.min(1, s.h))
    drawSpike(s.x, s.y, h, w, s.lean || 0, rim)
  }

  requestAnimationFrame(frame)
}

canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX * rt.pixelRatio
  mouse.y = e.clientY * rt.pixelRatio
  mouse.on = true
})
canvas.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4 })
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
