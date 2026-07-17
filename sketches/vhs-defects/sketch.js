/**
 * VHS Defects — the failure modes of a worn VHS tape, layered over moving
 * "footage" (a synthwave scene, or drop an image/GIF frame to degrade your own).
 * The processing is done in YIQ, the way analogue video actually separates luma
 * from chroma, which is what makes VHS look like VHS:
 *
 *   • chroma bleed + lag — the tape's tiny colour bandwidth, so hues smear
 *     sideways and trail to the right of edges;
 *   • tracking jitter — each scanline shoved horizontally by tape-speed error;
 *   • head-switching noise — the torn, noisy band along the bottom edge;
 *   • dropouts — bright white streaks where oxide has flaked off;
 *   • tape snow, scanlines, and a vertical-hold roll that slips now and then.
 *
 * Drag an image onto the canvas to run it through the deck instead.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  tracking: { value: 0.5, min: 0, max: 2, step: 0.02, label: 'Tracking jitter' },
  chroma: { value: 0.7, min: 0, max: 2, step: 0.02, label: 'Chroma bleed' },
  noise: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Tape snow' },
  dropouts: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Dropouts' },
  scan: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Scanlines' },
  roll: { value: 0.3, min: 0, max: 1.5, step: 0.02, label: 'Vertical hold' },
  wear: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Desaturate / wear' },
})
// Music: beats knock the tracking, loudness raises the snow.
rt.mapInput('audio.pulse', 'tracking', 0.8)
rt.mapInput('audio.volume', 'noise', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = document.createElement('canvas') // the clean "footage"
const sctx = src.getContext('2d')
const out = document.createElement('canvas') // the degraded frame
const octx = out.getContext('2d')

let W, H
let Y, I, Q, Ib, Qb, srcImg, outImg
let baseImage = null // dropped image overrides the generated scene

function build() {
  const long = Math.round(Math.min(Math.max(window.innerWidth, window.innerHeight), 380) * rt.detail)
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  src.width = out.width = W
  src.height = out.height = H
  Y = new Float32Array(W * H)
  I = new Float32Array(W * H)
  Q = new Float32Array(W * H)
  Ib = new Float32Array(W * H)
  Qb = new Float32Array(W * H)
  outImg = octx.createImageData(W, H)
}
function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  build()
}

// --- the clean footage: a scrolling synthwave scene (so motion reveals the
// tracking + chroma artifacts), or a dropped image. -----------------------
function drawScene(t) {
  if (baseImage) {
    const s = Math.max(W / baseImage.width, H / baseImage.height)
    const w = baseImage.width * s, h = baseImage.height * s
    sctx.drawImage(baseImage, (W - w) / 2, (H - h) / 2, w, h)
    // A little on-screen display, like a camcorder, gets degraded too.
    sctx.fillStyle = '#fff'
    sctx.font = `${Math.round(H * 0.05)}px monospace`
    sctx.fillText('▶  SP', W * 0.04, H * 0.1)
    return
  }
  const horizon = H * 0.55
  // Sky.
  const sky = sctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#1a0b2e')
  sky.addColorStop(0.6, '#5b1b6b')
  sky.addColorStop(1, '#ff5f6d')
  sctx.fillStyle = sky
  sctx.fillRect(0, 0, W, horizon)
  // Sun with the classic horizontal cuts.
  const sunR = H * 0.24
  const sunX = W / 2, sunY = horizon - sunR * 0.35
  const sun = sctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR)
  sun.addColorStop(0, '#ffe14d')
  sun.addColorStop(1, '#ff4d8d')
  sctx.save()
  sctx.beginPath(); sctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); sctx.clip()
  sctx.fillStyle = sun; sctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2)
  sctx.globalCompositeOperation = 'destination-out'
  sctx.fillStyle = '#000'
  for (let k = 0; k < 6; k++) {
    const yy = sunY + sunR * 0.15 + k * sunR * 0.16
    sctx.fillRect(sunX - sunR, yy, sunR * 2, sunR * (0.03 + k * 0.012))
  }
  sctx.restore()
  // Ground.
  sctx.fillStyle = '#0a0410'
  sctx.fillRect(0, horizon, W, H - horizon)
  // Perspective grid scrolling toward the viewer.
  sctx.strokeStyle = 'rgba(120,60,200,0.9)'
  sctx.lineWidth = Math.max(1, H * 0.004)
  const scroll = (t * 0.35) % 1
  for (let n = 0; n < 14; n++) {
    const f = (n + scroll) / 14
    const yy = horizon + (H - horizon) * f * f
    sctx.beginPath(); sctx.moveTo(0, yy); sctx.lineTo(W, yy); sctx.stroke()
  }
  for (let vx = -7; vx <= 7; vx++) {
    sctx.beginPath()
    sctx.moveTo(W / 2 + vx * (W * 0.06), horizon)
    sctx.lineTo(W / 2 + vx * (W * 0.7), H)
    sctx.stroke()
  }
}

const clampi = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v)

// --- the VHS deck ---------------------------------------------------------
function process(t) {
  srcImg = sctx.getImageData(0, 0, W, H)
  const s = srcImg.data
  // RGB → YIQ.
  for (let p = 0, q = 0; p < s.length; p += 4, q++) {
    const r = s[p], g = s[p + 1], b = s[p + 2]
    Y[q] = 0.299 * r + 0.587 * g + 0.114 * b
    I[q] = 0.596 * r - 0.274 * g - 0.322 * b
    Q[q] = 0.211 * r - 0.523 * g + 0.312 * b
  }
  // Horizontal box-blur of the chroma (VHS's narrow colour bandwidth).
  const rc = Math.max(1, Math.round(2 + params.chroma * 7))
  const inv = 1 / (rc * 2 + 1)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let si = 0, sq = 0
    for (let x = -rc; x <= rc; x++) { const c = clampi(x, W - 1); si += I[row + c]; sq += Q[row + c] }
    for (let x = 0; x < W; x++) {
      Ib[row + x] = si * inv
      Qb[row + x] = sq * inv
      const add = clampi(x + rc + 1, W - 1), sub = clampi(x - rc, W - 1)
      si += I[row + add] - I[row + sub]
      sq += Q[row + add] - Q[row + sub]
    }
  }

  const d = outImg.data
  const chromaLag = params.chroma * 6 // colour trails to the right of edges
  const desat = 1 - params.wear * 0.55
  const rollOff = Math.round(rollOffset)
  const snow = params.noise
  for (let y = 0; y < H; y++) {
    // Per-line tracking jitter: slow wobble + high-frequency tape error.
    let jit =
      (Math.sin(y * 0.3 + t * 6) * 1.5 + Math.sin(y * 1.7 + t * 13) * 1.0) * params.tracking +
      (Math.random() - 0.5) * 2 * params.tracking
    // Head-switching band: the torn, noisy strip along the very bottom.
    const band = y > H - Math.round(H * 0.06)
    if (band) jit += (Math.random() - 0.5) * W * 0.25 * (0.4 + params.tracking)
    const srcY = ((y + rollOff) % H + H) % H
    const row = srcY * W
    const orow = y * W
    for (let x = 0; x < W; x++) {
      const lx = clampi(Math.round(x + jit), W - 1)
      const cx = clampi(Math.round(x + jit + chromaLag), W - 1)
      let yv = Y[row + lx]
      // Snow: luma noise, heavier in the dark (and across the whole band).
      const n = (Math.random() - 0.5) * 255 * snow * (band ? 1.4 : 0.35 + (1 - yv / 255) * 0.8)
      yv += n
      const iv = Ib[row + cx] * desat
      const qv = Qb[row + cx] * desat
      let r = yv + 0.956 * iv + 0.621 * qv
      let g = yv - 0.272 * iv - 0.647 * qv
      let bl = yv - 1.106 * iv + 1.703 * qv
      // Scanlines.
      if (params.scan > 0 && (y & 1)) { const k = 1 - params.scan * 0.35; r *= k; g *= k; bl *= k }
      const o = (orow + x) * 4
      d[o] = r < 0 ? 0 : r > 255 ? 255 : r
      d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      d[o + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl
      d[o + 3] = 255
    }
  }
  octx.putImageData(outImg, 0, 0)

  // Dropouts: short bright streaks where the oxide flaked off.
  const nDrop = Math.random() < params.dropouts * 0.5 ? 1 + (Math.random() * params.dropouts * 3 | 0) : 0
  octx.save()
  octx.globalCompositeOperation = 'lighter'
  for (let k = 0; k < nDrop; k++) {
    const dy = Math.random() * H | 0
    const dx = Math.random() * W | 0
    const len = W * (0.05 + Math.random() * 0.25)
    octx.fillStyle = `rgba(255,255,255,${0.5 + Math.random() * 0.4})`
    octx.fillRect(dx, dy, len, 1)
    octx.fillStyle = 'rgba(180,180,255,0.4)'
    octx.fillRect(dx, dy + 1, len, 1)
  }
  octx.restore()
}

// Update the vertical-hold roll: usually still, occasionally slips and rolls.
let rollOffset = 0
let rollVel = 0
function updateRoll(dt) {
  if (Math.random() < 0.004 * params.roll) rollVel += (Math.random() - 0.2) * 40 * params.roll
  rollOffset += rollVel * dt * 6
  rollVel *= 0.92
  if (Math.abs(rollVel) < 0.05) rollVel = 0
}

function render() {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  // Slight softness (tape is never sharp).
  ctx.filter = `blur(${0.6 * rt.pixelRatio}px)`
  ctx.drawImage(out, 0, 0, canvas.width, canvas.height)
  ctx.filter = 'none'
  // Vignette + a faint moving tracking bar of static.
  const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016)
  lastNow = now
  updateRoll(dt)
  drawScene(now * 0.001)
  process(now * 0.001)
  render()
  requestAnimationFrame(frame)
}

// Drag & drop an image to feed the deck.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
  if (!f || !f.type.startsWith('image')) return
  const im = new Image()
  im.onload = () => { baseImage = im }
  im.src = URL.createObjectURL(f)
})

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
