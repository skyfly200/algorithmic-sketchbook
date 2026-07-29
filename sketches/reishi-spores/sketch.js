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
    const fx = capCx + rt.random(-1, 1) * capHalf * 0.9
    const fy = capCy + capThick * rt.random(0.15, 0.45) // dropping from the pore underside
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
// A varnished kidney/fan shelf: a domed, gently-lobed top and a shallow pore
// underside, scaled about the cap centre for the nested growth zones.
const capPhase = rt.random(0, TAU)
function capPath(g, sc) {
  const HW = capHalf * sc, HT = capThick * sc, UD = capThick * 0.42 * sc
  const n = 56
  g.beginPath()
  for (let i = 0; i <= n; i++) { // wavy top dome, right end → left end
    const th = (i / n) * Math.PI
    const wob = 1 + 0.05 * Math.sin(th * 6 + capPhase) + 0.022 * Math.sin(th * 13 + capPhase * 1.7)
    g.lineTo(capCx + Math.cos(th) * HW, capCy - Math.sin(th) * HT * wob)
  }
  for (let i = 1; i <= n; i++) { // shallow underside arc, left end → right end
    const u = i / n
    g.lineTo(capCx - HW + 2 * HW * u, capCy + Math.sin(u * Math.PI) * UD)
  }
  g.closePath()
}
function drawReishi(t) {
  const g = ctx
  // short lacquered stalk
  g.fillStyle = '#2c1a12'
  g.beginPath()
  g.moveTo(capCx - capHalf * 0.14, capCy + capThick * 0.28)
  g.quadraticCurveTo(capCx - capHalf * 0.26, baseY, capCx - capHalf * 0.02, baseY)
  g.lineTo(capCx + capHalf * 0.13, baseY)
  g.quadraticCurveTo(capCx + capHalf * 0.03, capCy + capThick * 0.28, capCx + capHalf * 0.16, capCy + capThick * 0.2)
  g.closePath(); g.fill()

  // nested growth zones: dark mahogany centre → orange → pale cream margin
  const K = 24
  for (let k = K; k >= 1; k--) {
    const sc = k / K // 1 = outer edge, small = centre
    const e2 = Math.pow(sc, 2.2) // keep most of the cap red; only the outer band pales
    const hue = 8 + e2 * 38
    const sat = 58 - e2 * 20
    const lig = 12 + Math.pow(sc, 1.4) * 9 + e2 * 60
    g.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`
    capPath(g, sc); g.fill()
  }

  g.save(); capPath(g, 0.995); g.clip()
  // pale pore underside band along the bottom (where the spores drop)
  g.fillStyle = 'hsla(44,42%,80%,0.5)'
  g.fillRect(0, capCy + capThick * 0.16, W, capThick * 0.55)
  // faint radial wrinkles over the varnish
  g.strokeStyle = 'rgba(28,12,7,0.14)'; g.lineWidth = Math.max(1, PR)
  for (let i = 0; i <= 13; i++) { const a = (i / 13) * Math.PI; g.beginPath(); g.moveTo(capCx, capCy); g.lineTo(capCx + Math.cos(a) * capHalf * 1.1, capCy - Math.sin(a) * capThick * 1.1); g.stroke() }
  // lacquer gloss + a sharp specular glint, upper-left
  const gx = capCx - capHalf * 0.4, gy = capCy - capThick * 0.55
  const gl = g.createRadialGradient(gx, gy, 0, gx, gy, capHalf * 0.95)
  gl.addColorStop(0, 'rgba(255,241,218,0.5)'); gl.addColorStop(0.5, 'rgba(255,230,200,0.12)'); gl.addColorStop(1, 'rgba(255,230,200,0)')
  g.fillStyle = gl; g.fillRect(0, 0, W, H)
  g.fillStyle = 'rgba(255,250,236,0.55)'
  g.beginPath(); g.ellipse(gx + capHalf * 0.12, gy, capHalf * 0.15, capThick * 0.11, -0.5, 0, TAU); g.fill()
  g.restore()

  // concentric growth furrows (darker rings) that ride the cap contour
  g.strokeStyle = 'rgba(38,16,9,0.32)'; g.lineWidth = Math.max(1, PR * 1.1)
  for (let r = 0.32; r < 1.0; r += 0.13) { capPath(g, r); g.stroke() }
  // pale living margin at the very edge
  g.strokeStyle = 'hsla(46,60%,82%,0.95)'; g.lineWidth = Math.max(1.5, PR * 2.2)
  capPath(g, 1); g.stroke()
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
