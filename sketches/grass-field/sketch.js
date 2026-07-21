// Grass Field — a meadow of thousands of blades bending in the wind: each
// blade is a tapered Bézier sway rooted at a ground point, driven by a
// travelling wind field (gusts roll across as visible waves), with depth
// haze, wildflowers, and a warm sky. Pointer parts the grass like a hand.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  density: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Density' },
  wind: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind strength' },
  gust: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Gustiness' },
  height: { value: 1, min: 0.5, max: 1.8, step: 0.05, label: 'Blade height' },
  hue: { value: 95, min: 40, max: 140, step: 1, label: 'Grass hue' },
  flowers: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Wildflowers' },
})
rt.mapInput('audio.level', 'wind', 0.6)
rt.mapInput('audio.pulse', 'gust', 0.4)

let W = 0, H = 0
let blades = []
let px_ = 2, py_ = 2, tpx = 2
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  build()
}
function build() {
  blades = []
  const n = Math.round(2600 * params.density * rt.detail)
  for (let i = 0; i < n; i++) {
    const depth = rt.rng() // 0 far … 1 near
    const y = H * (0.4 + depth * 0.62)
    blades.push({
      x: rt.random(-20, W + 20), y, depth,
      len: (40 + depth * 130) * rt.pixelRatio * params.height * rt.random(0.7, 1.2),
      w: (1.5 + depth * 4) * rt.pixelRatio,
      lean: rt.random(-0.2, 0.2), phase: rt.random(0, Math.PI * 2),
      hue: params.hue + rt.random(-18, 22), sat: 45 + rt.random(-8, 18),
      light: 22 + depth * 26 + rt.random(-6, 8),
      curl: rt.random(0.15, 0.5), // how much the blade arcs over toward its tip
      flip: rt.rng() < 0.5 ? 1 : -1, // which side the highlight sits on
      flower: rt.rng() < 0.04 ? { h: rt.random(0, 360), s: rt.random(3, 6) * rt.pixelRatio } : null,
    })
  }
  blades.sort((a, b) => a.depth - b.depth) // far first
}
window.addEventListener('pointermove', (e) => { tpx = e.clientX * rt.pixelRatio; py_ = e.clientY * rt.pixelRatio })
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  px_ += (tpx - px_) * 0.1
  if (Math.round(2600 * params.density * rt.detail) !== blades.length) build()

  // sky + ground gradient
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `hsl(${params.hue + 90}, 60%, 72%)`)
  g.addColorStop(0.4, `hsl(${params.hue + 60}, 55%, 60%)`)
  g.addColorStop(0.42, `hsl(${params.hue}, 45%, 30%)`)
  g.addColorStop(1, `hsl(${params.hue + 10}, 55%, 12%)`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  ctx.lineJoin = 'round'
  for (const b of blades) {
    // travelling wind wave across x + per-blade gust noise
    const wave = Math.sin(b.x * 0.006 - t * 2 * params.wind) * params.wind
    const gust = Math.sin(t * 1.3 * params.gust + b.phase) * params.gust * 0.6
    let bend = (wave + gust + b.lean) * (0.4 + b.depth) * 0.5
    // pointer parts nearby blades
    const dx = b.x - px_
    const near = Math.max(0, 1 - Math.abs(dx) / (120 * rt.pixelRatio)) * Math.max(0, 1 - Math.abs(b.y - py_) / (200 * rt.pixelRatio))
    bend += Math.sign(dx || 1) * near * 0.9

    // A blade is a tapered leaf: two edges from a wide base to a fine tip,
    // arcing over via the curl. The spine curves, the width shrinks to 0.
    const off = bend * b.len // horizontal tip displacement
    const tipX = b.x + off
    const tipY = b.y - b.len + Math.abs(off) * b.curl * 0.35 // arcing tips droop
    const cx = b.x + off * 0.45
    const cy = b.y - b.len * (0.55 - b.curl * 0.15)
    const hw = b.w * 0.6 // half-width at the base
    // outline: up the left edge (spine offset -hw) to the tip, back down the right
    const nx = -(cy - b.y), ny = (cx - b.x) // base normal (perp to spine start)
    const nl = Math.hypot(nx, ny) || 1
    const ox = (nx / nl) * hw, oy = (ny / nl) * hw
    const lit = Math.min(60, b.light + (bend * b.flip > 0 ? 20 : 2)) // wind-facing edge catches light
    const grad = ctx.createLinearGradient(b.x, b.y, tipX, tipY)
    grad.addColorStop(0, `hsl(${b.hue + 8}, ${b.sat}%, ${Math.max(8, b.light - 12)}%)`) // shaded base
    grad.addColorStop(0.6, `hsl(${b.hue}, ${b.sat}%, ${b.light}%)`)
    grad.addColorStop(1, `hsl(${b.hue - 8}, ${b.sat + 10}%, ${lit}%)`) // brighter, yellower tip
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(b.x - ox, b.y - oy)
    ctx.quadraticCurveTo(cx - ox * 0.5, cy, tipX, tipY)
    ctx.quadraticCurveTo(cx + ox * 0.5, cy, b.x + ox, b.y + oy)
    ctx.closePath()
    ctx.fill()
    // a thin bright rim on the lit edge for a blade-of-grass sheen
    if (bend * b.flip > 0.05) {
      ctx.strokeStyle = `hsla(${b.hue - 12}, 70%, ${lit + 12}%, 0.5)`
      ctx.lineWidth = Math.max(0.5, hw * 0.4)
      ctx.beginPath()
      ctx.moveTo(b.x - ox, b.y - oy)
      ctx.quadraticCurveTo(cx - ox * 0.5, cy, tipX, tipY)
      ctx.stroke()
    }
    if (b.flower && params.flowers > 0.05) {
      ctx.fillStyle = `hsl(${b.flower.h}, 80%, 70%)`
      ctx.beginPath(); ctx.arc(tipX, tipY, b.flower.s, 0, Math.PI * 2); ctx.fill()
    }
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
