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
      // a few baked ash flecks per coal, for a crusty ashen surface texture
      const flecks = []
      for (let k = 0; k < 5; k++) flecks.push([rt.random(-step * 0.3, step * 0.3), rt.random(-step * 0.3, step * 0.3), rt.random(1, 2.5) * PR])
      coals.push({ x: cx, y: cy, verts, flecks, base: rt.random(0.3, 1), phase: rt.random(0, 6.28), rate: rt.random(0.3, 1.1) })
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

  // 0) a dim, deep-red ambient bed so the whole heap reads as hot embers, not
  //    isolated dots — brightest toward the centre where a real bed pools heat.
  ctx.globalCompositeOperation = 'lighter'
  const bed = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6)
  bed.addColorStop(0, `hsla(${hue + 2}, 100%, ${18 + gust * 6}%, 0.5)`)
  bed.addColorStop(1, 'hsla(6, 100%, 8%, 0)')
  ctx.fillStyle = bed
  ctx.fillRect(0, 0, W, H)

  // 1) molten glow beneath: a hot radial per coal, additive. A slow directional
  //    "breath" of air sweeps a brighter band across the bed, as when you blow
  //    on coals; the hottest cores go white-hot.
  for (const c of coals) {
    const breath = 0.72 + 0.28 * Math.sin(t * 0.8 * (0.5 + params.airflow) - c.x * 0.004 - c.y * 0.0025)
    let h = c.base * (0.55 + 0.45 * Math.sin(t * c.rate + c.phase)) * breath
    h *= 1 + params.airflow * 0.4 * Math.sin(t * 0.7 + c.x * 0.003)
    h += gust * 0.5
    if (fanNear) {
      const d = Math.hypot(c.x - ptr.x, c.y - ptr.y)
      h += Math.max(0, 1 - d / (160 * PR)) * (0.6 + params.airflow)
    }
    h = Math.max(0, Math.min(1.5, h * params.heat))
    c.h = h
    const r = 42 * PR * params.coalSize
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
    const hot = Math.max(0, h - 0.95) // white-hot excess
    // core: white-hot when very hot, else saturated orange; edge deep red
    g.addColorStop(0, `hsla(${hue + h * 22}, ${100 - hot * 120}%, ${Math.min(94, 34 + h * 34 + hot * 40)}%, ${Math.min(1, h)})`)
    g.addColorStop(0.45, `hsla(${hue + h * 10}, 100%, ${28 + h * 22}%, ${Math.min(0.8, h * 0.7)})`)
    g.addColorStop(1, 'hsla(8, 100%, 16%, 0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
  }

  // 2) crusted coal chunks on top, leaving glowing cracks between them
  ctx.globalCompositeOperation = 'source-over'
  for (const c of coals) {
    const h = c.h ?? 0
    const cool = 1 - Math.min(1, h) // cool coals go ashen grey
    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.beginPath()
    for (let k = 0; k < c.verts.length; k++) {
      const [vx, vy] = c.verts[k]
      const px = vx * crackScale, py = vy * crackScale
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.save(); ctx.clip()
    // crust: hot coals are dark char; cool ones grey over with ash
    const dk = 1 - params.crust
    const light = Math.round((3 + h * 8 + cool * cool * 16 * params.crust) * (0.5 + dk))
    const sat = Math.round(35 - cool * 28)
    ctx.fillStyle = `hsl(${hue - cool * 20}, ${sat}%, ${light}%)`
    ctx.fill()
    // ash flecks on the cooler crust
    if (cool > 0.2) {
      ctx.fillStyle = `hsla(30, 8%, ${60 * cool}%, ${0.35 * cool})`
      for (const [fx, fy, fr] of c.flecks) { ctx.beginPath(); ctx.arc(fx * crackScale, fy * crackScale, fr, 0, 6.28); ctx.fill() }
    }
    ctx.restore()
    // hot rim where the crust meets the cracks
    ctx.lineWidth = 1.5 * PR
    ctx.strokeStyle = `hsla(${hue + 8}, 100%, ${Math.min(75, 45 + h * 30)}%, ${Math.min(0.95, h)})`
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
