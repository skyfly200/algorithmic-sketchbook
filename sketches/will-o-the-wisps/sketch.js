// Will-o'-the-Wisps: pale marsh lights drifting over a misty bog. Each wisp
// wanders on its own slow lissajous path with a flickering core and a fading trail.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  count: { value: 9, min: 1, max: 24, step: 1, label: 'Wisps' },
  speed: { value: 0.5, min: 0.02, max: 4, step: 0.01, label: 'Drift speed', scale: 'log' },
  size: { value: 1, min: 0.2, max: 5, step: 0.01, label: 'Glow size', scale: 'log' },
  trail: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Trail length' },
  flicker: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Flicker' },
  hue: { value: 150, min: 0, max: 360, step: 1, label: 'Hue' },
  fog: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Mist' },
  reeds: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Reeds' },
})
rt.mapInput('beat.pulse', 'size', 0.15)

const MAX = 24
const TRAIL = 40
let W = 0, H = 0
let bg = null // baked sky + water gradient + reeds
let glow = null // white radial sprite, tinted by drawing with 'lighter' + hsl layers
const fogBlobs = Array.from({ length: 7 }, (_, i) => ({
  x: Math.random(), y: 0.55 + Math.random() * 0.4, r: 0.25 + Math.random() * 0.3, k: 0.2 + Math.random() * 0.4, i,
}))
const wisps = Array.from({ length: MAX }, (_, i) => {
  const r = (a) => Math.sin(i * 12.9898 + a) * 43758.5453 % 1
  return {
    ax: 0.5 + Math.abs(r(1)) * 0.5, ay: 0.4 + Math.abs(r(2)) * 0.5,
    fx: 0.5 + Math.abs(r(3)) * 0.9, fy: 0.7 + Math.abs(r(4)) * 1.1,
    p0: r(5) * 6.28, p1: r(6) * 6.28, p2: r(7) * 6.28,
    cx: 0.15 + Math.abs(r(8)) * 0.7, cy: 0.5 + Math.abs(r(9)) * 0.3,
    sz: 0.6 + Math.abs(r(10)) * 0.8,
    trail: new Float32Array(TRAIL * 2), head: 0, filled: 0, last: 0,
  }
})

function makeSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.12, 'rgba(255,255,255,0.7)')
  gr.addColorStop(0.4, 'rgba(255,255,255,0.15)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return c
}

// Tinted copies of the sprite, rebuilt only when the hue changes.
let tinted = null, tintHue = -1
function tintedSprite(hue) {
  if (tinted && tintHue === hue) return tinted
  tinted = document.createElement('canvas')
  tinted.width = tinted.height = 128
  const g = tinted.getContext('2d')
  g.drawImage(glow, 0, 0)
  g.globalCompositeOperation = 'source-atop'
  g.fillStyle = `hsl(${hue}, 80%, 62%)`
  g.fillRect(0, 0, 128, 128)
  // keep a near-white hot centre
  g.globalCompositeOperation = 'lighter'
  g.globalAlpha = 0.6
  g.drawImage(glow, 32, 32, 64, 64)
  tintHue = hue
  return tinted
}

function bake() {
  bg = document.createElement('canvas')
  bg.width = W
  bg.height = H
  const g = bg.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#02040a')
  sky.addColorStop(0.55, '#07101a')
  sky.addColorStop(1, '#030806')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  // bare trees
  g.strokeStyle = 'rgba(2,4,6,0.9)'
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) / 6 * W + Math.sin(i * 7.3) * W * 0.05
    const h = H * (0.25 + 0.15 * Math.abs(Math.sin(i * 3.1)))
    g.lineWidth = Math.max(2, W * 0.004)
    g.beginPath(); g.moveTo(x, H * 0.62); g.lineTo(x + Math.sin(i) * 12, H * 0.62 - h); g.stroke()
    g.lineWidth = Math.max(1, W * 0.0018)
    for (let b = 0; b < 5; b++) {
      const by = H * 0.62 - h * (0.4 + b * 0.13)
      const d = (b % 2 ? 1 : -1) * h * 0.18
      g.beginPath(); g.moveTo(x, by); g.lineTo(x + d, by - h * 0.12); g.stroke()
    }
  }
  // ground
  g.fillStyle = '#020503'
  g.fillRect(0, H * 0.62, W, H * 0.38)
}

function drawReeds(a) {
  if (a <= 0.01) return
  ctx.strokeStyle = `rgba(1,3,2,${0.9 * a})`
  ctx.lineWidth = Math.max(1, W * 0.0015)
  const n = Math.floor(70 * a)
  const sway = rt.phase('sway', 0.6)
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = ((i * 0.6180339) % 1) * W
    const h = H * (0.08 + 0.1 * ((i * 0.381966) % 1))
    const y = H * (0.9 + 0.1 * ((i * 0.7548) % 1))
    const s = Math.sin(sway + i) * h * 0.1
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + s * 0.4, y - h * 0.5, x + s, y - h)
  }
  ctx.stroke()
}

function resize() {
  W = canvas.width = Math.max(1, Math.round(window.innerWidth * rt.pixelRatio))
  H = canvas.height = Math.max(1, Math.round(window.innerHeight * rt.pixelRatio))
  bake()
  for (const w of wisps) w.filled = 0
}

glow = makeSprite()
const fogPhase = (k) => rt.phase('fog' + k, 0.03)

function frame(now) {
  rt.tick(now)
  const n = Math.round(params.count)
  const unit = Math.min(W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(bg, 0, 0)

  const spr = tintedSprite(Math.round(params.hue))
  ctx.globalCompositeOperation = 'lighter'

  if (params.fog > 0.01) {
    for (const b of fogBlobs) {
      const ph = fogPhase(b.i) + b.i * 2
      const x = (b.x + Math.sin(ph) * 0.15) * W
      const y = b.y * H
      const r = b.r * W * 0.7
      ctx.globalAlpha = params.fog * b.k * 0.12
      ctx.drawImage(spr, x - r, y - r * 0.45, r * 2, r * 0.9)
    }
  }

  const boost = 1 + rt.beat.state.pulse * 0.5
  for (let i = 0; i < n; i++) {
    const w = wisps[i]
    const ph = rt.phase('w' + i, params.speed)
    const x = (w.cx + Math.sin(ph * w.fx + w.p0) * 0.28 * w.ax + Math.sin(ph * 0.37 + w.p2) * 0.08) * W
    const y = (w.cy + Math.sin(ph * w.fy + w.p1) * 0.2 * w.ay - Math.max(0, Math.sin(ph * 0.21 + w.p2)) * 0.08) * H
    const fl = 1 - params.flicker * (0.5 + 0.5 * Math.sin(ph * 23 + w.p0 * 3) * Math.sin(ph * 9.1 + w.p1))
    const r = unit * 0.05 * params.size * w.sz * boost * (0.85 + 0.15 * fl)

    // record the trail at a fixed spatial cadence so it doesn't depend on frame rate
    const dx = x - w.trail[w.head * 2], dy = y - w.trail[w.head * 2 + 1]
    if (!w.filled || dx * dx + dy * dy > (unit * 0.006) ** 2) {
      w.head = (w.head + 1) % TRAIL
      w.trail[w.head * 2] = x
      w.trail[w.head * 2 + 1] = y
      w.filled = Math.min(TRAIL, w.filled + 1)
    }
    const len = Math.round(w.filled * params.trail)
    for (let k = len - 1; k >= 1; k--) {
      const idx = (w.head - k + TRAIL * 2) % TRAIL
      const f = 1 - k / len
      const tr = r * (0.25 + 0.35 * f)
      ctx.globalAlpha = f * f * 0.35 * fl
      ctx.drawImage(spr, w.trail[idx * 2] - tr, w.trail[idx * 2 + 1] - tr, tr * 2, tr * 2)
    }
    // soft halo, then bright core
    ctx.globalAlpha = 0.55 * fl
    ctx.drawImage(spr, x - r * 3, y - r * 3, r * 6, r * 6)
    ctx.globalAlpha = Math.min(1, fl)
    ctx.drawImage(spr, x - r, y - r, r * 2, r * 2)

    // faint reflection in the bog
    ctx.globalAlpha = 0.18 * fl
    const ry = H * 0.62 + (H * 0.62 - y) * 0.15 + unit * 0.05
    if (y < H * 0.9) ctx.drawImage(spr, x - r * 1.5, ry - r * 0.4, r * 3, r * 0.8)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  drawReeds(params.reeds)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
