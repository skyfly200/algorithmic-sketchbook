/**
 * Foam Cells — a bubble raft. Bubbles nucleate, grow, and softly repel each
 * other into a packed foam; where they press together their bright rims form
 * the Plateau borders of soap film. Oversized bubbles pop and spawn smaller
 * ones, keeping the packing churning. Bubbles are a baked shaded sprite.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 1.7, min: 0.4, max: 3, step: 0.05, label: 'Bubble density' },
  growth: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Growth speed' },
  jiggle: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Jiggle' },
  popRate: { value: 0.2, min: 0, max: 2, step: 0.05, label: 'Pop rate' },
  tint: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Film tint' },
})
// Music: beats pop bubbles and shake the raft; loudness drives growth.
rt.mapInput('beat.pulse', 'popRate', 0.7)
rt.mapInput('beat.volume', 'jiggle', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let width, height, minDim
let bubbles = []
let target = 60
let lastNow = 0

const SPRITE = document.createElement('canvas')
const SPR = 256
SPRITE.width = SPRITE.height = SPR
let tintBaked = -1
function bakeSprite(tint) {
  const g = SPRITE.getContext('2d')
  g.clearRect(0, 0, SPR, SPR)
  const c = SPR / 2
  const R = c * 0.98
  const filmA = [255, 246, 232]
  const filmB = [232, 244, 255]
  const film = filmA.map((a, i) => Math.round(a + (filmB[i] - a) * tint))

  // Dark translucent dome (looking down into the bubble).
  let grad = g.createRadialGradient(c, c, 0, c, c, R)
  grad.addColorStop(0, 'rgba(12, 14, 18, 0.62)')
  grad.addColorStop(0.5, 'rgba(26, 30, 38, 0.42)')
  grad.addColorStop(0.82, 'rgba(52, 58, 68, 0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // Bright Plateau-border rim.
  grad = g.createRadialGradient(c, c, R * 0.72, c, c, R)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.8, `rgba(${film[0]}, ${film[1]}, ${film[2]}, 0.4)`)
  grad.addColorStop(0.93, `rgba(${film[0]}, ${film[1]}, ${film[2]}, 0.9)`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // Main specular glint (upper-left) + a small secondary.
  for (const [ox, oy, rad, a] of [
    [-0.30, -0.34, 0.34, 0.95],
    [0.22, 0.26, 0.12, 0.5],
  ]) {
    const sx = c + R * ox
    const sy = c + R * oy
    grad = g.createRadialGradient(sx, sy, 0, sx, sy, R * rad)
    grad.addColorStop(0, `rgba(255,255,255,${a})`)
    grad.addColorStop(0.45, `rgba(255,255,255,${a * 0.3})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(sx, sy, R * rad, 0, Math.PI * 2)
    g.fill()
  }
}

function newBubble(x, y, r) {
  return {
    x: x ?? Math.random() * width,
    y: y ?? Math.random() * height,
    // Power-law size: lots of small bubbles, a few big ones (real foam).
    r: r ?? minDim * (0.012 + 0.13 * Math.random() ** 2.6),
    vx: 0,
    vy: 0,
  }
}

function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
  minDim = Math.min(width, height)
  target = Math.round(((width * height) / (minDim * minDim) * 46) * rt.detail * params.density)
  bubbles = Array.from({ length: target }, () => newBubble())
}

// Clip a polygon to the half-plane { p : (p - b)·dir <= dist } (Sutherland–
// Hodgman). Used to cut a bubble along the flat wall it shares with a neighbor.
function clipHalfplane(poly, bx, by, dx, dy, dist) {
  const out = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const nxt = poly[(i + 1) % n]
    const dc = (cur.x - bx) * dx + (cur.y - by) * dy - dist
    const dn = (nxt.x - bx) * dx + (nxt.y - by) * dy - dist
    if (dc <= 0) out.push(cur)
    if (dc <= 0 !== dn <= 0) {
      const t = dc / (dc - dn)
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) })
    }
  }
  return out
}

// A bubble's foam cell: its circle, cut by the radical axis against every
// neighbour it actually touches. Touching pairs get a flat shared wall (like a
// power/Laguerre Voronoi); free edges stay round. This is what makes foam tile.
function cellPoly(b, nbrs) {
  const N = 72
  let poly = new Array(N)
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    poly[i] = { x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r }
  }
  for (const o of nbrs) {
    const dx = o.x - b.x
    const dy = o.y - b.y
    const d = Math.hypot(dx, dy) || 0.001
    if (d >= b.r + o.r) continue // not touching → no flat wall
    // Radical-axis distance from b's centre along the line to o (bigger bubbles
    // push the wall toward smaller ones — realistic foam).
    const dist = (d * d + b.r * b.r - o.r * o.r) / (2 * d)
    poly = clipHalfplane(poly, b.x, b.y, dx / d, dy / d, dist)
    if (poly.length < 3) break
  }
  return poly
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  const maxR = minDim * 0.14
  target = Math.round(((width * height) / (minDim * minDim) * 46) * rt.detail * params.density)

  // Grow + Brownian jiggle.
  const grow = params.growth * minDim * 0.006 * dt
  for (const b of bubbles) {
    b.r += grow
    b.vx += (Math.random() - 0.5) * params.jiggle * minDim * 0.02 * dt
    b.vy += (Math.random() - 0.5) * params.jiggle * minDim * 0.02 * dt
  }

  // Soft repulsion so bubbles pack with shared borders (O(n²), n is small).
  for (let i = 0; i < bubbles.length; i++) {
    const a = bubbles[i]
    for (let k = i + 1; k < bubbles.length; k++) {
      const b = bubbles[k]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.001
      const overlap = a.r + b.r - d
      if (overlap > 0) {
        const nx = dx / d
        const ny = dy / d
        const push = overlap * 0.028
        a.vx -= nx * push
        a.vy -= ny * push
        b.vx += nx * push
        b.vy += ny * push
      }
    }
  }

  // Integrate, damp, and keep bubbles on screen.
  for (const b of bubbles) {
    b.x += b.vx
    b.y += b.vy
    b.vx *= 0.86
    b.vy *= 0.86
    if (b.x < b.r * 0.5) b.vx += 0.5
    if (b.x > width - b.r * 0.5) b.vx -= 0.5
    if (b.y < b.r * 0.5) b.vy += 0.5
    if (b.y > height - b.r * 0.5) b.vy -= 0.5
  }

  // Pop oversized bubbles; each pop scatters a few small ones.
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    const popChance = params.popRate * dt * (b.r > maxR ? 6 : b.r / maxR * 0.4)
    if (Math.random() < popChance) {
      bubbles.splice(i, 1)
      const kids = 2 + Math.floor(Math.random() * 3)
      for (let n = 0; n < kids; n++) {
        const a = Math.random() * Math.PI * 2
        bubbles.push(
          newBubble(
            b.x + Math.cos(a) * b.r * 0.5,
            b.y + Math.sin(a) * b.r * 0.5,
            minDim * (0.015 + Math.random() * 0.02),
          ),
        )
      }
    }
  }

  // Refill toward the target count.
  while (bubbles.length < target) bubbles.push(newBubble())
  if (bubbles.length > target * 1.5) bubbles.length = Math.round(target * 1.5)

  if (params.tint !== tintBaked) {
    bakeSprite(params.tint)
    tintBaked = params.tint
  }

  // --- render ---
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, '#111318')
  bg.addColorStop(1, '#07080b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  bubbles.sort((a, b) => b.r - a.r) // big first, small rims sit on top

  // Film-wall colour (matches the sprite's Plateau-border tint).
  const filmA = [255, 246, 232]
  const filmB = [232, 244, 255]
  const film = filmA.map((a, i) => Math.round(a + (filmB[i] - a) * params.tint))
  ctx.lineJoin = 'round'

  for (const b of bubbles) {
    // Neighbours this bubble actually touches.
    const nbrs = []
    for (const o of bubbles) {
      if (o === b) continue
      const dx = o.x - b.x
      const dy = o.y - b.y
      const rr = b.r + o.r
      if (dx * dx + dy * dy < rr * rr) nbrs.push(o)
    }
    const poly = cellPoly(b, nbrs)
    if (poly.length < 3) continue

    // Fill: the shaded dome, clipped to the (flattened) cell.
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
    ctx.closePath()
    ctx.clip()
    const s = b.r * 2.06
    ctx.drawImage(SPRITE, b.x - s / 2, b.y - s / 2, s, s)
    ctx.restore()

    // The bright soap-film wall along every edge (flat or round).
    ctx.beginPath()
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
    ctx.closePath()
    ctx.strokeStyle = `rgba(${film[0]}, ${film[1]}, ${film[2]}, 0.75)`
    ctx.lineWidth = 1.4 * rt.pixelRatio
    ctx.stroke()
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
