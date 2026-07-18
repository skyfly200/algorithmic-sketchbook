/**
 * Rain on a window over a live scene (camera / dropped photo or video / demo /
 * the Mixer layers below). The glass is misted, so the background reads soft
 * and pale. Droplets nucleate on it, grow, and each one acts as a little lens —
 * clip a circle, magnify and flip the scene behind it, add a bright specular
 * and a dark refracted rim. When a drop gets heavy it breaks loose and slides
 * down, swallowing the drops in its path (merging, area-conserving) and wiping
 * a clear streak through the fog that slowly mists back over.
 *
 * The wiped glass lives in a persistent "wet" mask that fades (re-condenses)
 * each frame; the clear streaks are the sharp background shown through it.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: +rt.random(0.4, 0.85).toFixed(2), min: 0.1, max: 1, step: 0.02, label: 'Drop density' },
  fog: { value: +rt.random(0.4, 0.8).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Fogged glass' },
  gravity: { value: 0.6, min: 0.1, max: 1.5, step: 0.02, label: 'Run speed' },
  dropSize: { value: 1.0, min: 0.5, max: 2, step: 0.05, label: 'Drop size' },
  refraction: { value: 1.0, min: 0.3, max: 2, step: 0.05, label: 'Refraction' },
  wind: { value: +rt.random(0.3, 0.7).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Wind (sideways)' },
  trails: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Streak clarity' },
})
// Tilt which way the drops run by moving the mouse (or tilting the device).
rt.mapInput('mouse.x', 'wind', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// Background layers: a misted (blurred, paled) copy for the glass, and a sharp
// copy for what the drops refract and the streaks reveal.
const fogC = document.createElement('canvas')
const fogCtx = fogC.getContext('2d')
const sharpC = document.createElement('canvas')
const sharpCtx = sharpC.getContext('2d')
// Persistent "wet" mask — white where water has cleared the fog; fades back.
const wetC = document.createElement('canvas')
const wetCtx = wetC.getContext('2d')
// Composited clear streaks (sharp bg masked by wet).
const clearC = document.createElement('canvas')
const clearCtx = clearC.getContext('2d')

let W = 0
let H = 0
let PR = 1
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  for (const c of [fogC, sharpC, wetC, clearC]) {
    c.width = W
    c.height = H
  }
  wetCtx.clearRect(0, 0, W, H)
}

// --- droplets ---------------------------------------------------------------
// r is in canvas px. Small drops cling and grow; once heavy they slide.
let drops = []
const rand = (a, b) => a + Math.random() * (b - a)

function spawn(x, y, r, sliding = false) {
  drops.push({ x, y, r, vy: 0, vx: 0, sliding, wob: Math.random() * Math.PI * 2 })
}

function slideThreshold() {
  // Bigger window + bigger drops hold on longer before running.
  return (10 + 9 * params.dropSize) * PR
}

function step() {
  const g = slideThreshold()
  const maxDrops = Math.floor((260 + 360 * params.density) * rt.detail)
  const minDim = Math.min(W, H)

  // Nucleation: seed new clinging droplets across the glass.
  const spawnTries = Math.ceil(params.density * 6)
  for (let i = 0; i < spawnTries; i++) {
    if (drops.length >= maxDrops) break
    if (Math.random() < 0.5) spawn(rand(0, W), rand(0, H), rand(0.8, 2.2) * PR * params.dropSize)
  }

  const windX = (params.wind - 0.5) * 2 * 1.4 * PR // -1.4..1.4 px bias

  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]
    if (!d.sliding) {
      // Condensation growth, slowing as it gets big.
      d.r += (0.05 + 0.05 * params.density) * PR * (1 - d.r / (g * 1.6))
      if (d.r >= g * (0.85 + Math.random() * 0.4)) {
        d.sliding = true
        d.vy = 0.4 * PR
      }
      continue
    }

    // Sliding: accelerate under gravity, wobble sideways, feel the wind.
    d.vy += 0.08 * params.gravity * PR * (0.6 + d.r / g)
    d.vy = Math.min(d.vy, 14 * PR * params.gravity)
    d.wob += 0.3
    d.x += windX + Math.sin(d.wob) * 0.4 * PR
    d.y += d.vy

    // Wipe the fog along the path and shed the odd residual bead.
    wetCtx.globalCompositeOperation = 'source-over'
    wetCtx.fillStyle = '#fff'
    wetCtx.beginPath()
    wetCtx.arc(d.x, d.y, d.r * 0.85, 0, Math.PI * 2)
    wetCtx.fill()
    if (Math.random() < 0.14 && d.r > 4 * PR) {
      spawn(d.x + rand(-d.r, d.r) * 0.6, d.y - d.r, rand(0.9, 1.8) * PR * params.dropSize)
      d.r *= 0.985 // lose a little mass to the residual
    }

    // Swallow drops in the path (merge, area-conserving).
    for (let j = 0; j < drops.length; j++) {
      if (j === i) continue
      const o = drops[j]
      const dx = o.x - d.x
      const dy = o.y - d.y
      const rr = d.r + o.r
      if (dx * dx + dy * dy < rr * rr * 0.7) {
        const a = d.r * d.r + o.r * o.r
        d.r = Math.sqrt(a)
        drops.splice(j, 1)
        if (j < i) i--
      }
    }
  }

  // Coalescence among all drops (not just sliding sweepers): any two beads
  // that touch merge into one, area-conserving — the bigger keeps the spot.
  for (let i = 0; i < drops.length; i++) {
    const a = drops[i]
    for (let j = i + 1; j < drops.length; j++) {
      const b = drops[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rr = a.r + b.r
      if (dx * dx + dy * dy < rr * rr * 0.55) {
        const big = a.r >= b.r ? a : b
        const small = a.r >= b.r ? b : a
        const area = a.r * a.r + b.r * b.r
        big.r = Math.sqrt(area)
        big.sliding = big.sliding || small.sliding
        big.vy = Math.max(big.vy, small.vy)
        if (small === a) {
          drops[i] = big === a ? a : b
        }
        drops.splice(j, 1)
        j--
      }
    }
  }

  // Cull off-screen and cap the herd.
  drops = drops.filter((d) => d.y - d.r < H + 4 && d.x > -20 * PR && d.x < W + 20 * PR)
  if (drops.length > maxDrops) drops.splice(0, drops.length - maxDrops)

  // Re-fog: the wet streaks slowly dry and mist over again.
  const dry = 0.006 + (1 - params.trails) * 0.05
  wetCtx.globalCompositeOperation = 'destination-out'
  wetCtx.fillStyle = `rgba(0,0,0,${dry})`
  wetCtx.fillRect(0, 0, W, H)
  wetCtx.globalCompositeOperation = 'source-over'
  void minDim
}

// Refract the sharp background inside a drop: the scene behind it, magnified
// and point-inverted (as a spherical droplet really does).
function drawDrop(d) {
  const m = 1 + 0.35 * params.refraction
  ctx.save()
  ctx.beginPath()
  ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(d.x, d.y - d.r * 0.15) // sample a touch above (drops look up)
  ctx.scale(-m, -m) // point inversion + magnify
  ctx.drawImage(sharpC, -d.x, -(d.y - d.r * 0.15), W, H)
  ctx.restore()

  // Refracted dark rim + a slim bright edge on the lower side.
  ctx.lineWidth = Math.max(0.6, d.r * 0.12)
  ctx.strokeStyle = 'rgba(10,14,22,0.45)'
  ctx.beginPath()
  ctx.arc(d.x, d.y, d.r * 0.96, 0, Math.PI * 2)
  ctx.stroke()

  // Specular highlight (upper-left) — the tiny window reflection.
  const hx = d.x - d.r * 0.32
  const hy = d.y - d.r * 0.34
  const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, d.r * 0.5)
  hg.addColorStop(0, 'rgba(255,255,255,0.85)')
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hg
  ctx.beginPath()
  ctx.arc(hx, hy, d.r * 0.5, 0, Math.PI * 2)
  ctx.fill()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  // Sharp background (for refraction + streaks).
  sharpCtx.globalCompositeOperation = 'source-over'
  sharpCtx.filter = 'none'
  src.draw(sharpCtx, W, H)

  // Fogged glass: blurred, paled version of the scene.
  fogCtx.clearRect(0, 0, W, H)
  fogCtx.filter = `blur(${(3 + params.fog * 7) * PR}px) brightness(${1 + params.fog * 0.1})`
  src.draw(fogCtx, W, H)
  fogCtx.filter = 'none'
  fogCtx.fillStyle = `rgba(206,212,224,${params.fog * 0.4})`
  fogCtx.fillRect(0, 0, W, H)

  step()

  // 1) misted glass
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(fogC, 0, 0)

  // 2) clear streaks: sharp bg shown through the wet mask
  if (params.trails > 0.01) {
    clearCtx.globalCompositeOperation = 'source-over'
    clearCtx.globalAlpha = 1
    clearCtx.clearRect(0, 0, W, H)
    clearCtx.drawImage(sharpC, 0, 0)
    clearCtx.globalCompositeOperation = 'destination-in'
    clearCtx.drawImage(wetC, 0, 0)
    clearCtx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.55 + 0.45 * params.trails
    ctx.drawImage(clearC, 0, 0)
    ctx.globalAlpha = 1
  }

  // 3) the drops themselves
  for (const d of drops) drawDrop(d)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
