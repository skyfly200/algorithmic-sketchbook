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
  dropRate: { value: 0.9, min: 0, max: 4, step: 0.05, label: 'Drop rate' },
  dropSize: { value: 0.14, min: 0.04, max: 0.3, step: 0.01, label: 'Drop size' },
  combRate: { value: 0.4, min: 0, max: 3, step: 0.05, label: 'Comb rate' },
  combTeeth: { value: 8, min: 1, max: 24, step: 1, label: 'Comb teeth' },
  sharp: { value: 0.55, min: 0.1, max: 0.95, step: 0.01, label: 'Comb sharpness' },
  palette: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette' },
})
// Music: beats drop stones, loudness rakes the comb.
rt.mapInput('audio.pulse', 'dropRate', 0.8)
rt.mapInput('audio.volume', 'combRate', 0.6)

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
  const h = (params.palette + rt.random(-0.09, 0.09) + rt.pick([0, 0.08, 0.5, 0.6, 0.33])) % 1
  const [r, g, b] = hslRGB((h + 1) % 1, rt.random(0.55, 0.85), rt.random(0.42, 0.6))
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`
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
  drops.push({ color: inkColor(), pts })
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

function render() {
  ctx.fillStyle = '#f3ece0' // the pale size/paper
  ctx.fillRect(0, 0, W, H)
  for (const d of drops) {
    const p = d.pts
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
    ctx.closePath()
    ctx.fillStyle = d.color
    ctx.fill()
  }
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

  render()
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
