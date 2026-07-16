/**
 * Marbling — suminagashi / ebru on a virtual size bath. Each ink drop is a
 * closed loop of points; dropping a new one displaces every existing point
 * radially outward by the exact area-preserving map p → C + (p−C)·√(1 + r²/d²)
 * (Aubrey Jaffer's mathematical marbling), so earlier colours are pushed into
 * thin concentric shells. Drawing a comb/tine across the bath shears those
 * shells into the feathery combed patterns of real marbled paper.
 *
 * Drag to rake a comb through the ink; click to drop a stone.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  dropRate: { value: 0.8, min: 0, max: 4, step: 0.05, label: 'Drop rate' },
  dropSize: { value: 0.13, min: 0.04, max: 0.3, step: 0.01, label: 'Drop size' },
  flow: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Water flow' },
  combRate: { value: 0.3, min: 0, max: 3, step: 0.05, label: 'Comb rate' },
  combTeeth: { value: 8, min: 1, max: 24, step: 1, label: 'Comb teeth' },
  sharp: { value: 0.55, min: 0.1, max: 0.95, step: 0.01, label: 'Comb sharpness' },
  opacity: { value: 0.82, min: 0.3, max: 1, step: 0.02, label: 'Ink opacity' },
  palette: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette' },
})
// Music: beats drop stones, loudness stirs the water.
rt.mapInput('audio.pulse', 'dropRate', 0.8)
rt.mapInput('audio.volume', 'flow', 0.7)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W, H, minDim
const drops = [] // { color, pts: Float64Array [x0,y0,x1,y1,...] }
const MAX_DROPS = 90

function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  minDim = Math.min(W, H)
}

function inkColor() {
  const h = (params.palette + rt.random(-0.09, 0.09) + rt.pick([0, 0.08, 0.5, 0.6, 0.33]) + 1) % 1
  const s = rt.random(0.55, 0.85)
  const [r, g, b] = hslRGB(h, s, rt.random(0.42, 0.58))
  const [rr, rg, rb] = hslRGB(h, s * 0.7, 0.8) // lighter wet-edge rim
  return { fill: `rgb(${r | 0}, ${g | 0}, ${b | 0})`, rim: `rgb(${rr | 0}, ${rg | 0}, ${rb | 0})` }
}
function hslRGB(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

// Ink-drop map: expand all existing points around the new drop centre.
function dropInk(cx, cy, r) {
  const r2 = r * r
  for (const d of drops) {
    const p = d.pts
    for (let i = 0; i < p.length; i += 2) {
      const dx = p[i] - cx
      const dy = p[i + 1] - cy
      const dist2 = dx * dx + dy * dy || 1e-6
      const f = Math.sqrt(1 + r2 / dist2)
      p[i] = cx + dx * f
      p[i + 1] = cy + dy * f
    }
  }
  // New drop as a fine circle.
  const N = 160
  const pts = new Float64Array(N * 2)
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    pts[i * 2] = cx + Math.cos(a) * r
    pts[i * 2 + 1] = cy + Math.sin(a) * r
  }
  const c = inkColor()
  drops.push({ color: c.fill, rim: c.rim, pts })
  while (drops.length > MAX_DROPS) drops.shift()
}

// Tine/comb: shear points along direction u; the displacement decays with
// perpendicular distance from the tine line (raised to `sharp`), giving the
// characteristic combed cusps.
function combLine(bx, by, ux, uy, amp, sharp) {
  const px = -uy // perpendicular
  const py = ux
  const z = 14 / minDim // how fast the pull decays with distance from the tine
  for (const d of drops) {
    const p = d.pts
    for (let i = 0; i < p.length; i += 2) {
      const perp = Math.abs((p[i] - bx) * px + (p[i + 1] - by) * py) * z
      const shift = amp * Math.pow(sharp, perp)
      p[i] += ux * shift
      p[i + 1] += uy * shift
    }
  }
}

// A full comb pass: a rank of parallel tines drawn across the bath, alternating
// pull direction so the ink feathers into a nonpareil weave.
function combStroke(angle) {
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const teeth = Math.round(params.combTeeth)
  const span = minDim * 1.2
  const cx = W / 2
  const cy = H / 2
  const amp = minDim * 0.05
  for (let t = 0; t < teeth; t++) {
    const off = (t / (teeth - 1 || 1) - 0.5) * span
    const bx = cx + -uy * off
    const by = cy + ux * off
    combLine(bx, by, ux, uy, (t % 2 ? -1 : 1) * amp, params.sharp)
  }
}

// Divergence-free curl flow (area-preserving, so ink swirls without clumping)
// from a drifting scalar potential — this is what makes the bath move like water.
function advect(t, strength) {
  if (strength <= 0) return
  const s = 4 / minDim
  const amp = strength * minDim * 0.0012 // gentle — a living swirl, not a shear
  for (const d of drops) {
    const p = d.pts
    for (let i = 0; i < p.length; i += 2) {
      const X = p[i] * s
      const Y = p[i + 1] * s
      // v = curl φ = (∂φ/∂y, −∂φ/∂x)
      const vx = 1.3 * Math.cos(1.3 * Y - 0.4 * t) + 0.7 * Math.cos(0.7 * (X + Y) + 0.3 * t)
      const vy = -(1.1 * Math.cos(1.1 * X + 0.5 * t) + 0.7 * Math.cos(0.7 * (X + Y) + 0.3 * t))
      p[i] += vx * amp
      p[i + 1] += vy * amp
    }
  }
}

function render(t) {
  // Wet bath: a pale watery gradient with slow caustic light bands drifting.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#eef1ee')
  bg.addColorStop(1, '#dfe6ea')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.06
  for (let k = 0; k < 3; k++) {
    const y = ((0.5 + 0.45 * Math.sin(t * 0.3 + k * 2.1)) * H) | 0
    const g = ctx.createLinearGradient(0, y - minDim * 0.2, 0, y + minDim * 0.2)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, y - minDim * 0.2, W, minDim * 0.4)
  }
  ctx.restore()

  // Translucent inks floating on the water — overlaps mix into new hues.
  ctx.globalAlpha = params.opacity
  ctx.lineJoin = 'round'
  for (const d of drops) {
    const p = d.pts
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
    ctx.closePath()
    ctx.fillStyle = d.color
    ctx.fill()
    // A faint bright meniscus rim, like the wet edge of ink on water.
    ctx.globalAlpha = params.opacity * 0.35
    ctx.strokeStyle = d.rim
    ctx.lineWidth = 1.2 * rt.pixelRatio
    ctx.stroke()
    ctx.globalAlpha = params.opacity
  }
  ctx.globalAlpha = 1
}

let dropAcc = 0
let combAcc = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  dropAcc += dt * params.dropRate
  while (dropAcc >= 1) {
    dropAcc -= 1
    dropInk(rt.random(W * 0.15, W * 0.85), rt.random(H * 0.15, H * 0.85), minDim * params.dropSize * rt.random(0.6, 1.1))
  }
  combAcc += dt * params.combRate
  while (combAcc >= 1) {
    combAcc -= 1
    combStroke(rt.pick([0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]))
  }

  const t = now * 0.001
  advect(t, params.flow)
  render(t)
  requestAnimationFrame(frame)
}

// Interaction: click drops a stone; drag rakes a comb along the drag direction.
let dragPrev = null
canvas.addEventListener('pointerdown', (e) => {
  const x = e.clientX * rt.pixelRatio
  const y = e.clientY * rt.pixelRatio
  dropInk(x, y, minDim * params.dropSize)
  dragPrev = [x, y]
})
canvas.addEventListener('pointermove', (e) => {
  if (!dragPrev) return
  const x = e.clientX * rt.pixelRatio
  const y = e.clientY * rt.pixelRatio
  const dx = x - dragPrev[0]
  const dy = y - dragPrev[1]
  const len = Math.hypot(dx, dy)
  if (len > minDim * 0.02) {
    combLine(x, y, dx / len, dy / len, len * 0.9, params.sharp)
    dragPrev = [x, y]
  }
})
window.addEventListener('pointerup', () => (dragPrev = null))

// Seed a first bloom so the bath isn't empty.
window.addEventListener('resize', resize)
resize()
for (let i = 0; i < 12; i++) dropInk(rt.random(W * 0.25, W * 0.75), rt.random(H * 0.25, H * 0.75), minDim * 0.12)
combStroke(0)
combStroke(Math.PI / 2)
requestAnimationFrame(frame)
