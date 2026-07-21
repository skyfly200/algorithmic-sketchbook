/**
 * Sand Art — a falling-sand cellular automaton. A sweeping spout pours streams
 * of colour-cycling sand that fall, pile up at their angle of repose, and settle
 * into the banded dunes of a sand-art bottle. Each grain is one cell: it drops
 * straight down if it can, otherwise tumbles diagonally (gated by a "looseness"
 * so piles hold a slope). A slow drain at the floor keeps the sand flowing so
 * the layers build, slump, and restack forever.
 *
 * Drag to pour your own sand; the colour keeps cycling as you go.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  cell: { value: 1, min: 1, max: 8, step: 1, label: 'Grain size' },
  pour: { value: 1.4, min: 0, max: 3, step: 0.05, label: 'Pour rate' },
  looseness: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Looseness (slope)' },
  hueRate: { value: 0.7, min: 0, max: 3, step: 0.05, label: 'Colour cycling' },
  drain: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Floor drain' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette' },
})
// Music: louder pours more sand.
rt.mapInput('audio.volume', 'pour', 0.7)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const grid = document.createElement('canvas')
const gctx = grid.getContext('2d')

let W, H, cols, rows, sand, img
let huePhase = 0
let spoutX = 0.5
let spoutDir = 1

// 0 = empty; else 1..255 encodes the grain's hue byte (never 0).
function rebuild() {
  // Floor the cell at 2 device px so the finest grain setting stays affordable
  // even when the pixel ratio is 1 (otherwise the CA grid can balloon to one
  // cell per pixel and tank the frame rate).
  const cs = Math.max(2, Math.round(params.cell) * rt.pixelRatio)
  cols = Math.max(16, Math.floor(W / cs))
  rows = Math.max(16, Math.floor(H / cs))
  sand = new Uint8Array(cols * rows)
  grid.width = cols
  grid.height = rows
  img = gctx.createImageData(cols, rows)
}
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  rebuild()
}

// HSL→packed RGB for the palette (bands of the cycling hue).
function hueColor(byte) {
  const h = (byte / 255 + params.hue) % 1
  const s = 0.72
  const l = 0.55
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
// Precompute a LUT so render doesn't recompute HSL per grain each frame.
let lut = null
let lutHue = -1
function buildLut() {
  lut = new Uint8Array(256 * 3)
  for (let b = 1; b < 256; b++) {
    const [r, g, bl] = hueColor(b)
    lut[b * 3] = r; lut[b * 3 + 1] = g; lut[b * 3 + 2] = bl
  }
  lutHue = params.hue
}

function pourAt(cx, cyRow, wCells, byte) {
  for (let k = -wCells; k <= wCells; k++) {
    if (rt.rng() > 0.88) continue
    const x = (cx + k + cols) % cols
    const y = Math.max(0, cyRow + ((rt.rng() * 2) | 0))
    if (sand[y * cols + x] === 0) sand[y * cols + x] = byte
  }
}

function step(loose) {
  // Bottom-up so a grain only moves one cell per frame.
  for (let y = rows - 2; y >= 0; y--) {
    const dirScan = y & 1 ? 1 : -1 // alternate scan direction to avoid drift bias
    for (let n = 0; n < cols; n++) {
      const x = dirScan > 0 ? n : cols - 1 - n
      const i = y * cols + x
      const v = sand[i]
      if (v === 0) continue
      const below = i + cols
      if (sand[below] === 0) { sand[below] = v; sand[i] = 0; continue }
      if (rt.rng() > loose) continue // hold the slope
      const d = rt.rng() < 0.5 ? -1 : 1
      const xa = x + d
      if (xa >= 0 && xa < cols && sand[below + d] === 0) { sand[below + d] = v; sand[i] = 0; continue }
      const xb = x - d
      if (xb >= 0 && xb < cols && sand[below - d] === 0) { sand[below - d] = v; sand[i] = 0 }
    }
  }
}

function render() {
  if (params.hue !== lutHue || !lut) buildLut()
  const d = img.data
  for (let i = 0; i < cols * rows; i++) {
    const v = sand[i]
    if (v === 0) { d[i * 4] = 8; d[i * 4 + 1] = 7; d[i * 4 + 2] = 11; d[i * 4 + 3] = 255; continue }
    d[i * 4] = lut[v * 3]; d[i * 4 + 1] = lut[v * 3 + 1]; d[i * 4 + 2] = lut[v * 3 + 2]; d[i * 4 + 3] = 255
  }
  gctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(grid, 0, 0, W, H)
}

const drag = { on: false, x: 0, y: 0 }
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  huePhase = (huePhase + params.hueRate * dt * 0.15) % 1
  const byte = 1 + ((huePhase * 254) | 0)

  // A spout that sweeps briskly across the top; because it sweeps faster than
  // the colour cycles, each pass lays a near-uniform band → horizontal layers.
  spoutX += spoutDir * dt * 0.4
  if (spoutX > 0.92) { spoutX = 0.92; spoutDir = -1 }
  if (spoutX < 0.08) { spoutX = 0.08; spoutDir = 1 }
  const passes = Math.max(0, Math.round(params.pour * 7))
  const spoutW = Math.max(2, (cols * 0.03) | 0)
  for (let p = 0; p < passes; p++) pourAt((spoutX * cols) | 0, 0, spoutW, byte)

  // Pour from the cursor while dragging.
  if (drag.on) pourAt(Math.round((drag.x / W) * cols), Math.round((drag.y / H) * rows), Math.max(2, (cols * 0.02) | 0), byte)

  // Floor drain: pull grains out of the bottom row so the sand keeps flowing.
  // Only kick in once the sand has built up, so it fills before it recycles.
  let filled = 0
  for (let x = 0; x < cols; x++) if (sand[(rows - 1) * cols + x]) filled++
  if (filled > cols * 0.8) {
    const dr = params.drain * 0.15
    for (let x = 0; x < cols; x++) if (rt.rng() < dr) sand[(rows - 1) * cols + x] = 0
  }

  // A couple of settle steps per frame for a lively flow.
  step(params.looseness)
  step(params.looseness)
  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => { drag.on = true; drag.x = e.clientX * rt.pixelRatio; drag.y = e.clientY * rt.pixelRatio })
canvas.addEventListener('pointermove', (e) => { drag.x = e.clientX * rt.pixelRatio; drag.y = e.clientY * rt.pixelRatio })
window.addEventListener('pointerup', () => (drag.on = false))
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
