// Bubbling, glowing cauldrons float under a night sky, shedding rising bubbles.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  cauldrons: { value: 5, min: 1, max: 16, step: 1, label: 'Cauldrons' },
  size: { value: 1, min: 0.4, max: 2.5, step: 0.05, scale: 'log', label: 'Size' },
  bubbles: { value: 1, min: 0.1, max: 8, step: 0.1, scale: 'log', label: 'Bubbling' },
  glow: { value: 0.8, min: 0.05, max: 3, step: 0.05, scale: 'log', label: 'Brew glow' },
  hue: { value: 120, min: 0, max: 360, step: 1, label: 'Brew hue' },
})
rt.mapInput('beat.pulse', 'glow', 0.3)

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const R = rng(1337)
const stars = Array.from({ length: 220 }, () => ({ x: R(), y: R() * 0.8, r: 0.4 + R() * 1.2, p: R() * 6.28 }))
const potSeeds = Array.from({ length: 16 }, () => ({
  x: 0.06 + R() * 0.88, y: 0.3 + R() * 0.6, bob: R() * 6.28, scale: 0.6 + R() * 0.7,
}))

let W = 1, H = 1
let sky = null
let bubbleList = []

function bakeSky() {
  sky = document.createElement('canvas')
  sky.width = W
  sky.height = H
  const c = sky.getContext('2d')
  const g = c.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#04030c')
  g.addColorStop(0.6, '#14102a')
  g.addColorStop(1, '#2a1a3a')
  c.fillStyle = g
  c.fillRect(0, 0, W, H)
  c.fillStyle = '#0a0714'
  c.beginPath()
  c.moveTo(0, H)
  for (let x = 0; x <= W; x += W / 40) c.lineTo(x, H * (0.9 + 0.04 * Math.sin(x / W * 9) + 0.02 * Math.sin(x / W * 23)))
  c.lineTo(W, H)
  c.fill()
}

function resize() {
  W = canvas.width = Math.max(2, Math.round(window.innerWidth * rt.pixelRatio))
  H = canvas.height = Math.max(2, Math.round(window.innerHeight * rt.pixelRatio))
  bakeSky()
  bubbleList = []
}

function drawCauldron(x, y, u, hue, glow, t) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(u, u)
  // glow cast on the air around the pot
  const g = ctx.createRadialGradient(0, -20, 5, 0, -20, 120)
  g.addColorStop(0, `hsla(${hue},90%,55%,${Math.min(0.6, 0.25 * glow)})`)
  g.addColorStop(1, `hsla(${hue},90%,55%,0)`)
  ctx.fillStyle = g
  ctx.fillRect(-120, -140, 240, 240)
  // legs
  ctx.fillStyle = '#07050b'
  ctx.fillRect(-26, 22, 8, 14); ctx.fillRect(18, 22, 8, 14)
  // body
  ctx.beginPath()
  ctx.moveTo(-40, -22)
  ctx.bezierCurveTo(-52, 10, -34, 34, 0, 34)
  ctx.bezierCurveTo(34, 34, 52, 10, 40, -22)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = 'rgba(160,140,200,0.25)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(-34, 6); ctx.bezierCurveTo(-22, 26, 22, 26, 34, 6); ctx.stroke()
  // rim + brew surface
  ctx.fillStyle = '#120d1c'
  ctx.beginPath(); ctx.ellipse(0, -22, 44, 10, 0, 0, 6.2832); ctx.fill()
  const surf = ctx.createRadialGradient(0, -22, 2, 0, -22, 38)
  surf.addColorStop(0, `hsl(${hue},90%,${55 + 15 * Math.min(1, glow)}%)`)
  surf.addColorStop(1, `hsl(${hue},80%,28%)`)
  ctx.fillStyle = surf
  ctx.beginPath(); ctx.ellipse(0, -22, 38, 7, 0, 0, 6.2832); ctx.fill()
  ctx.restore()
}

function spawnBubbles(dt, potX, potY, u, hue) {
  const n = params.bubbles * dt * 3
  let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0)
  while (count-- > 0 && bubbleList.length < 600) {
    bubbleList.push({
      x: potX + (Math.random() - 0.5) * 50 * u, y: potY - 22 * u,
      vx: (Math.random() - 0.5) * 10 * u, vy: -(25 + Math.random() * 45) * u,
      r: (1.5 + Math.random() * 4) * u, life: 0, max: 1.5 + Math.random() * 2, hue,
    })
  }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.1, Math.max(0, t - last))
  last = t

  ctx.drawImage(sky, 0, 0)
  for (const s of stars) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 1.5 + s.p)})`
    ctx.fillRect(s.x * W, s.y * H, s.r * rt.pixelRatio, s.r * rt.pixelRatio)
  }

  const u = Math.min(W, H) / 700 * params.size
  const hue = params.hue
  const pots = Math.round(params.cauldrons)
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < pots; i++) {
    const s = potSeeds[i]
    const x = s.x * W
    const y = s.y * H + Math.sin(t * 0.9 + s.bob) * 10 * u
    const k = u * s.scale
    drawCauldron(x, y, k, hue + i * 6, params.glow, t)
    spawnBubbles(dt / Math.max(1, pots) * 2, x, y, k, hue + i * 6)
  }

  ctx.globalCompositeOperation = 'lighter'
  for (let i = bubbleList.length - 1; i >= 0; i--) {
    const b = bubbleList[i]
    b.life += dt
    if (b.life > b.max) { bubbleList.splice(i, 1); continue }
    b.x += b.vx * dt + Math.sin(t * 3 + i) * 6 * dt; b.y += b.vy * dt
    const a = 1 - b.life / b.max
    ctx.fillStyle = `hsla(${b.hue},90%,65%,${0.55 * a * Math.min(1, params.glow)})`
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1 + b.life * 0.8), 0, 6.2832); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
