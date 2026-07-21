// Lava Lamp — buoyant wax blobs rise and sink in a warm glass column: a
// metaball field is threshold-rendered so blobs merge and split with gooey
// necks, heated at the base (they expand and rise) and cooled at the top
// (they flatten and sink). Click nudges a blob; beats warm the lamp.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// low-res field for the metaball threshold, scaled up
const fc = document.createElement('canvas')
const fx = fc.getContext('2d')

const params = rt.params({
  blobs: { value: 7, min: 3, max: 16, step: 1, label: 'Blobs' },
  heat: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Heat' },
  viscosity: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Viscosity' },
  hue: { value: 20, min: 0, max: 360, step: 1, label: 'Wax hue' },
  bgHue: { value: 280, min: 0, max: 360, step: 1, label: 'Glass hue' },
  glow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Glow' },
})
rt.mapInput('audio.level', 'heat', 0.5)

let W = 0, H = 0, FW = 0, FH = 0
let blobs = []
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  // Higher-res metaball field — capped so retina/4K doesn't explode the
  // per-pixel × per-blob loop, but far crisper than the old 1/8 grid.
  const cap = 560
  const s = Math.min(1, cap / Math.max(W, H))
  FW = fc.width = Math.max(120, Math.round(W * s))
  FH = fc.height = Math.max(180, Math.round(H * s))
  init()
}
function init() {
  blobs = []
  const n = Math.round(params.blobs)
  for (let i = 0; i < n; i++) blobs.push({ x: rt.random(0.2, 0.8), y: rt.random(0.1, 0.9), r: rt.random(0.05, 0.11), vy: 0, vx: 0, temp: rt.random(0, 1) })
}
canvas.addEventListener('pointerdown', (e) => {
  const px = e.clientX / window.innerWidth, py = e.clientY / window.innerHeight
  for (const b of blobs) { const d = Math.hypot(b.x - px, b.y - py); if (d < 0.15) b.vy -= 0.4 }
})
let warm = 0
rt.onBeat(({ energy }) => { warm = 0.3 + energy * 0.4 })
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  if (Math.round(params.blobs) !== blobs.length) init()
  warm = Math.max(0, warm - dt)

  // physics: heat at base (y~1) warms blobs → they rise; cool at top
  for (const b of blobs) {
    const nearBase = Math.max(0, b.y - 0.6) / 0.4
    const nearTop = Math.max(0, 0.4 - b.y) / 0.4
    b.temp += (nearBase * (1.2 + warm) * params.heat - nearTop * 0.9 - 0.15) * dt
    b.temp = Math.max(0, Math.min(1.4, b.temp))
    // buoyancy: hot rises (negative y velocity)
    const buoy = (b.temp - 0.55) * -0.35 * params.heat
    b.vy += buoy * dt
    b.vy *= 1 - 0.9 * dt / params.viscosity
    b.vx += Math.sin(t * 0.5 + b.y * 6) * 0.02 * dt
    b.vx *= 1 - 1.2 * dt
    b.y += b.vy * dt
    b.x += b.vx * dt
    // soft walls
    if (b.y < 0.06) { b.y = 0.06; b.vy = Math.abs(b.vy) * 0.3 }
    if (b.y > 0.94) { b.y = 0.94; b.vy = -Math.abs(b.vy) * 0.3 }
    if (b.x < 0.08) { b.x = 0.08; b.vx = Math.abs(b.vx) * 0.5 }
    if (b.x > 0.92) { b.x = 0.92; b.vx = -Math.abs(b.vx) * 0.5 }
    // hot blobs swell
    b.rr = b.r * (0.85 + b.temp * 0.4)
  }

  // render metaball field at low res
  const img = fx.createImageData(FW, FH)
  const d = img.data
  const waxR = [255, 140, 40], waxHue = params.hue
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      let f = 0
      const nx = x / FW, ny = y / FH
      for (const b of blobs) {
        const dx = (nx - b.x), dy = (ny - b.y)
        f += (b.rr * b.rr) / (dx * dx + dy * dy + 0.0004)
      }
      const i = (y * FW + x) * 4
      // Anti-aliased threshold: a soft coverage ramp across the boundary
      // reads as a smooth high-res edge even at a modest field size, instead
      // of the old hard pixelated cutoff.
      if (f > 1.05) {
        const cov = Math.min(1, (f - 1.05) * 3.0) // 0 at rim → 1 inside
        const lit = Math.min(1, (f - 1.3) * 0.25)
        const hue = (waxHue + lit * 20) % 360
        const rgb = hslRgb(hue / 360, 0.9, 0.36 + lit * 0.38)
        d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.round(cov * 255)
      } else {
        d[i + 3] = 0
      }
    }
  }
  fx.putImageData(img, 0, 0)

  // glass column background
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `hsl(${params.bgHue}, 60%, 8%)`)
  g.addColorStop(0.5, `hsl(${params.bgHue}, 70%, 16%)`)
  g.addColorStop(1, `hsl(${(params.bgHue + 30) % 360}, 80%, 10%)`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // base heat glow
  const bg = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.5)
  bg.addColorStop(0, `hsla(${params.hue}, 100%, 55%, ${0.25 + warm})`)
  bg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  ctx.imageSmoothingEnabled = true
  if (params.glow > 0.01) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = params.glow * 0.6
    ctx.filter = `blur(${8 * rt.pixelRatio}px)`
    ctx.drawImage(fc, 0, 0, W, H)
    ctx.filter = 'none'; ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.drawImage(fc, 0, 0, W, H)
  // glass highlight
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(W * 0.2, 0, W * 0.08, H)
  requestAnimationFrame(frame)
}
function hslRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  return [f(0), f(8), f(4)]
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
