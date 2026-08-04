/**
 * Sand Art — a falling-sand cellular automaton. One or more spouts pour streams
 * of colour-cycling sand that fall, pile up at their angle of repose, and settle
 * into banded dunes. Each grain is one cell: it drops straight down if it can,
 * otherwise tumbles diagonally (gated by a "looseness" so piles hold a slope). A
 * slow floor drain keeps the sand flowing so the layers build, slump and restack
 * forever. Drop in a container or a field of obstacles and the sand pools, spills
 * and streams around them.
 *
 * Drag to pour your own sand; the colour keeps cycling as you go.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  cell: { value: 1, min: 1, max: 8, step: 1, label: 'Grain size' },
  faucets: { value: 1, min: 1, max: 6, step: 1, label: 'Faucets' },
  pour: { value: 1.4, min: 0, max: 3, step: 0.05, label: 'Pour rate' },
  looseness: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Looseness (slope)' },
  gradient: { value: 'Rainbow', type: 'select', options: ['Rainbow', 'Sunset', 'Ocean', 'Earth', 'Candy', 'Mono'], label: 'Sand gradient' },
  spread: { value: 1, min: 0.1, max: 3, step: 0.05, label: 'Gradient bands' },
  hueRate: { value: 0.7, min: 0, max: 3, step: 0.05, label: 'Colour cycling' },
  container: { value: 'None', type: 'select', options: ['None', 'Bowl', 'Funnel', 'Pegs', 'Hourglass'], label: 'Obstacles' },
  drain: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Floor drain' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette shift' },
})
// Music: louder pours more sand.
rt.mapInput('audio.volume', 'pour', 0.7)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const grid = document.createElement('canvas')
const gctx = grid.getContext('2d')

let W, H, cols, rows, sand, wall, img
let huePhase = 0
let spoutX = 0.5
let spoutDir = 1

// 0 = empty; else 1..255 encodes the grain's colour byte (never 0).
function rebuild() {
  const cs = Math.max(2, Math.round(params.cell) * rt.pixelRatio)
  cols = Math.max(16, Math.floor(W / cs))
  rows = Math.max(16, Math.floor(H / cs))
  sand = new Uint8Array(cols * rows)
  wall = new Uint8Array(cols * rows)
  grid.width = cols
  grid.height = rows
  img = gctx.createImageData(cols, rows)
  buildWalls()
}
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  rebuild()
}

// --- immovable obstacles / containers ---------------------------------------
let wallSig = ''
function buildWalls() {
  wall.fill(0)
  wallSig = params.container
  const setW = (x, y) => { x |= 0; y |= 0; if (x >= 0 && x < cols && y >= 0 && y < rows) wall[y * cols + x] = 1 }
  const line = (x0, y0, x1, y1, th = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0
    for (let s = 0; s <= n; s++) {
      const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n
      for (let o = 0; o < th; o++) { setW(x, y + o); setW(x + o, y) }
    }
  }
  const c = params.container
  if (c === 'Bowl') {
    const bx0 = cols * 0.16, bx1 = cols * 0.84, by = rows * 0.86, th = Math.max(2, cols * 0.01)
    for (let x = bx0; x <= bx1; x++) for (let o = 0; o < th; o++) setW(x, by + o)
    for (let y = rows * 0.5; y <= by; y++) for (let o = 0; o < th; o++) { setW(bx0 + o, y); setW(bx1 - o, y) }
  } else if (c === 'Funnel') {
    const cx = cols / 2, gap = cols * 0.05, apex = rows * 0.66, th = Math.max(2, cols * 0.01)
    line(cols * 0.04, rows * 0.34, cx - gap, apex, th)
    line(cols * 0.96, rows * 0.34, cx + gap, apex, th)
    // a short chute below the throat
    for (let y = apex; y < rows * 0.82; y++) { for (let o = 0; o < th; o++) { setW(cx - gap + o, y); setW(cx + gap - o, y) } }
  } else if (c === 'Hourglass') {
    const cx = cols / 2, gap = cols * 0.045, waist = rows * 0.5, th = Math.max(2, cols * 0.01)
    line(cols * 0.06, rows * 0.16, cx - gap, waist, th)
    line(cols * 0.94, rows * 0.16, cx + gap, waist, th)
    line(cx - gap, waist, cols * 0.06, rows * 0.84, th)
    line(cx + gap, waist, cols * 0.94, rows * 0.84, th)
  } else if (c === 'Pegs') {
    const sp = Math.max(7, cols * 0.1), pr = Math.max(1, sp * 0.14) | 0
    let ri = 0
    for (let y = rows * 0.24; y < rows * 0.88; y += sp * 1.5, ri++) {
      const off = ri % 2 ? sp * 0.5 : 0
      for (let x = off + sp * 0.5; x < cols; x += sp) {
        for (let dy = -pr; dy <= pr; dy++) for (let dx = -pr; dx <= pr; dx++) setW(x + dx, y + dy)
      }
    }
  }
}

// --- palette: sample a colour gradient, tinted/shifted by the hue control ----
const GRADS = {
  Sunset: [[35, 10, 60], [130, 20, 95], [225, 60, 75], [250, 150, 45], [255, 225, 130]],
  Ocean: [[10, 25, 60], [12, 72, 112], [22, 145, 165], [120, 212, 200], [225, 248, 238]],
  Earth: [[58, 40, 24], [120, 85, 45], [162, 132, 72], [100, 112, 56], [196, 174, 124]],
  Candy: [[255, 120, 172], [255, 205, 120], [140, 232, 182], [150, 182, 255], [232, 150, 255]],
  Mono: [[22, 20, 17], [92, 82, 70], [182, 166, 140], [242, 232, 212]],
}
function hslRGB(h) {
  const s = 0.72, l = 0.55
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
function sampleGrad(name, t) {
  t = ((t % 1) + 1) % 1
  if (name === 'Rainbow') return hslRGB(t)
  const st = GRADS[name]
  const f = t * st.length
  const i = Math.floor(f) % st.length, g = f - Math.floor(f)
  const a = st[i], b = st[(i + 1) % st.length]
  return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g]
}
let lut = null, lutSig = ''
function buildLut() {
  lut = new Uint8Array(256 * 3)
  const grad = params.gradient, spread = params.spread, shift = params.hue
  for (let b = 1; b < 256; b++) {
    const [r, g, bl] = sampleGrad(grad, (b / 255) * spread + shift)
    lut[b * 3] = r; lut[b * 3 + 1] = g; lut[b * 3 + 2] = bl
  }
  lutSig = grad + spread + shift
}

function pourAt(cx, cyRow, wCells, byte) {
  for (let k = -wCells; k <= wCells; k++) {
    if (rt.rng() > 0.88) continue
    const x = (cx + k + cols) % cols
    const y = Math.max(0, cyRow + ((rt.rng() * 2) | 0))
    const i = y * cols + x
    if (sand[i] === 0 && wall[i] === 0) sand[i] = byte
  }
}

function step(loose) {
  for (let y = rows - 2; y >= 0; y--) {
    const dirScan = y & 1 ? 1 : -1
    for (let n = 0; n < cols; n++) {
      const x = dirScan > 0 ? n : cols - 1 - n
      const i = y * cols + x
      const v = sand[i]
      if (v === 0) continue
      const below = i + cols
      if (sand[below] === 0 && wall[below] === 0) { sand[below] = v; sand[i] = 0; continue }
      if (rt.rng() > loose) continue
      const d = rt.rng() < 0.5 ? -1 : 1
      const xa = x + d
      if (xa >= 0 && xa < cols && sand[below + d] === 0 && wall[below + d] === 0) { sand[below + d] = v; sand[i] = 0; continue }
      const xb = x - d
      if (xb >= 0 && xb < cols && sand[below - d] === 0 && wall[below - d] === 0) { sand[below - d] = v; sand[i] = 0 }
    }
  }
}

function render() {
  const sig = params.gradient + params.spread + params.hue
  if (sig !== lutSig || !lut) buildLut()
  const d = img.data
  for (let i = 0; i < cols * rows; i++) {
    if (wall[i]) { d[i * 4] = 74; d[i * 4 + 1] = 70; d[i * 4 + 2] = 64; d[i * 4 + 3] = 255; continue }
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
let pourAcc = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (params.container !== wallSig) buildWalls()

  huePhase = (huePhase + params.hueRate * dt * 0.15) % 1
  const byte = 1 + ((huePhase * 254) | 0)

  const nF = Math.round(params.faucets)
  // Accumulate a fractional pour budget so a low rate trickles (a pass every few
  // frames) instead of quantising to a full pass per faucet every frame — which
  // dumped far too much sand once several faucets ran at once.
  pourAcc += params.pour * 7
  const passes = Math.floor(pourAcc)
  pourAcc -= passes
  const spoutW = Math.max(2, (cols * 0.03) | 0)
  if (nF === 1) {
    // a single spout sweeps briskly across the top → horizontal sand-art bands
    spoutX += spoutDir * dt * 0.4
    if (spoutX > 0.92) { spoutX = 0.92; spoutDir = -1 }
    if (spoutX < 0.08) { spoutX = 0.08; spoutDir = 1 }
    for (let p = 0; p < passes; p++) pourAt((spoutX * cols) | 0, 0, spoutW, byte)
  } else {
    // several fixed faucets, evenly spread → a row of banded cones
    for (let f = 0; f < nF; f++) {
      const fx = (0.1 + 0.8 * (f + 0.5) / nF) * cols
      for (let p = 0; p < passes; p++) pourAt(fx | 0, 0, spoutW, byte)
    }
  }

  if (drag.on) pourAt(Math.round((drag.x / W) * cols), Math.round((drag.y / H) * rows), Math.max(2, (cols * 0.02) | 0), byte)

  // Floor drain: pull grains out of the bottom row so the sand keeps flowing.
  let filled = 0
  for (let x = 0; x < cols; x++) if (sand[(rows - 1) * cols + x]) filled++
  if (filled > cols * 0.8) {
    const dr = params.drain * 0.15
    for (let x = 0; x < cols; x++) if (rt.rng() < dr) sand[(rows - 1) * cols + x] = 0
  }

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
