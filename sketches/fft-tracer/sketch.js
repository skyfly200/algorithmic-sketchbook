/**
 * FFT Tracer — a live spectrum analyser off the microphone. Trace the FFT
 * magnitude spectrum as a glowing filled curve, or a classic bar-graph
 * analyser, with falling peak-hold caps on top. Log-frequency axis by default.
 * (The scrolling spectrogram lives in its own "Waterfall" sketch now.)
 *
 * Click the 🎤 (bottom-right) to enable the mic. With no audio it idles on a
 * gentle synthetic spectrum so it never sits blank.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Bars', type: 'select', options: ['Bars', 'Curve'], label: 'Display' },
  bars: { value: 96, min: 24, max: 256, step: 1, label: 'Resolution' },
  gain: { value: 1.3, min: 0.3, max: 4, step: 0.05, label: 'Gain' },
  smooth: { value: 0.55, min: 0, max: 0.95, step: 0.02, label: 'Smoothing' },
  log: { value: true, type: 'bool', label: 'Log frequency' },
  mirror: { value: false, type: 'bool', label: 'Mirror' },
  peaks: { value: true, type: 'bool', label: 'Peak-hold caps' },
  hue: { value: +rt.random(0.5, 0.7).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
})
rt.onBeat(() => {}) // mounts the mic toggle; we read the spectrum directly

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W, H
let mag = new Float32Array(256) // smoothed per-bar magnitude
let peak = new Float32Array(256) // falling peak-hold
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
}

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}

// Fill mag[] for `n` bars by averaging FFT bins (log- or linear-spaced), or a
// synthetic idle spectrum when the mic is off.
function sample(n, t) {
  const bins = rt.beat.getSpectrum()
  const active = rt.beat.state.active && bins
  const smoothF = params.smooth
  const nb = active ? bins.length : 0
  for (let i = 0; i < n; i++) {
    let target
    if (active) {
      const lo = params.log ? 1 * Math.pow(nb / 1, i / n) : (i / n) * nb
      const hi = params.log ? 1 * Math.pow(nb / 1, (i + 1) / n) : ((i + 1) / n) * nb
      let s = 0, c = 0
      for (let b = Math.floor(lo); b < Math.max(Math.floor(lo) + 1, hi) && b < nb; b++) { s += bins[b]; c++ }
      target = Math.min(1, (c ? s / c / 255 : 0) * params.gain * (1 + i / n)) // tilt up highs
    } else {
      // Idle: a couple of gently drifting formant bumps + a soft noise floor.
      const f = i / n
      target =
        0.12 +
        0.5 * Math.exp(-((f - (0.2 + 0.06 * Math.sin(t * 0.7))) ** 2) / 0.004) +
        0.4 * Math.exp(-((f - (0.5 + 0.1 * Math.sin(t * 0.5 + 1))) ** 2) / 0.01) +
        0.25 * Math.exp(-((f - 0.78) ** 2) / 0.02) * (0.6 + 0.4 * Math.sin(t * 3))
      target *= 0.5 + 0.5 * Math.abs(Math.sin(t + f * 8)) * 0.6 + 0.4
      target = Math.min(1, target * params.gain * 0.7)
    }
    mag[i] = mag[i] * smoothF + target * (1 - smoothF)
    peak[i] = Math.max(peak[i] * 0.965, mag[i]) // peak-hold with slow fall
  }
}

// index into mag[]/peak[] for bar i honouring the mirror toggle
function idx(i, n) {
  const bi = params.mirror ? Math.abs((i / (n - 1)) * 2 - 1) : i / (n - 1)
  return Math.min(n - 1, Math.round(bi * (n - 1)))
}

function render(t) {
  const n = Math.round(params.bars)
  sample(n, t)
  const [hr, hg, hb] = hslArr(params.hue, 0.85, 0.6)

  // background with a soft vertical wash
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#05070d')
  bg.addColorStop(1, '#020306')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const baseY = H - 10 * rt.pixelRatio
  const h0 = H - 40 * rt.pixelRatio
  const bw = W / n

  if (params.mode === 'Curve') {
    ctx.beginPath()
    ctx.moveTo(0, baseY)
    for (let i = 0; i < n; i++) {
      const m = mag[idx(i, n)]
      ctx.lineTo(i * bw + bw / 2, baseY - m * h0)
    }
    ctx.lineTo(W, baseY)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, baseY - h0, 0, baseY)
    grad.addColorStop(0, `rgba(${hr},${hg},${hb},0.95)`)
    grad.addColorStop(1, `rgba(${hr},${hg},${hb},0.08)`)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = `rgba(${Math.min(255, hr + 60)},${Math.min(255, hg + 60)},${Math.min(255, hb + 60)},0.9)`
    ctx.lineWidth = 2 * rt.pixelRatio
    ctx.stroke()
  } else {
    // Bars: each bin a vertical bar coloured by its own level, lit from below.
    const gap = Math.max(1, bw * 0.12)
    for (let i = 0; i < n; i++) {
      const m = mag[idx(i, n)]
      const bh = m * h0
      const c = hslArr((params.hue + 0.05 - m * 0.35 + 1) % 1, 0.9, 0.35 + m * 0.35)
      const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY)
      g.addColorStop(0, `rgb(${c[0]},${c[1]},${c[2]})`)
      g.addColorStop(1, `rgba(${hr},${hg},${hb},0.15)`)
      ctx.fillStyle = g
      ctx.fillRect(i * bw + gap / 2, baseY - bh, bw - gap, bh)
    }
  }

  // Peak-hold caps.
  if (params.peaks) {
    for (let i = 0; i < n; i++) {
      const p = peak[idx(i, n)]
      ctx.fillStyle = '#fff'
      ctx.globalAlpha = 0.35 + 0.5 * p
      ctx.fillRect(i * bw + 1, baseY - p * h0 - 2 * rt.pixelRatio, Math.max(1, bw - 2), 2.5 * rt.pixelRatio)
    }
    ctx.globalAlpha = 1
  }

}

function frame(now) {
  rt.tick(now)
  render(now * 0.001)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
