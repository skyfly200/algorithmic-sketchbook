// Brightness & Contrast — the basic tonal controls for a live source, plus
// exposure, gamma and saturation. The brightness/contrast/exposure/gamma curve
// is baked into a 256-entry lookup table each frame (so it's one table read per
// channel), then saturation is mixed per pixel around the luminance.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  brightness: { value: 0, min: -1, max: 1, step: 0.01, label: 'Brightness' },
  contrast: { value: 1, min: 0, max: 2, step: 0.02, label: 'Contrast' },
  exposure: { value: 0, min: -1.5, max: 1.5, step: 0.02, label: 'Exposure (stops)' },
  gamma: { value: 1, min: 0.4, max: 2.6, step: 0.02, label: 'Gamma' },
  saturation: { value: 1, min: 0, max: 2.5, step: 0.02, label: 'Saturation' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'brightness', 0.12)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })

let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 720
  const s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}

const lut = new Uint8ClampedArray(256)
function buildLut() {
  const expo = Math.pow(2, params.exposure)
  const con = params.contrast
  const bri = params.brightness
  const invG = 1 / params.gamma
  for (let v = 0; v < 256; v++) {
    let x = (v / 255) * expo // exposure (linear-ish gain)
    x = (x - 0.5) * con + 0.5 // contrast around mid grey
    x += bri * 0.6 // brightness lift/drop — gentled so it doesn't blow straight to white/black
    x = x < 0 ? 0 : x > 1 ? 1 : x
    x = Math.pow(x, invG) // gamma
    lut[v] = x * 255
  }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  buildLut()
  const sat = params.saturation
  const img = bctx.getImageData(0, 0, bw, bh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]]
    if (sat !== 1) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      r = y + (r - y) * sat
      g = y + (g - y) * sat
      b = y + (b - y) * sat
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b
  }
  bctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
