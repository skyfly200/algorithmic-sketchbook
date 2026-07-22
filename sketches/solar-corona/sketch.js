// Solar Corona — a star seen close: a granulated, roiling photosphere disk, a
// corona of plasma filaments streaming out from the limb, arcing prominences
// that loop off the edge, and flares that erupt on the beat.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  turbulence: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Surface turbulence' },
  corona: { value: 1, min: 0, max: 2, step: 0.05, label: 'Corona reach' },
  prominences: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Prominence activity' },
  flare: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Flare energy' },
  spin: { value: 0.3, min: 0, max: 2, step: 0.02, label: 'Spin' },
  temp: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Colour temperature' },
  sunSize: { value: 1, min: 0.5, max: 1.6, step: 0.05, label: 'Star size' },
})
rt.mapInput('audio.level', 'turbulence', 0.4)
rt.mapInput('audio.pulse', 'flare', 0.5)

let W = 0, H = 0, PR = 1, cx = 0, cy = 0, R = 0
// baked granulation cells (Voronoi-ish blobs)
let cells = []
function build() {
  cells = []
  const n = 180
  for (let i = 0; i < n; i++) cells.push({ a: rt.random(0, 6.28), r: Math.sqrt(rt.rng()), s: rt.random(0.04, 0.11), ph: rt.random(0, 6.28), sp: rt.random(0.5, 1.5) })
}
build()
// filaments streaming from the limb
const rays = Array.from({ length: 220 }, () => ({ a: rt.random(0, 6.28), len: rt.random(0.15, 0.9), w: rt.random(0.004, 0.02), ph: rt.random(0, 6.28), sp: rt.random(0.3, 1) }))
const proms = Array.from({ length: 14 }, () => ({ a: rt.random(0, 6.28), h: rt.random(0.1, 0.35), w: rt.random(0.2, 0.6), ph: rt.random(0, 6.28) }))

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cx = W / 2; cy = H / 2
  R = Math.min(W, H) * 0.28 * params.sunSize
}

function col(temp, hot) {
  // temp 0 = red giant, 1 = blue-white; hot in [0,1]
  const h = 20 - temp * 20 + hot * (30 + temp * 190)
  const l = 40 + hot * 45
  return `hsl(${h}, 100%, ${l}%)`
}

let flareE = 0
rt.onBeat(({ energy }) => { flareE = Math.min(1, 0.5 + energy * 0.6) })

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  R = Math.min(W, H) * 0.28 * params.sunSize
  flareE = Math.max(0, flareE - dt * 1.2)
  const rot = t * params.spin

  ctx.fillStyle = '#04030a'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.globalCompositeOperation = 'lighter'

  // 1) corona halo
  const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * (1.4 + params.corona * 1.6))
  halo.addColorStop(0, col(params.temp, 0.6))
  halo.addColorStop(0.3, `hsla(${30 - params.temp * 20}, 100%, 55%, 0.25)`)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, R * (1.4 + params.corona * 1.6), 0, 6.28); ctx.fill()

  // 2) corona filaments streaming outward
  ctx.lineCap = 'round'
  for (const f of rays) {
    const a = f.a + rot * 0.2
    const flick = 0.5 + 0.5 * Math.sin(t * f.sp + f.ph)
    const len = R * (1 + f.len * params.corona * (0.6 + flick * 0.6))
    ctx.strokeStyle = `hsla(${40 - params.temp * 25}, 100%, ${60 + flick * 20}%, ${0.12 * flick})`
    ctx.lineWidth = f.w * R * 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98)
    const wob = Math.sin(t + f.ph) * 0.05
    ctx.lineTo(Math.cos(a + wob) * len, Math.sin(a + wob) * len)
    ctx.stroke()
  }

  // 3) prominences: plasma loops arcing off the limb
  for (const p of proms) {
    const on = 0.5 + 0.5 * Math.sin(t * 0.4 + p.ph)
    if (on < 1 - params.prominences) continue
    const a = p.a + rot * 0.2
    const base = R * 0.99
    const x0 = Math.cos(a - p.w * 0.1) * base, y0 = Math.sin(a - p.w * 0.1) * base
    const x1 = Math.cos(a + p.w * 0.1) * base, y1 = Math.sin(a + p.w * 0.1) * base
    const mx = Math.cos(a) * base * (1 + p.h * on), my = Math.sin(a) * base * (1 + p.h * on)
    ctx.strokeStyle = `hsla(${8 + params.temp * 10}, 100%, 60%, ${0.4 * on})`
    ctx.lineWidth = R * 0.02
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke()
  }
  ctx.restore()

  // 4) the photosphere disk with granulation
  ctx.save(); ctx.translate(cx, cy)
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
  disk.addColorStop(0, col(params.temp, 0.95))
  disk.addColorStop(0.7, col(params.temp, 0.8))
  disk.addColorStop(1, col(params.temp, 0.5))
  ctx.fillStyle = disk
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.28); ctx.fill()
  // granulation cells
  ctx.globalCompositeOperation = 'overlay'
  for (const c of cells) {
    const a = c.a + rot
    const rr = c.r * R * 0.96
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr
    const flick = 0.5 + 0.5 * Math.sin(t * c.sp * params.turbulence * 2 + c.ph)
    const s = c.s * R * (0.7 + flick * 0.6)
    const g = ctx.createRadialGradient(x, y, 0, x, y, s)
    g.addColorStop(0, `hsla(${45 - params.temp * 30}, 100%, ${55 + flick * 25}%, 0.5)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, s, 0, 6.28); ctx.fill()
  }
  // limb darkening
  ctx.globalCompositeOperation = 'multiply'
  const limb = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R)
  limb.addColorStop(0, 'rgba(255,255,255,1)')
  limb.addColorStop(1, 'rgba(120,60,20,1)')
  ctx.fillStyle = limb
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.28); ctx.fill()

  // 5) flare
  const fe = flareE * params.flare
  if (fe > 0.02) {
    ctx.globalCompositeOperation = 'lighter'
    const fa = rt.rng() * 6.28
    const fx = Math.cos(fa) * R, fy = Math.sin(fa) * R
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, R * (0.6 + fe))
    g.addColorStop(0, `rgba(255,255,240,${fe})`)
    g.addColorStop(1, 'rgba(255,180,60,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(fx, fy, R * (0.6 + fe), 0, 6.28); ctx.fill()
  }
  ctx.restore()
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
