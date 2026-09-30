// Neon Sign — glowing glass tubing bent into shapes against a dark brick
// wall: multi-pass bloom gives the tubes their halo, a couple of letters
// flicker and buzz like a failing transformer, and the whole sign hums
// brighter on the beat. Seeded shapes and colours each load.
//
// Performance: the brick wall is baked once per size, and the glow is drawn and
// blurred at quarter resolution (16x fewer pixels per blur) then scaled up.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  shape: { value: rt.pick(['open', 'heart', 'cocktail', 'arrow', 'wave']), type: 'select', options: ['open', 'heart', 'cocktail', 'arrow', 'wave'], label: 'Sign' },
  glow: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Glow' },
  flicker: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Flicker' },
  hue: { value: rt.random(280, 340), min: 0, max: 360, step: 1, label: 'Tube hue' },
  hue2: { value: rt.random(160, 200), min: 0, max: 360, step: 1, label: 'Accent hue' },
  thickness: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Tube width' },
  buzz: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Buzz' },
})
rt.mapInput('audio.pulse', 'glow', 0.4)

let W = 0, H = 0
const Q = 0.25 // glow resolution relative to the canvas
const glowC = document.createElement('canvas') // tubes, drawn small
const gx = glowC.getContext('2d')
const blurC = document.createElement('canvas') // blurred copy, reused for each halo
const bx = blurC.getContext('2d')
const wall = document.createElement('canvas') // baked brick wall
function bakeWall() {
  wall.width = W; wall.height = H
  const c = wall.getContext('2d')
  c.fillStyle = '#0d0a0c'; c.fillRect(0, 0, W, H)
  c.strokeStyle = 'rgba(255,255,255,0.02)'; c.lineWidth = rt.pixelRatio
  const bh = 26 * rt.pixelRatio
  c.beginPath()
  for (let y = 0, row = 0; y < H; y += bh, row++) {
    c.moveTo(0, y); c.lineTo(W, y)
    const off = (row % 2) * bh
    for (let x = off; x < W; x += bh * 2) { c.moveTo(x, y); c.lineTo(x, y + bh) }
  }
  c.stroke()
}
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  glowC.width = blurC.width = Math.max(2, Math.round(W * Q))
  glowC.height = blurC.height = Math.max(2, Math.round(H * Q))
  bakeWall()
}
// each shape is a set of polyline strokes in a -1..1 box, [hueKind, points]
function shapePaths(name) {
  const P = []
  const seg = (pts, k = 0) => P.push({ k, pts })
  if (name === 'heart') {
    const pts = []
    for (let a = 0; a <= Math.PI * 2; a += 0.08) {
      const x = 16 * Math.pow(Math.sin(a), 3) / 16
      const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16
      pts.push([x * 0.9, y * 0.9])
    }
    seg(pts)
  } else if (name === 'cocktail') {
    seg([[-0.5, -0.5], [0.5, -0.5], [0.08, 0.15], [0.08, 0.6], [-0.3, 0.75], [0.46, 0.75]], 0)
    seg([[-0.5, -0.5], [0, 0], [0.5, -0.5]], 1)
    P.push({ k: 1, pts: circle(0.34, -0.44, 0.07) })
  } else if (name === 'arrow') {
    seg([[-0.7, 0], [0.5, 0]], 0)
    seg([[0.2, -0.3], [0.6, 0], [0.2, 0.3]], 0)
    P.push({ k: 1, pts: roundRect(-0.85, -0.5, 1.7, 1.0) })
  } else if (name === 'wave') {
    for (let r = 0; r < 3; r++) {
      const pts = []
      for (let x = -0.8; x <= 0.8; x += 0.05) pts.push([x, -0.3 + r * 0.3 + Math.sin(x * 6) * 0.12])
      seg(pts, r % 2)
    }
  } else { // OPEN
    seg([[-0.75, -0.3], [-0.75, 0.3], [-0.55, 0.3], [-0.55, -0.3], [-0.75, -0.3]], 0) // O
    seg([[-0.4, 0.3], [-0.4, -0.3], [-0.2, -0.3], [-0.2, 0], [-0.4, 0]], 0) // P
    seg([[-0.05, 0.3], [-0.05, -0.3], [0.15, -0.3], [0.15, 0.3], [-0.05, 0], [0.15, 0]], 0) // E-ish
    seg([[0.3, 0.3], [0.3, -0.3], [0.5, 0.3], [0.5, -0.3]], 0) // N
    P.push({ k: 1, pts: roundRect(-0.9, -0.5, 1.8, 1.0) })
  }
  return P
}
function circle(cx, cy, r) { const p = []; for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.2) p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); return p }
function roundRect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] }
let paths = shapePaths(params.shape)
let curShape = params.shape
const flickerState = {}

function stroke(c, paths, cx, cy, scale, lw, hue, hue2, lightF) {
  for (let pi = 0; pi < paths.length; pi++) {
    const seg = paths[pi]
    const f = flickerState[pi] ?? 1
    c.strokeStyle = `hsl(${seg.k ? hue2 : hue}, 100%, ${60 + f * 25}%)`
    c.lineWidth = lw
    c.lineJoin = 'round'; c.lineCap = 'round'
    c.globalAlpha = (0.4 + f * 0.6) * lightF
    c.beginPath()
    for (let i = 0; i < seg.pts.length; i++) {
      const x = cx + seg.pts[i][0] * scale, y = cy + seg.pts[i][1] * scale
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
    }
    c.stroke()
  }
  c.globalAlpha = 1
}
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  if (params.shape !== curShape) { curShape = params.shape; paths = shapePaths(params.shape) }

  // per-segment flicker: mostly on, occasionally a segment stutters
  for (let i = 0; i < paths.length; i++) {
    if (rt.rng() < params.flicker * 0.04) flickerState[i] = rt.rng() < 0.5 ? 0.1 : 1
    else if (flickerState[i] === undefined) flickerState[i] = 1
    // buzz: fast subtle brightness ripple
    flickerState[i] = Math.min(1, (flickerState[i] ?? 1) + dt * 4) * (1 - params.buzz * 0.08 * (0.5 + 0.5 * Math.sin(t * 60 + i)))
  }

  // brick wall (baked)
  ctx.drawImage(wall, 0, 0)

  const cx = W / 2, cy = H / 2
  const scale = Math.min(W, H) * 0.42
  const lw = 6 * rt.pixelRatio * params.thickness
  const lightF = params.glow

  // glow pass: draw thick at quarter res, blur there, add back scaled up
  gx.clearRect(0, 0, glowC.width, glowC.height)
  stroke(gx, paths, cx * Q, cy * Q, scale * Q, lw * 2.2 * Q, params.hue, params.hue2, lightF)
  ctx.globalCompositeOperation = 'lighter'
  ctx.imageSmoothingEnabled = true
  const halo = (blurPx, alpha) => {
    bx.clearRect(0, 0, blurC.width, blurC.height)
    bx.filter = `blur(${blurPx * rt.pixelRatio * Q}px)`
    bx.drawImage(glowC, 0, 0)
    bx.filter = 'none'
    ctx.globalAlpha = alpha * params.glow
    ctx.drawImage(blurC, 0, 0, W, H)
  }
  halo(10, 0.8)
  halo(22, 0.5)
  ctx.globalAlpha = 1
  // crisp tube core
  stroke(ctx, paths, cx, cy, scale, lw, params.hue, params.hue2, 1)
  // bright inner filament
  stroke(ctx, paths.map((p) => ({ k: p.k, pts: p.pts })), cx, cy, scale, lw * 0.35, params.hue, params.hue2, 1)
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
