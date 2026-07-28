/**
 * Reishi Spore Cloud — a lacquered reishi (lingzhi) conk quietly letting go
 * clouds of fine cocoa-brown spores from its pore surface. The spores billow
 * out and drift on slow turbulence, backlit so the dense parts glow golden-brown
 * like dust in a shaft of light, thinning as they rise and fade. An optional
 * iridescent glimmer gives a fraction of the spores an oil-slick sparkle that
 * shifts through the spectrum. Emission, turbulence, rise, wind, iridescence,
 * spore hue and glow are live; the mushroom can be hidden, and each beat sends
 * up a fresh puff.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  emission: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Emission' },
  turbulence: { value: 0.5, min: 0, max: 1.2, step: 0.02, label: 'Turbulence' },
  rise: { value: 0.35, min: -0.4, max: 1, step: 0.02, label: 'Rise / settle' },
  wind: { value: 0.12, min: -1, max: 1, step: 0.02, label: 'Wind' },
  iridescence: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Iridescent glimmer' },
  hue: { value: 27, min: 12, max: 42, step: 1, label: 'Spore hue' },
  glow: { value: 1, min: 0.4, max: 1.8, step: 0.05, label: 'Glow' },
  mushroom: { value: true, type: 'bool', label: 'Show mushroom' },
})
rt.mapInput('audio.level', 'emission', 0.5)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
let capCx = 0, capCy = 0, capHalf = 0, capThick = 0, baseY = 0

// soft brown spore sprite, drawn once and stamped per particle
const sprite = document.createElement('canvas')
function buildSprite() {
  const s = 48; sprite.width = s; sprite.height = s
  const g = sprite.getContext('2d')
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  rg.addColorStop(0, 'hsla(28,62%,52%,0.9)')
  rg.addColorStop(0.5, 'hsla(24,58%,40%,0.35)')
  rg.addColorStop(1, 'hsla(20,55%,32%,0)')
  g.fillStyle = rg; g.fillRect(0, 0, s, s)
}
buildSprite()

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  baseY = H * 0.9
  capCx = W * 0.5
  capHalf = Math.min(W, H) * 0.2
  capThick = capHalf * 0.5
  capCy = baseY - capThick * 1.2
}

// --- particles ---------------------------------------------------------------
const MAX = 5200
const P = []
let emitAcc = 0
function spawn(n, burst) {
  for (let i = 0; i < n; i++) {
    const fx = capCx + rt.random(-1, 1) * capHalf * 0.92
    const fy = capCy + capThick * rt.random(0.3, 0.75) // from the pore underside
    const p = P.length < MAX ? {} : P[(Math.random() * P.length) | 0]
    p.x = fx; p.y = fy
    p.vx = rt.random(-1, 1) * 14 * PR
    p.vy = (burst ? rt.random(-70, -20) : rt.random(-18, 4)) * PR
    p.life = p.max = rt.random(2.2, 5.5)
    p.sz = rt.random(0.5, 1.5)
    p.irid = rt.rng() < 0.5
    p.ho = rt.random(0, 360)
    if (P.length < MAX) P.push(p)
  }
}
rt.onBeat(({ energy }) => spawn(60 + (energy * 120 | 0), true))

// --- lacquered reishi conk ---------------------------------------------------
function capOutline(g, sx, sy) {
  g.beginPath()
  g.ellipse(capCx, capCy, capHalf * sx, capThick * sy, 0, Math.PI, TAU) // top dome
  g.ellipse(capCx, capCy, capHalf * sx, capThick * sy * 0.5, 0, 0, Math.PI) // gentle underside
  g.closePath()
}
function drawReishi(t) {
  // stem
  const g = ctx
  g.fillStyle = '#3a241a'
  g.beginPath(); g.moveTo(capCx - capHalf * 0.16, capCy)
  g.quadraticCurveTo(capCx - capHalf * 0.24, baseY, capCx - capHalf * 0.05, baseY)
  g.lineTo(capCx + capHalf * 0.05, baseY)
  g.quadraticCurveTo(capCx + capHalf * 0.02, capCy, capCx + capHalf * 0.1, capCy)
  g.closePath(); g.fill()
  // concentric lacquered growth zones, dark centre → bright margin
  const K = 12
  for (let k = K; k >= 1; k--) {
    const s = k / K
    const zt = 1 - s
    const hue = 12 + zt * 14
    const lig = 12 + zt * 30
    g.fillStyle = `hsl(${hue}, ${58 - zt * 10}%, ${lig}%)`
    capOutline(g, s, s)
    g.fill()
  }
  // creamy growing margin
  g.strokeStyle = 'hsla(44,55%,72%,0.9)'; g.lineWidth = Math.max(1.5, PR * 2)
  capOutline(g, 1, 1); g.stroke()
  // lacquer gloss highlight
  const gl = g.createRadialGradient(capCx - capHalf * 0.35, capCy - capThick * 0.5, 0, capCx - capHalf * 0.35, capCy - capThick * 0.5, capHalf * 0.7)
  gl.addColorStop(0, 'rgba(255,235,200,0.4)'); gl.addColorStop(1, 'rgba(255,235,200,0)')
  g.save(); capOutline(g, 1, 1); g.clip(); g.fillStyle = gl; g.fillRect(0, 0, W, H); g.restore()
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now

  emitAcc += params.emission * 55 * dt
  const em = emitAcc | 0; emitAcc -= em
  if (em > 0) spawn(em, false)

  // background: dark with a soft warm shaft behind the mushroom
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#070503'; ctx.fillRect(0, 0, W, H)
  const beam = ctx.createRadialGradient(capCx, capCy, 0, capCx, capCy, Math.min(W, H) * 0.7)
  beam.addColorStop(0, 'rgba(60,40,22,0.55)'); beam.addColorStop(1, 'rgba(10,7,4,0)')
  ctx.fillStyle = beam; ctx.fillRect(0, 0, W, H)

  if (params.mushroom) drawReishi(t)

  // spore cloud, backlit additive so density glows
  ctx.globalCompositeOperation = 'lighter'
  const turb = params.turbulence, wind = params.wind * 26 * PR, rise = params.rise
  const glow = params.glow, irid = params.iridescence
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]
    const nx = Math.sin(p.y * 0.011 + t * 0.7) + Math.cos(p.x * 0.013 - t * 0.5)
    const ny = Math.sin(p.x * 0.01 - t * 0.6) - 0.3
    p.vx += (nx * turb * 34 * PR + wind) * dt
    p.vy += (-rise * 40 * PR + ny * turb * 28 * PR) * dt
    p.vx *= 0.975; p.vy *= 0.975
    p.x += p.vx * dt; p.y += p.vy * dt
    p.life -= dt
    if (p.life <= 0 || p.y < -H * 0.1) { P.splice(i, 1); continue }
    const a = (p.life / p.max)
    const fade = a * (1 - a) * 4 // fade in then out
    const sz = p.sz * (1 + (1 - a) * 2.4) * Math.min(W, H) * 0.02
    ctx.globalAlpha = Math.min(1, fade * 0.5 * glow)
    ctx.drawImage(sprite, p.x - sz, p.y - sz, sz * 2, sz * 2)
    if (irid > 0 && p.irid && a > 0.2) {
      ctx.globalAlpha = Math.min(1, fade * irid * 0.9)
      ctx.fillStyle = `hsl(${(t * 80 + p.ho) % 360}, 90%, 72%)`
      ctx.beginPath(); ctx.arc(p.x, p.y, PR * (0.8 + p.sz), 0, TAU); ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
