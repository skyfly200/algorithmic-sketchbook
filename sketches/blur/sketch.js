// Blur — a family of blurs for a live source: a plain Gaussian, a directional
// motion blur, a radial zoom blur streaking out from a centre, and a spin blur
// smearing around it. Motion/zoom/spin are accumulation blurs (many faint,
// offset/scaled/rotated copies averaged together); the centre is mappable so
// the zoom/spin origin can be driven live.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Gaussian', type: 'select', options: ['Gaussian', 'Motion', 'Zoom', 'Spin'], label: 'Blur type' },
  algorithm: {
    value: 'Native (gaussian)',
    type: 'select',
    options: ['Native (gaussian)', 'Fast (downsample)', 'Smooth (pyramid)', 'Bokeh (disc)'],
    label: 'Blur algorithm',
  },
  amount: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Amount' },
  angle: { value: 0, min: 0, max: 360, step: 1, label: 'Motion angle' },
  samples: { value: 16, min: 4, max: 40, step: 1, label: 'Quality (samples)' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'amount', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  buf.width = W
  buf.height = H
}

// Pyramid of successively halved canvases, created on demand and resized to
// follow the main buffer.
const pyr = []
function level(i) {
  const w = Math.max(2, W >> i), h = Math.max(2, H >> i)
  let c = pyr[i]
  if (!c) c = pyr[i] = document.createElement('canvas')
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
  return c
}
function smooth(c) {
  const x = c.getContext('2d')
  x.imageSmoothingEnabled = true
  x.imageSmoothingQuality = 'high'
  return x
}

// Cheap blur without ctx.filter (also works where it is unsupported): shrink the
// image, then scale it back up with bilinear filtering. `smoothUp` walks the
// pyramid one octave at a time in both directions (a dual-filter / Kawase-style
// blur — round, artefact-free); otherwise it jumps straight to the small size
// and back (fastest, a little blocky at high radii).
function downsampleBlur(r, smoothUp) {
  const levels = Math.min(6, Math.max(1, Math.round(Math.log2(1 + r / 1.5))))
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (smoothUp) {
    let prev = buf
    for (let i = 1; i <= levels; i++) {
      const c = level(i)
      smooth(c).drawImage(prev, 0, 0, c.width, c.height)
      prev = c
    }
    for (let i = levels - 1; i >= 1; i--) {
      const c = level(i)
      smooth(c).drawImage(prev, 0, 0, c.width, c.height)
      prev = c
    }
    ctx.drawImage(prev, 0, 0, W, H)
  } else {
    const c = level(levels)
    smooth(c).drawImage(buf, 0, 0, c.width, c.height)
    ctx.drawImage(c, 0, 0, W, H)
  }
}

// Lens-style blur: average copies spread over a disc (golden-angle spiral), so
// bright spots bloom into round bokeh discs instead of soft gaussian smudges.
// Sampled from a half-res copy to keep the many draws cheap.
function bokehBlur(r) {
  const n = Math.max(6, Math.round(params.samples) * 2)
  const half = level(1)
  smooth(half).drawImage(buf, 0, 0, half.width, half.height)
  const GOLDEN = 2.399963
  for (let i = 0; i < n; i++) {
    const d = r * Math.sqrt((i + 0.5) / n)
    const a = i * GOLDEN
    ctx.globalAlpha = 1 / (i + 1)
    ctx.drawImage(half, Math.cos(a) * d, Math.sin(a) * d, W, H)
  }
  ctx.globalAlpha = 1
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  bctx.clearRect(0, 0, W, H)
  src.draw(bctx, W, H, { mirror: params.mirror })

  const mode = params.mode
  const amt = params.amount
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.clearRect(0, 0, W, H)

  if (mode === 'Gaussian' || amt < 0.002) {
    const r = amt * 40 * rt.pixelRatio
    const algo = params.algorithm
    if (r < 0.5) ctx.drawImage(buf, 0, 0)
    else if (algo === 'Fast (downsample)') downsampleBlur(r, false)
    else if (algo === 'Smooth (pyramid)') downsampleBlur(r, true)
    else if (algo === 'Bokeh (disc)') bokehBlur(r)
    else {
      ctx.filter = `blur(${r}px)`
      ctx.drawImage(buf, 0, 0)
      ctx.filter = 'none'
    }
  } else {
    const n = Math.max(2, Math.round(params.samples))
    const cx = params.centerX * W, cy = params.centerY * H
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) // 0..1 across the smear
      ctx.globalAlpha = 1 / (i + 1) // running average → equal-weight blur
      if (mode === 'Motion') {
        const a = (params.angle * Math.PI) / 180
        const d = (f - 0.5) * amt * 90 * rt.pixelRatio
        ctx.setTransform(1, 0, 0, 1, Math.cos(a) * d, Math.sin(a) * d)
        ctx.drawImage(buf, 0, 0)
      } else if (mode === 'Zoom') {
        const s = 1 + f * amt * 0.5
        ctx.setTransform(s, 0, 0, s, cx - cx * s, cy - cy * s)
        ctx.drawImage(buf, 0, 0)
      } else { // Spin
        const ang = (f - 0.5) * amt * 0.9
        const cos = Math.cos(ang), sin = Math.sin(ang)
        ctx.setTransform(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos)
        ctx.drawImage(buf, 0, 0)
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
