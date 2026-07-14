/**
 * Bright Waves Logo — the site's animated mark, drawn on a canvas (a port of
 * the original SMIL SVG) so it can be captured anywhere a sketch can: as a
 * Patch effect node, a Mixer layer (including the Motion Extraction feed), or
 * a standalone page. Transparent by default so it composites as a branding /
 * watermark overlay over live visuals; a param adds a solid backdrop.
 *
 * The wave cycle: four shapes (two triangle "wings", a green and a blue
 * zigzag) fly through a circular window on staggered 4-second loops — same
 * keyframes as the original SVG animation.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  scale: { value: 0.7, min: 0.15, max: 1.4, step: 0.01, label: 'Logo size' },
  opacity: { value: 1, min: 0, max: 1, step: 0.01, label: 'Opacity' },
  spin: { value: 0, min: -60, max: 60, step: 1, label: 'Spin (°/s)' },
  pulse: { value: 0.14, min: 0, max: 0.6, step: 0.01, label: 'Beat pulse' },
  art: { value: true, type: 'bool', label: 'Tiled art disc' },
  backdrop: { value: false, type: 'bool', label: 'Solid backdrop' },
})
// Beats breathe the mark by default — remix in the controls panel.
rt.mapInput('audio.pulse', 'pulse', 0.25)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

// The mark lives in a 2400×2400 virtual space (like the SVG viewBox).
const V = 2400
const CX = 1200

// --- the four animated shapes (coordinates in the 200×200 motif space) ---
const PURPLE = [[0, 0], [0, 200], [50, 150], [0, 100], [50, 50]]
const ORANGE = [[200, 0], [200, 200], [150, 150], [200, 100], [150, 50]]
const GREEN = [[0, 100], [50, 150], [100, 100], [150, 150], [200, 100]]
const BLUE = [[0, 100], [50, 50], [100, 100], [150, 50], [200, 100]]

// SMIL keyframes: [time 0..1, dx, dy] — piecewise, eased between keys.
const ANIM = [
  { pts: PURPLE, color: 'purple', fill: true, keys: [[0, 500, -500], [0.2, 0, 0], [0.8, 0, 0], [1, -500, 500]] },
  { pts: ORANGE, color: 'orange', fill: true, keys: [[0, -500, 500], [0.15, -500, 500], [0.35, 0, 0], [0.8, 0, 0], [1, 500, -500]] },
  { pts: GREEN, color: 'green', fill: false, keys: [[0, 500, 500], [0.05, 500, 500], [0.25, 0, 0], [0.8, 0, 0], [1, -500, -500]] },
  { pts: BLUE, color: 'blue', fill: false, keys: [[0, -500, -500], [0.2, -500, -500], [0.4, 0, 0], [0.8, 0, 0], [1, 500, 500]] },
]

function ease(t) {
  return t * t * (3 - 2 * t) // smoothstep, close to the SVG's spline easing
}
function offsetAt(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, x0, y0] = keys[i]
    const [t1, x1, y1] = keys[i + 1]
    if (t <= t1) {
      const f = t1 > t0 ? ease((t - t0) / (t1 - t0)) : 1
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]
    }
  }
  return [keys.at(-1)[1], keys.at(-1)[2]]
}

// --- the tiled art disc, rendered once to an offscreen (it never changes) ---
function tracePoly(g, pts, ox = 0, oy = 0, close = true) {
  g.beginPath()
  g.moveTo(pts[0][0] + ox, pts[0][1] + oy)
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + ox, pts[i][1] + oy)
  if (close) g.closePath()
}
function drawTile(g, x, y) {
  g.save()
  g.translate(x, y)
  g.lineWidth = 10
  for (const [pts, color] of [
    [PURPLE, 'purple'],
    [ORANGE, 'orange'],
    [[[100, 0], [100, 200], [150, 150], [100, 100], [150, 50]], 'purple'],
    [[[100, 0], [100, 200], [50, 150], [100, 100], [50, 50]], 'orange'],
  ]) {
    tracePoly(g, pts)
    g.fillStyle = color
    g.strokeStyle = color
    g.fill()
    g.stroke()
  }
  for (const [pts, color] of [
    [GREEN, 'green'],
    [BLUE, 'blue'],
    [[[0, 0], [50, 50], [100, 0], [150, 50], [200, 0]], 'green'],
    [[[0, 200], [50, 150], [100, 200], [150, 150], [200, 200]], 'blue'],
  ]) {
    tracePoly(g, pts, 0, 0, false)
    g.strokeStyle = color
    g.stroke()
  }
  g.restore()
}
const DISC = document.createElement('canvas')
DISC.width = DISC.height = V
{
  const g = DISC.getContext('2d')
  g.beginPath()
  g.arc(CX, CX, 2000, 0, Math.PI * 2)
  g.clip()
  for (let x = -100; x < V; x += 200) for (let y = -100; y < V; y += 200) drawTile(g, x, y)
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
}

function frame(now) {
  rt.tick(now)
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (params.backdrop) {
    ctx.fillStyle = '#0a0b10'
    ctx.fillRect(0, 0, w, h)
  }

  const s = (Math.min(w, h) / V) * params.scale * (1 + rt.beat.state.pulse * params.pulse)
  ctx.save()
  ctx.globalAlpha = params.opacity
  ctx.translate(w / 2, h / 2)
  ctx.rotate(((now * 0.001 * params.spin) % 360) * (Math.PI / 180))
  ctx.scale(s, s)
  ctx.translate(-CX, -CX)

  if (params.art) ctx.drawImage(DISC, 0, 0)

  // The mark: shapes fly through a circular window (the SVG's mask), each on
  // its own staggered 4 s loop. Motif point q maps to (q + offset − 100)·8 +
  // 1200 in disc space — the same transform chain as the original SVG.
  const t = (now * 0.001 / 4) % 1
  ctx.beginPath()
  ctx.arc(CX, CX, 1760, 0, Math.PI * 2)
  ctx.clip()
  ctx.lineWidth = 80 // stroke-width 10 × the 8× mark scale
  for (const shape of ANIM) {
    const [dx, dy] = offsetAt(shape.keys, t)
    const pts = shape.pts.map(([x, y]) => [(x + dx - 100) * 8 + CX, (y + dy - 100) * 8 + CX])
    tracePoly(ctx, pts, 0, 0, shape.fill)
    ctx.strokeStyle = shape.color
    if (shape.fill) {
      ctx.fillStyle = shape.color
      ctx.fill()
    }
    ctx.stroke()
  }
  ctx.restore()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
