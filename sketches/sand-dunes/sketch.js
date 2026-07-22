// Sand Dunes — Werner's cellular dune model. The field is a grid of sand-slab
// heights; each step a slab is picked up from a random cell, saltates a hop
// downwind, and is deposited (more readily in a wind shadow), then avalanches
// wherever the slope exceeds the angle of repose. Barchans and ridges emerge,
// crawl downwind, split and merge — evolving forever. Rendered from above with
// raking sunlight so the lee slopes fall into shadow.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  wind: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Wind strength' },
  windDir: { value: 0, min: -180, max: 180, step: 5, label: 'Wind direction°' },
  hop: { value: 3, min: 1, max: 8, step: 1, label: 'Saltation hop' },
  supply: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Sand supply' },
  avalanche: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Avalanche' },
  sun: { value: 40, min: 0, max: 90, step: 1, label: 'Sun angle°' },
  hue: { value: 34, min: 0, max: 60, step: 1, label: 'Sand hue' },
})
rt.mapInput('audio.level', 'wind', 0.4)

let GW = 0, GH = 0, h = null, W = 0, H = 0, PR = 1
let img = null, low = null, lctx = null
function build() {
  GW = 220; GH = Math.max(80, Math.round(GW * (H / W)))
  h = new Uint16Array(GW * GH)
  for (let i = 0; i < h.length; i++) h[i] = 3 + (rt.rng() * 4 | 0) // a shallow sand sheet
  low = document.createElement('canvas'); low.width = GW; low.height = GH
  lctx = low.getContext('2d'); img = lctx.createImageData(GW, GH)
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}
const wrap = (v, n) => ((v % n) + n) % n
const at = (x, y) => h[wrap(y, GH) * GW + wrap(x, GW)]
function add(x, y, d) { h[wrap(y, GH) * GW + wrap(x, GW)] += d }

// avalanche: if a cell towers over a downhill neighbour by > repose, topple one
function relax(x, y) {
  const c = at(x, y)
  const repose = 2
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dx, dy] of dirs) {
    if (c - at(x + dx, y + dy) > repose) { add(x, y, -1); add(x + dx, y + dy, 1); return }
  }
}

function step() {
  const ang = (params.windDir * Math.PI) / 180
  const hopLen = Math.round(params.hop)
  const wx = Math.round(Math.cos(ang)) || 1, wy = Math.round(Math.sin(ang))
  const iters = Math.round(GW * GH * 0.5 * params.wind * params.supply)
  for (let k = 0; k < iters; k++) {
    const x = (rt.rng() * GW) | 0, y = (rt.rng() * GH) | 0
    if (at(x, y) <= 0) continue
    add(x, y, -1) // pick up a slab
    // saltate downwind until it deposits
    let tx = x, ty = y
    for (let hopn = 0; hopn < 6; hopn++) {
      tx += wx * hopLen; ty += wy * hopLen
      // deposit probability: high in a shadow (behind higher sand), else 0.4
      const shadow = at(tx - wx, ty - wy) > at(tx, ty)
      if (shadow || rt.rng() < 0.4) break
    }
    add(tx, ty, 1)
  }
  // a few avalanche passes
  const av = Math.round(GW * GH * 0.4 * params.avalanche)
  for (let k = 0; k < av; k++) relax((rt.rng() * GW) | 0, (rt.rng() * GH) | 0)
}

function render() {
  const sun = (params.sun * Math.PI) / 180
  const lx = Math.cos(sun), ly = Math.sin(sun)
  const d = img.data
  const hue = params.hue
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = at(x, y)
      // surface normal from height gradient → lambert shade with the sun
      const gx = at(x + 1, y) - at(x - 1, y)
      const gy = at(x, y + 1) - at(x, y - 1)
      const shade = Math.max(0.15, 0.6 - gx * lx * 0.12 - gy * ly * 0.12 + Math.min(0.3, c * 0.02))
      const i = (y * GW + x) * 4
      const l = Math.min(85, 30 + shade * 60)
      const [r, g, b] = hsl(hue, 45, l)
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255
    }
  }
  lctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(low, 0, 0, W, H)
}
function hsl(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}

function frame(now) {
  rt.tick(now)
  step()
  render()
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
