// Stacked ridgelines à la Joy Division's "Unknown Pleasures" cover — itself a
// stack of the pulsar CP 1919's radio pulses. Each row is a rectified fractal
// profile pulled up under a central Gaussian, so the spikes gather mid-width
// and flatten to a line at the edges. Rows are drawn back (top) to front
// (bottom); filling under each curve with the background colour hides the rows
// behind it, giving the woodcut, overlapping-mountains look. The noise field
// scrolls, so the ridges breathe and drift.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  lines: { value: 62, min: 12, max: 140, step: 1, label: 'Lines' },
  amplitude: { value: 1.0, min: 0.2, max: 2.5, step: 0.05, label: 'Amplitude' },
  spread: { value: 0.5, min: 0.15, max: 1, step: 0.01, label: 'Spread' },
  speed: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Speed' },
  detail: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Detail' },
  wander: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Wander' },
  glow: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'Glow' },
  hue: { value: 210, min: 0, max: 360, step: 1, label: 'Hue' },
  tint: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'Tint' },
})

// Loudness swells the peaks, a beat flares the glow — a good default feel.
rt.mapInput('audio.volume', 'amplitude', 0.5)
rt.mapInput('audio.pulse', 'glow', 0.4)

// --- 1D value-noise fractal --------------------------------------------------
const seedOff = rt.rng() * 1000
function hash(x) {
  const s = Math.sin(x * 127.1 + seedOff) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x) {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i) * (1 - u) + hash(i + 1) * u
}
function fbm(x) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let k = 0; k < 5; k++) {
    sum += amp * vnoise(x * freq)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // ~0..1
}

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)

  const lines = Math.max(8, Math.round(params.lines))
  const marginX = W * 0.16
  const spanX = W - marginX * 2
  const marginTop = H * 0.14
  const marginBot = H * 0.12
  const dy = (H - marginTop - marginBot) / (lines - 1)
  const peak = dy * 3.4 * params.amplitude // how far the tallest spike rises

  // Envelope: a central Gaussian, wider with `spread`.
  const sigma = 0.1 + params.spread * 0.34
  const inv2s2 = 1 / (2 * sigma * sigma)

  // Frequency of the noise across the width, and its scroll.
  const freqScale = 2.5 + params.detail * 15
  const scroll = t * params.speed

  // Sample density: enough to be smooth, scaled by quality.
  const cols = Math.max(80, Math.round(spanX / (2.4 / Math.max(0.4, rt.pixelRatio))))
  const dx = spanX / cols

  const sat = Math.round(params.tint * 60)
  const stroke = `hsl(${Math.round(params.hue)}, ${sat}%, 92%)`
  const lw = Math.max(1, 1.15 * rt.pixelRatio)

  ctx.lineJoin = 'round'
  ctx.lineWidth = lw

  const ys = new Float32Array(cols + 1)

  // Back (top) to front (bottom): each filled under-curve occludes rows behind.
  for (let r = 0; r < lines; r++) {
    const baseY = marginTop + r * dy
    // Each row samples the field at its own offset so rows are decorrelated;
    // `wander` lets nearby rows drift apart over time for a liquid feel.
    const rowSeed = r * 8.13
    const rowDrift = scroll + Math.sin(r * 0.5 + t * params.wander * 0.6) * params.wander * 1.5

    for (let c = 0; c <= cols; c++) {
      const u = c / cols // 0..1 across the span
      const du = u - 0.5
      // Gaussian body, forced to zero right at the edges so every line lands
      // flat on its baseline (no vertical seam where the rows begin/end).
      const edge = Math.min(u, 1 - u) / 0.07
      const fade = edge < 1 ? edge * edge * (3 - 2 * edge) : 1
      const env = Math.exp(-(du * du) * inv2s2) * fade
      const raw = fbm(u * freqScale + rowSeed + rowDrift)
      // Rectify around a threshold so the profile sits flat between spikes and
      // sharpens as `detail` rises.
      let spike = (raw - 0.42) / 0.58
      spike = spike > 0 ? spike : 0
      spike = Math.pow(spike, 1 + params.detail * 1.8)
      ys[c] = baseY - env * spike * peak
    }

    // Fill under the curve with the background to mask the rows behind.
    ctx.beginPath()
    ctx.moveTo(marginX, ys[0])
    for (let c = 1; c <= cols; c++) ctx.lineTo(marginX + c * dx, ys[c])
    ctx.lineTo(marginX + spanX, H)
    ctx.lineTo(marginX, H)
    ctx.closePath()
    ctx.fillStyle = '#05060a'
    ctx.fill()

    // Stroke the ridge itself.
    ctx.beginPath()
    ctx.moveTo(marginX, ys[0])
    for (let c = 1; c <= cols; c++) ctx.lineTo(marginX + c * dx, ys[c])
    ctx.strokeStyle = stroke
    if (params.glow > 0.01) {
      ctx.shadowColor = stroke
      ctx.shadowBlur = params.glow * 12 * rt.pixelRatio
    } else {
      ctx.shadowBlur = 0
    }
    ctx.stroke()
  }
  ctx.shadowBlur = 0

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
