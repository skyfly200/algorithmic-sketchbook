// Nebula Gasses — billowing clouds of interstellar gas bloom over a live
// source (camera / dropped media / demo / the Mixer or Patch feed). Layers of
// baked fractal noise drift and curl at different speeds, each tinted across a
// nebula palette and stacked additively so overlaps glow, with a scatter of
// twinkling stars. The source shows through the thin gas; beats make it surge.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Gas density' },
  drift: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  hue: { value: 285, min: 0, max: 360, step: 1, label: 'Nebula hue' },
  spread: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Colour spread' },
  glow: { value: 0.8, min: 0, max: 1.5, step: 0.02, label: 'Inner glow' },
  stars: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Stars' },
  dim: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Dim source' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.low', 'density', 0.25)
rt.mapInput('audio.pulse', 'glow', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// --- baked cloud noise: a seeded, tileable fbm mask (white on transparent) --
function bakeNoise(scale) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const cc = c.getContext('2d')
  const img = cc.createImageData(size, size)
  const P = new Uint8Array(512)
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = Math.floor(rt.rng() * (i + 1));[p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  function vn(x, y, rep) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const h = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
    const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
    return a + fade(yf) * (b - a)
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * scale, fy = (y / size) * scale
    let n = 0.5 * vn(fx, fy, scale) + 0.3 * vn(fx * 2, fy * 2, scale * 2) + 0.2 * vn(fx * 4, fy * 4, scale * 4)
    n = Math.max(0, (n - 0.4) * 1.9) // billowy shapes with dark gaps between clouds
    const i = (y * size + x) * 4
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
    img.data[i + 3] = Math.min(255, n * 255)
  }
  cc.putImageData(img, 0, 0)
  const c2 = document.createElement('canvas')
  c2.width = c2.height = size
  const cc2 = c2.getContext('2d')
  cc2.filter = 'blur(2px)'
  cc2.drawImage(c, 0, 0)
  return c2
}
const cloudA = bakeNoise(4)
const cloudB = bakeNoise(7)
const cloudC = bakeNoise(11)

// Nebula composited half-res on `buf`; `scratch` tints one layer at a time.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')
const scratch = document.createElement('canvas')
const sctx = scratch.getContext('2d')

let starList = []
let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  buf.width = scratch.width = Math.max(2, W >> 1)
  buf.height = scratch.height = Math.max(2, H >> 1)
  starList = []
  const n = Math.round(260 * rt.detail)
  for (let i = 0; i < n; i++) starList.push({ x: rt.rng(), y: rt.rng(), r: rt.random(0.4, 1.6), tw: rt.random(0, Math.PI * 2), sp: rt.random(1, 3) })
}

// Tile a cloud mask, tint it in a nebula colour, and add it into `buf` so
// overlapping clouds accumulate light.
function addLayer(img, ox, oy, scale, alpha, hueOff, light) {
  const fw = buf.width, fh = buf.height
  const tile = Math.max(fw, fh) * scale
  const x0 = -(((ox % tile) + tile) % tile), y0 = -(((oy % tile) + tile) % tile)
  sctx.globalCompositeOperation = 'source-over'
  sctx.clearRect(0, 0, fw, fh)
  sctx.globalAlpha = alpha
  for (let y = y0; y < fh; y += tile) for (let x = x0; x < fw; x += tile) sctx.drawImage(img, x, y, tile, tile)
  sctx.globalAlpha = 1
  // colourize the shape only
  sctx.globalCompositeOperation = 'source-atop'
  const hue = (params.hue + hueOff + 360) % 360
  const g = sctx.createLinearGradient(0, 0, fw, fh)
  g.addColorStop(0, `hsl(${hue}, 90%, ${26 + light * 34}%)`)
  g.addColorStop(1, `hsl(${(hue + 50) % 360}, 85%, ${20 + light * 28}%)`)
  sctx.fillStyle = g
  sctx.fillRect(0, 0, fw, fh)
  sctx.globalCompositeOperation = 'source-over'
  bctx.globalCompositeOperation = 'lighter'
  bctx.drawImage(scratch, 0, 0)
  bctx.globalCompositeOperation = 'source-over'
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  src.draw(ctx, W, H, { mirror: params.mirror })

  const pulse = rt.beat.state.pulse
  const d = Math.min(1, params.density * (1 + pulse * 0.25))
  const v = t * 26 * params.drift
  const spread = params.spread * 90
  const light = params.glow * (0.6 + pulse * 0.4)

  // deepen the source toward space-black so the gas reads as luminous
  ctx.fillStyle = `rgba(4, 3, 12, ${d * params.dim * 0.85})`
  ctx.fillRect(0, 0, W, H)

  // build the nebula: three tinted, drifting cloud layers stacked additively
  bctx.clearRect(0, 0, buf.width, buf.height)
  addLayer(cloudA, v * 0.5, v * 0.12, 1.7, d * 0.9, -spread, light)
  addLayer(cloudB, -v * 0.32, v * 0.07, 2.4, d * 0.7, spread * 0.6, light * 0.9)
  addLayer(cloudC, v * 0.9, -v * 0.05, 1.15, d * 0.55, -spread * 1.4, light * 1.1)

  // lay the nebula over the scene, blurred and glowing
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = 'blur(3px)'
  ctx.globalAlpha = 0.5 + light * 0.5
  ctx.drawImage(buf, 0, 0, W, H)
  ctx.restore()

  // stars twinkle through the thin gas
  if (params.stars > 0.02) {
    ctx.globalCompositeOperation = 'lighter'
    for (const s of starList) {
      const a = params.stars * (0.4 + 0.6 * Math.abs(Math.sin(s.tw + t * s.sp)))
      ctx.fillStyle = `rgba(220, 230, 255, ${a})`
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * rt.pixelRatio, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
