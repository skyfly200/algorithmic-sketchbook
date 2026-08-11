// Twist — Photoshop's Twirl for a live source: rotate the image around a centre
// by an angle that falls off with radius, so the middle spins hard and the edges
// stay put. Positive and negative angles wind opposite ways; the centre and
// radius are placeable, and a gentle live sway makes it churn.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  angle: { value: 220, min: -720, max: 720, step: 5, label: 'Twist angle°' },
  radius: { value: 0.8, min: 0.1, max: 1.5, step: 0.02, label: 'Radius' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  falloff: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Falloff' },
  swirl: { value: 0.2, min: 0, max: 1.5, step: 0.05, label: 'Live swirl' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'angle', 0.3)

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let W = 0, H = 0, bw = 0, bh = 0

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 640, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}

let t0 = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const srcData = bctx.getImageData(0, 0, bw, bh)
  const sd = srcData.data
  const out = bctx.createImageData(bw, bh)
  const od = out.data
  const cx = params.centerX * bw, cy = params.centerY * bh
  const R = params.radius * Math.max(bw, bh) * 0.5
  const ang = (params.angle * Math.PI / 180) + Math.sin(t * 0.6) * params.swirl
  const fall = params.falloff
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const dx = x - cx, dy = y - cy
      const r = Math.hypot(dx, dy)
      let sx = x, sy = y
      if (r < R) {
        const a = ang * Math.pow(1 - r / R, fall)  // twist inversely from the source pixel
        const cs = Math.cos(a), sn = Math.sin(a)
        sx = cx + dx * cs - dy * sn
        sy = cy + dx * sn + dy * cs
      }
      // bilinear sample
      const ix = sx < 0 ? 0 : sx > bw - 1 ? bw - 1 : sx
      const iy = sy < 0 ? 0 : sy > bh - 1 ? bh - 1 : sy
      const x0 = ix | 0, y0 = iy | 0, fx = ix - x0, fy = iy - y0
      const x1 = x0 + 1 < bw ? x0 + 1 : x0, y1 = y0 + 1 < bh ? y0 + 1 : y0
      const o = (y * bw + x) * 4
      for (let k = 0; k < 4; k++) {
        const a00 = sd[(y0 * bw + x0) * 4 + k], a10 = sd[(y0 * bw + x1) * 4 + k]
        const a01 = sd[(y1 * bw + x0) * 4 + k], a11 = sd[(y1 * bw + x1) * 4 + k]
        od[o + k] = a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) + a01 * (1 - fx) * fy + a11 * fx * fy
      }
    }
  }
  bctx.putImageData(out, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
