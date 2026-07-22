// Glowing Coals — a bed of embers seen from above. Jittered coal chunks pack
// the frame; molten heat glows up through the cracks between them, and each
// coal's temperature breathes on its own phase plus a shared airflow. Fan a
// patch hotter with the pointer; beats gust the whole bed and lift sparks.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  heat: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Heat' },
  airflow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Airflow' },
  crust: { value: 0.7, min: 0.2, max: 1, step: 0.02, label: 'Crust darkness' },
  cracks: { value: 0.5, min: 0.1, max: 0.9, step: 0.02, label: 'Crack width' },
  coalSize: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Coal size' },
  hue: { value: 22, min: 0, max: 45, step: 1, label: 'Ember hue' },
  sparks: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Sparks' },
})
rt.mapInput('audio.level', 'airflow', 0.5)
rt.mapInput('audio.pulse', 'heat', 0.25)

let W = 0, H = 0, PR = 1
let coals = []
function buildCoals() {
  coals = []
  const step = 54 * PR * params.coalSize
  const jit = step * 0.32
  for (let y = -step; y < H + step; y += step) {
    for (let x = -step; x < W + step; x += step) {
      const cx = x + rt.random(-jit, jit)
      const cy = y + rt.random(-jit, jit)
      const nv = 7 + Math.floor(rt.random(0, 3))
      const verts = []
      for (let k = 0; k < nv; k++) {
        const a = (k / nv) * Math.PI * 2
        const rr = step * 0.5 * rt.random(0.7, 1.05)
        verts.push([Math.cos(a) * rr, Math.sin(a) * rr])
      }
      coals.push({ x: cx, y: cy, verts, base: rt.random(0.3, 1), phase: rt.random(0, 6.28), rate: rt.random(0.3, 1.1) })
    }
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  buildCoals()
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })

const sparks = []
let gust = 0
rt.onBeat(({ energy }) => { gust = 0.5 + energy * 0.6 })

let lastSize = 1
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  gust = Math.max(0, gust - dt * 1.2)
  if (params.coalSize !== lastSize) { lastSize = params.coalSize; buildCoals() }

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#0a0402'
  ctx.fillRect(0, 0, W, H)

  const hue = params.hue
  const fanNear = performance.now() - ptr.t < 1200
  const crackScale = 1 - params.cracks * 0.35 // crust shrink → wider cracks

  // 1) molten glow beneath: a hot radial per coal, additive
  ctx.globalCompositeOperation = 'lighter'
  for (const c of coals) {
    // breathing temperature + shared airflow + a pointer fan + beat gust
    let h = c.base * (0.55 + 0.45 * Math.sin(t * c.rate + c.phase))
    h *= 1 + params.airflow * 0.5 * Math.sin(t * 0.7 + c.x * 0.003)
    h += gust * 0.5
    if (fanNear) {
      const d = Math.hypot(c.x - ptr.x, c.y - ptr.y)
      h += Math.max(0, 1 - d / (160 * PR)) * (0.6 + params.airflow)
    }
    h = Math.max(0, Math.min(1.4, h * params.heat))
    c.h = h
    const r = 40 * PR * params.coalSize
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
    const light = 30 + h * 35
    g.addColorStop(0, `hsla(${hue + h * 20}, 100%, ${light}%, ${Math.min(1, h)})`)
    g.addColorStop(1, 'hsla(10, 100%, 20%, 0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
  }

  // 2) crusted coal chunks on top, leaving glowing cracks between them
  ctx.globalCompositeOperation = 'source-over'
  for (const c of coals) {
    const h = c.h ?? 0
    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.beginPath()
    for (let k = 0; k < c.verts.length; k++) {
      const [vx, vy] = c.verts[k]
      const px = vx * crackScale, py = vy * crackScale
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    // crust: near-black, warming faintly with its own heat
    const dk = 1 - params.crust
    ctx.fillStyle = `hsl(${hue}, 40%, ${Math.round((4 + h * 10) * (0.4 + dk))}%)`
    ctx.fill()
    // hot rim where the crust meets the cracks
    ctx.lineWidth = 1.5 * PR
    ctx.strokeStyle = `hsla(${hue + 8}, 100%, ${45 + h * 25}%, ${Math.min(0.9, h)})`
    ctx.stroke()
    ctx.restore()
  }

  // 3) the odd spark lifting off a hot coal
  if (params.sparks > 0.01) {
    for (const c of coals) {
      if ((c.h ?? 0) > 0.8 && rt.rng() < params.sparks * 0.02) {
        sparks.push({ x: c.x, y: c.y, vy: -rt.random(20, 60) * PR, vx: rt.random(-10, 10) * PR, life: 1 })
      }
    }
    ctx.globalCompositeOperation = 'lighter'
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 8 * PR * dt; s.life -= dt * 0.8
      if (s.life <= 0) { sparks.splice(i, 1); continue }
      ctx.fillStyle = `hsla(${hue + 20}, 100%, ${60 + s.life * 30}%, ${s.life})`
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6 * PR * s.life, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
