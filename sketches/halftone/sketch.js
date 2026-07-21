/**
 * Halftone: print a live source (camera / dropped photo or video / demo / the
 * Mixer layers below) the way newspapers and comics do — rotated screens of
 * dots whose size carries the tone. Mono mode is one ink screen at 45°; CMYK
 * mode lays four multiply-blended screens at the classic press angles
 * (C 15°, M 75°, Y 0°, K 45°), and the rosette pattern emerges on its own.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource, clamp } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  cell: { value: +rt.random(5, 10).toFixed(1), min: 3, max: 24, step: 0.5, label: 'Dot pitch' },
  cmyk: { value: rt.rng() < 0.7, type: 'bool', label: 'CMYK (off = ink mono)' },
  contrast: { value: 1.15, min: 0.5, max: 2.2, step: 0.05, label: 'Contrast' },
  angle: { value: Math.round(rt.random(-15, 15)), min: -45, max: 45, step: 1, label: 'Screen angle' },
  scale: { value: 1.0, min: 0.5, max: 1.6, step: 0.02, label: 'Dot gain' },
  paper: { value: true, type: 'bool', label: 'Paper white (off = black)' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats fatten the dots a touch — the page "breathes" with the music.
rt.mapInput('audio.pulse', 'scale', 0.25)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let bufW = 0
let bufH = 0

// Cap the backing resolution: the number of screen cells (and their arcs)
// scales with the canvas area × 4 CMYK passes, so a native-res sheet is by
// far the slowest path. Rendering to ~1100px and letting the browser upscale
// keeps the rosette crisp for a fraction of the cost.
const RENDER_CAP = 1100
function effPR() {
  const long = Math.max(window.innerWidth, window.innerHeight)
  return Math.min(rt.pixelRatio, RENDER_CAP / long)
}
let PR = effPR()

let W = 0
let H = 0
function resize() {
  PR = effPR()
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  const cap = 480
  const s = Math.min(1, cap / Math.max(W, H))
  bufW = Math.max(2, Math.round(W * s))
  bufH = Math.max(2, Math.round(H * s))
  buf.width = bufW
  buf.height = bufH
}

// Draw one rotated dot screen. `value(r,g,b)` returns 0..1 ink coverage.
function screen(angleDeg, color, value, data, cellPx) {
  const a = (angleDeg * Math.PI) / 180
  const cosA = Math.cos(a)
  const sinA = Math.sin(a)
  const maxR = cellPx * 0.7 * params.scale
  // Cover the canvas in the rotated grid: iterate grid coords over the
  // bounding box of the rotated canvas.
  const diag = Math.hypot(W, H)
  const n = Math.ceil(diag / cellPx) + 2
  const cx = W / 2
  const cy = H / 2
  ctx.fillStyle = color
  ctx.beginPath()
  for (let gy = -n / 2; gy < n / 2; gy++) {
    for (let gx = -n / 2; gx < n / 2; gx++) {
      // Grid point in screen space.
      const u = gx * cellPx
      const v = gy * cellPx
      const x = cx + u * cosA - v * sinA
      const y = cy + u * sinA + v * cosA
      if (x < -cellPx || x > W + cellPx || y < -cellPx || y > H + cellPx) continue
      const bx = clamp(Math.round((x / W) * bufW), 0, bufW - 1)
      const by = clamp(Math.round((y / H) * bufH), 0, bufH - 1)
      const i = (by * bufW + bx) * 4
      let val = value(data[i], data[i + 1], data[i + 2])
      val = clamp((val - 0.5) * params.contrast + 0.5, 0, 1)
      const r = Math.sqrt(val) * maxR
      if (r < 0.25) continue
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  let data
  try {
    src.draw(bctx, bufW, bufH, { mirror: params.mirror })
    data = bctx.getImageData(0, 0, bufW, bufH).data
  } catch {
    requestAnimationFrame(frame)
    return
  }

  const cellPx = params.cell * PR
  const base = params.angle

  ctx.globalCompositeOperation = 'source-over'
  if (params.paper) {
    ctx.fillStyle = '#f4f1e8'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'multiply'
    if (params.cmyk) {
      // Ink coverage = 1 - channel (subtractive), keyed by the classic angles.
      screen(base + 15, 'rgb(0,174,239)', (r, g, b) => 1 - r / 255, data, cellPx)
      screen(base + 75, 'rgb(236,0,140)', (r, g, b) => 1 - g / 255, data, cellPx)
      screen(base + 0, 'rgb(255,242,0)', (r, g, b) => 1 - b / 255, data, cellPx)
      screen(base + 45, 'rgb(20,18,16)', (r, g, b) => {
        const k = 1 - Math.max(r, g, b) / 255
        return k * k // black plate only where it's genuinely dark
      }, data, cellPx)
    } else {
      screen(base + 45, 'rgb(24,22,26)', (r, g, b) => 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255, data, cellPx)
    }
  } else {
    // Glowing dots on black: additive screens sized by brightness.
    ctx.fillStyle = '#060608'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    if (params.cmyk) {
      screen(base + 15, 'rgb(255,40,40)', (r) => r / 255, data, cellPx)
      screen(base + 75, 'rgb(40,255,40)', (r, g) => g / 255, data, cellPx)
      screen(base + 0, 'rgb(60,60,255)', (r, g, b) => b / 255, data, cellPx)
    } else {
      screen(base + 45, 'rgb(235,235,240)', (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255, data, cellPx)
    }
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
