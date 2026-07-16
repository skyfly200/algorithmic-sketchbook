/**
 * Droplet Bounce — non-coalescence on a vibrating bath. A droplet dropped onto a
 * fluid bath rides a thin film of air and can bounce many times before it
 * finally merges. Here each drop falls in under gravity, bounces (losing energy
 * each time and stamping an expanding ripple), walks as it surfs the slope of
 * the wave field its bounces leave behind, and eventually — bigger drops and
 * tired low bounces sooner — the air film drains, surface tension breaks, and it
 * coalesces into the bath with a larger splash ripple. Drops bump apart but
 * never merge with each other. Click to drop one.
 *
 * Resonate mode drives the bath at its Faraday resonance: each bounce is
 * re-energized to a steady height and the air film is continually replenished,
 * so the drops bounce forever in a shimmering standing wave and never coalesce.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  count: { value: 8, min: 1, max: 24, step: 1, label: 'Droplets' },
  gravity: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Gravity' },
  bounce: { value: 0.62, min: 0.2, max: 0.85, step: 0.01, label: 'Bounciness' },
  tension: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Surface tension' },
  walk: { value: 1, min: 0, max: 3, step: 0.05, label: 'Walk drive' },
  resonate: { value: false, type: 'bool', label: 'Resonate (never coalesce)' },
  drive: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Faraday drive' },
  hue: { value: +rt.random(0.5, 0.62).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Bath hue' },
})
// Music: beats drop new droplets in, loudness drives the walking.
rt.mapInput('audio.volume', 'walk', 0.6)
rt.onBeat(() => { if (drops.length < Math.round(params.count) * 1.6) spawn() })

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const fld = document.createElement('canvas')
const fctx = fld.getContext('2d')

let W, H, gw, gh, cell
let hPrev, hCur, hNext, img
let drops = []
let ripples = []
let driveT = 0 // Faraday drive phase (resonate mode)

function resetField() {
  cell = 8 * rt.pixelRatio
  gw = Math.max(16, Math.floor(W / cell))
  gh = Math.max(16, Math.floor(H / cell))
  hPrev = new Float32Array(gw * gh)
  hCur = new Float32Array(gw * gh)
  hNext = new Float32Array(gw * gh)
  fld.width = gw
  fld.height = gh
  img = fctx.createImageData(gw, gh)
}
function spawn(x, y) {
  const r = cell * rt.random(1.4, 2.4)
  drops.push({
    x: x ?? rt.random(W * 0.15, W * 0.85),
    y: y ?? rt.random(H * 0.15, H * 0.85),
    z: H * rt.random(0.22, 0.34), // start up in the air
    vz: 0, vx: 0, vy: 0, r,
    film: rt.random(0.8, 1.3), // air-film reserve; drains, then it coalesces
    impact: 0, // squash timer after a bounce
  })
}
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  resetField()
  drops = []
  ripples = []
  for (let i = 0; i < Math.round(params.count); i++) spawn()
}

const gi = (gx, gy) => gy * gw + gx

function stepField(damp) {
  const c2 = 0.22
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const i = gi(x, y)
      const lap = hCur[i - 1] + hCur[i + 1] + hCur[i - gw] + hCur[i + gw] - 4 * hCur[i]
      hNext[i] = (2 * hCur[i] - hPrev[i] + c2 * lap) * damp
    }
  }
  const t = hPrev; hPrev = hCur; hCur = hNext; hNext = t
}

// A bounce or a coalescence stamps the wave field and spawns a visible ring.
function splash(x, y, strength, big) {
  const gx = Math.max(1, Math.min(gw - 2, Math.round(x / cell)))
  const gy = Math.max(1, Math.min(gh - 2, Math.round(y / cell)))
  hCur[gi(gx, gy)] += strength * (big ? 3.2 : 1.8)
  ripples.push({ x, y, r: (big ? 1.4 : 0.8) * cell, maxr: (big ? 9 : 5) * cell * (0.6 + strength), life: 1, big })
}

function bounceKick(d) {
  const gx = Math.max(1, Math.min(gw - 2, Math.round(d.x / cell)))
  const gy = Math.max(1, Math.min(gh - 2, Math.round(d.y / cell)))
  const sx = hCur[gi(gx + 1, gy)] - hCur[gi(gx - 1, gy)]
  const sy = hCur[gi(gx, gy + 1)] - hCur[gi(gx, gy - 1)]
  const k = params.walk * cell * 0.9
  d.vx -= sx * k
  d.vy -= sy * k
}

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
const hsl = (h, s, l) => { const c = hslArr(h, s, l); return `rgb(${c[0]},${c[1]},${c[2]})` }

function render() {
  // Shade the bath from the wave field's slope.
  const d = img.data
  const base = [8, 12, 22]
  const lit = hslArr(params.hue, 0.6, 0.6)
  // Faraday standing wave: a faint hex-ish shimmer oscillating with the drive,
  // shown only in resonate mode to signal the bath is being vibrated.
  const far = params.resonate ? 0.28 : 0
  const kx = 7 / gw * Math.PI * 2
  const ky = 6 / gh * Math.PI * 2
  const dph = Math.sin(driveT)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = gi(x, y)
      const sx = (x > 0 && x < gw - 1) ? hCur[i + 1] - hCur[i - 1] : 0
      const sy = (y > 0 && y < gh - 1) ? hCur[i + gw] - hCur[i - gw] : 0
      let sh = (sx * 0.6 - sy * 0.8) * 0.5
      if (far) sh += far * dph * Math.sin(x * kx) * Math.sin(y * ky)
      sh = Math.max(-1, Math.min(1, sh))
      const g = 0.5 + sh * 0.5
      d[i * 4] = base[0] + lit[0] * g * 0.6
      d[i * 4 + 1] = base[1] + lit[1] * g * 0.6
      d[i * 4 + 2] = base[2] + lit[2] * g * 0.7
      d[i * 4 + 3] = 255
    }
  }
  fctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(fld, 0, 0, W, H)

  // Expanding ripple rings.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const rp of ripples) {
    const a = rp.life * rp.life * (rp.big ? 0.5 : 0.32)
    ctx.beginPath()
    ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${hslArr(params.hue, 0.5, 0.75).join(',')},${a})`
    ctx.lineWidth = (rp.big ? 2.2 : 1.4) * rt.pixelRatio
    ctx.stroke()
  }
  ctx.restore()

  // Droplets: shadow (tighter/darker as it nears the surface), glossy body
  // raised by its height z, squashed just after a bounce.
  const zScale = 0.62
  for (const dp of drops) {
    const near = 1 - Math.min(1, dp.z / (H * 0.3))
    ctx.save()
    ctx.globalAlpha = 0.12 + near * 0.32
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(dp.x, dp.y, dp.r * (0.7 + near * 0.5), dp.r * 0.34 * (0.7 + near * 0.5), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    const squash = 1 - dp.impact * 0.4
    const bx = dp.x
    const by = dp.y - dp.z * zScale
    const rx = dp.r / squash
    const ry = dp.r * squash
    const grad = ctx.createRadialGradient(bx - rx * 0.35, by - ry * 0.4, rx * 0.1, bx, by, rx)
    grad.addColorStop(0, hsl(params.hue, 0.4, 0.92))
    grad.addColorStop(0.4, hsl(params.hue, 0.6, 0.66))
    grad.addColorStop(1, hsl(params.hue, 0.7, 0.3))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(bx - rx * 0.32, by - ry * 0.4, rx * 0.18, ry * 0.14, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

let lastNow = 0
let spawnAcc = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.04, (now - lastNow) / 1000) : 0.016
  lastNow = now

  driveT += dt * 9 * params.drive // Faraday drive oscillation
  stepField(0.9)
  stepField(0.9)

  // Keep drops falling in to maintain the target population.
  const target = Math.round(params.count)
  spawnAcc += dt
  if (drops.length < target && spawnAcc > 0.25) { spawnAcc = 0; spawn() }

  const G = params.gravity * H * 2.2
  const rMax = cell * 2.4
  for (let i = drops.length - 1; i >= 0; i--) {
    const dp = drops[i]
    dp.impact = Math.max(0, dp.impact - dt * 5)
    dp.vz -= G * dt
    dp.z += dp.vz * dt
    if (dp.z <= 0 && dp.vz < 0) {
      const speed = -dp.vz
      const s = Math.min(1.4, speed / (H * 1.2))
      dp.impact = 1
      bounceKick(dp)
      if (params.resonate) {
        // Faraday-driven: the bath pumps energy back, so each bounce is
        // re-energized to a steady resonant height and the film is replenished
        // — the drop bounces forever and never coalesces.
        dp.film = 1
        splash(dp.x, dp.y, 0.4 + s, false)
        dp.z = 0
        dp.vz = Math.sqrt(2 * G * H * 0.11 * params.drive)
      } else {
        // Air film drains a little each bounce; big drops and weak bounces drain
        // faster. When it's gone, or a bounce is too feeble, it coalesces.
        dp.film -= (0.12 + 0.5 * (dp.r / rMax)) / params.tension + (s < 0.12 ? 0.5 : 0)
        if (dp.film <= 0) {
          splash(dp.x, dp.y, 0.5 + s, true) // surface tension breaks → merge in
          drops.splice(i, 1)
          continue
        }
        splash(dp.x, dp.y, 0.3 + s, false)
        dp.z = 0
        dp.vz = speed * params.bounce // bounce back up, having lost energy
      }
    }
    // Horizontal walk + drag, keep on the bath.
    dp.x += dp.vx * dt
    dp.y += dp.vy * dt
    dp.vx *= 0.95
    dp.vy *= 0.95
    if (dp.x < dp.r) { dp.x = dp.r; dp.vx = Math.abs(dp.vx) }
    if (dp.x > W - dp.r) { dp.x = W - dp.r; dp.vx = -Math.abs(dp.vx) }
    if (dp.y < dp.r) { dp.y = dp.r; dp.vy = Math.abs(dp.vy) }
    if (dp.y > H - dp.r) { dp.y = H - dp.r; dp.vy = -Math.abs(dp.vy) }
  }

  // Non-coalescence between droplets: they bump apart but never merge.
  for (let i = 0; i < drops.length; i++)
    for (let k = i + 1; k < drops.length; k++) {
      const a = drops[i], b = drops[k]
      if (Math.abs(a.z - b.z) > a.r + b.r) continue // only when at similar height
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.001
      const min = (a.r + b.r) * 1.05
      if (dist < min) {
        const push = (min - dist) * 0.5
        const nx = dx / dist, ny = dy / dist
        a.x -= nx * push; a.y -= ny * push
        b.x += nx * push; b.y += ny * push
        a.vx -= nx * 5; a.vy -= ny * 5
        b.vx += nx * 5; b.vy += ny * 5
      }
    }

  // Age ripples.
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i]
    rp.r += (rp.maxr - rp.r) * Math.min(1, dt * 3)
    rp.life -= dt * 1.3
    if (rp.life <= 0) ripples.splice(i, 1)
  }

  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => spawn(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio))
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
