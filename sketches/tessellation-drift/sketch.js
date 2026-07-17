/**
 * Tessellation Drift — a tiling of the plane where each tile grows and shrinks
 * as it passes through a moving noise field, while the whole tiling
 * domain-warps and drifts. The noise field is stationary in "world" space; the
 * tiling scrolls through it, so tiles animate coherently.
 *
 * Beyond plain squares and hexagons it can lay down the more intricate
 * Archimedean / Laves tilings: triangles, the rhombille "tumbling-blocks"
 * pattern, and the truncated-square 4.8.8 (octagons + squares). Each is defined
 * by a translational unit cell (a couple of lattice vectors plus its prototiles)
 * and instanced across the view.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const TILINGS = ['Hexagons', 'Squares', 'Triangles', 'Rhombille', 'Truncated 4.8.8', 'Trihexagonal']
const params = rt.params({
  tiling: { value: rt.pick(TILINGS), type: 'select', options: TILINGS, label: 'Tiling' },
  cellSize: { value: Math.round(rt.random(30, 64)), min: 18, max: 110, step: 1, label: 'Cell size' },
  grow: { value: +rt.random(0.28, 0.72).toFixed(2), min: 0, max: 0.9, step: 0.01, label: 'Grow / shrink' },
  growSpeed: { value: 0.6, min: 0.05, max: 2.5, step: 0.05, label: 'Grow speed' },
  warp: { value: Math.round(rt.random(8, 50)), min: 0, max: 90, step: 1, label: 'Warp amount' },
  warpScale: { value: +rt.random(0.5, 1.9).toFixed(2), min: 0.2, max: 3, step: 0.1, label: 'Warp scale' },
  drift: { value: +rt.random(0.2, 1.3).toFixed(2), min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  fill: { value: true, type: 'bool', label: 'Fill cells' },
  trail: { value: 1, min: 0.08, max: 1, step: 0.01, label: 'Clear (1 = crisp)' },
})
// Beats pump the cell growth by default — remix in the controls panel.
rt.mapInput('audio.pulse', 'grow', 0.35)

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

// --- tiling definitions -----------------------------------------------------
// Each returns { v1, v2, protos } where protos are polygons (arrays of [x,y])
// inside one unit cell; translating them by every integer combo of the two
// lattice vectors tiles the plane. `s` is the tile edge in device pixels.
function hexVerts(s, r = s) {
  const v = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 // flat-top hexagon
    v.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return v
}

function tilingDef(type, s) {
  const h = (Math.sqrt(3) / 2) * s
  switch (type) {
    case 'Squares':
      return {
        v1: [s, 0],
        v2: [0, s],
        protos: [[[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]]],
      }
    case 'Triangles':
      return {
        v1: [s, 0],
        v2: [s / 2, h],
        protos: [
          [[0, 0], [s, 0], [s / 2, h]],
          [[s, 0], [1.5 * s, h], [0.5 * s, h]],
        ],
      }
    case 'Rhombille': {
      // Three rhombi per flat-top hexagon (the "tumbling blocks" illusion).
      const V = hexVerts(s)
      const C = [0, 0]
      const rh = (a, b, c) => [C, V[a], V[b], V[c]]
      return {
        v1: [1.5 * s, h],
        v2: [0, 2 * h],
        protos: [rh(5, 0, 1), rh(1, 2, 3), rh(3, 4, 5)],
      }
    }
    case 'Truncated 4.8.8': {
      // Octagons on a square lattice with squares filling the gaps.
      const R = s / (2 * Math.sin(Math.PI / 8)) // octagon circumradius for edge s
      const w = s * (1 + Math.SQRT2) // cell pitch = octagon width across flats
      const oct = []
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i / 8) * Math.PI * 2
        oct.push([Math.cos(a) * R, Math.sin(a) * R])
      }
      // The gap between four octagons is a square rotated 45° (its sides are
      // the octagons' diagonal flats): vertices s/√2 out from the gap centre.
      const q = s / Math.SQRT2
      const sq = [[w / 2 - q, w / 2], [w / 2, w / 2 - q], [w / 2 + q, w / 2], [w / 2, w / 2 + q]]
      return { v1: [w, 0], v2: [0, w], protos: [oct, sq] }
    }
    case 'Trihexagonal': {
      // Hexagons cornered together with up/down triangles between (3.6.3.6).
      const V = hexVerts(s)
      const up = [V[0], V[1], [1.5 * s, h]] // (s,0),(s/2,h),(1.5s,h)
      const down = [V[1], V[2], [0, 2 * h]] // (s/2,h),(-s/2,h),(0,2h)
      return { v1: [2 * s, 0], v2: [s, 2 * h], protos: [V, up, down] }
    }
    case 'Hexagons':
    default:
      return { v1: [1.5 * s, h], v2: [0, 2 * h], protos: [hexVerts(s)] }
  }
}

function centroid(poly) {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p[0]
    y += p[1]
  }
  return [x / poly.length, y / poly.length]
}

// Integrated phases: drift and grow-speed are accumulated per frame rather
// than multiplied by absolute time, so live modulation (audio reactivity)
// changes the *rate* smoothly instead of teleporting the whole field by
// t × Δvalue on every beat.
let driftPhase = 0
let growPhase = 0
let lastNow = 0

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.1, (now - lastNow) * 0.001) : 0.016
  lastNow = now
  driftPhase += params.drift * dt
  growPhase += params.growSpeed * dt

  if (params.trail >= 1) {
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, width, height)
  } else {
    ctx.fillStyle = `rgba(5, 6, 10, ${params.trail})`
    ctx.fillRect(0, 0, width, height)
  }

  const s = Math.max(6, params.cellSize * rt.pixelRatio)
  const amt = params.warp * rt.pixelRatio
  const { v1, v2, protos } = tilingDef(params.tiling, s)

  // Camera scrolls through world space; tiles are generated in world coords.
  const camX = driftPhase * 40 * rt.pixelRatio
  const camY = driftPhase * 26 * rt.pixelRatio
  const pad = 2 * (Math.hypot(...v1) + Math.hypot(...v2))

  // Lattice index range covering the padded view window (invert the basis).
  const det = v1[0] * v2[1] - v1[1] * v2[0]
  const x0 = camX - pad
  const x1 = camX + width + pad
  const y0 = camY - pad
  const y1 = camY + height + pad
  let iMin = Infinity
  let iMax = -Infinity
  let jMin = Infinity
  let jMax = -Infinity
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const i = (cx * v2[1] - cy * v2[0]) / det
    const j = (cy * v1[0] - cx * v1[1]) / det
    iMin = Math.min(iMin, i)
    iMax = Math.max(iMax, i)
    jMin = Math.min(jMin, j)
    jMax = Math.max(jMax, j)
  }
  iMin = Math.floor(iMin) - 1
  iMax = Math.ceil(iMax) + 1
  jMin = Math.floor(jMin) - 1
  jMax = Math.ceil(jMax) + 1

  ctx.lineWidth = Math.max(1, 1.4 * rt.pixelRatio)

  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const ox = i * v1[0] + j * v2[0]
      const oy = i * v1[1] + j * v2[1]
      for (const proto of protos) {
        // Tile centroid in world space drives noise (growth) and colour.
        const [pcx, pcy] = centroid(proto)
        const wcx = ox + pcx
        const wcy = oy + pcy
        const scx = wcx - camX
        const scy = wcy - camY
        if (scx < -pad || scx > width + pad || scy < -pad || scy > height + pad) continue

        const n = noise(wcx * 0.01, wcy * 0.01, growPhase)
        const growth = 1 - params.grow + params.grow * 2 * n // ~[1-grow, 1+grow]

        const hue = (hueBase + wcx * 0.05 + wcy * 0.04 + t * 12) % 360
        const light = 42 + n * 28
        const alpha = 0.25 + 0.6 * n

        ctx.beginPath()
        for (let k = 0; k < proto.length; k++) {
          // Scale the vertex about the tile centroid, then domain-warp it.
          const wx = wcx + (ox + proto[k][0] - wcx) * growth
          const wy = wcy + (oy + proto[k][1] - wcy) * growth
          const wp = warpAt(wx, wy, t, amt, params.warpScale)
          const vx = wx - camX + wp.dx
          const vy = wy - camY + wp.dy
          k === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
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
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
