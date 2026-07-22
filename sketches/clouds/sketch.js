// Clouds — a sky of clouds that form, drift and dissolve. A big baked fbm field
// is sampled each frame at two slowly-diverging offsets and cross-faded, so the
// cloud shapes continuously morph (form and break up) as the field drifts on
// the wind. The cloud "type" reshapes the density curve — puffy cumulus, flat
// stratus, wispy cirrus, or a dark storm — and the sun rakes across so tops
// glow and undersides shade.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  type: { value: 'Cumulus', type: 'select', options: ['Cumulus', 'Stratus', 'Cirrus', 'Storm'], label: 'Cloud type' },
  evolve: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Evolve / cycle type' },
  cover: { value: 0.5, min: 0.1, max: 0.9, step: 0.02, label: 'Cloud cover' },
  wind: { value: 1, min: 0, max: 4, step: 0.05, label: 'Wind' },
  sun: { value: 40, min: 0, max: 90, step: 1, label: 'Sun angle°' },
  sky: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Sky (day↔dusk)' },
})
rt.mapInput('audio.level', 'wind', 0.4)

// --- baked tileable fbm field ----------------------------------------------
const FS = 512
const field = new Float32Array(FS * FS)
{
  const P = new Uint8Array(512); const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = (rt.rng() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  const vn = (x, y, rep) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const hsh = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const A = hsh(xi, yi) + u * (hsh(xi + 1, yi) - hsh(xi, yi))
    const B = hsh(xi, yi + 1) + u * (hsh(xi + 1, yi + 1) - hsh(xi, yi + 1))
    return A + fade(yf) * (B - A)
  }
  for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
    const fx = (x / FS) * 6, fy = (y / FS) * 6
    let n = 0.5 * vn(fx, fy, 6) + 0.28 * vn(fx * 2, fy * 2, 12) + 0.15 * vn(fx * 4, fy * 4, 24) + 0.07 * vn(fx * 8, fy * 8, 48)
    field[y * FS + x] = n
  }
}
function sampleField(u, v) {
  const x = ((u % 1) + 1) % 1 * FS, y = ((v % 1) + 1) % 1 * FS
  const xi = x | 0, yi = y | 0, xf = x - xi, yf = y - yi
  const x1 = (xi + 1) % FS, y1 = (yi + 1) % FS
  const a = field[yi * FS + xi], b = field[yi * FS + x1], c = field[y1 * FS + xi], d = field[y1 * FS + x1]
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
}

let W = 0, H = 0, PR = 1, GW = 0, GH = 0, img = null, low = null, lctx = null
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  GW = 240; GH = Math.max(90, Math.round(GW * (H / W)))
  low = document.createElement('canvas'); low.width = GW; low.height = GH
  lctx = low.getContext('2d'); img = lctx.createImageData(GW, GH)
}

// map fbm value → cloud density [0,1] per type
function shape(n, type, cover) {
  const th = 1 - cover
  let d = Math.max(0, (n - th * 0.7) / (1 - th * 0.7))
  if (type === 'Cumulus') d = Math.pow(d, 1.8) * 1.4          // puffy, high contrast
  else if (type === 'Stratus') d = Math.min(1, d * 0.7 + 0.25) // flat, uniform grey
  else if (type === 'Cirrus') d = Math.pow(d, 2.6) * 1.2       // thin, wispy streaks
  else d = Math.pow(d, 1.3) * 1.6                              // Storm: thick + dark
  return Math.min(1, d)
}
const TYPES = ['Cumulus', 'Stratus', 'Cirrus', 'Storm']

let drift = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  drift += (params.wind * 0.006)
  const sunA = (params.sun * Math.PI) / 180
  const lx = Math.cos(sunA) * 0.6, ly = -Math.sin(sunA) * 0.6

  // sky gradient
  const sk = params.sky
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgb(${60 + sk * 60},${110 + sk * 20},${190 - sk * 40})`)
  g.addColorStop(1, `rgb(${150 + sk * 60},${180 - sk * 30},${210 - sk * 40})`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // auto-evolve the type by cross-blending toward the next one
  const typeIdx = TYPES.indexOf(params.type)
  const nextIdx = (typeIdx + 1) % TYPES.length
  const blend = params.evolve > 0.01 ? (0.5 + 0.5 * Math.sin(t * 0.05 * params.evolve)) * params.evolve : 0

  const cover = params.cover
  const cirrusStretch = 3.2 // cirrus streaks are stretched horizontally
  const d = img.data
  const type = params.type
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const strX = (type === 'Cirrus' || TYPES[nextIdx] === 'Cirrus') ? cirrusStretch : 1
      const u = (x / GW) / strX + drift
      const v = (y / GH) * 1.4
      // two offset samples cross-faded → morphing (forming/dissolving) clouds
      const n1 = sampleField(u, v)
      const n2 = sampleField(u + 0.13, v + t * 0.004)
      const n = n1 * (1 - 0.4) + n2 * 0.4
      let dens = shape(n, type, cover)
      if (blend > 0.01) dens = dens * (1 - blend) + shape(n, TYPES[nextIdx], cover) * blend
      // vertical light gradient inside the cloud (tops brighter)
      const nAbove = sampleField(u + lx * 0.02, v + ly * 0.02)
      const lit = 0.55 + (n - nAbove) * 2.0
      const isStorm = type === 'Storm'
      const base = isStorm ? 90 : 235
      const shade = Math.max(0.2, Math.min(1, lit))
      const val = Math.round((isStorm ? base * (0.4 + shade * 0.6) : base * shade))
      const i = (y * GW + x) * 4
      // composite cloud over sky by alpha = density
      const a = Math.min(1, dens)
      // read sky under (approx from gradient)
      const skyTop = [60 + sk * 60, 110 + sk * 20, 190 - sk * 40]
      const skyBot = [150 + sk * 60, 180 - sk * 30, 210 - sk * 40]
      const f2 = y / GH
      const sr = skyTop[0] + (skyBot[0] - skyTop[0]) * f2
      const sg = skyTop[1] + (skyBot[1] - skyTop[1]) * f2
      const sb = skyTop[2] + (skyBot[2] - skyTop[2]) * f2
      d[i] = Math.round(sr * (1 - a) + val * a)
      d[i + 1] = Math.round(sg * (1 - a) + (val * 0.99) * a)
      d[i + 2] = Math.round(sb * (1 - a) + (val * (isStorm ? 1.05 : 0.98)) * a)
      d[i + 3] = 255
    }
  }
  lctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(low, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
