/**
 * Waterfall — a live scrolling spectrogram off the microphone. Each new row is
 * the current FFT spectrum, coloured by loudness, and the whole field drifts
 * (down, up, left or right) so you read time as it flows across the screen.
 *
 * Click the 🎤 (bottom-right) to enable the mic. With no audio it idles on a
 * gentle synthetic spectrum so it never sits blank.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  bars: { value: 160, min: 32, max: 512, step: 1, label: 'Resolution' },
  gain: { value: 1.3, min: 0.3, max: 4, step: 0.05, label: 'Gain' },
  smooth: { value: 0.45, min: 0, max: 0.95, step: 0.02, label: 'Smoothing' },
  scroll: { value: 'Down', type: 'select', options: ['Down', 'Up', 'Left', 'Right'], label: 'Scroll' },
  speed: { value: 2, min: 1, max: 6, step: 1, label: 'Scroll speed (px)' },
  log: { value: true, type: 'bool', label: 'Log frequency' },
  mirror: { value: false, type: 'bool', label: 'Mirror' },
  hue: { value: +rt.random(0.5, 0.7).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette hue' },
})
rt.onBeat(() => {}) // mounts the mic toggle; we read the spectrum directly

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// A ping-pong buffer we scroll into so the freq axis is always crisp.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

let W, H
let mag = new Float32Array(512)
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  buf.width = W
  buf.height = H
  bctx.fillStyle = '#04060b'
  bctx.fillRect(0, 0, W, H)
}

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}

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
      target = Math.min(1, (c ? s / c / 255 : 0) * params.gain * (1 + i / n))
    } else {
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
  }
}

function colorFor(m) {
  return hslArr((params.hue + 0.55 - m * 0.55 + 1) % 1, 0.9, 0.1 + m * 0.55)
}

function render(t) {
  const n = Math.round(params.bars)
  sample(n, t)
  const dir = params.scroll
  const sp = Math.round(params.speed) * rt.pixelRatio
  const horizontal = dir === 'Left' || dir === 'Right'
  // scroll the buffer, then paint the new spectrum line along the leading edge
  if (dir === 'Down') bctx.drawImage(buf, 0, sp)
  else if (dir === 'Up') bctx.drawImage(buf, 0, -sp)
  else if (dir === 'Right') bctx.drawImage(buf, sp, 0)
  else bctx.drawImage(buf, -sp, 0)

  // The new row/column: frequency runs across the axis perpendicular to scroll.
  const len = horizontal ? H : W
  const stripe = bctx.createImageData(horizontal ? sp : len, horizontal ? len : sp)
  const sd = stripe.data
  const sw = horizontal ? sp : len
  const sh = horizontal ? len : sp
  for (let a = 0; a < len; a++) {
    const fi = a / len
    const bi = params.mirror ? Math.abs(fi * 2 - 1) : fi
    const m = mag[Math.min(n - 1, (bi * n) | 0)]
    const c = colorFor(m)
    for (let b = 0; b < sp; b++) {
      const x = horizontal ? b : a
      const y = horizontal ? a : b
      const o = (y * sw + x) * 4
      sd[o] = c[0]; sd[o + 1] = c[1]; sd[o + 2] = c[2]; sd[o + 3] = 255
    }
  }
  const px = dir === 'Right' ? 0 : dir === 'Left' ? W - sp : 0
  const py = dir === 'Down' ? 0 : dir === 'Up' ? H - sp : 0
  bctx.putImageData(stripe, px, py)

  ctx.drawImage(buf, 0, 0)

}

function frame(now) {
  rt.tick(now)
  render(now * 0.001)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
