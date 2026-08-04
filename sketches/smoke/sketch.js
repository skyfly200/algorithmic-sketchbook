// Smoke — a rising plume advected by curl noise. Particles pour off a source,
// get carried by a swirling, divergence-free-ish flow field plus buoyant rise
// and wind, then swell and thin out as they climb. Each is a soft blob; stacked
// they read as a curling column of smoke. Grey, white, or tinted; a beat sends
// up a puff. Drag to steer the source.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  emission: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Emission' },
  rise: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Rise' },
  turbulence: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Turbulence' },
  wind: { value: 0.1, min: -1, max: 1, step: 0.02, label: 'Wind' },
  spread: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: 'Source width' },
  life: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Persistence' },
  density: { value: 0.7, min: 0.2, max: 1.5, step: 0.05, label: 'Density' },
  tint: { value: 0, min: 0, max: 360, step: 1, label: 'Tint (0 = grey)' },
})
rt.mapInput('audio.volume', 'emission', 0.6)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
let srcX = 0.5, srcY = 0.92, tSrcX = 0.5, tSrcY = 0.92
const P = []
const MAX = 2600
let emitAcc = 0

// cheap scalar noise → curl (rotate the gradient 90°) gives a swirling,
// low-divergence flow that curls smoke instead of blowing it straight.
function noise(x, y, t) {
  return Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7)
    + 0.5 * Math.sin(x * 3.1 - t * 1.3) * Math.cos(y * 2.7 + t * 0.5)
}
function curl(x, y, t) {
  const e = 0.15
  const nx = (noise(x, y + e, t) - noise(x, y - e, t)) / (2 * e)
  const ny = (noise(x + e, y, t) - noise(x - e, y, t)) / (2 * e)
  return [ny, -nx] // perpendicular to gradient → divergence-free curl
}

const sprite = document.createElement('canvas')
sprite.width = sprite.height = 64
let lastTint = -1
function buildSprite(tint) {
  const g = sprite.getContext('2d')
  g.clearRect(0, 0, 64, 64)
  const c = tint < 0.5 ? [235, 238, 244] : hsl(tint, 55, 72)
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  rg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.5)`)
  rg.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},0.14)`)
  rg.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64)
  lastTint = tint
}
function hsl(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
buildSprite(0)

function spawn(n, burst) {
  const sw = params.spread * W * 0.06
  for (let i = 0; i < n; i++) {
    const p = P.length < MAX ? {} : P[(Math.random() * P.length) | 0]
    p.x = srcX * W + rt.random(-1, 1) * sw
    p.y = srcY * H + rt.random(-1, 1) * sw * 0.4
    p.vx = rt.random(-1, 1) * 8 * PR
    p.vy = (burst ? rt.random(-120, -70) : rt.random(-58, -30)) * PR
    p.life = p.max = rt.random(2.5, 5.5) * params.life
    p.sz = rt.random(0.5, 1.3)
    p.rot = rt.random(0, TAU)
    p.seed = rt.random(0, 100)
    if (P.length < MAX) P.push(p)
  }
}
rt.onBeat(({ energy }) => spawn(40 + (energy * 80 | 0), true))

window.addEventListener('pointermove', (e) => {
  if (e.buttons) { tSrcX = e.clientX / window.innerWidth; tSrcY = e.clientY / window.innerHeight }
})

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now
  srcX += (tSrcX - srcX) * 0.1; srcY += (tSrcY - srcY) * 0.1

  emitAcc += params.emission * 42 * dt
  const em = emitAcc | 0; emitAcc -= em
  if (em > 0) spawn(em, false)

  if (params.tint !== lastTint) buildSprite(params.tint)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#0a0b0e'
  ctx.fillRect(0, 0, W, H)

  const turb = params.turbulence, rise = params.rise, wind = params.wind * 26 * PR
  const minDim = Math.min(W, H)
  // Normal blend, not additive: overlapping soft grey blobs build toward opaque
  // smoke instead of blowing out to white like a light source.
  ctx.globalCompositeOperation = 'source-over'
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]
    const [cx, cy] = curl(p.x / minDim * 3, p.y / minDim * 3, t * 0.5 + p.seed)
    p.vx += (cx * turb * 45 * PR + wind) * dt
    p.vy += (cy * turb * 30 * PR - rise * 46 * PR) * dt
    p.vx *= 0.985; p.vy *= 0.99   // keep buoyant momentum so a tall column forms
    p.x += p.vx * dt; p.y += p.vy * dt
    p.life -= dt
    if (p.life <= 0 || p.y < -H * 0.1) { P.splice(i, 1); continue }
    const a = p.life / p.max
    const fade = a * (1 - a) * 4              // fade in then out
    const sz = p.sz * (1 + (1 - a) * 2.6) * minDim * 0.06
    ctx.globalAlpha = Math.min(0.4, fade * 0.09 * params.density)
    ctx.drawImage(sprite, p.x - sz, p.y - sz, sz * 2, sz * 2)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
