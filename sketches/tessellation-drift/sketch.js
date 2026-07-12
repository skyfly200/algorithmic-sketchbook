/**
 * Tessellation Drift — a tiling lattice (hexagons or squares) where each cell
 * grows and shrinks as it passes through a moving noise field, while the whole
 * grid domain-warps and drifts. The noise field is stationary in "world"
 * space; the lattice scrolls through it, so cells animate coherently.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  cellSize: { value: Math.round(rt.random(32, 88)), min: 22, max: 120, step: 1, label: 'Cell size' },
  hexagonal: { value: rt.rng() > 0.5, type: 'bool', label: 'Hexagons (off = squares)' },
  grow: { value: +rt.random(0.28, 0.72).toFixed(2), min: 0, max: 0.9, step: 0.01, label: 'Grow / shrink' },
  growSpeed: { value: 0.6, min: 0.05, max: 2.5, step: 0.05, label: 'Grow speed' },
  warp: { value: Math.round(rt.random(8, 60)), min: 0, max: 90, step: 1, label: 'Warp amount' },
  warpScale: { value: +rt.random(0.5, 1.9).toFixed(2), min: 0.2, max: 3, step: 0.1, label: 'Warp scale' },
  drift: { value: +rt.random(0.2, 1.3).toFixed(2), min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  fill: { value: true, type: 'bool', label: 'Fill cells' },
  trail: { value: 1, min: 0.08, max: 1, step: 0.01, label: 'Clear (1 = crisp)' },
})
// Beats pump the cell growth by default — remix in the controls panel.
rt.mapInput('beat.pulse', 'grow', 0.35)

// Seeded generative variation: phase-shift the noise field and the palette.
const NSEED = rt.random(0, 100)
const hueBase = rt.random(0, 360)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let width, height
function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, width, height)
}

// Smooth, cheap value-noise-ish field from layered trig. Returns ~0..1.
function noise(x, y, t) {
  return (
    0.5 +
    0.5 *
      (0.5 * Math.sin(x * 1.7 + t + NSEED) * Math.cos(y * 1.3 - t * 0.7 + NSEED) +
        0.5 * Math.sin((x + y) * 0.9 - t * 0.4 + NSEED))
  )
}

// Domain-warp displacement applied to every vertex, in device pixels.
function warpAt(x, y, t, amt, freq) {
  const s = 0.0016 * freq
  return {
    dx: amt * Math.sin(y * s + t * 0.6) + amt * 0.5 * Math.cos((x + y) * s * 0.7 - t * 0.4),
    dy: amt * Math.cos(x * s - t * 0.5) + amt * 0.5 * Math.sin((x - y) * s * 0.7 + t * 0.3),
  }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  if (params.trail >= 1) {
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, width, height)
  } else {
    // Partial clear leaves ghost trails of the warping lattice.
    ctx.fillStyle = `rgba(5, 6, 10, ${params.trail})`
    ctx.fillRect(0, 0, width, height)
  }

  const size = params.cellSize * rt.pixelRatio
  const amt = params.warp * rt.pixelRatio
  const hex = params.hexagonal

  // Lattice spacing (pointy-top hexes tile with these steps).
  const stepX = hex ? Math.sqrt(3) * size : size * 1.6
  const stepY = hex ? 1.5 * size : size * 1.6

  // Drift: scroll the lattice through world space. Sub-step offset keeps it
  // seamless as cells wrap off one edge and on to the other.
  const worldX = t * params.drift * 40 * rt.pixelRatio
  const worldY = t * params.drift * 26 * rt.pixelRatio
  const offX = ((worldX % stepX) + stepX) % stepX
  const offY = ((worldY % stepY) + stepY) % stepY

  const cols = Math.ceil(width / stepX) + 3
  const rows = Math.ceil(height / stepY) + 3
  const sides = hex ? 6 : 4
  const rot = hex ? Math.PI / 2 : Math.PI / 4 // pointy-top hex / diamond-free square

  ctx.lineWidth = Math.max(1, 1.4 * rt.pixelRatio)

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      // Screen center, with hex row stagger.
      const stagger = hex && (row & 1) ? stepX / 2 : 0
      const cx = col * stepX + stagger - offX
      const cy = row * stepY - offY

      // World coordinate (moves with drift) drives the noise field so cells
      // grow/shrink as they travel through it — no popping at wrap edges.
      const wx = cx + worldX
      const wy = cy + worldY
      const n = noise(wx * 0.01, wy * 0.01, t * params.growSpeed)
      const growth = 1 - params.grow + params.grow * 2 * n // ~[1-grow, 1+grow]
      const r = size * 0.52 * growth

      const hue = (hueBase + wx * 0.05 + wy * 0.04 + t * 12) % 360
      const light = 42 + n * 28
      const alpha = 0.25 + 0.6 * n

      ctx.beginPath()
      for (let i = 0; i <= sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2
        let vx = cx + Math.cos(a) * r
        let vy = cy + Math.sin(a) * r
        // Warp each vertex by the drifting displacement field.
        const w = warpAt(vx + worldX, vy + worldY, t, amt, params.warpScale)
        vx += w.dx
        vy += w.dy
        i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
      }
      ctx.closePath()

      if (params.fill) {
        ctx.fillStyle = `hsla(${hue}, 70%, ${light}%, ${alpha * 0.5})`
        ctx.fill()
      }
      ctx.strokeStyle = `hsla(${hue}, 85%, ${light + 15}%, ${alpha})`
      ctx.stroke()
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
