// Fog — rolling banks of volumetric fog drift across a live source (camera /
// dropped media / demo / the Mixer or Patch feed). Layers of baked fractal
// noise slide at different speeds with a height bias (fog pools low), the
// scene dims into the murk with density, and beats send a slow extra surge
// rolling through.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Density' },
  drift: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  height: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Ground hug' },
  murk: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Murk' },
  cool: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Cool tint' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.low', 'density', 0.25)
rt.mapInput('audio.pulse', 'drift', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// --- baked fog noise: two seeded fbm tiles, pre-blurred -------------------
function bakeNoise(scale) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const cc = c.getContext('2d')
  const img = cc.createImageData(size, size)
  const P = new Uint8Array(512)
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rt.rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  // tileable value noise: lattice indices wrap at `rep`
  function vn(x, y, rep) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const h = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
    const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
    return a + fade(yf) * (b - a)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * scale
      const fy = (y / size) * scale
      let n = 0.55 * vn(fx, fy, scale) + 0.3 * vn(fx * 2, fy * 2, scale * 2) + 0.15 * vn(fx * 4, fy * 4, scale * 4)
      n = Math.max(0, (n - 0.32) * 1.6) // lift the shapes out of the mid-gray
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.min(255, n * 255)
    }
  }
  cc.putImageData(img, 0, 0)
  // soften the lattice
  const c2 = document.createElement('canvas')
  c2.width = c2.height = size
  const cc2 = c2.getContext('2d')
  cc2.filter = 'blur(2px)'
  cc2.drawImage(c, 0, 0)
  return c2
}
const noiseA = bakeNoise(5)
const noiseB = bakeNoise(9)

// fog is composed at half resolution then drawn up with a blur
const fogBuf = document.createElement('canvas')
const fctx = fogBuf.getContext('2d')

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  fogBuf.width = Math.max(2, W >> 1)
  fogBuf.height = Math.max(2, H >> 1)
}

// draw a noise tile across the buffer with wrap, at a drifting offset
function layer(img, ox, oy, scale, alpha) {
  const fw = fogBuf.width
  const fh = fogBuf.height
  const tile = Math.max(fw, fh) * scale
  fctx.globalAlpha = alpha
  const x0 = -(((ox % tile) + tile) % tile)
  const y0 = -(((oy % tile) + tile) % tile)
  for (let y = y0; y < fh; y += tile)
    for (let x = x0; x < fw; x += tile) fctx.drawImage(img, x, y, tile, tile)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  src.draw(ctx, W, H, { mirror: params.mirror })

  const d = Math.min(1, params.density * (1 + rt.beat.state.pulse * 0.3))
  const fw = fogBuf.width
  const fh = fogBuf.height

  // the scene recedes into the murk before the fog is laid on
  ctx.fillStyle = `rgba(${26 - params.cool * 14}, ${30 - params.cool * 6}, ${36 + params.cool * 10}, ${d * params.murk * 0.75})`
  ctx.fillRect(0, 0, W, H)

  // compose drifting layers, then bias them toward the ground
  fctx.clearRect(0, 0, fw, fh)
  fctx.globalCompositeOperation = 'lighter'
  const v = t * 40 * params.drift
  layer(noiseA, v * 0.6, v * 0.08, 1.6, d * 0.5)
  layer(noiseB, -v * 0.35, v * 0.05, 2.2, d * 0.4)
  layer(noiseA, v * 1.15, -v * 0.06, 0.9, d * 0.35)
  fctx.globalAlpha = 1
  fctx.globalCompositeOperation = 'destination-in'
  const g = fctx.createLinearGradient(0, 0, 0, fh)
  g.addColorStop(0, `rgba(0,0,0,${1 - params.height * 0.85})`)
  g.addColorStop(0.55, `rgba(0,0,0,${1 - params.height * 0.35})`)
  g.addColorStop(1, 'rgba(0,0,0,1)')
  fctx.fillStyle = g
  fctx.fillRect(0, 0, fw, fh)
  fctx.globalCompositeOperation = 'source-over'

  ctx.save()
  ctx.filter = 'blur(6px)'
  const warm = 1 - params.cool
  ctx.globalAlpha = 1
  // tint the fog itself via a colored underlay of the same mask
  ctx.drawImage(fogBuf, 0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
  // gentle color cast over the fogged scene
  ctx.fillStyle = `rgba(${200 * warm + 150 * params.cool}, ${205 * warm + 175 * params.cool}, ${195 * warm + 235 * params.cool}, ${d * 0.1})`
  ctx.fillRect(0, 0, W, H)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
