/**
 * Zen Garden — a raked-sand karesansui you tend with the cursor. The sand is a
 * height field: drag a rake and it carves a band of parallel grooves that follow
 * your stroke (curving as you curve); click on open sand to set a stone, and
 * concentric ripples ring it the way real gardens are raked around rocks. The
 * field is lit at a low grazing angle so every furrow casts a soft shadow and
 * catches a highlight on its far crest — the calm, tactile look of combed sand.
 *
 * Drag to rake · click to place a stone · press C to clear the sand.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  tines: { value: 7, min: 3, max: 16, step: 1, label: 'Rake tines' },
  spacing: { value: 10, min: 4, max: 26, step: 1, label: 'Groove spacing' },
  depth: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Groove depth' },
  light: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Light height' },
  sand: { value: 0.09, min: 0, max: 1, step: 0.01, label: 'Sand hue' },
  stoneSize: { value: 1, min: 0.5, max: 2.2, step: 0.05, label: 'Stone size' },
})

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

let W, H, gsc, gw, gh
let height, grain, img
let dirty = true
const stones = []

function build() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  gsc = Math.max(1.6, 2 * rt.pixelRatio) / rt.detail
  gw = Math.max(120, Math.floor(W / gsc))
  gh = Math.max(120, Math.floor(H / gsc))
  buf.width = gw
  buf.height = gh
  img = bctx.createImageData(gw, gh)
  height = new Float32Array(gw * gh)
  grain = new Float32Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) grain[i] = rt.rng() // static sand tooth
  stones.length = 0
  dirty = true
}

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

// Carve a band of parallel grooves along a stroke segment (grid coords).
function rakeSeg(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len, py = dx / len // unit perpendicular
  const sp = params.spacing / gsc
  const halfW = (params.tines * sp) / 2
  const steps = Math.ceil(len) + 1
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const cx = ax + dx * t, cy = ay + dy * t
    for (let w = -halfW; w <= halfW; w += 0.5) {
      const gx = Math.round(cx + px * w)
      const gy = Math.round(cy + py * w)
      if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue
      const edge = 1 - Math.abs(w / halfW) ** 4 // fade the band's outer edges
      height[gy * gw + gx] = -params.depth * Math.cos((w / sp) * Math.PI * 2) * edge
    }
  }
  dirty = true
}

// Concentric ripples around a stone.
function ripples(cx, cy, R) {
  const sp = params.spacing / gsc
  const r = Math.ceil(R)
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y)
      if (d > R) continue
      const gx = (cx + x) | 0, gy = (cy + y) | 0
      if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue
      const fade = 1 - (d / R) ** 3
      height[gy * gw + gx] = -params.depth * Math.cos((d / sp) * Math.PI * 2) * fade
    }
  }
  dirty = true
}

function placeStone(gx, gy) {
  const r = (14 + rt.random(0, 16)) * params.stoneSize
  stones.push({ x: gx, y: gy, r, ry: r * rt.random(0.62, 0.82), rot: rt.random(-0.4, 0.4), tone: rt.random(0.3, 0.55) })
  ripples(gx, gy, r / gsc + params.spacing / gsc * 3.2)
}

// Shade the height field: grazing light so grooves emboss into ridged sand.
function shade() {
  const d = img.data
  const [sr, sg, sb] = hslArr(params.sand, 0.36, 0.66)
  const lz = 0.3 + params.light * 0.7
  const ln = 1 / Math.hypot(-0.6, -0.55, lz)
  const lx = -0.6 * ln, ly = -0.55 * ln, lzz = lz * ln
  const zScale = 4.5
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const h = height[i] + grain[i] * 0.12
      const hl = x > 0 ? height[i - 1] + grain[i - 1] * 0.12 : h
      const hr = x < gw - 1 ? height[i + 1] + grain[i + 1] * 0.12 : h
      const hu = y > 0 ? height[i - gw] + grain[i - gw] * 0.12 : h
      const hd = y < gh - 1 ? height[i + gw] + grain[i + gw] * 0.12 : h
      let nx = (hl - hr) * zScale, ny = (hu - hd) * zScale, nz = 1
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= il; ny *= il; nz *= il
      const diff = Math.max(0, nx * lx + ny * ly + nz * lzz)
      const v = 0.42 + diff * 0.7 + (grain[i] - 0.5) * 0.05 // ambient + light + tooth
      d[i * 4] = Math.min(255, sr * v * 255)
      d[i * 4 + 1] = Math.min(255, sg * v * 255)
      d[i * 4 + 2] = Math.min(255, sb * v * 255)
      d[i * 4 + 3] = 255
    }
  }
  bctx.putImageData(img, 0, 0)
  dirty = false
}

function drawStones() {
  for (const st of stones) {
    const x = st.x * gsc, y = st.y * gsc, r = st.r, ry = st.ry
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(st.rot)
    // Soft cast shadow toward the light-away side.
    ctx.globalAlpha = 0.28
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(r * 0.28, ry * 0.34, r * 1.02, ry * 1.02, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // Rock body, lit from upper-left.
    const g = ctx.createRadialGradient(-r * 0.4, -ry * 0.45, r * 0.1, 0, 0, r)
    const t = st.tone
    g.addColorStop(0, `rgb(${(150 * t) | 0},${(150 * t) | 0},${(158 * t) | 0})`)
    g.addColorStop(0.6, `rgb(${(90 * t) | 0},${(90 * t) | 0},${(98 * t) | 0})`)
    g.addColorStop(1, `rgb(${(40 * t) | 0},${(40 * t) | 0},${(46 * t) | 0})`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

function frame() {
  if (dirty) shade()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buf, 0, 0, W, H)
  drawStones()
  requestAnimationFrame(frame)
}

// Auto-tend a calm starting garden.
function seedGarden() {
  // A gentle horizontal comb across the whole bed.
  for (let y = 0; y < gh; y += (params.tines * params.spacing) / gsc) rakeSeg(0, y, gw, y)
  placeStone(gw * 0.32, gh * 0.4)
  placeStone(gw * 0.66, gh * 0.62)
  placeStone(gw * 0.5, gh * 0.24)
}

// --- interaction: drag to rake, click to place a stone ---
let down = false
let moved = false
let prev = null
function toGrid(e) { return [(e.clientX * rt.pixelRatio) / gsc, (e.clientY * rt.pixelRatio) / gsc] }
canvas.addEventListener('pointerdown', (e) => { down = true; moved = false; prev = toGrid(e) })
canvas.addEventListener('pointermove', (e) => {
  if (!down) return
  const p = toGrid(e)
  if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1) {
    moved = true
    rakeSeg(prev[0], prev[1], p[0], p[1])
    prev = p
  }
})
window.addEventListener('pointerup', (e) => {
  if (down && !moved) { const p = toGrid(e); placeStone(p[0], p[1]) }
  down = false
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') { height.fill(0); stones.length = 0; dirty = true }
})

function resize() { build(); seedGarden() }
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
