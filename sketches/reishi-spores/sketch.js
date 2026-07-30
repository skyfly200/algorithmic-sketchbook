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
  emission: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Emission' },
  turbulence: { value: 0.6, min: 0, max: 1.2, step: 0.02, label: 'Turbulence' },
  rise: { value: 0.4, min: -0.4, max: 1, step: 0.02, label: 'Rise / settle' },
  wind: { value: -0.28, min: -1, max: 1, step: 0.02, label: 'Wind' },
  iridescence: { value: 0.25, min: 0, max: 1, step: 0.02, label: 'Iridescent glimmer' },
  hue: { value: 32, min: 12, max: 48, step: 1, label: 'Spore tint' },
  glow: { value: 1, min: 0.4, max: 1.8, step: 0.05, label: 'Glow' },
  mushroom: { value: true, type: 'bool', label: 'Show mushroom' },
})
rt.mapInput('audio.level', 'emission', 0.5)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
let capCx = 0, capCy = 0, capHalf = 0, capThick = 0, baseY = 0

// Soft, pale spore sprite. A dense backlit spore cloud reads as smoky white
// sheets against the dark, faintly warm — so the puff is near-white with a
// low alpha and only a whisper of the hue tint, and many overlap into veils.
const sprite = document.createElement('canvas')
let lastHue = -1
function buildSprite() {
  const h = params.hue
  const s = 72; sprite.width = s; sprite.height = s
  const g = sprite.getContext('2d')
  g.clearRect(0, 0, s, s)
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  rg.addColorStop(0, `hsla(${h},24%,92%,0.32)`)
  rg.addColorStop(0.4, `hsla(${h},22%,84%,0.1)`)
  rg.addColorStop(1, `hsla(${h},20%,76%,0)`)
  g.fillStyle = rg; g.fillRect(0, 0, s, s)
  lastHue = h
}
buildSprite()

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  // conk sits low and to the right; the cloud billows up and across the frame
  baseY = H * 0.99
  capCx = W * 0.72
  capHalf = Math.min(W, H) * 0.19
  capThick = capHalf * 0.5
  capCy = baseY - capThick * 1.2
}

// --- particles ---------------------------------------------------------------
const MAX = 9000
const P = []
let emitAcc = 0
function spawn(n, burst) {
  for (let i = 0; i < n; i++) {
    const fx = capCx + rt.random(-1, 1) * capHalf * 0.85
    const fy = capCy + capThick * rt.random(0.1, 0.4) // dropping from the pore underside
    const p = P.length < MAX ? {} : P[(Math.random() * P.length) | 0]
    // ~30% are big, long-lived, very faint "veil" puffs — these overlap into
    // the smoky billowing sheets; the rest are fine drifting spores.
    const veil = rt.rng() < 0.3
    p.x = fx; p.y = fy
    p.vx = rt.random(-1, 1) * 20 * PR
    p.vy = (burst ? rt.random(-90, -40) : rt.random(-42, -14)) * PR
    p.life = p.max = veil ? rt.random(5, 9) : rt.random(2.2, 5.5)
    p.sz = veil ? rt.random(2.2, 4.5) : rt.random(0.5, 1.6)
    p.veil = veil
    p.irid = !veil && rt.rng() < 0.4
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
    const e2 = Math.pow(sc, 3.0) // rich red-orange across the cap; pale only at the very rim
    const hue = 10 + e2 * 16 // deep red centre → warm orange rim
    const sat = 88 - e2 * 30
    const lig = 24 + Math.pow(sc, 1.5) * 10 + e2 * 55 // brightens toward the growing edge
    g.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`
    capPath(g, sc); g.fill()
  }

  g.save(); capPath(g, 0.995); g.clip()
  // pale pore underside band along the bottom (where the spores drop)
  g.fillStyle = 'hsla(44,42%,80%,0.5)'
  g.fillRect(0, capCy + capThick * 0.16, W, capThick * 0.55)
  // domed relief: a light side (upper-left) and a shadowed side (lower-right)
  // shade the whole cap so it reads as a rounded 3D shelf, not a flat disc
  const lgx = capCx - capHalf * 0.42, lgy = capCy - capThick * 0.6
  const dome = g.createRadialGradient(lgx, lgy, 0, lgx, lgy, capHalf * 1.5)
  dome.addColorStop(0, 'rgba(255,238,214,0.45)'); dome.addColorStop(0.45, 'rgba(255,225,195,0.08)'); dome.addColorStop(1, 'rgba(255,225,195,0)')
  g.fillStyle = dome; g.fillRect(0, 0, W, H)
  const shx = capCx + capHalf * 0.5, shy = capCy + capThick * 0.6
  const shade = g.createRadialGradient(shx, shy, 0, shx, shy, capHalf * 1.4)
  shade.addColorStop(0, 'rgba(18,7,3,0.5)'); shade.addColorStop(0.6, 'rgba(18,7,3,0.12)'); shade.addColorStop(1, 'rgba(18,7,3,0)')
  g.fillStyle = shade; g.fillRect(0, 0, W, H)
  // sharp specular glint on the varnish, upper-left
  g.fillStyle = 'rgba(255,250,236,0.6)'
  g.beginPath(); g.ellipse(lgx + capHalf * 0.16, lgy + capThick * 0.05, capHalf * 0.16, capThick * 0.12, -0.5, 0, TAU); g.fill()

  // embossed concentric growth ridges: a shadow stroke offset down and a
  // highlight stroke offset up on each contour, so the cap looks corrugated
  // in 3D relief rather than ruled with flat dark lines
  for (let r = 0.26; r < 0.99; r += 0.085) {
    g.save(); g.translate(0, PR * 1.3); g.strokeStyle = 'rgba(26,10,5,0.3)'; g.lineWidth = Math.max(1, PR * 1.4); capPath(g, r); g.stroke(); g.restore()
    g.save(); g.translate(0, -PR * 1.0); g.strokeStyle = 'rgba(255,224,186,0.16)'; g.lineWidth = Math.max(1, PR); capPath(g, r); g.stroke(); g.restore()
  }
  g.restore()
  // bright white growing margin at the very edge (the reishi's fresh rim)
  g.strokeStyle = 'hsla(40,35%,95%,0.98)'; g.lineWidth = Math.max(2.5, PR * 4)
  capPath(g, 1); g.stroke()
  g.strokeStyle = 'hsla(42,45%,88%,0.6)'; g.lineWidth = Math.max(1.5, PR * 2)
  capPath(g, 0.95); g.stroke()
}

let last = 0
function frame(now) {
  rt.tick(now)
  if (params.hue !== lastHue) buildSprite() // retint the puff when the tint changes
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now

  emitAcc += params.emission * 60 * dt
  const em = emitAcc | 0; emitAcc -= em
  if (em > 0) spawn(em, false)

  // background: dark with a soft warm shaft behind the mushroom
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#070503'; ctx.fillRect(0, 0, W, H)
  const beam = ctx.createRadialGradient(capCx, capCy, 0, capCx, capCy, Math.min(W, H) * 0.7)
  beam.addColorStop(0, 'rgba(50,34,20,0.3)'); beam.addColorStop(1, 'rgba(10,7,4,0)')
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
    // veils swell larger and stay faint so they layer into smoky sheets;
    // ordinary spores are smaller and a touch crisper
    const grow = p.veil ? 3.4 : 2.4
    const sz = p.sz * (1 + (1 - a) * grow) * Math.min(W, H) * 0.02
    ctx.globalAlpha = Math.min(1, fade * (p.veil ? 0.05 : 0.16) * glow)
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
