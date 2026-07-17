/**
 * Pointillism: repaint a live source (camera, a dropped photo/video, the demo
 * scene, or — inside the Mixer/Patch — the layers below) as a field of little
 * colour dots. A stable jittered grid of sample points reads the source each
 * frame and stamps a dot in the colour it finds there; short strokes can be
 * oriented along image contours for an impressionist, brushed feel. The eye
 * blends the dots the way it does a Seurat or Signac canvas.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource, clamp } from '../_lib/source.js'

const rt = createRuntime()

const params = rt.params({
  size: { value: 1.0, min: 0.4, max: 2.5, step: 0.05, label: 'Dot size' },
  spacing: { value: 1.0, min: 0.5, max: 2.5, step: 0.05, label: 'Spacing' },
  jitter: { value: 0.6, min: 0, max: 1.2, step: 0.05, label: 'Jitter' },
  stroke: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Brush strokes' },
  saturation: { value: 1.3, min: 0.5, max: 2.2, step: 0.05, label: 'Saturation' },
  variation: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Size variation' },
  opacity: { value: 0.92, min: 0.3, max: 1, step: 0.02, label: 'Dot opacity' },
  paper: { value: false, type: 'bool', label: 'Paper (light) ground' },
})
// A little audio life by default: loudness fattens the dots, beats jostle them.
rt.mapInput('audio.volume', 'size', 0.4)
rt.mapInput('audio.pulse', 'jitter', 0.4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// Offscreen buffer that holds the cover-fit source, sampled per frame.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let bufW = 0
let bufH = 0
let imgData = null

// Stable stipple points (canvas px). Each carries fixed random offsets so its
// jitter and size wobble don't flicker frame to frame.
let pts = []
let lastSpacing = -1

function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  // Sampling buffer: same aspect as the canvas, capped so getImageData is cheap.
  const cap = 520
  const s = Math.min(1, cap / Math.max(canvas.width, canvas.height))
  bufW = Math.max(2, Math.round(canvas.width * s))
  bufH = Math.max(2, Math.round(canvas.height * s))
  buf.width = bufW
  buf.height = bufH
  lastSpacing = -1 // force stipple rebuild
}

function buildPoints() {
  const gap = 9 * rt.pixelRatio * params.spacing
  pts = []
  const off = gap * 0.5
  for (let y = off; y < canvas.height + gap; y += gap) {
    // Brick-offset alternate rows so the grid doesn't read as rows/columns.
    const shift = ((Math.round(y / gap) % 2) * gap) / 2
    for (let x = off - shift; x < canvas.width + gap; x += gap) {
      pts.push({
        x,
        y,
        jx: Math.random() * 2 - 1,
        jy: Math.random() * 2 - 1,
        sz: 0.6 + Math.random() * 0.9, // per-dot size wobble
      })
    }
  }
  lastSpacing = params.spacing
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  if (params.spacing !== lastSpacing || !pts.length) buildPoints()

  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  // Refresh the sampled source.
  try {
    src.draw(bctx, bufW, bufH)
    imgData = bctx.getImageData(0, 0, bufW, bufH)
  } catch {
    // Video not ready yet (or tainted) — keep the last sample.
  }
  if (!imgData) {
    requestAnimationFrame(frame)
    return
  }
  const data = imgData.data

  // Ground: black glows the dots; paper reads as a classic painting.
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = params.paper ? '#efe7d6' : '#07070b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const gap = 9 * rt.pixelRatio * params.spacing
  const baseR = gap * 0.62 * params.size
  const sat = params.saturation
  const sxb = bufW / canvas.width
  const syb = bufH / canvas.height
  const jitAmt = params.jitter * gap * 0.5
  const elong = params.stroke // 0 round … 1 long strokes
  const alpha = params.opacity

  ctx.globalAlpha = alpha
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const px = p.x + p.jx * jitAmt
    const py = p.y + p.jy * jitAmt
    const bx = clamp(Math.round(px * sxb), 0, bufW - 1)
    const by = clamp(Math.round(py * syb), 0, bufH - 1)
    const idx = (by * bufW + bx) * 4
    let r = data[idx]
    let g = data[idx + 1]
    let b = data[idx + 2]

    // Saturation boost around the pixel's own luminance.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    r = clamp(lum + (r - lum) * sat, 0, 255)
    g = clamp(lum + (g - lum) * sat, 0, 255)
    b = clamp(lum + (b - lum) * sat, 0, 255)

    // Dot radius wobbles per-point and, a little, with local brightness so
    // highlights bloom and shadows tighten — reads more painterly.
    const rad = baseR * p.sz * (1 + (lum / 255 - 0.5) * params.variation)
    if (rad < 0.3) continue

    ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`

    // Local gradient decides whether (and how far) to elongate: dots stretch
    // into strokes along real contours and stay round in smooth areas, so flat
    // regions don't fill with randomly-angled flecks.
    let e = 0
    let ang = 0
    if (elong > 0.02) {
      const l = (j) => 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
      const xl = bx > 0 ? idx - 4 : idx
      const xr = bx < bufW - 1 ? idx + 4 : idx
      const yt = by > 0 ? idx - bufW * 4 : idx
      const yd = by < bufH - 1 ? idx + bufW * 4 : idx
      const gxv = l(xr) - l(xl)
      const gyv = l(yd) - l(yt)
      const gmag = Math.hypot(gxv, gyv)
      e = elong * clamp(gmag / 26, 0, 1)
      ang = Math.atan2(gyv, gxv) + Math.PI / 2 // along the contour
    }

    if (e > 0.02) {
      const rx = rad * (1 + e * 1.7)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(ang)
      ctx.beginPath()
      ctx.ellipse(0, 0, rx, rad, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      ctx.beginPath()
      ctx.arc(px, py, rad, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
