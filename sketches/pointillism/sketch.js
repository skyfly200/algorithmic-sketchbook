/**
 * Pointillism: repaint a live source (camera, a dropped photo/video, the demo
 * scene, or — inside the Mixer/Patch — the layers below) as a field of little
 * colour dots. A stable jittered grid of sample points reads the source each
 * frame and stamps a dot in the colour it finds there; short strokes can be
 * oriented along image contours for an impressionist, brushed feel. The eye
 * blends the dots the way it does a Seurat or Signac canvas.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const preview = new URLSearchParams(location.search).get('preview') === '1'

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
const chooser = document.getElementById('chooser')

// Offscreen buffer that holds the cover-fit source, sampled per frame.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let bufW = 0
let bufH = 0
let imgData = null

let source = null // <video>, <img>, demo <canvas>, or the Mixer feed <canvas>
let sourceW = 0
let sourceH = 0
let demoTick = null
let isMixerFeed = false

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

// --- source acquisition (mirrors motion-extraction's chooser flow) ----------
window.addEventListener('message', (e) => {
  const d = e.data
  if (!d || d.type !== 'mixer:frame' || !d.bitmap) return
  const bmp = d.bitmap
  if (!source || !isMixerFeed) source = document.createElement('canvas')
  if (source.width !== bmp.width) source.width = bmp.width
  if (source.height !== bmp.height) source.height = bmp.height
  source.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()
  demoTick = null
  sourceW = source.width
  sourceH = source.height
  isMixerFeed = true
  if (chooser) chooser.style.display = 'none'
})

async function useCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
  })
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  demoTick = null
  isMixerFeed = false
  source = video
  sourceW = video.videoWidth
  sourceH = video.videoHeight
}

// Animated demo scene — soft drifting colour blobs over a warm gradient, the
// kind of impressionist sky that pointillism flatters. Also runs the thumbnail.
function useDemo() {
  const c = document.createElement('canvas')
  c.width = 960
  c.height = 540
  const d = c.getContext('2d')
  const blobs = Array.from({ length: 7 }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.18 + Math.random() * 0.22,
    hue: (i * 47 + Math.random() * 30) % 360,
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
    sx: 0.4 + Math.random() * 0.5,
    sy: 0.4 + Math.random() * 0.5,
  }))
  demoTick = (t) => {
    const g = d.createLinearGradient(0, 0, 0, 540)
    g.addColorStop(0, '#12203a')
    g.addColorStop(0.55, '#3a2a55')
    g.addColorStop(1, '#6a3f4a')
    d.fillStyle = g
    d.fillRect(0, 0, 960, 540)
    d.globalCompositeOperation = 'lighter'
    for (const b of blobs) {
      const cx = (b.x + 0.12 * Math.sin(t * b.sx + b.px)) * 960
      const cy = (b.y + 0.12 * Math.cos(t * b.sy + b.py)) * 540
      const rr = b.r * 540
      const rg = d.createRadialGradient(cx, cy, 0, cx, cy, rr)
      rg.addColorStop(0, `hsla(${b.hue}, 85%, 62%, 0.9)`)
      rg.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      d.fillStyle = rg
      d.beginPath()
      d.arc(cx, cy, rr, 0, Math.PI * 2)
      d.fill()
    }
    // A low sun for a horizon the dots can render.
    d.fillStyle = 'rgba(255, 224, 170, 0.9)'
    d.beginPath()
    d.arc(720, 150, 46, 0, Math.PI * 2)
    d.fill()
    d.globalCompositeOperation = 'source-over'
  }
  isMixerFeed = false
  source = c
  sourceW = 960
  sourceH = 540
}

function loadFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    demoTick = null
    isMixerFeed = false
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => {
        source = img
        sourceW = img.naturalWidth
        sourceH = img.naturalHeight
        resolve()
      }
      img.onerror = reject
      img.src = url
    } else {
      const video = document.createElement('video')
      video.src = url
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.onloadeddata = async () => {
        try {
          await video.play()
        } catch {
          /* the click that opened the picker is our gesture; ignore */
        }
        source = video
        sourceW = video.videoWidth
        sourceH = video.videoHeight
        resolve()
      }
      video.onerror = () => reject(new Error('decode failed'))
    }
  })
}

if (chooser) {
  const fileInput = document.getElementById('file-input')
  document.getElementById('use-upload').addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      await loadFile(file)
      chooser.style.display = 'none'
    } catch {
      chooser.querySelector('p').textContent = 'Could not load that file — try another photo or video.'
    }
  })
  for (const [id, fn] of [
    ['use-camera', useCamera],
    ['use-demo', useDemo],
  ]) {
    document.getElementById(id).addEventListener('click', async () => {
      try {
        await fn()
        chooser.style.display = 'none'
      } catch {
        chooser.querySelector('p').textContent =
          'Camera unavailable — try the demo source or upload a file instead.'
      }
    })
  }
  // Drag-and-drop a file anywhere.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    try {
      await loadFile(file)
      chooser.style.display = 'none'
    } catch {
      /* ignore */
    }
  })
}

// Never sit on a blank screen: start the demo so the gallery card and the
// first view show the effect. The chooser stays up (in the solo viewer) so the
// camera/upload options are one click away.
useDemo()
if (preview && chooser) chooser.style.display = 'none'

// Cover-fit the source into the sampling buffer.
function drawSourceToBuf() {
  const scale = Math.max(bufW / sourceW, bufH / sourceH)
  const w = sourceW * scale
  const h = sourceH * scale
  bctx.drawImage(source, (bufW - w) / 2, (bufH - h) / 2, w, h)
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  if (params.spacing !== lastSpacing || !pts.length) buildPoints()

  if (!source) {
    requestAnimationFrame(frame)
    return
  }
  demoTick?.(t)

  // Refresh the sampled source.
  try {
    drawSourceToBuf()
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
