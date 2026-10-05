/**
 * Star Field — the classic fly-through: stars stream out of a vanishing point
 * toward you, near ones sweeping past faster than far ones. Turn up Warp and the
 * points stretch into hyperspace streaks and the whole field accelerates; push
 * it and it tips into a full jump. Add a slow twist to barrel-roll the field,
 * pick a colour mode (white, temperature by depth, or rainbow), and let the
 * pointer steer where the stars come from. Beats fire a warp burst.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const COLORS = ['White', 'Temperature', 'Rainbow']
const params = rt.params({
  count: { value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'Star count' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.02, label: 'Speed' },
  warp: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Warp' },
  spread: { value: 1, min: 0.4, max: 2, step: 0.02, label: 'Spread' },
  twist: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Twist' },
  glow: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Glow' },
  colorMode: { value: 'Temperature', type: 'select', options: COLORS, label: 'Colour' },
  hue: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Hue' },
  // 0.5 = dead ahead (also what Patch shows, where default mappings start off).
  // The pointer mappings below are centred, so the pointer swings the vanishing
  // point both ways around this base across the whole screen.
  steerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Steer X' },
  steerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Steer Y' },
})
// Default mappings — the pointer steers the vanishing point, a beat kicks the
// warp, loudness pushes the speed, and the highs brighten the glow.
rt.mapInput('mouse.x', 'steerX', 1, { center: true })
rt.mapInput('mouse.y', 'steerY', 1, { center: true })
rt.mapInput('audio.pulse', 'warp', 0.5)
rt.mapInput('audio.volume', 'speed', 0.15)
rt.mapInput('audio.high', 'glow', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
let W = 0, H = 0, cx = 0, cy = 0
const MAXZ = 1

// star pool: normalised x,y in [-1,1] on the projection plane, z depth (0..1).
// prevScale caches last frame's projection so warp can draw a streak.
let stars = []
let poolSize = 0
function makeStar(s) {
  s.x = (Math.random() * 2 - 1) * 2
  s.y = (Math.random() * 2 - 1) * 2
  s.z = Math.random() * MAXZ
  s.pr = null // previous projected radius factor (reset trail)
}
function buildPool() {
  // scale target count by viewport area and the detail setting so a big screen
  // or a fast machine gets more stars without changing the feel.
  const area = (window.innerWidth * window.innerHeight) / (1280 * 720)
  poolSize = Math.floor((300 + params.count * 2200) * Math.max(0.5, area) * rt.detail)
  stars = new Array(poolSize)
  for (let i = 0; i < poolSize; i++) { stars[i] = {}; makeStar(stars[i]); stars[i].z = 0.05 + Math.random() * 0.95 }
}

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  cx = W / 2; cy = H / 2
  buildPool()
}

let lastCount = 0.5
let lastNow = 0
function starColor(z, i) {
  const mode = params.colorMode
  if (mode === 'Rainbow') return `hsl(${(params.hue * 360 + (1 - z) * 200 + i * 0.7) % 360} 100% ${60 + (1 - z) * 20}%)`
  if (mode === 'Temperature') { // near = warm/white, far = cool blue
    const h = 210 - (1 - z) * 180 // 210(blue)…30(warm)
    return `hsl(${h} ${70 - (1 - z) * 30}% ${55 + (1 - z) * 35}%)`
  }
  return `hsl(0 0% ${70 + (1 - z) * 30}%)` // White
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  // rebuild the pool if the count knob moved a lot
  if (Math.abs(params.count - lastCount) > 0.08) { lastCount = params.count; buildPool() }

  const warp = params.warp
  // fade instead of hard clear so warp streaks smear a little — more speed feel.
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(2,3,8,${1 - warp * 0.45})`
  ctx.fillRect(0, 0, W, H)

  const steerX = (params.steerX - 0.5) * 2
  const steerY = (params.steerY - 0.5) * 2
  const vpx = cx + steerX * W * 0.25
  const vpy = cy - steerY * H * 0.25
  const fov = Math.min(W, H) * 0.5 / params.spread
  // depth speed (units of z per second): a slow drift, plus warp
  const vz = (params.speed + warp * 3) * 0.2
  const rot = now * 0.001 * params.twist
  const cosR = Math.cos(rot), sinR = Math.sin(rot)

  ctx.globalCompositeOperation = 'lighter'
  // streak reach in z: a pinpoint at rest, a long hyperspace line at full warp
  const reach = vz * (0.012 + warp * warp * 0.9)

  for (let i = 0; i < poolSize; i++) {
    const s = stars[i]
    s.z -= vz * dt
    if (s.z <= 0.03) { makeStar(s); s.z = MAXZ; continue }

    // rotate the plane coords for the barrel-roll twist
    const rx = s.x * cosR - s.y * sinR
    const ry = s.x * sinR + s.y * cosR
    const k = fov / s.z // pinhole projection: stars fan outward as they near
    const px = vpx + rx * k
    const py = vpy + ry * k
    if (px < -50 || px > W + 50 || py < -50 || py > H + 50) { if (s.z < 0.5) { makeStar(s); s.z = MAXZ } continue }

    const depth = 1 - s.z
    const size = Math.max(0.5, (0.5 + depth * 1.8) * rt.pixelRatio)
    ctx.fillStyle = ctx.strokeStyle = starColor(s.z, i)
    // fade in from the far distance so respawns don't pop
    ctx.globalAlpha = Math.min(1, 0.15 + depth * 1.1) * Math.min(1, (MAXZ - s.z) * 12 + 0.05)

    // the same star one instant ago (a bit deeper) — the line between them is the streak
    const k2 = fov / (s.z + reach)
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(vpx + rx * k2, vpy + ry * k2); ctx.lineTo(px, py); ctx.stroke()

    // cheap glow for the nearest stars
    if (params.glow > 0.02 && depth > 0.7) {
      ctx.globalAlpha = (depth - 0.7) * params.glow
      ctx.beginPath(); ctx.arc(px, py, size * 3, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
