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
// gradient from a darker seat to a lighter free edge, plus a moving glint. The
// shape is deliberately irregular — asymmetric widths, an uneven top, a tilt and
// an off-centre highlight — so no two scales read the same (`o` carries the
// per-scale jitter).
function drawScale(cx, cy, r, col, glint, o) {
  const [h, s, l] = col
  const top = -r * o.round
  const lw = r * o.lw, rw = r * o.rw
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(o.rot)
  ctx.beginPath()
  ctx.moveTo(-lw, 0)
  ctx.quadraticCurveTo(-lw, top * o.lh, 0, top)
  ctx.quadraticCurveTo(rw, top * o.rh, rw, 0)
  ctx.quadraticCurveTo(0, r * o.dip, -lw, 0)
  ctx.closePath()
  ctx.clip()
  const g = ctx.createRadialGradient(o.gx * r, o.gy * r, r * 0.08, 0, 0, r * 1.35)
  const base = hsl(h, s, Math.max(0.05, l - 0.14))
  const edge = hsl(h, s * 0.8, Math.min(0.95, l + 0.12 + glint * 0.5))
  g.addColorStop(0, `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`)
  g.addColorStop(1, `rgb(${edge[0] | 0},${edge[1] | 0},${edge[2] | 0})`)
  ctx.fillStyle = g
  ctx.fillRect(-lw - 1, top - 1, lw + rw + 2, r * 2 + 2)
  // iridescent rim highlight along the free edge
  if (glint > 0.01) {
    ctx.globalAlpha = glint
    ctx.strokeStyle = `rgb(${edge[0] | 0},${edge[1] | 0},${edge[2] | 0})`
    ctx.lineWidth = Math.max(1, r * 0.12)
    ctx.beginPath()
    ctx.moveTo(-lw, 0)
    ctx.quadraticCurveTo(-lw, top * o.lh, 0, top)
    ctx.quadraticCurveTo(rw, top * o.rh, rw, 0)
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
  const cols = Math.ceil(W / colW) + 3
  const rows = Math.ceil(H / rowH) + 3
  const sh = params.shimmer * t
  const irid = params.iridescence
  const pulse = rt.beat.state.pulse
  for (let ry = 0; ry < rows; ry++) {
    // rows waver left/right and breathe up/down a little, so the lattice isn't
    // a perfect grid
    const wav = Math.sin(ry * 0.9) * colW * 0.14 + Math.sin(ry * 2.3 + 1.7) * colW * 0.05
    const cyRow = ry * rowH + Math.sin(ry * 1.7) * rowH * 0.08
    const off = (ry % 2) * colW * 0.5 + wav
    for (let cxI = 0; cxI < cols; cxI++) {
      // four decorrelated hashes drive the per-scale jitter
      const h1 = hash(cxI * 1.7 + ry * 13.1, ry * 1.9 + 3.3)
      const h2 = hash(cxI * 3.1 + 5.2, ry * 2.3 + cxI * 0.7)
      const h3 = hash(cxI + 9.4, ry * 4.1 + 2.2)
      const h4 = hash(cxI * 5.3 + 1.1, ry + 11.7)
      const h5 = hash(cxI * 0.9 + ry * 7.7, cxI * 2.1 + 4.5)
      const cx = cxI * colW + off - colW * 1.5 + (h1 - 0.5) * colW * 0.22
      const cy = cyRow + (h2 - 0.5) * rowH * 0.22
      const u = cx / W, v = cy / H
      let col = bodyColor(u, v, sp)
      // per-scale tone + hue jitter so patches break up organically
      col = [col[0] + (h1 - 0.5) * 10, col[1] * (0.85 + h3 * 0.3), col[2] + (h5 - 0.5) * 0.12]
      if (params.pattern !== 1) col = [col[0], col[1] * params.pattern, 0.5 + (col[2] - 0.5) * params.pattern]
      const rr = r * (0.78 + h3 * 0.4)
      // a worn / missing scale now and then: a dark socket showing the skin below
      if (h4 < 0.03 + params.pattern * 0.01) {
        ctx.save(); ctx.globalAlpha = 0.8
        const dk = hsl(col[0], col[1] * 0.5, Math.max(0.03, col[2] - 0.28))
        ctx.fillStyle = `rgb(${dk[0] | 0},${dk[1] | 0},${dk[2] | 0})`
        ctx.beginPath(); ctx.ellipse(cx, cy - rr * 0.2, rr * 0.7, rr * 0.55, 0, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        continue
      }
      const band = Math.sin((u * 6 + v * 3) * Math.PI - sh * 2)
      const glint = Math.max(0, band) ** 3 * irid * (0.7 + pulse) + pulse * 0.15
      drawScale(cx, cy, rr, col, Math.min(1, glint), {
        round: params.curvature * (0.6 + h5 * 0.6) + 0.2,
        rot: (h4 - 0.5) * 0.5,
        lw: 0.82 + h1 * 0.34, rw: 0.82 + h2 * 0.34,
        lh: 0.88 + h3 * 0.28, rh: 0.88 + h4 * 0.28,
        dip: 0.35 + h5 * 0.4,
        gx: (h2 - 0.5) * 0.6, gy: (h3 - 0.5) * 0.6,
      })
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
