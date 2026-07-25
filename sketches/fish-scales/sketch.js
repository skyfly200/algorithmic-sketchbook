/**
 * Fish Scales — a field of overlapping scales like the flank of a fish, drawn as
 * imbricated rows (each row offset half a scale and lapping the one below). A
 * species preset sets the palette and the pattern painted across the body — koi
 * patches, trout spots, mackerel bars, goldfish sheen, a tropical rainbow — and
 * a travelling iridescent highlight shimmers over everything as if the fish
 * turns in the light. Beats send a bright ripple down the flank.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  species: { value: 'Koi', type: 'select', options: ['Koi', 'Rainbow trout', 'Mackerel', 'Goldfish', 'Tropical'], label: 'Species' },
  scale: { value: 0.5, min: 0.2, max: 1.5, step: 0.02, label: 'Scale size' },
  iridescence: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Iridescence' },
  shimmer: { value: 0.6, min: 0, max: 3, step: 0.05, label: 'Shimmer speed' },
  curvature: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Scale roundness' },
  pattern: { value: 0.8, min: 0, max: 1.4, step: 0.02, label: 'Pattern strength' },
  hue: { value: 0, min: -60, max: 60, step: 1, label: 'Hue shift' },
})
rt.mapInput('audio.mid', 'shimmer', 1.5)
rt.mapInput('audio.pulse', 'iridescence', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W = 0, H = 0, minDim = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  minDim = Math.min(W, H)
}

function hsl(h, s, l) {
  h = ((h % 360) + 360) / 360
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
// value-noise-ish hash for the procedural body patterns
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

// Per-species colour at normalized body position (u across, v down the flank),
// returning [hue, sat, light] before the shimmer highlight is applied.
function bodyColor(u, v, sp) {
  const back = 1 - v // 1 at the top (dark back), 0 at the belly
  const hueS = params.hue
  if (sp === 'Koi') {
    // white base with soft red/black kohaku patches from low-freq noise
    const patch = vnoise(u * 4 + 10, v * 4)
    const black = vnoise(u * 5 + 40, v * 5 + 7)
    if (black > 0.72) return [220 + hueS, 0.15, 0.16]
    if (patch > 0.58) return [12 + hueS, 0.85, 0.52] // red
    return [30 + hueS, 0.08, 0.9] // pearly white
  }
  if (sp === 'Rainbow trout') {
    const stripe = 0.5 + 0.5 * Math.sin(v * Math.PI) // pink lateral band mid-flank
    const spot = hash(Math.floor(u * 40), Math.floor(v * 26)) > 0.93 ? 1 : 0
    if (spot) return [200 + hueS, 0.2, 0.12]
    const h = 150 + hueS - back * 40 + stripe * -140
    return [h, 0.3 + stripe * 0.3, 0.35 + back * 0.12 + stripe * 0.18]
  }
  if (sp === 'Mackerel') {
    // steely green-blue back with wavy dark bars, silver belly
    const bar = Math.sin(u * 26 + Math.sin(v * 6) * 2.2) // wavy vertical bars
    const dark = back * (0.5 + 0.5 * Math.max(0, bar))
    const h = 185 + hueS - back * 30
    return [h, 0.25 + back * 0.35, 0.72 - back * 0.32 - dark * 0.28]
  }
  if (sp === 'Goldfish') {
    const h = 32 + hueS + vnoise(u * 3, v * 3) * 14
    return [h, 0.9, 0.5 + back * 0.06]
  }
  // Tropical: rainbow bands across the flank
  const h = (u * 320 + v * 60 + hueS)
  return [h, 0.85, 0.55]
}

// One scale: a rounded fan clipped to a semicircle, filled with a radial
// gradient from a darker seat to a lighter free edge, plus a moving glint.
function drawScale(cx, cy, r, col, glint) {
  const [h, s, l] = col
  const round = 0.5 + params.curvature * 0.5
  const top = cy - r * round
  ctx.save()
  ctx.beginPath()
  // a scallop: arc across the top, meeting at the seated base below
  ctx.moveTo(cx - r, cy)
  ctx.quadraticCurveTo(cx - r, top, cx, top)
  ctx.quadraticCurveTo(cx + r, top, cx + r, cy)
  ctx.quadraticCurveTo(cx, cy + r * 0.5, cx - r, cy)
  ctx.closePath()
  ctx.clip()
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.3)
  const base = hsl(h, s, Math.max(0.05, l - 0.14))
  const edge = hsl(h, s * 0.8, Math.min(0.95, l + 0.12 + glint * 0.5))
  g.addColorStop(0, `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`)
  g.addColorStop(1, `rgb(${edge[0] | 0},${edge[1] | 0},${edge[2] | 0})`)
  ctx.fillStyle = g
  ctx.fillRect(cx - r - 1, top - 1, r * 2 + 2, r * 2 + 2)
  // iridescent rim highlight along the free edge
  if (glint > 0.01) {
    ctx.globalAlpha = glint
    ctx.strokeStyle = `rgb(${edge[0] | 0},${edge[1] | 0},${edge[2] | 0})`
    ctx.lineWidth = Math.max(1, r * 0.12)
    ctx.beginPath()
    ctx.moveTo(cx - r, cy)
    ctx.quadraticCurveTo(cx - r, top, cx, top)
    ctx.quadraticCurveTo(cx + r, top, cx + r, cy)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function render(t) {
  const sp = params.species
  // background = the darkest body tone so gaps read as shadow between scales
  const bg = hsl(bodyColor(0.5, 0.5, sp)[0], 0.4, 0.06)
  ctx.fillStyle = `rgb(${bg[0] | 0},${bg[1] | 0},${bg[2] | 0})`
  ctx.fillRect(0, 0, W, H)

  const r = minDim * 0.05 * params.scale
  const colW = r * 1.6
  const rowH = r * 0.95
  const cols = Math.ceil(W / colW) + 2
  const rows = Math.ceil(H / rowH) + 2
  // travelling shimmer: a diagonal band whose phase moves with time
  const sh = params.shimmer * t
  const irid = params.iridescence
  const pulse = rt.beat.state.pulse
  for (let ry = 0; ry < rows; ry++) {
    const cy = ry * rowH
    const off = (ry % 2) * colW * 0.5 // half-offset alternate rows (imbricate)
    for (let cxI = 0; cxI < cols; cxI++) {
      const cx = cxI * colW + off - colW
      const u = cx / W, v = cy / H
      let col = bodyColor(u, v, sp)
      // pattern strength scales the deviation of sat/light from a neutral scale
      if (params.pattern !== 1) {
        col = [col[0], col[1] * params.pattern, 0.5 + (col[2] - 0.5) * params.pattern]
      }
      // moving iridescent glint: bright where the shimmer band crosses this scale
      const band = Math.sin((u * 6 + v * 3) * Math.PI - sh * 2)
      const glint = Math.max(0, band) ** 3 * irid * (0.7 + pulse) + pulse * 0.15
      drawScale(cx, cy, r, col, Math.min(1, glint))
    }
  }
}

function frame(now) {
  rt.tick(now)
  render(now * 0.001)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
