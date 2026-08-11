// Liquid Metal — remap a live source into rippling chrome/mercury. Luminance is
// pushed through a metallic light→dark→light ramp (the banded highlights that
// make a surface read as polished metal), domain-warped by a slow noise so the
// sheen flows like liquid, with a sharp specular glint riding the brightest
// ridges. Tint from steel to gold to copper.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const TINTS = {
  Chrome: [[0.10, 0.11, 0.14], [0.72, 0.78, 0.90], [0.97, 0.99, 1.03]],
  Steel: [[0.08, 0.09, 0.11], [0.55, 0.60, 0.68], [0.90, 0.94, 1.00]],
  Gold: [[0.12, 0.07, 0.01], [0.85, 0.62, 0.16], [1.05, 0.95, 0.65]],
  Copper: [[0.12, 0.05, 0.03], [0.80, 0.42, 0.26], [1.05, 0.80, 0.62]],
  Mercury: [[0.09, 0.10, 0.12], [0.62, 0.66, 0.72], [1.02, 1.04, 1.08]],
}
const params = rt.params({
  tint: { value: 'Chrome', type: 'select', options: Object.keys(TINTS), label: 'Metal' },
  bands: { value: 3.5, min: 1, max: 9, step: 0.1, label: 'Sheen bands' },
  flow: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Flow warp' },
  speed: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Flow speed' },
  specular: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Glint' },
  contrast: { value: 1.1, min: 0.4, max: 2.5, step: 0.05, label: 'Contrast' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'specular', 0.4)

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 820, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}
// cheap value noise for the flow warp
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const h = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n) }
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) +
         (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const im = bctx.getImageData(0, 0, bw, bh)
  const d = im.data
  const [lo, mid, hi] = TINTS[params.tint]
  const bands = params.bands, flow = params.flow, spec = params.specular, con = params.contrast
  const ph = t * params.speed
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4
      let l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
      l = Math.min(1, Math.max(0, (l - 0.5) * con + 0.5))
      // warp the luminance coordinate by flowing noise so the sheen slides
      const w = flow * (vn(x * 0.02 + ph, y * 0.02 - ph * 0.6) - 0.5) * 2
      // banded metal ramp: fract of luminance*bands -> triangle -> highlight
      let s = (l * bands + w + ph * 0.15) % 1; if (s < 0) s += 1
      const tri = 1 - Math.abs(s * 2 - 1)          // 0..1..0 sheen band
      // three-point tint ramp keyed on the banded value
      const k = tri, a = k < 0.5 ? k * 2 : 1, b = k < 0.5 ? 0 : (k - 0.5) * 2
      let r0 = lo[0] * (1 - a) + mid[0] * a, g0 = lo[1] * (1 - a) + mid[1] * a, b0 = lo[2] * (1 - a) + mid[2] * a
      r0 = r0 * (1 - b) + hi[0] * b; g0 = g0 * (1 - b) + hi[1] * b; b0 = b0 * (1 - b) + hi[2] * b
      // sharp specular glint on the crest of each band, gated by brightness
      const gl = Math.pow(tri, 18) * spec * (0.3 + 0.7 * l)
      r0 += gl; g0 += gl; b0 += gl
      d[i] = Math.min(255, r0 * 255); d[i + 1] = Math.min(255, g0 * 255); d[i + 2] = Math.min(255, b0 * 255)
    }
  }
  bctx.putImageData(im, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
