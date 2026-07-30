// Clouds — a sky of clouds that form, drift and dissolve. A big baked fbm field
// is sampled each frame at two slowly-diverging offsets and cross-faded, so the
// cloud shapes continuously morph (form and break up) as the field drifts on
// the wind. The cloud "type" reshapes the density curve — puffy cumulus, flat
// stratus, wispy cirrus, or a dark storm, plus rarer types (smooth stacked
// lenticular lenses, pouchy mammatus, dappled mackerel sky, and electric-blue
// noctilucent wisps) — and the sun rakes across so tops glow and undersides
// shade.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  type: { value: 'Cumulus', type: 'select', options: ['Cumulus', 'Stratus', 'Cirrus', 'Storm', 'Lenticular', 'Mammatus', 'Mackerel', 'Noctilucent'], label: 'Cloud type' },
  evolve: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Evolve / cycle type' },
  cover: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Cloud cover' },
  wind: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Wind' },
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

function smooth01(e0, e1, x) {
  let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}
const gauss = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w))

// Per-type look: horizontal stretch, a density curve over the fbm value, an
// optional altitude band (confines the cloud in the sky), a fine ripple carve,
// and lighting/colour flags. The last four are the rarer cloud types.
const TYPE_DEF = {
  Cumulus: { stretch: 1, curve: (d) => Math.pow(d, 1.8) * 1.4 },
  // flat, featureless grey overcast sheet — low contrast, a dull veil everywhere
  Stratus: { stretch: 1.6, dull: true, curve: (d) => Math.min(1, 0.35 + d * 0.55) },
  // high fibrous mare's-tails — strongly wind-stretched and carved into streaks
  Cirrus: { stretch: 4.5, fiber: true, curve: (d) => Math.pow(d, 1.8) * 1.1,
    band: (y) => smooth01(0.75, 0.35, y) },
  Storm: { stretch: 1, storm: true, curve: (d) => Math.pow(d, 1.3) * 1.6 },
  // smooth stacked lens discs (a "UFO" cloud over a mountain), strongly stretched
  Lenticular: { stretch: 5, curve: (d) => Math.pow(smooth01(0.35, 1, d), 1.1),
    band: (y) => Math.min(1, gauss(y, 0.4, 0.07) + 0.75 * gauss(y, 0.53, 0.05) + 0.5 * gauss(y, 0.29, 0.05)) },
  // dark lumpy pouches hanging under a storm, lit from beneath
  Mammatus: { stretch: 1.1, storm: true, litBelow: true, ripple: 5.5, curve: (d) => Math.pow(d, 1.2) * 1.5,
    band: (y) => smooth01(0.22, 0.5, y) },
  // mackerel sky — regular rows of small dappled altocumulus puffs
  Mackerel: { stretch: 1.25, rows: 8, ripple: 3.6, curve: (d) => Math.pow(d, 1.05) * 1.35 },
  // noctilucent — thin electric-blue wisps glowing high in a twilight sky
  Noctilucent: { stretch: 4.5, glow: true, curve: (d) => Math.pow(d, 2.4) * 1.15,
    band: (y) => gauss(y, 0.26, 0.13) },
}
const TYPES = Object.keys(TYPE_DEF)

let drift = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  drift += params.wind * 0.002 // gentler wind (was ~3× faster)
  const sunA = (params.sun * Math.PI) / 180
  const lx = Math.cos(sunA) * 0.6, ly = -Math.sin(sunA) * 0.6

  // sky gradient
  const sk = params.sky
  const skyTop = [60 + sk * 60, 110 + sk * 20, 190 - sk * 40]
  const skyBot = [150 + sk * 60, 180 - sk * 30, 210 - sk * 40]
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgb(${skyTop[0]},${skyTop[1]},${skyTop[2]})`)
  g.addColorStop(1, `rgb(${skyBot[0]},${skyBot[1]},${skyBot[2]})`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // auto-evolve the type by cross-blending toward the next one
  const typeIdx = Math.max(0, TYPES.indexOf(params.type))
  const nextIdx = (typeIdx + 1) % TYPES.length
  const blend = params.evolve > 0.01 ? (0.5 + 0.5 * Math.sin(t * 0.05 * params.evolve)) * params.evolve : 0
  const defA = TYPE_DEF[TYPES[typeIdx]], defB = TYPE_DEF[TYPES[nextIdx]]
  const cover = params.cover

  // density + lighting + colour for one type at a pixel
  function cloud(def, x, y) {
    const u = (x / GW) / def.stretch + drift
    const v = (y / GH) * 1.4
    const n1 = sampleField(u, v)
    const n2 = sampleField(u + 0.13, v + t * 0.004)
    const n = n1 * 0.6 + n2 * 0.4
    // cover lowers the density floor: at cover→1 almost the whole sky clouds
    // over into a dense overcast; at low cover only the fbm peaks poke through.
    const lo = 0.62 - cover * 0.62
    let d = def.curve(smooth01(lo, lo + 0.3, n))
    if (def.band) d *= def.band(y / GH)
    // rows of puffs (mackerel / altocumulus): a regular horizontal banding
    if (def.rows) d *= 0.35 + 0.65 * Math.pow(Math.abs(Math.sin((y / GH) * Math.PI * def.rows)), 0.6)
    // fibrous carve (cirrus mare's-tails): fine wind-stretched streaks
    if (def.fiber) { const fb = sampleField(u * 0.6 + 5, v * 7 + 2); d *= 0.25 + 0.75 * smooth01(0.4, 0.66, fb) }
    if (def.ripple) { const rip = sampleField(u * def.ripple + 11, v * def.ripple + 3); d *= 0.22 + 0.78 * smooth01(0.4, 0.62, rip) }
    // overcast fill: at very high cover, lift the thin gaps so it reads solid
    if (cover > 0.8) d = d + (cover - 0.8) * 3.5 * (1 - d) * smooth01(lo - 0.05, lo + 0.15, n)
    d = Math.min(1, d)
    // lighting: brighter where the field rises toward the light (below for mammatus)
    const s = def.litBelow ? -1 : 1
    const nA = sampleField(u + lx * 0.02, v + ly * 0.02 * s)
    const shade = Math.max(def.storm ? 0.28 : 0.42, Math.min(1, 0.6 + (n - nA) * 2.0 * s))
    let r, gc, b
    if (def.storm) { const val = 90 * (0.4 + shade * 0.6); r = val; gc = val; b = val * 1.05 }
    else if (def.glow) { const val = 235 * shade; r = val * 0.55; gc = val * 0.82; b = val * 1.15 }
    else if (def.dull) { const val = 200 * (0.6 + shade * 0.4); r = val; gc = val; b = val * 1.03 } // flat grey overcast
    else { const val = 235 * shade; r = val; gc = val * 0.99; b = val * 0.98 }
    return { d, r, g: gc, b }
  }

  const d = img.data
  for (let y = 0; y < GH; y++) {
    const f2 = y / GH
    const sr = skyTop[0] + (skyBot[0] - skyTop[0]) * f2
    const sg = skyTop[1] + (skyBot[1] - skyTop[1]) * f2
    const sb = skyTop[2] + (skyBot[2] - skyTop[2]) * f2
    for (let x = 0; x < GW; x++) {
      const A = cloud(defA, x, y)
      let a = A.d, cr = A.r, cg = A.g, cb = A.b
      if (blend > 0.01) {
        const B = cloud(defB, x, y)
        a = a * (1 - blend) + B.d * blend
        cr = cr * (1 - blend) + B.r * blend
        cg = cg * (1 - blend) + B.g * blend
        cb = cb * (1 - blend) + B.b * blend
      }
      const i = (y * GW + x) * 4
      d[i] = sr * (1 - a) + cr * a
      d[i + 1] = sg * (1 - a) + cg * a
      d[i + 2] = sb * (1 - a) + cb * a
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
