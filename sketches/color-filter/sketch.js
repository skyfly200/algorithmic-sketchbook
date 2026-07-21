// Color Filter — cinematic colour grading for a live source: hue rotate,
// saturation/contrast, temperature (warm↔cool), a duotone map from shadows
// to highlights, and posterize. A one-stop grade node.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  hue: { value: 0, min: 0, max: 360, step: 1, label: 'Hue rotate' },
  sat: { value: 1.15, min: 0, max: 2.5, step: 0.05, label: 'Saturation' },
  contrast: { value: 1.1, min: 0.4, max: 2.2, step: 0.05, label: 'Contrast' },
  temp: { value: 0, min: -1, max: 1, step: 0.02, label: 'Temperature' },
  duotone: { value: 0, min: 0, max: 1, step: 0.02, label: 'Duotone mix' },
  shadowHue: { value: 230, min: 0, max: 360, step: 1, label: 'Duotone shadow' },
  hiHue: { value: 40, min: 0, max: 360, step: 1, label: 'Duotone highlight' },
  posterize: { value: 0, min: 0, max: 1, step: 0.02, label: 'Posterize' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.mid', 'hue', 60)

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
function hsl(h) { // hue (deg) → rgb triplet at full sat, mid light
  h = ((h % 360) + 360) / 360
  const k = (n) => (n + h * 12) % 12
  const f = (n) => 0.5 - 0.5 * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const img = bctx.getImageData(0, 0, bw, bh)
  const d = img.data
  const hueRad = (params.hue * Math.PI) / 180
  const cosH = Math.cos(hueRad), sinH = Math.sin(hueRad)
  const sh = hsl(params.shadowHue), hi = hsl(params.hiHue)
  const levels = params.posterize > 0.01 ? Math.round(2 + (1 - params.posterize) * 30) : 0
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2]
    // hue rotate via YIQ
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    let I = 0.596 * r - 0.274 * g - 0.322 * b
    let Q = 0.211 * r - 0.523 * g + 0.312 * b
    const nI = I * cosH - Q * sinH, nQ = I * sinH + Q * cosH
    r = y + 0.956 * nI + 0.621 * nQ
    g = y - 0.272 * nI - 0.647 * nQ
    b = y - 1.106 * nI + 1.703 * nQ
    // saturation + contrast around 128
    const yy = 0.299 * r + 0.587 * g + 0.114 * b
    r = yy + (r - yy) * params.sat; g = yy + (g - yy) * params.sat; b = yy + (b - yy) * params.sat
    r = (r - 128) * params.contrast + 128; g = (g - 128) * params.contrast + 128; b = (b - 128) * params.contrast + 128
    // temperature: warm lifts R, cools B
    r += params.temp * 40; b -= params.temp * 40
    // duotone: map luminance across shadow→highlight ramp
    if (params.duotone > 0.01) {
      const l = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255))
      const dr = sh[0] + (hi[0] - sh[0]) * l, dg = sh[1] + (hi[1] - sh[1]) * l, db = sh[2] + (hi[2] - sh[2]) * l
      r += (dr - r) * params.duotone; g += (dg - g) * params.duotone; b += (db - b) * params.duotone
    }
    if (levels) { r = Math.round(r / 255 * levels) / levels * 255; g = Math.round(g / 255 * levels) / levels * 255; b = Math.round(b / 255 * levels) / levels * 255 }
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
