// Washboard Road — the corrugation instability that ripples dirt and gravel
// roads. A sprung wheel rolls a looped road at speed; each time it lands it
// scrapes grains and throws them a little downstream, so tiny bumps grow into a
// regular washboard that marches along the road. A background process runs many
// fast passes so the pattern forms in seconds, while one wheel rolls and bounces
// on the current surface for show, kicking up dust on the hard hits.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Speed' },
  suspension: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Suspension bounce' },
  grip: { value: 1, min: 0.3, max: 2.2, step: 0.05, label: 'Scrape / carve' },
  transport: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Downstream drift' },
  relax: { value: 0.6, min: 0, max: 2, step: 0.05, label: 'Grain slump' },
  passes: { value: 4, min: 0, max: 12, step: 1, label: 'Formation rate' },
  dust: { value: 1, min: 0, max: 2, step: 0.05, label: 'Dust' },
  hue: { value: 32, min: 10, max: 48, step: 1, label: 'Dirt hue' },
})
rt.mapInput('audio.level', 'passes', 0.4)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
const N = 900                     // looped road length in cells
let road = new Float32Array(N)    // surface height (px, +down means a dip)
let roadY = 0, cell = 0           // baseline y and cell→px scale
const R = 1.0                     // wheel radius in the sim's height units

// display wheel (rolls for show and also sculpts a little)
let dx = 0, dyw = 0, dvw = 0
const dust = []

function seedRoad() {
  for (let i = 0; i < N; i++) road[i] = (rt.rng() - 0.5) * 0.4 // faint initial roughness
}

// one full pass: a hopping sprung wheel traverses the whole looped road, and on
// every landing it digs a little material and drops it a few cells downstream.
function pass() {
  const v = 3.5 * params.speed
  const grav = 0.9
  const push = 0.9 * params.suspension     // suspension push-off velocity per contact
  const carve = 0.012 * params.grip
  const drift = Math.max(1, Math.round(3 * params.transport))
  let x = (Math.random() * N) | 0
  let yw = road[x] + R, vw = 0
  const dt = 1 / v
  for (let s = 0; s < N; s++) {
    x = (x + 1) % N
    vw -= grav * dt
    yw += vw * dt
    const ground = road[x] + R
    if (yw <= ground) {              // contact / landing
      // bounded scoop so the pattern saturates instead of running away
      const dig = Math.min(0.06, carve * (1 + Math.abs(vw)))
      road[x] += dig                 // + is down: dig a dip here
      road[(x + drift) % N] -= dig    // pile it up just downstream
      yw = ground
      vw = push                       // suspension launches the wheel again
    }
  }
}
const CLAMP = 1.4                     // hard cap on the ripple amplitude (units)

function relaxRoad() {
  const k = params.relax * 0.12
  if (k <= 0) return
  const prev0 = road[0], prevLast = road[N - 1]
  let left = prevLast
  for (let i = 0; i < N; i++) {
    const right = i === N - 1 ? prev0 : road[i + 1]
    const cur = road[i]
    road[i] = cur + k * ((left + right) * 0.5 - cur)
    left = cur
  }
  // keep the mean near zero, and hard-cap the amplitude so the ripples saturate
  let m = 0
  for (let i = 0; i < N; i++) m += road[i]
  m /= N
  for (let i = 0; i < N; i++) {
    let v = road[i] - m
    if (v > CLAMP) v = CLAMP; else if (v < -CLAMP) v = -CLAMP
    road[i] = v
  }
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  roadY = H * 0.62
  cell = W / 26                     // px per road cell in the view window
  if (!road.some((v) => v !== 0)) seedRoad()
}

const sampleRoad = (fx) => { // linear sample of the looped road at fractional cell
  const i = ((fx % N) + N) % N
  const i0 = Math.floor(i), f = i - i0
  return road[i0] * (1 - f) + road[(i0 + 1) % N] * f
}
const AMP = 26 // px per height unit

function frame(now) {
  rt.tick(now)

  // sculpt: several fast passes evolve the whole road, then let grains slump
  const np = Math.round(params.passes)
  for (let p = 0; p < np; p++) pass()
  relaxRoad()

  // advance the display wheel and let it bounce on the current surface
  const v = 3.2 * params.speed
  dx += v * 0.5
  const grav = 0.9, push = 0.9 * params.suspension, dt = 1 / v
  const ground = sampleRoad(dx) + R
  dvw -= grav * dt
  dyw += dvw * dt
  let landed = false
  if (dyw <= ground) { landed = dvw < -0.15; dyw = ground; dvw = push }

  // --- render (side view) ---
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const sky = ctx.createLinearGradient(0, 0, 0, roadY)
  sky.addColorStop(0, hsl(205, 45, 62)); sky.addColorStop(1, hsl(38, 40, 78))
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, roadY)

  // the road window follows the wheel; wheel sits ~1/3 across
  const wheelPX = W * 0.34
  const originCell = dx - wheelPX / cell
  const cols = Math.ceil(W / cell) + 2

  // road body
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let c = 0; c <= cols; c++) {
    const px = c * cell
    const y = roadY - sampleRoad(originCell + c) * AMP
    c === 0 ? ctx.lineTo(px, y) : ctx.lineTo(px, y)
  }
  ctx.lineTo(W, H); ctx.closePath()
  const dirt = ctx.createLinearGradient(0, roadY - 40, 0, H)
  dirt.addColorStop(0, hsl(params.hue, 42, 46)); dirt.addColorStop(1, hsl(params.hue, 40, 22))
  ctx.fillStyle = dirt; ctx.fill()

  // ripple shading: sun from the left, so windward faces catch light and the
  // lee faces fall into shadow. Shaded at pixel resolution for a smooth relief.
  ctx.save(); ctx.beginPath()
  ctx.moveTo(0, H)
  for (let c = 0; c <= cols; c++) ctx.lineTo(c * cell, roadY - sampleRoad(originCell + c) * AMP)
  ctx.lineTo(W, H); ctx.closePath(); ctx.clip()
  const step = Math.max(2, 3 * PR)
  for (let px = 0; px < W; px += step) {
    const fc = originCell + px / cell
    const h0 = sampleRoad(fc), h1 = sampleRoad(fc + 0.4)
    const slope = Math.max(-1, Math.min(1, (h1 - h0) * 4))
    const y = roadY - h0 * AMP
    if (slope > 0.02) ctx.fillStyle = `rgba(20,10,0,${slope * 0.4})`
    else if (slope < -0.02) ctx.fillStyle = `rgba(255,238,205,${-slope * 0.32})`
    else continue
    ctx.fillRect(px, y - AMP, step + 1, AMP * 2 + 60)
  }
  ctx.restore()

  // dust on hard landings
  if (landed && params.dust > 0) {
    for (let i = 0; i < 6 * params.dust; i++) {
      dust.push({ x: wheelPX + rt.random(-8, 14) * PR, y: roadY - dyw * AMP + rt.random(-4, 4) * PR, vx: rt.random(-30, 60) * PR, vy: rt.random(-70, -10) * PR, life: rt.random(0.4, 1.1), max: 1 })
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i]
    d.vy += 60 * PR * 0.016; d.x += d.vx * 0.016; d.y += d.vy * 0.016; d.life -= 0.016
    if (d.life <= 0) { dust.splice(i, 1); continue }
    ctx.globalAlpha = Math.min(0.5, d.life * 0.4) * params.dust
    ctx.fillStyle = hsl(params.hue, 30, 72)
    ctx.beginPath(); ctx.arc(d.x, d.y, (1.6 + (1 - d.life) * 6) * PR, 0, TAU); ctx.fill()
  }
  ctx.globalAlpha = 1

  // the vehicle: a wheel + a sprung body that lags the wheel's bounce
  const wy = roadY - dyw * AMP
  const wr = 26 * PR
  // simple leaf-spring body above the wheel
  const bodyY = wy - wr - 34 * PR - (dyw - R) * AMP * 0.25
  ctx.fillStyle = hsl(params.hue + 180, 25, 42)
  ctx.fillRect(wheelPX - 60 * PR, bodyY - 22 * PR, 150 * PR, 30 * PR)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2 * PR
  ctx.beginPath(); ctx.moveTo(wheelPX, bodyY + 8 * PR); ctx.lineTo(wheelPX, wy - wr); ctx.stroke()
  // wheel
  ctx.fillStyle = '#15171b'
  ctx.beginPath(); ctx.arc(wheelPX, wy - wr, wr, 0, TAU); ctx.fill()
  ctx.fillStyle = '#3a3f47'
  ctx.beginPath(); ctx.arc(wheelPX, wy - wr, wr * 0.45, 0, TAU); ctx.fill()
  // spinning spoke
  const ang = dx * 0.12
  ctx.strokeStyle = '#20242a'; ctx.lineWidth = 4 * PR
  ctx.beginPath(); ctx.moveTo(wheelPX + Math.cos(ang) * wr * 0.4, wy - wr + Math.sin(ang) * wr * 0.4)
  ctx.lineTo(wheelPX - Math.cos(ang) * wr * 0.4, wy - wr - Math.sin(ang) * wr * 0.4); ctx.stroke()

  requestAnimationFrame(frame)
}

function hsl(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)` }

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
