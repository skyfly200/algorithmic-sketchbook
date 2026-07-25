/**
 * Worm Bin — a writhing tangle of worms in a bin. Each worm is a head that
 * crawls with a wandering heading and a sinusoidal side-to-side wriggle; its body
 * is a chain of segments trailing behind under a distance constraint (a little
 * inverse-kinematics rope), drawn as a glossy tapered tube with a dorsal
 * highlight and the pale saddle band of an earthworm. Density and movement are
 * dialable; beats make the whole bin flinch and squirm.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'Density' },
  length: { value: 16, min: 6, max: 34, step: 1, label: 'Worm length' },
  thickness: { value: 0.5, min: 0.2, max: 1.2, step: 0.02, label: 'Thickness' },
  speed: { value: 0.6, min: 0, max: 2, step: 0.05, label: 'Crawl speed' },
  wriggle: { value: 0.7, min: 0, max: 2, step: 0.05, label: 'Wriggle' },
  writhe: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Writhe (coil)' },
  species: { value: 'Earthworm', type: 'select', options: ['Earthworm', 'Nightcrawler', 'Mealworm', 'Bloodworm', 'Alien'], label: 'Kind' },
})
rt.mapInput('audio.volume', 'speed', 1)
rt.mapInput('audio.pulse', 'wriggle', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PALETTE = {
  Earthworm: { h: 8, s: 0.42, l: 0.5, band: true },
  Nightcrawler: { h: 340, s: 0.3, l: 0.42, band: true },
  Mealworm: { h: 38, s: 0.5, l: 0.6, band: false },
  Bloodworm: { h: 355, s: 0.75, l: 0.45, band: false },
  Alien: { h: 130, s: 0.7, l: 0.5, band: true },
}

let W = 0, H = 0, minDim = 0
const worms = []

function makeWorm() {
  const n = Math.round(params.length) + ((rt.rng() * 6) | 0)
  const x = rt.random(0, W), y = rt.random(0, H)
  const seg = []
  for (let i = 0; i < n; i++) seg.push({ x, y })
  return {
    seg,
    a: rt.random(0, Math.PI * 2), // heading
    wa: rt.random(0, Math.PI * 2), // wander phase
    ph: rt.random(0, Math.PI * 2), // wriggle phase
    freq: rt.random(0.8, 1.6),
    girth: rt.random(0.7, 1.25),
    hueOff: rt.random(-10, 10),
    speed: rt.random(0.7, 1.3),
  }
}
function syncCount() {
  const target = Math.max(1, Math.round(6 + params.density * 150))
  while (worms.length < target) worms.push(makeWorm())
  while (worms.length > target) worms.pop()
}

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  minDim = Math.min(W, H)
}

function updateWorm(w, t, dt) {
  const head = w.seg[0]
  // wander the heading, and occasionally coil (writhe) by turning hard
  w.wa += dt * rt.random(0.6, 1.4)
  const coil = params.writhe * (0.5 + 0.5 * Math.sin(t * 0.7 + w.ph))
  w.a += Math.sin(w.wa) * (0.6 + coil * 3) * dt * 3
  // sinusoidal side-to-side wriggle overlaid on the heading
  const wob = Math.sin(t * w.freq * 6 + w.ph) * params.wriggle
  const dir = w.a + wob * 0.6
  const step = minDim * 0.006 * params.speed * w.speed * (0.6 + rt.beat.state.pulse * 0.8)
  head.x += Math.cos(dir) * step
  head.y += Math.sin(dir) * step
  // stay in the bin: bounce off the walls with a soft margin
  const m = minDim * 0.03
  if (head.x < m) { head.x = m; w.a = Math.PI - w.a }
  if (head.x > W - m) { head.x = W - m; w.a = Math.PI - w.a }
  if (head.y < m) { head.y = m; w.a = -w.a }
  if (head.y > H - m) { head.y = H - m; w.a = -w.a }
  // body follows: each segment holds a fixed distance to the one ahead
  const link = minDim * 0.012 * (0.8 + params.thickness * 0.4)
  for (let i = 1; i < w.seg.length; i++) {
    const p = w.seg[i - 1], s = w.seg[i]
    let dx = s.x - p.x, dy = s.y - p.y
    const d = Math.hypot(dx, dy) || 1e-4
    const k = link / d
    s.x = p.x + dx * k
    s.y = p.y + dy * k
  }
}

function drawWorm(w) {
  const pal = PALETTE[params.species] ?? PALETTE.Earthworm
  const seg = w.seg
  const baseR = minDim * 0.011 * params.thickness * w.girth
  // tube: a fat rounded stroke, dark underside first then the lit body
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(seg[0].x, seg[0].y)
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i]
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
    }
  }
  const h = pal.h + w.hueOff
  // shadow underside
  path(); ctx.strokeStyle = `hsl(${h}, ${pal.s * 100}%, ${pal.l * 55}%)`; ctx.lineWidth = baseR * 2.2; ctx.stroke()
  // main body
  path(); ctx.strokeStyle = `hsl(${h}, ${pal.s * 100}%, ${pal.l * 100}%)`; ctx.lineWidth = baseR * 1.8; ctx.stroke()
  // clitellum saddle band a third of the way down (earthworm-like)
  if (pal.band && seg.length > 8) {
    const i0 = Math.floor(seg.length * 0.28), i1 = Math.floor(seg.length * 0.4)
    ctx.beginPath(); ctx.moveTo(seg[i0].x, seg[i0].y)
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(seg[i].x, seg[i].y)
    ctx.strokeStyle = `hsl(${h + 8}, ${pal.s * 60}%, ${Math.min(85, pal.l * 130)}%)`
    ctx.lineWidth = baseR * 1.9; ctx.stroke()
  }
  // glossy dorsal highlight, thin and offset toward the light
  path()
  ctx.strokeStyle = `hsla(${h}, ${pal.s * 80}%, ${Math.min(92, pal.l * 150)}%, 0.6)`
  ctx.lineWidth = baseR * 0.55
  ctx.stroke()
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  syncCount()
  const t = now * 0.001

  // bin floor: dark substrate with a few coffee-ground / soil flecks
  ctx.fillStyle = '#161009'
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 3; i++) {
    const y = ((0.5 + 0.4 * Math.sin(t * 0.2 + i)) * H) | 0
    const g = ctx.createRadialGradient(W / 2, y, 0, W / 2, y, minDim * 0.6)
    g.addColorStop(0, 'rgba(60,44,24,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
  ctx.globalAlpha = 1

  for (const w of worms) updateWorm(w, t, dt)
  // draw back-to-front by head y so nearer worms overlap those behind
  worms.sort((a, b) => a.seg[0].y - b.seg[0].y)
  for (const w of worms) drawWorm(w)

  requestAnimationFrame(frame)
}

// Poke to make nearby worms recoil away from the point.
canvas.addEventListener('pointerdown', (e) => {
  const x = e.clientX * rt.pixelRatio, y = e.clientY * rt.pixelRatio
  for (const w of worms) {
    const h = w.seg[0]
    const dx = h.x - x, dy = h.y - y, d = Math.hypot(dx, dy)
    if (d < minDim * 0.2) w.a = Math.atan2(dy, dx)
  }
})

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
