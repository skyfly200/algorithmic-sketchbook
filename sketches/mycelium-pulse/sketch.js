// Mycelium Pulse — a living fungal network: hyphae creep outward from spores,
// branching into a dense web that seeks unclaimed space, and bright pulses of
// nutrient race along the strands from the roots to the growing tips (and
// back), lighting the mycelium up like a neural net. Click plants a spore.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// persistent network layer; pulses drawn on top each frame
const net = document.createElement('canvas')
const nctx = net.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  branch: { value: 0.6, min: 0, max: 1.2, step: 0.02, label: 'Branching' },
  wander: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Wander' },
  pulseRate: { value: 1, min: 0, max: 4, step: 0.05, label: 'Pulse rate' },
  hue: { value: 35, min: 0, max: 360, step: 1, label: 'Hyphae hue' },
  pulseHue: { value: 160, min: 0, max: 360, step: 1, label: 'Pulse hue' },
  regrow: { value: true, type: 'bool', label: 'Regrow' },
})
rt.mapInput('audio.pulse', 'pulseRate', 1.5)
rt.mapInput('audio.level', 'growth', 0.4)

// noise for wandering
const P = new Uint8Array(512)
{ const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (rt.rng() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]] } for (let i = 0; i < 512; i++) P[i] = p[i & 255] }
const fade = (x) => x * x * (3 - 2 * x)
function vn(x, y) { const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y); const h = (a, b) => P[(P[a] + b) & 511] / 255; const u = fade(xf); const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi)); const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1)); return a + fade(yf) * (b - a) }

let W = 0, H = 0
let tips = []
const edges = [] // {x1,y1,x2,y2} for pulse travel
const pulses = []
let grown = 0
const seed0 = rt.random(0, 50)
function resize() {
  W = canvas.width = net.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = net.height = Math.floor(window.innerHeight * rt.pixelRatio)
  nctx.fillStyle = '#0a0705'; nctx.fillRect(0, 0, W, H)
  tips = []; edges.length = 0; pulses.length = 0; grown = 0
  spore(W / 2, H / 2)
}
function spore(x, y) {
  const n = 4 + (rt.rng() * 3 | 0)
  for (let i = 0; i < n; i++) tips.push({ x, y, a: (i / n) * Math.PI * 2 + rt.random(-0.3, 0.3), w: rt.random(1.5, 2.5), gen: 0, life: rt.random(200, 500) })
}
canvas.addEventListener('pointerdown', (e) => spore(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio))

let last = 0, pAcc = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  const px = rt.pixelRatio

  // grow hyphae onto the persistent net
  const speed = params.growth * 45 * px
  nctx.globalCompositeOperation = 'lighter'
  for (let i = tips.length - 1; i >= 0; i--) {
    const tip = tips[i]
    const ns = 0.0025 / px
    const n = vn(tip.x * ns + seed0, tip.y * ns + seed0)
    tip.a += (n - 0.5) * 5 * params.wander * dt
    const step = speed * dt
    const nx = tip.x + Math.cos(tip.a) * step
    const ny = tip.y + Math.sin(tip.a) * step
    nctx.strokeStyle = `hsla(${params.hue}, 55%, ${28 + tip.gen * 4}%, 0.9)`
    nctx.lineWidth = Math.max(0.5, tip.w * px)
    nctx.lineCap = 'round'
    nctx.beginPath(); nctx.moveTo(tip.x, tip.y); nctx.lineTo(nx, ny); nctx.stroke()
    edges.push({ x1: tip.x, y1: tip.y, x2: nx, y2: ny })
    if (edges.length > 6000) edges.splice(0, 2000)
    tip.x = nx; tip.y = ny; tip.w *= 0.997; tip.life -= 1; grown += step
    if (rt.rng() < params.branch * 0.05 && tips.length < 400 && tip.gen < 6) {
      tips.push({ x: nx, y: ny, a: tip.a + rt.random(0.5, 1.1) * (rt.rng() < 0.5 ? 1 : -1), w: tip.w * 0.75, gen: tip.gen + 1, life: tip.life * 0.6 })
    }
    if (tip.life <= 0 || tip.w < 0.4 || nx < 0 || nx > W || ny < 0 || ny > H) tips.splice(i, 1)
  }
  nctx.globalCompositeOperation = 'source-over'

  // spawn nutrient pulses that travel along recent edges
  pAcc += dt * params.pulseRate
  while (pAcc > 0.4 && edges.length) {
    pAcc -= 0.4
    const e = edges[(rt.rng() * edges.length) | 0]
    pulses.push({ x: e.x1, y: e.y1, tx: e.x2, ty: e.y2, u: 0, life: 1, hop: 0 })
  }

  ctx.drawImage(net, 0, 0)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i]
    p.u += dt * 3
    const x = p.x + (p.tx - p.x) * Math.min(1, p.u)
    const y = p.y + (p.ty - p.y) * Math.min(1, p.u)
    const g = ctx.createRadialGradient(x, y, 0, x, y, 6 * px)
    g.addColorStop(0, `hsla(${params.pulseHue}, 100%, 75%, ${p.life})`)
    g.addColorStop(1, `hsla(${params.pulseHue}, 100%, 55%, 0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, 6 * px, 0, Math.PI * 2); ctx.fill()
    if (p.u >= 1) {
      p.life -= 0.18; p.hop++
      // hop to a connected edge near the current node
      if (p.hop < 30 && p.life > 0.1) {
        let best = null, bd = 22 * px
        for (let k = edges.length - 1; k >= Math.max(0, edges.length - 400); k--) {
          const e = edges[k]
          const d = Math.hypot(e.x1 - p.tx, e.y1 - p.ty)
          if (d < bd && rt.rng() < 0.3) { best = e; break }
        }
        if (best) { p.x = best.x1; p.y = best.y1; p.tx = best.x2; p.ty = best.y2; p.u = 0 }
        else p.life = 0
      } else p.life = 0
    }
    if (p.life <= 0) pulses.splice(i, 1)
  }
  ctx.globalCompositeOperation = 'source-over'

  if (!tips.length && params.regrow) {
    if (grown > W * H) resize()
    else spore(rt.random(W * 0.2, W * 0.8), rt.random(H * 0.2, H * 0.8))
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
