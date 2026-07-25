/**
 * Ferrofluid Speaker — the desktop "dark matter" gadget you see everywhere: a
 * clear vial with black ferrofluid pooled at the bottom, an electromagnet under
 * the base, and the music driving the field. Seen from the side, the flat pool
 * goes unstable and throws up a crown of sharp Rosensweig spikes that climb,
 * lean and dance with the bass, then sink back between beats. The spikes are
 * shaded like oily black chrome with a wet specular streak, standing in a lit
 * glass cylinder over a glowing coil.
 *
 * Turn on the mic (bottom-right) to drive it with live sound; with no mic it
 * runs on a synthetic kick so it always dances.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  drive: { value: 1.1, min: 0, max: 2.5, step: 0.05, label: 'Audio drive' },
  height: { value: 0.8, min: 0.2, max: 1.5, step: 0.02, label: 'Spike height' },
  spikes: { value: 16, min: 4, max: 34, step: 1, label: 'Spikes' },
  sharpness: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Sharpness' },
  sway: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Sway' },
  viscosity: { value: 0.55, min: 0, max: 1, step: 0.02, label: 'Viscosity' },
  fill: { value: 0.35, min: 0.1, max: 0.8, step: 0.02, label: 'Fluid amount' },
  vessel: { value: 'Cylinder', type: 'select', options: ['Cylinder', 'Dish', 'None'], label: 'Vessel' },
  hue: { value: Math.round(rt.random(190, 280)), min: 0, max: 360, step: 1, label: 'Sheen hue' },
})
rt.onBeat(() => {}) // mounts the mic toggle; audio is read below

// --- audio: real mic when on, a synthetic kick otherwise ---------------------
let bass = 0, high = 0, coil = 0
function readAudio(t) {
  const s = rt.beat.state
  if (s.active) {
    bass += (s.low - bass) * 0.35
    high += (s.high - high) * 0.35
  } else {
    const ph = (t * 2.1) % 1
    const thump = Math.exp(-ph * 6) * 0.95
    bass += ((0.18 + thump + 0.12 * Math.sin(t * 1.2)) - bass) * 0.3
    high += ((0.15 + 0.12 * Math.sin(t * 8)) - high) * 0.3
  }
  coil += (bass - coil) * 0.4
}

// --- layout + spike slots ----------------------------------------------------
let W = 0, H = 0, PR = 1
let cx = 0, yBase = 0, vesselTop = 0, vw = 0, poolW = 0, maxH = 0
let slots = []
let slotCount = -1
let lastVessel = ''
function smooth(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t) }

function buildSlots() {
  slotCount = Math.round(params.spikes)
  slots = []
  const n = slotCount
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0.5
    const jitter = (rt.rng() - 0.5) * (poolW / n) * 0.35
    const x = cx + (f - 0.5) * poolW * 0.9 + jitter
    const cb = 1 - Math.abs(f - 0.5) * 2 // 1 at centre, 0 at the rim
    slots.push({
      x,
      phase: rt.random(0, 6.28),
      leanPhase: rt.random(0, 6.28),
      speed: 0.6 + rt.rng() * 0.9,
      w: 0.7 + rt.rng() * 0.55,
      thresh: (1 - cb) * 0.55 + rt.random(0, 0.18), // rim spikes need more field
      h: 0,
      lean: 0,
    })
  }
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cx = W / 2
  const vessel = params.vessel
  vw = Math.min(W * 0.6, H * 0.62)
  vesselTop = vessel === 'Dish' ? H * 0.34 : H * 0.1
  yBase = H * 0.8
  poolW = vw * 0.9
  maxH = (yBase - vesselTop) * 0.92
  lastVessel = params.vessel
  buildSlots()
}

// A single ferrofluid spike: a leaning needle with concave flanks meeting a
// sharp tip, shaded like oily black chrome with a wet specular highlight.
function drawSpike(s) {
  const h = s.h
  if (h < 2 * PR) return
  const bx = s.x, w = (poolW / slotCount) * 0.62 * s.w
  const lean = s.lean
  const tipx = bx + lean, tipy = yBase - h
  // sharper => side control points pulled toward the axis and higher up
  const cs = 0.06 + (1 - params.sharpness) * 0.4
  const cyf = 0.5 + params.sharpness * 0.32
  ctx.beginPath()
  ctx.moveTo(bx - w, yBase)
  ctx.quadraticCurveTo(bx - w * cs + lean * 0.6, yBase - h * cyf, tipx, tipy)
  ctx.quadraticCurveTo(bx + w * cs + lean * 0.6, yBase - h * cyf, bx + w, yBase)
  ctx.closePath()
  const g = ctx.createLinearGradient(bx - w, yBase, tipx, tipy)
  g.addColorStop(0, '#04050a')
  g.addColorStop(0.55, '#12151d')
  g.addColorStop(1, '#252b38')
  ctx.fillStyle = g
  ctx.fill()
  // wet specular streak down the lit (upper-left) flank
  ctx.save()
  ctx.clip()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = `hsla(${params.hue}, 45%, 82%, 0.5)`
  ctx.lineWidth = Math.max(1, w * 0.22)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bx - w * 0.45, yBase - h * 0.06)
  ctx.quadraticCurveTo(bx - w * cs * 0.6 + lean * 0.6, yBase - h * (cyf + 0.05), tipx - w * 0.08, tipy + h * 0.05)
  ctx.stroke()
  ctx.restore()
  // glint at the tip
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = `hsla(${params.hue}, 40%, 92%, 0.7)`
  ctx.beginPath(); ctx.arc(tipx, tipy + h * 0.02, Math.max(1, w * 0.14), 0, 6.28); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

function drawPool(field) {
  const moundH = vw * (0.03 + field * 0.05)
  const half = poolW / 2 + vw * 0.03
  const g = ctx.createLinearGradient(0, yBase - moundH, 0, yBase + vw * 0.12)
  g.addColorStop(0, '#161a22')
  g.addColorStop(0.5, '#0a0c12')
  g.addColorStop(1, '#04050a')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(cx - half, yBase + vw * 0.2)
  ctx.lineTo(cx - half, yBase)
  ctx.quadraticCurveTo(cx, yBase - moundH, cx + half, yBase)
  ctx.lineTo(cx + half, yBase + vw * 0.2)
  ctx.closePath()
  ctx.fill()
  // bright meniscus along the pool's top edge
  ctx.strokeStyle = `hsla(${params.hue}, 40%, 80%, 0.25)`
  ctx.lineWidth = 1.5 * PR
  ctx.beginPath()
  ctx.moveTo(cx - half, yBase)
  ctx.quadraticCurveTo(cx, yBase - moundH, cx + half, yBase)
  ctx.stroke()
}

function drawVessel(front) {
  const vessel = params.vessel
  if (vessel === 'None') return
  const left = cx - vw / 2, right = cx + vw / 2
  const top = vesselTop, bot = yBase + vw * 0.16
  const ry = vw * 0.09
  if (!front) {
    // inner back wall: a faint darkening + a cool ambient
    const g = ctx.createLinearGradient(left, 0, right, 0)
    g.addColorStop(0, 'rgba(120,150,190,0.05)')
    g.addColorStop(0.5, 'rgba(20,26,40,0.12)')
    g.addColorStop(1, 'rgba(120,150,190,0.05)')
    ctx.fillStyle = g
    ctx.fillRect(left, top, vw, bot - top)
    // bottom ellipse (seen through the fluid)
    ctx.fillStyle = 'rgba(10,12,18,0.5)'
    ctx.beginPath(); ctx.ellipse(cx, bot, vw / 2, ry, 0, 0, Math.PI * 2); ctx.fill()
    return
  }
  // front glass: soft vertical sheen bands + rims
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const band = (x, wdt, a) => {
    const g = ctx.createLinearGradient(x - wdt, 0, x + wdt, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, `rgba(230,240,255,${a})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - wdt, top, wdt * 2, bot - top)
  }
  band(left + vw * 0.16, vw * 0.05, 0.16)
  band(left + vw * 0.26, vw * 0.02, 0.1)
  band(right - vw * 0.13, vw * 0.03, 0.08)
  ctx.restore()
  // rims (open top ellipse + edges)
  ctx.strokeStyle = 'rgba(210,225,245,0.18)'
  ctx.lineWidth = 2 * PR
  ctx.beginPath(); ctx.ellipse(cx, top, vw / 2, ry, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bot); ctx.moveTo(right, top); ctx.lineTo(right, bot); ctx.stroke()
  ctx.strokeStyle = 'rgba(210,225,245,0.28)'
  ctx.beginPath(); ctx.ellipse(cx, bot, vw / 2, ry, 0, 0, Math.PI, false); ctx.stroke()
}

function drawBase() {
  // the electromagnet housing + a coil glow that pumps on the bass
  const bw = vw * 0.7, bh = vw * 0.22
  const bx = cx - bw / 2, by = yBase + vw * 0.16
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const gg = ctx.createRadialGradient(cx, by, 0, cx, by, bw * 0.7)
  gg.addColorStop(0, `hsla(${params.hue}, 70%, 55%, ${0.15 + coil * 0.5})`)
  gg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gg
  ctx.fillRect(cx - bw, by - bh, bw * 2, bh * 2)
  ctx.restore()
  const g = ctx.createLinearGradient(0, by, 0, by + bh)
  g.addColorStop(0, '#20232b')
  g.addColorStop(1, '#0c0e13')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + bw, by)
  ctx.lineTo(bx + bw * 0.92, by + bh)
  ctx.lineTo(bx + bw * 0.08, by + bh)
  ctx.closePath()
  ctx.fill()
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (params.vessel !== lastVessel) resize()
  else if (Math.round(params.spikes) !== slotCount) buildSlots()
  readAudio(t)

  // field strength driving the instability: a resting mound + bass + beat surge
  const pulse = rt.beat.state.pulse
  const field = params.fill * 0.25 + bass * params.drive * 1.4 + pulse * 0.5
  const ease = Math.min(1, dt * (7 - params.viscosity * 5))
  for (const s of slots) {
    const cbx = 1 - Math.abs((s.x - cx) / (poolW * 0.5))
    const act = smooth(s.thresh, s.thresh + 0.25, field)
    let target = act * (0.22 + field) * maxH * (0.45 + 0.55 * Math.max(0, cbx)) * s.w
    target *= 1 + params.sway * 0.2 * Math.sin(t * s.speed * 3 + s.phase)
    s.h += (target - s.h) * ease
    s.lean = params.sway * maxH * 0.14 * Math.sin(t * s.speed * 1.5 + s.leanPhase)
  }

  // --- draw, back to front ---
  const bg = ctx.createRadialGradient(cx, H * 0.42, 0, cx, H * 0.5, Math.max(W, H) * 0.7)
  bg.addColorStop(0, '#0c0f16')
  bg.addColorStop(1, '#040509')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  drawBase()
  drawVessel(false)
  drawPool(field)
  // spikes short-to-tall so the tall central ones sit in front
  const order = [...slots].sort((a, b) => a.h - b.h)
  for (const s of order) drawSpike(s)
  drawVessel(true)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
