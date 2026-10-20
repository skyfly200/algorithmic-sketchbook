// Blood moon over a dark ridge; branching lightning forks across the sky,
// flashing the clouds and moon. Beats call down a bolt.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  frequency: { value: 0.35, min: 0.02, max: 3, step: 0.01, scale: 'log', label: 'Strike rate' },
  branching: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Branching' },
  flash: { value: 1, min: 0.1, max: 3, step: 0.05, scale: 'log', label: 'Flash glow' },
  moonGlow: { value: 1, min: 0.1, max: 3, step: 0.05, scale: 'log', label: 'Moon glow' },
  redness: { value: 0.75, min: 0, max: 1, step: 0.02, label: 'Blood red' },
  cloudSpeed: { value: 0.4, min: 0.02, max: 4, step: 0.02, scale: 'log', label: 'Cloud speed' },
})
rt.mapInput('beat.pulse', 'flash', 0.2)

let W = 0, H = 0
let bolts = [] // { segs:[{x1,y1,x2,y2,w}], age, life }
let flash = 0
let strikeAcc = 0
let clouds, ridge

function rand(a, b) { return a + Math.random() * (b - a) }

function bake() {
  clouds = document.createElement('canvas')
  clouds.width = Math.max(2, W >> 2); clouds.height = Math.max(2, H >> 2)
  const c = clouds.getContext('2d')
  c.fillStyle = 'rgba(255,255,255,0)'
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * clouds.width, y = Math.random() * clouds.height * 0.7
    const r = rand(20, 70) * (clouds.width / 400 + 0.4)
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill()
  }
  ridge = document.createElement('canvas')
  ridge.width = W; ridge.height = H
  const r = ridge.getContext('2d')
  r.fillStyle = '#020204'; r.beginPath(); r.moveTo(0, H)
  let y = H * 0.86
  for (let x = 0; x <= W; x += 8) {
    y += rand(-6, 6) * rt.pixelRatio; y = Math.min(H * 0.92, Math.max(H * 0.8, y))
    r.lineTo(x, y)
  }
  r.lineTo(W, H); r.fill()
  // dead trees
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * W, h = rand(0.05, 0.12) * H
    r.strokeStyle = '#020204'; r.lineWidth = 2 * rt.pixelRatio
    r.beginPath(); r.moveTo(x, H * 0.9); r.lineTo(x + rand(-5, 5), H * 0.9 - h); r.stroke()
  }
}

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  bake()
}

function makeBolt(x0) {
  const segs = []
  const fork = (x, y, ang, len, w, depth) => {
    const steps = Math.max(4, Math.floor(len / (12 * rt.pixelRatio)))
    for (let i = 0; i < steps; i++) {
      ang += rand(-0.45, 0.45) * 0.6
      ang = Math.max(Math.PI / 2 - 1, Math.min(Math.PI / 2 + 1, ang))
      const l = len / steps
      const nx = x + Math.cos(ang) * l * rand(0.7, 1.3), ny = y + Math.sin(ang) * l
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, w })
      x = nx; y = ny
      if (depth < 3 && Math.random() < 0.12 * params.branching * 3)
        fork(x, y, ang + rand(-1, 1), len * rand(0.2, 0.5), w * 0.55, depth + 1)
      if (y > H * 0.88) break
    }
  }
  fork(x0, -10, Math.PI / 2 + rand(-0.2, 0.2), H * 0.95, 3.2 * rt.pixelRatio, 0)
  bolts.push({ segs, age: 0, life: rand(0.25, 0.5) })
  flash = Math.min(1.5, flash + 1)
}
rt.onBeat(() => makeBolt(rand(W * 0.1, W * 0.9)))

let last = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now
  const t = rt.phase('clouds', params.cloudSpeed)
  const R = Math.round(255 * (0.35 + 0.65 * params.redness))
  const G = Math.round(60 * (1 - params.redness) + 20)

  strikeAcc += dt * params.frequency
  while (strikeAcc > 1) { strikeAcc -= rand(0.5, 1.5); makeBolt(rand(W * 0.1, W * 0.9)) }
  flash *= Math.exp(-dt * 7)

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, `rgb(${6 + flash * 30 * params.flash | 0},3,8)`)
  bg.addColorStop(1, `rgb(${30 + flash * 40 * params.flash | 0},6,8)`)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  // moon
  const mx = W * 0.68, my = H * 0.28, mr = Math.min(W, H) * 0.12
  const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4)
  halo.addColorStop(0, `rgba(${R},${G},10,${0.5 * params.moonGlow})`)
  halo.addColorStop(1, 'rgba(120,0,0,0)')
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H)
  const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr)
  mg.addColorStop(0, `rgb(${R},${G + 30},${G})`); mg.addColorStop(1, `rgb(${R * 0.55 | 0},${G * 0.3 | 0},${G * 0.3 | 0})`)
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.3); ctx.fill()
  ctx.fillStyle = 'rgba(60,0,0,0.25)'
  for (const [dx, dy, s] of [[-0.3, 0.1, 0.22], [0.25, -0.2, 0.15], [0.1, 0.35, 0.18]]) {
    ctx.beginPath(); ctx.arc(mx + dx * mr, my + dy * mr, s * mr, 0, 6.3); ctx.fill()
  }

  // drifting clouds, lit by the flash
  ctx.globalAlpha = 0.5 + Math.min(1, flash * params.flash)
  const off = (t * 20) % clouds.width
  for (const o of [-clouds.width, 0]) ctx.drawImage(clouds, (off + o) * (W / clouds.width), 0, W, H * 0.8)
  ctx.globalAlpha = 1

  // bolts
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  bolts = bolts.filter((b) => (b.age += dt) < b.life)
  for (const b of bolts) {
    const k = 1 - b.age / b.life
    const a = k * (Math.random() < 0.15 ? 0.4 : 1)
    for (const [wm, col] of [[5, `rgba(180,40,60,${0.12 * a * params.flash})`], [2, `rgba(255,160,160,${0.4 * a})`], [0.7, `rgba(255,245,245,${a})`]]) {
      ctx.strokeStyle = col
      ctx.beginPath()
      for (const s of b.segs) { ctx.lineWidth = s.w * wm; ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2) }
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(ridge, 0, 0)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
