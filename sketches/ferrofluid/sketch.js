/**
 * Ferrofluid Field — a puddle of magnetic fluid under a field. As the field
 * rises the surface goes unstable (the Rosensweig / normal-field instability)
 * and erupts into a hexagonal array of peaks standing along the field lines.
 *
 * The fluid is a real height field: a connected pool with Gaussian peaks on a
 * hex lattice, their height set by the local field. It's shaded per pixel like
 * the chrome-black liquid it is — diffuse + a tight specular + a procedural
 * environment reflection off the surface normal + Fresnel edge sheen — so peaks
 * catch the light on their flanks and glint at the tips, connected by the
 * mirror-dark valleys between them. The mouse is a magnet that pulls the peaks
 * up and leans the reflection toward the cursor.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  field: { value: 0.7, min: 0, max: 1.3, step: 0.02, label: 'Field strength' },
  spikes: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Spike density' },
  magnet: { value: 0.8, min: 0, max: 2.5, step: 0.05, label: 'Magnet pull' },
  wobble: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Wobble' },
  hue: { value: +rt.random(0.55, 0.68).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Sheen hue' },
})
// Music: beats surge the field, loudness excites the wobble.
rt.mapInput('audio.pulse', 'field', 0.5)
rt.mapInput('audio.volume', 'wobble', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

let W, H, gw, gh, gsc, cxg, cyg, Rg
let height, img, sites
const mouse = { x: -1e4, y: -1e4 }

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

function build() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  gsc = Math.max(1.6, 1.9 * rt.pixelRatio) / rt.detail // grid downsample (finer = smoother)
  gw = Math.max(120, Math.floor(W / gsc))
  gh = Math.max(120, Math.floor(H / gsc))
  buf.width = gw
  buf.height = gh
  img = bctx.createImageData(gw, gh)
  height = new Float32Array(gw * gh)
  cxg = gw / 2
  cyg = gh * 0.56
  Rg = Math.min(gw, gh) * 0.4
  // Hex lattice of peak sites inside the pool disc.
  sites = []
  const step = (Math.min(gw, gh) * 0.062) / params.spikes
  const rowH = step * 0.866
  for (let y = -Rg, row = 0; y <= Rg; y += rowH, row++) {
    const xoff = row % 2 ? step / 2 : 0
    for (let x = -Rg; x <= Rg; x += step) {
      const px = x + xoff
      if (Math.hypot(px, y) > Rg) continue
      sites.push({ gx: cxg + px, gy: cyg + y, rr: Math.hypot(px, y) / Rg, ph: rt.random(0, 6.28), n: rt.random(0.75, 1.15) })
    }
  }
}
let builtSpikes = 1
function resize() { build(); builtSpikes = params.spikes }

// Stamp a Gaussian peak of amplitude `amp`, sigma `sg` (grid units) at (px,py).
function stamp(px, py, amp, sg) {
  const rad = Math.ceil(sg * 3)
  const x0 = Math.max(0, (px - rad) | 0)
  const x1 = Math.min(gw - 1, (px + rad) | 0)
  const y0 = Math.max(0, (py - rad) | 0)
  const y1 = Math.min(gh - 1, (py + rad) | 0)
  const inv = 1 / (2 * sg * sg)
  for (let y = y0; y <= y1; y++) {
    const dy = y - py
    for (let x = x0; x <= x1; x++) {
      const dx = x - px
      height[y * gw + x] += amp * Math.exp(-(dx * dx + dy * dy) * inv)
    }
  }
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  lastNow = now
  if (params.spikes !== builtSpikes) resize()

  // --- assemble the height field: a broad pool dome + the field-driven peaks.
  height.fill(0)
  const step = (Math.min(gw, gh) * 0.062) / params.spikes
  const sg = step * 0.32 // tighter → pointier peaks, darker valleys
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const d = Math.hypot(x - cxg, y - cyg) / Rg
      if (d < 1) height[y * gw + x] = 0.45 * (1 - d * d) // the pool mound
    }
  }
  const field = params.field
  for (const s of sites) {
    let a = field * (1 - s.rr * 0.5) * s.n
    if (params.magnet > 0) {
      const md = Math.hypot(mouse.x / gsc - s.gx, mouse.y / gsc - s.gy)
      a += params.magnet * Math.exp(-((md / (Math.min(gw, gh) * 0.16)) ** 2))
    }
    a += params.wobble * 0.1 * Math.sin(t * 3 + s.ph)
    if (a > 0.04) stamp(s.gx, s.gy, a * 3.0, sg)
  }

  // --- shade the surface as chrome-black liquid metal (per grid pixel).
  const d = img.data
  const [tr, tg, tb] = hslArr(params.hue, 0.85, 0.62) // sheen tint
  const zScale = 3.4 // vertical exaggeration for the normals
  const lx0 = -0.42, ly0 = -0.5, lz0 = 0.76 // key light
  const hlz = lz0 + 1
  const hn = 1 / Math.sqrt(lx0 * lx0 + ly0 * ly0 + hlz * hlz)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const h = height[i]
      const hl = x > 0 ? height[i - 1] : h
      const hr = x < gw - 1 ? height[i + 1] : h
      const hu = y > 0 ? height[i - gw] : h
      const hd = y < gh - 1 ? height[i + gw] : h
      let nx = (hl - hr) * zScale
      let ny = (hu - hd) * zScale
      let nz = 1
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= il; ny *= il; nz *= il
      const diff = Math.max(0, nx * lx0 + ny * ly0 + nz * lz0)
      const spec = Math.pow(Math.max(0, nx * lx0 * hn + ny * ly0 * hn + nz * hlz * hn), 55)
      // Reflection of the top-down view about the normal, sampled against two
      // narrow bright studio strips → mirror-black metal with sharp reflected
      // bands on the flanks, and mostly-black valleys for that oily contrast.
      const ry = 2 * nz * ny
      const band = Math.exp(-((ry + 0.55) * (ry + 0.55)) / 0.045) + 0.55 * Math.exp(-((ry - 0.5) * (ry - 0.5)) / 0.06)
      const env = 0.5 * band
      const fres = Math.pow(1 - nz, 3)
      const base = 0.02
      const r = base + diff * 0.06 * tr + env * tr * 0.85 + fres * tr * 0.3 + spec * 1.7
      const g = base + diff * 0.06 * tg + env * tg * 0.9 + fres * tg * 0.3 + spec * 1.7
      const b = base + diff * 0.07 * tb + env * tb * 1.05 + fres * tb * 0.4 + spec * 1.8
      const p = h > 0.01 ? 1 : 0 // outside the pool → background
      d[i * 4] = Math.min(255, (r * p + 0.012) * 255)
      d[i * 4 + 1] = Math.min(255, (g * p + 0.014) * 255)
      d[i * 4 + 2] = Math.min(255, (b * p + 0.02) * 255)
      d[i * 4 + 3] = 255
    }
  }
  bctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // A whisper of blur on the upscale dissolves any residual grid stepping in the
  // sharp specular glints without softening the overall chrome read.
  ctx.filter = `blur(${0.6 * rt.pixelRatio}px)`
  ctx.drawImage(buf, 0, 0, W, H)
  ctx.filter = 'none'

  requestAnimationFrame(frame)
}

canvas.addEventListener('pointermove', (e) => { mouse.x = e.clientX * rt.pixelRatio; mouse.y = e.clientY * rt.pixelRatio })
canvas.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4 })
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
