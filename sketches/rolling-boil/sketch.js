/**
 * Rolling Boil — nucleate boiling from the side. Vapor bubbles nucleate at hot
 * spots along the bottom, grow while pinned, detach past a critical size, then
 * rise under buoyancy — wobbling, jostling, and expanding as pressure drops —
 * and pop at the surface with an expanding ring.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  heat: { value: 1.4, min: 0, max: 3, step: 0.05, label: 'Heat (nucleation)' },
  rise: { value: 0.8, min: 0.3, max: 3, step: 0.05, label: 'Rise speed' },
  wobble: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wobble' },
  bubbleSize: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Bubble size' },
  tint: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Water hue' },
})
// Music: beats throw a burst of bubbles, loudness cranks the heat.
rt.mapInput('audio.pulse', 'heat', 1.2)
rt.mapInput('audio.volume', 'wobble', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let width, height, minDim
let lastNow = 0
const rising = [] // detached bubbles
const pinned = [] // bubbles still growing on the floor
const rings = [] // surface pop rings
let sites = [] // nucleation sites along the bottom
let nucAccum = 0

const SPRITE = document.createElement('canvas')
const SPR = 160
SPRITE.width = SPRITE.height = SPR
function bakeSprite() {
  const g = SPRITE.getContext('2d')
  g.clearRect(0, 0, SPR, SPR)
  const c = SPR / 2
  const R = c * 0.97

  // A glassy 3D vapor sphere (drawn with 'screen' over the water, so dark =
  // transparent, bright = the lit glass). Layers build the sense of curvature:
  //   1. a broad soft sheen filling the upper-left hemisphere (the lit side)
  //   2. a Fresnel rim that brightens toward the silhouette
  //   3. a bright refracted caustic on the far (lower-right) edge — light
  //      focused through the sphere
  //   4. a small sharp specular hotspot
  // 1. upper-left sheen — gives the sphere its rounded, shaded body.
  let grad = g.createRadialGradient(c - R * 0.3, c - R * 0.32, R * 0.1, c - R * 0.1, c - R * 0.1, R * 1.15)
  grad.addColorStop(0, 'rgba(210, 232, 250, 0.5)')
  grad.addColorStop(0.5, 'rgba(150, 185, 220, 0.16)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // 2. Fresnel rim (bright near the whole edge, brighter on the shadow side).
  grad = g.createRadialGradient(c, c, R * 0.72, c, c, R)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.86, 'rgba(210, 235, 255, 0.28)')
  grad.addColorStop(0.965, 'rgba(255,255,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // 3. Refracted caustic on the lower-right rim.
  const cx = c + R * 0.5
  const cy = c + R * 0.52
  grad = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5)
  grad.addColorStop(0, 'rgba(255, 250, 235, 0.9)')
  grad.addColorStop(0.5, 'rgba(255, 245, 220, 0.25)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.save()
  g.beginPath()
  g.arc(c, c, R * 0.98, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = grad
  g.fillRect(0, 0, SPR, SPR)
  g.restore()

  // 4. Sharp specular hotspot, upper-left.
  const sx = c - R * 0.36
  const sy = c - R * 0.4
  grad = g.createRadialGradient(sx, sy, 0, sx, sy, R * 0.22)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(sx, sy, R * 0.22, 0, Math.PI * 2)
  g.fill()
}
bakeSprite()

function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
  minDim = Math.min(width, height)
  const n = Math.round((width / minDim) * 16)
  sites = Array.from({ length: n }, (_, i) => ({
    x: (width * (i + 0.5)) / n + (Math.random() - 0.5) * (width / n) * 0.6,
    hot: 0.3 + Math.random() * 0.7, // some spots boil harder
  }))
  rising.length = pinned.length = rings.length = 0
}

function drawBubble(b) {
  const d = b.depth ?? 1 // fake depth: nearer bubbles are bigger and brighter
  const s = b.r * 2.06 * d
  ctx.globalAlpha = 0.45 + 0.55 * d
  ctx.drawImage(SPRITE, b.x - s / 2, b.y - s / 2, s, s)
  ctx.globalAlpha = 1
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  const floor = height - minDim * 0.015
  const baseR = minDim * 0.012 * params.bubbleSize
  const critR = minDim * 0.03 * params.bubbleSize

  // Nucleate: seed new pinned bubbles at hot sites.
  nucAccum += params.heat * 75 * dt
  while (nucAccum >= 1) {
    nucAccum -= 1
    const site = sites[(Math.random() * sites.length) | 0]
    if (site && Math.random() < site.hot) {
      pinned.push({ x: site.x + (Math.random() - 0.5) * baseR, y: floor, r: baseR * (0.4 + Math.random() * 0.4) })
    }
  }

  // Pinned bubbles grow, then detach.
  for (let i = pinned.length - 1; i >= 0; i--) {
    const b = pinned[i]
    b.r += critR * 0.9 * dt * (0.6 + params.heat)
    b.y = floor - b.r * 0.4
    if (b.r >= critR * (0.7 + Math.random() * 0.5)) {
      pinned.splice(i, 1)
      rising.push({ x: b.x, y: floor - b.r, r: b.r, vx: 0, vy: 0, phase: Math.random() * 6.28, depth: 0.55 + Math.random() * 0.7 })
    }
  }

  // Rising bubbles: buoyancy, wobble, mutual jostle, expansion.
  for (const b of rising) {
    b.r += b.r * 0.25 * dt // expand as pressure drops
    const buoy = params.rise * (0.6 + b.r / critR) * minDim * 0.3 * dt
    b.vy -= buoy
    b.phase += dt * (3 + params.wobble * 4)
    b.vx += Math.sin(b.phase) * params.wobble * minDim * 0.4 * dt
    b.vx *= 0.94
    b.vy *= 0.9
    b.x += b.vx
    b.y += b.vy
  }
  // Jostle (soft repulsion) so streams braid instead of overlapping.
  for (let i = 0; i < rising.length; i++) {
    const a = rising[i]
    for (let k = i + 1; k < rising.length; k++) {
      const b = rising[k]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.001
      const ov = a.r + b.r - d
      if (ov > 0 && d < minDim) {
        const nx = (dx / d) * ov * 0.04
        const ny = (dy / d) * ov * 0.04
        a.vx -= nx; a.vy -= ny; b.vx += nx; b.vy += ny
      }
    }
  }
  // Pop at the surface.
  const surface = minDim * 0.04
  for (let i = rising.length - 1; i >= 0; i--) {
    const b = rising[i]
    if (b.y - b.r <= surface) {
      rising.splice(i, 1)
      rings.push({ x: b.x, y: surface + b.r * 0.5, r: b.r, max: b.r * 2.4, a: 0.8 })
    }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]
    r.r += (r.max - r.r) * 4 * dt
    r.a -= dt * 2.2
    if (r.a <= 0) rings.splice(i, 1)
  }

  // --- render ---
  const hue = 190 + params.tint * 30
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, `hsl(${hue}, 55%, 8%)`)
  bg.addColorStop(1, `hsl(${hue - 10}, 70%, 20%)`) // hotter, brighter near the floor
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // Surface glow line.
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.15)`
  ctx.fillRect(0, 0, width, surface)

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  for (const b of pinned) drawBubble(b)
  for (const b of rising) drawBubble(b)
  for (const r of rings) {
    ctx.strokeStyle = `rgba(220, 240, 255, ${Math.max(0, r.a)})`
    ctx.lineWidth = 2 * rt.pixelRatio
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, r.r, r.r * 0.4, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
