// Solar Corona — a star seen close. A granulated, boiling photosphere disk with
// limb darkening and sunspots; a corona of streamers concentrated over magnetic
// active regions; and — the heart of it — a magnetic field of bipolar active
// regions whose coronal loops arc between opposite-polarity footpoints. Plasma
// glows along those field lines, prominences hang on them, and flares erupt at a
// region and travel *along* its loops before blowing open into a CME. All baked
// where it can be, so it stays photoreal-ish without dropping frames.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  turbulence: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Surface turbulence' },
  corona: { value: 1, min: 0, max: 2, step: 0.05, label: 'Corona reach' },
  prominences: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Loop / prominence activity' },
  flare: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Flare energy' },
  spin: { value: 0.3, min: 0, max: 2, step: 0.02, label: 'Spin' },
  temp: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Colour temperature' },
  sunSize: { value: 1, min: 0.5, max: 1.6, step: 0.05, label: 'Star size' },
})
rt.mapInput('audio.level', 'turbulence', 0.4)
rt.mapInput('audio.pulse', 'flare', 0.5)

let W = 0, H = 0, PR = 1, cx = 0, cy = 0, R = 0

// --- magnetic field: bipolar active regions with coronal loops --------------
let regions = []
function buildMag() {
  regions = []
  const n = 3 + (rt.rng() * 3 | 0)
  for (let i = 0; i < n; i++) {
    regions.push({
      a: rt.random(0, 6.28),                 // longitude of the region
      sep: rt.random(0.13, 0.34),            // angular gap between the two footpoints
      str: rt.random(0.5, 1),                // field strength → loop height & count
      sp: rt.random(0.4, 1.1), ph: rt.random(0, 6.28),
      prom: rt.rng() < 0.4,                  // hosts a hanging prominence
      flare: 0, cme: 0,                       // per-region flare state
    })
  }
}
buildMag()

// corona streamers
const rays = Array.from({ length: 240 }, () => ({ a: rt.random(0, 6.28), len: rt.random(0.15, 0.9), w: rt.random(0.004, 0.02), ph: rt.random(0, 6.28), sp: rt.random(0.3, 1) }))
// limb spicules (fine bright hairs all around the edge)
const spicules = Array.from({ length: 360 }, (_, i) => ({ a: (i / 360) * 6.28 + rt.random(-0.01, 0.01), len: rt.random(0.01, 0.05), ph: rt.random(0, 6.28), sp: rt.random(1, 3) }))

// --- baked textures: granulation (luminance) + starfield --------------------
let gran = null, GR = 0, stars = null
function buildGran() {
  GR = Math.ceil(R * 2.15)
  gran = document.createElement('canvas'); gran.width = GR; gran.height = GR
  const g = gran.getContext('2d')
  // mid-grey base = intergranular lanes; bright granule cells packed on top.
  // Baked as luminance so it can be drawn with 'overlay' and stay tint-agnostic.
  g.fillStyle = 'rgb(96,96,96)'; g.fillRect(0, 0, GR, GR)
  const cell = Math.max(5, R * 0.028)
  const nG = Math.floor((GR * GR) / (cell * cell)) * 1.5
  for (let i = 0; i < nG; i++) {
    const x = rt.random(0, GR), y = rt.random(0, GR)
    const s = cell * rt.random(0.5, 1.05), b = rt.random(0.6, 1)
    const rg = g.createRadialGradient(x, y, 0, x, y, s)
    rg.addColorStop(0, `rgba(255,255,255,${0.55 * b})`)
    rg.addColorStop(0.65, `rgba(210,210,210,${0.18 * b})`)
    rg.addColorStop(1, 'rgba(70,70,70,0)')
    g.fillStyle = rg
    g.beginPath(); g.arc(x, y, s, 0, 6.28); g.fill()
  }
  // a few dark dropout specks to deepen the lanes
  for (let i = 0; i < nG * 0.3; i++) {
    g.fillStyle = `rgba(30,30,30,${rt.random(0.1, 0.3)})`
    g.beginPath(); g.arc(rt.random(0, GR), rt.random(0, GR), cell * rt.random(0.15, 0.4), 0, 6.28); g.fill()
  }
}
function buildStars() {
  stars = document.createElement('canvas'); stars.width = W; stars.height = H
  const s = stars.getContext('2d')
  const n = Math.floor((W * H) / 6000)
  for (let i = 0; i < n; i++) {
    const b = rt.random(0.2, 1)
    s.fillStyle = `rgba(255,255,${230 + 25 * b | 0},${b})`
    s.fillRect(rt.random(0, W), rt.random(0, H), (b > 0.85 ? 2 : 1) * PR, (b > 0.85 ? 2 : 1) * PR)
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cx = W / 2; cy = H / 2
  R = Math.min(W, H) * 0.28 * params.sunSize
  buildGran(); buildStars()
}

// plasma colour: temp 0 = cool red star, 1 = hot blue-white; hot in [0,1]
function col(temp, hot, a = 1) {
  const h = 22 - temp * 22 + hot * (18 + temp * 200)
  const l = 38 + hot * 50
  return `hsla(${h}, 100%, ${l}%, ${a})`
}

// draw one bipolar region's coronal loops (the field lines) at brightness `br`
function drawLoops(reg, t, rot, br) {
  const a = reg.a + rot * 0.2
  const K = Math.round(4 + reg.str * 5)
  const topH = (0.1 + reg.str * 0.3) * (0.6 + params.prominences)
  for (let k = 0; k < K; k++) {
    const kk = K > 1 ? k / (K - 1) : 0.5
    const fan = (kk - 0.5) * reg.sep * 0.9
    const fa1 = a - reg.sep / 2 - fan, fa2 = a + reg.sep / 2 + fan
    const h = topH * (0.45 + kk * 0.75)
    const flick = 0.6 + 0.4 * Math.sin(t * reg.sp * 1.5 + reg.ph + k)
    const b = br * flick * (0.5 + 0.5 * kk)
    if (b < 0.03) continue
    const x0 = Math.cos(fa1) * R * 0.98, y0 = Math.sin(fa1) * R * 0.98
    const x1 = Math.cos(fa2) * R * 0.98, y1 = Math.sin(fa2) * R * 0.98
    const mx = Math.cos(a) * R * (1 + h), my = Math.sin(a) * R * (1 + h)
    // wide soft glow then a thin bright core → plasma confined to the field line
    ctx.lineCap = 'round'
    ctx.strokeStyle = col(params.temp, Math.min(1, 0.35 + b * 0.4), 0.1 * b)
    ctx.lineWidth = R * 0.03
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke()
    const promTint = reg.prom ? `hsla(${6 + params.temp * 8},100%,58%,${0.5 * b})` : col(params.temp, Math.min(1, 0.6 + b * 0.4), 0.5 * b)
    ctx.strokeStyle = promTint
    ctx.lineWidth = R * 0.008
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke()
  }
  // footpoint brightenings (plage)
  for (const fa of [a - reg.sep / 2, a + reg.sep / 2]) {
    const fx = Math.cos(fa) * R * 0.96, fy = Math.sin(fa) * R * 0.96
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, R * 0.08)
    g.addColorStop(0, col(params.temp, Math.min(1, 0.7 + br * 0.3), 0.5 * br + 0.15))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(fx, fy, R * 0.08, 0, 6.28); ctx.fill()
  }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const newR = Math.min(W, H) * 0.28 * params.sunSize
  if (Math.abs(newR - R) > 1) { R = newR; buildGran() }
  const rot = t * params.spin

  // update flares: random eruptions scaled by flare energy, plus each travels
  // outward along its region's field as a CME once it peaks.
  for (const reg of regions) {
    if (reg.flare <= 0 && rt.rng() < params.flare * 0.006) { reg.flare = 1; reg.cme = 0.0001 }
    if (reg.flare > 0) reg.flare = Math.max(0, reg.flare - dt * 0.5)
    if (reg.cme > 0) { reg.cme += dt * (0.25 + params.flare * 0.3); if (reg.cme > 1) reg.cme = 0 }
  }

  // background + stars
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#03020a'; ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.8; ctx.drawImage(stars, 0, 0); ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  ctx.save()
  ctx.translate(cx, cy)

  // region-strength lookup by angle → concentrate streamers over active regions
  const fieldAt = (ang) => {
    let s = 0
    for (const reg of regions) {
      let d = ang - (reg.a + rot * 0.2); d = Math.atan2(Math.sin(d), Math.cos(d))
      s += reg.str * Math.exp(-(d * d) / (2 * reg.sep * reg.sep)) * (1 + reg.flare * 2)
    }
    return Math.min(1.6, s)
  }

  // 1) corona halo
  ctx.globalCompositeOperation = 'lighter'
  const haloR = R * (1.4 + params.corona * 1.7)
  const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, haloR)
  halo.addColorStop(0, col(params.temp, 0.55, 0.5))
  halo.addColorStop(0.3, `hsla(${34 - params.temp * 22}, 100%, 55%, 0.18)`)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, haloR, 0, 6.28); ctx.fill()

  // 2) coronal streamers — brighter/longer over active longitudes (helmet
  //    streamers), sparse/short over coronal holes.
  ctx.lineCap = 'round'
  for (const f of rays) {
    const a = f.a + rot * 0.2
    const fld = fieldAt(a)
    const flick = 0.5 + 0.5 * Math.sin(t * f.sp + f.ph)
    const reach = 0.5 + fld * 0.9
    const len = R * (1 + f.len * params.corona * reach * (0.6 + flick * 0.6))
    const bri = (0.06 + fld * 0.14) * flick
    ctx.strokeStyle = col(params.temp, 0.55 + flick * 0.2, bri)
    ctx.lineWidth = f.w * R * (1.5 + fld)
    const wob = Math.sin(t * 0.6 + f.ph) * 0.04
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98)
    ctx.lineTo(Math.cos(a + wob) * len, Math.sin(a + wob) * len)
    ctx.stroke()
  }
  ctx.restore()

  // 3) photosphere disk: colour base → granulation overlay → sunspots → limb
  ctx.save(); ctx.translate(cx, cy)
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.28); ctx.clip()
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
  disk.addColorStop(0, col(params.temp, 0.95))
  disk.addColorStop(0.7, col(params.temp, 0.82))
  disk.addColorStop(1, col(params.temp, 0.62))
  ctx.fillStyle = disk
  ctx.fillRect(-R, -R, R * 2, R * 2)
  // boiling granulation, co-rotating, drawn as an overlay luminance texture
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.6 + Math.min(0.35, params.turbulence * 0.2)
  ctx.save(); ctx.rotate(rot); ctx.drawImage(gran, -GR / 2, -GR / 2); ctx.restore()
  ctx.globalAlpha = 1
  // a few animated hot upwellings for the boiling motion
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 40; i++) {
    const a = i * 2.399 + rot, rr = Math.sqrt((i * 137.5 % 100) / 100) * R * 0.95
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr
    const flick = 0.5 + 0.5 * Math.sin(t * (1 + (i % 5) * 0.3) * params.turbulence + i)
    const s = R * 0.05 * (0.6 + flick)
    const g = ctx.createRadialGradient(x, y, 0, x, y, s)
    g.addColorStop(0, col(params.temp, 0.9, 0.18 * flick))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, s, 0, 6.28); ctx.fill()
  }
  // sunspots at active-region footpoints (dark umbra + filamentary penumbra)
  ctx.globalCompositeOperation = 'source-over'
  for (const reg of regions) {
    if (!reg.str) continue
    const a = reg.a + rot * 0.2
    for (const fa of [a - reg.sep / 2, a + reg.sep / 2]) {
      const sr = R * 0.9
      const x = Math.cos(fa) * sr, y = Math.sin(fa) * sr
      const rad = R * 0.06 * reg.str
      const pen = ctx.createRadialGradient(x, y, rad * 0.4, x, y, rad * 1.8)
      pen.addColorStop(0, 'rgba(50,18,4,0.85)')
      pen.addColorStop(0.5, 'rgba(120,55,15,0.5)')
      pen.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = pen
      ctx.beginPath(); ctx.arc(x, y, rad * 1.8, 0, 6.28); ctx.fill()
      ctx.fillStyle = 'rgba(20,8,2,0.9)'
      ctx.beginPath(); ctx.arc(x, y, rad * 0.6, 0, 6.28); ctx.fill()
    }
  }
  // limb darkening (rim reddens and dims)
  ctx.globalCompositeOperation = 'multiply'
  const limb = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R)
  limb.addColorStop(0, 'rgba(255,255,255,1)')
  limb.addColorStop(0.85, 'rgba(200,120,55,1)')
  limb.addColorStop(1, 'rgba(90,40,12,1)')
  ctx.fillStyle = limb
  ctx.fillRect(-R, -R, R * 2, R * 2)
  ctx.restore()

  // 4) limb spicules — fine bright hairs around the edge
  ctx.save(); ctx.translate(cx, cy)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineWidth = R * 0.004
  for (const sp of spicules) {
    const a = sp.a + rot * 0.2
    const fl = 0.5 + 0.5 * Math.sin(t * sp.sp + sp.ph)
    const len = R * (1 + sp.len * (0.5 + fl))
    ctx.strokeStyle = col(params.temp, 0.6, 0.12 * fl)
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * R * 0.99, Math.sin(a) * R * 0.99)
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
    ctx.stroke()
  }

  // 5) coronal loops — the magnetic field lines, with plasma glowing along them
  for (const reg of regions) {
    const base = 0.25 + params.prominences * 0.5
    drawLoops(reg, t, rot, base + reg.flare * 1.4)
  }

  // 6) flares + CME travelling along the field
  for (const reg of regions) {
    if (reg.flare <= 0.02 && reg.cme <= 0) continue
    const a = reg.a + rot * 0.2
    // flare kernel at the region, blindingly bright
    if (reg.flare > 0.02) {
      const fe = reg.flare * (0.4 + params.flare)
      const fx = Math.cos(a) * R * 0.97, fy = Math.sin(a) * R * 0.97
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, R * (0.3 + fe * 0.6))
      g.addColorStop(0, `rgba(255,255,250,${Math.min(1, fe)})`)
      g.addColorStop(0.4, `rgba(255,210,120,${0.5 * fe})`)
      g.addColorStop(1, 'rgba(255,150,40,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(fx, fy, R * (0.3 + fe * 0.6), 0, 6.28); ctx.fill()
    }
    // CME: a bright expanding loop-front launched radially outward along the field
    if (reg.cme > 0) {
      const cr = R * (1 + reg.cme * (1.2 + params.corona))
      const fade = (1 - reg.cme) * 0.5
      ctx.strokeStyle = col(params.temp, 0.7, fade)
      ctx.lineWidth = R * 0.03 * (1 - reg.cme * 0.5)
      ctx.beginPath()
      ctx.arc(0, 0, cr, a - reg.sep * 1.4, a + reg.sep * 1.4)
      ctx.stroke()
    }
  }
  ctx.restore()
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
