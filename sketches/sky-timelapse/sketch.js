// Sky Timelapse — a whole day compressed into a loop: the sky sweeps through
// night, dawn, noon, dusk and back; the sun arcs over and sets as the moon
// rises opposite; stars fade in after dark; and layered clouds drift and glow,
// catching warm light at the horizons. Speed drives the clock; beats nudge it.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0, max: 6, step: 0.05, label: 'Day speed' },
  timeOfDay: { value: 0.35, min: 0, max: 1, step: 0.005, label: 'Time of day' },
  clouds: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Cloud cover' },
  wind: { value: 1, min: 0, max: 4, step: 0.05, label: 'Wind' },
  sun: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Sun size' },
  stars: { value: 0.8, min: 0, max: 1, step: 0.02, label: 'Stars' },
  // Long-exposure star trails: the night sky wheels about the celestial pole
  // and each star smears into an arc. 0 = crisp points, 1 = long streaks.
  trails: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Star trails' },
})
rt.mapInput('audio.level', 'wind', 0.4)

// Sky colour keyframes at zenith and horizon for phases around the clock
// (phase 0 = midnight → 0.25 dawn → 0.5 noon → 0.75 dusk).
const KEY = [
  { p: 0.0, top: [8, 10, 28], bot: [14, 16, 40] },     // midnight
  { p: 0.2, top: [30, 30, 70], bot: [120, 80, 90] },   // pre-dawn
  { p: 0.27, top: [90, 110, 180], bot: [240, 150, 110] }, // dawn
  { p: 0.5, top: [70, 140, 235], bot: [175, 210, 245] },  // noon
  { p: 0.73, top: [95, 90, 175], bot: [245, 130, 80] },   // dusk
  { p: 0.82, top: [30, 26, 66], bot: [110, 60, 80] },     // twilight
  { p: 1.0, top: [8, 10, 28], bot: [14, 16, 40] },        // midnight
]
function lerp(a, b, t) { return a + (b - a) * t }
function skyAt(phase) {
  let i = 0
  while (i < KEY.length - 1 && phase > KEY[i + 1].p) i++
  const a = KEY[i], b = KEY[Math.min(i + 1, KEY.length - 1)]
  const f = b.p > a.p ? (phase - a.p) / (b.p - a.p) : 0
  const mix = (k) => [0, 1, 2].map((j) => Math.round(lerp(a[k][j], b[k][j], f)))
  return { top: mix('top'), bot: mix('bot') }
}

// --- baked cloud noise (seeded, tileable) ----------------------------------
function bakeNoise(scale) {
  const size = 256
  const c = document.createElement('canvas'); c.width = c.height = size
  const cc = c.getContext('2d'); const img = cc.createImageData(size, size)
  const P = new Uint8Array(512); const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = Math.floor(rt.rng() * (i + 1));[p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  const vn = (x, y, rep) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const h = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const A = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
    const B = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
    return A + fade(yf) * (B - A)
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * scale, fy = (y / size) * scale
    let n = 0.55 * vn(fx, fy, scale) + 0.3 * vn(fx * 2, fy * 2, scale * 2) + 0.15 * vn(fx * 4, fy * 4, scale * 4)
    n = Math.max(0, (n - 0.42) * 2.0)
    const i = (y * size + x) * 4
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
    img.data[i + 3] = Math.min(255, n * 255)
  }
  cc.putImageData(img, 0, 0)
  const c2 = document.createElement('canvas'); c2.width = c2.height = size
  const cc2 = c2.getContext('2d'); cc2.filter = 'blur(1.5px)'; cc2.drawImage(c, 0, 0)
  return c2
}
const cloudA = bakeNoise(4)
const cloudB = bakeNoise(7)

let W = 0, H = 0
let starList = []
// A persistent buffer the stars smear into as the sky wheels, composited over
// the night sky — this is what produces the long-exposure trails.
const trailCv = document.createElement('canvas')
const trailCtx = trailCv.getContext('2d')
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  trailCv.width = W; trailCv.height = H
  trailCtx.clearRect(0, 0, W, H)
  starList = []
  const n = Math.round(220 * rt.detail)
  for (let i = 0; i < n; i++) starList.push({
    x: rt.rng(), y: rt.rng() * 0.85, r: rt.random(0.4, 1.6),
    tw: rt.random(0, 6.28), sp: rt.random(1.5, 3.5),
    hue: rt.random(200, 260), warm: rt.rng() < 0.25,
  })
}
// Celestial pole (upper area) the stars appear to rotate around, and the
// accumulated rotation of the night sky.
const pole = { x: 0.78, y: 0.06 }
let starRot = 0

function drawClouds(img, ox, scale, alpha, tint) {
  const tile = Math.max(W, H) * scale
  const x0 = -(((ox % tile) + tile) % tile)
  ctx.globalAlpha = alpha
  for (let x = x0; x < W; x += tile) ctx.drawImage(img, x, 0, tile, tile)
  // tint clouds toward the horizon light
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = alpha
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.5)`)
  g.addColorStop(1, `rgba(${Math.min(255, tint[0] + 40)},${Math.min(255, tint[1] + 20)},${tint[2]},0.9)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

let clock = 0
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  clock += dt * params.speed * 0.02 * (1 + rt.beat.state.pulse * 0.5)
  const phase = (params.timeOfDay + clock) % 1

  const sky = skyAt(phase)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgb(${sky.top.join(',')})`)
  g.addColorStop(1, `rgb(${sky.bot.join(',')})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // day factor (1 at noon, 0 at night) for stars + brightness
  const dayF = Math.max(0, Math.sin((phase - 0.0) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5)
  const nightF = 1 - dayF

  // stars wheel about the celestial pole, smearing into trails on a persistent
  // buffer. Fade the buffer a touch each frame — a longer Trails setting fades
  // slower (longer streaks); the buffer also clears out fast during daylight.
  starRot += dt * params.speed * 0.06
  const px = pole.x * W, py = pole.y * H
  const c = Math.cos(starRot), s = Math.sin(starRot)
  const trailFade = (1 - params.trails) * 0.12 + 0.006 + dayF * 0.25
  trailCtx.globalCompositeOperation = 'destination-out'
  trailCtx.fillStyle = `rgba(0,0,0,${Math.min(1, trailFade)})`
  trailCtx.fillRect(0, 0, W, H)
  if (params.stars > 0.02 && nightF > 0.02) {
    trailCtx.globalCompositeOperation = 'lighter'
    for (const st of starList) {
      const dx = st.x * W - px, dy = st.y * H - py
      const sx = px + dx * c - dy * s
      const sy = py + dx * s + dy * c
      const a = params.stars * nightF * (0.35 + 0.65 * Math.abs(Math.sin(st.tw + t * st.sp)))
      const col = st.warm ? '255,220,190' : '225,232,255'
      trailCtx.fillStyle = `rgba(${col},${a})`
      trailCtx.beginPath(); trailCtx.arc(sx, sy, st.r * rt.pixelRatio, 0, 6.28); trailCtx.fill()
    }
  }
  trailCtx.globalCompositeOperation = 'source-over'
  // composite the star layer over the sky
  ctx.globalCompositeOperation = 'lighter'
  ctx.drawImage(trailCv, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  // sun / moon: travel a low arc across the sky. Angle from phase; the sun is
  // up ~0.25..0.75, the moon opposite.
  const bodyArc = (ph, warm) => {
    const a = (ph - 0.25) * 2 * Math.PI // 0 at dawn(left) → π/2 noon → π at dusk(right); <0 or >π = night
    const x = 0.5 * W + Math.cos(Math.PI - a) * 0.42 * W
    const y = H * 0.72 - Math.sin(a) * H * 0.58
    if (Math.sin(a) < -0.05) return // below horizon
    const R = (warm ? 34 : 26) * params.sun * rt.pixelRatio
    const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 6)
    const col = warm ? [255, 235, 170] : [220, 228, 245]
    glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.8)`)
    glow.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},0.12)`)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = `rgb(${col.join(',')})`
    ctx.beginPath(); ctx.arc(x, y, R, 0, 6.28); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }
  bodyArc(phase, true)          // sun
  bodyArc((phase + 0.5) % 1, false) // moon

  // clouds drift on the wind, lit by the current horizon colour
  const drift = t * 20 * params.wind
  const tint = sky.bot
  drawClouds(cloudA, drift * 0.5, 1.5, params.clouds * (0.5 + dayF * 0.5), tint)
  drawClouds(cloudB, drift * 0.9, 2.3, params.clouds * 0.6 * (0.4 + dayF * 0.6), tint)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
