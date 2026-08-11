// Wind — Photoshop's Wind for a live source: catch the bright edges and smear
// them into fine horizontal streaks blown across the frame. Edges (rising
// brightness) seed a coloured streak that decays as it travels downwind, broken
// up with grain so it reads as wind-blown lines rather than a motion blur.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  direction: { value: 'Right', type: 'select', options: ['Right', 'Left', 'Both'], label: 'Direction' },
  strength: { value: 0.75, min: 0.1, max: 1, step: 0.02, label: 'Gust length' },
  threshold: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Edge sensitivity' },
  grain: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Grain' },
  amount: { value: 0.85, min: 0, max: 1, step: 0.02, label: 'Amount' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'strength', 0.3)

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 900, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}
const lum = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114

// one directional pass over a row: streaks seed at rising edges and decay downwind
function pass(d, out, dir, y, decay, thr255, grain, amount, seedMul) {
  const row = y * bw * 4
  const start = dir > 0 ? 0 : bw - 1, end = dir > 0 ? bw : -1
  let sr = 0, sg = 0, sb = 0, prev = lum(d[row], d[row + 1], d[row + 2])
  for (let x = start; x !== end; x += dir) {
    const i = row + x * 4
    const cur = lum(d[i], d[i + 1], d[i + 2])
    if (cur - prev > thr255 && Math.random() < seedMul) { sr = d[i]; sg = d[i + 1]; sb = d[i + 2] }
    prev = cur
    sr *= decay; sg *= decay; sb *= decay
    const g = 1 - grain * Math.random()
    // blow the streak forward: lighten the target with the decaying colour
    out[i] = Math.max(out[i], sr * g * amount)
    out[i + 1] = Math.max(out[i + 1], sg * g * amount)
    out[i + 2] = Math.max(out[i + 2], sb * g * amount)
  }
}

function frame(now) {
  rt.tick(now)
  src.update(now * 0.001)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const im = bctx.getImageData(0, 0, bw, bh)
  const d = im.data
  const out = new Uint8ClampedArray(d) // start from the source, streaks lighten it
  const decay = 0.90 + params.strength * 0.095
  const thr = params.threshold * 255
  const seed = 0.5 + params.grain * 0.5
  const amt = params.amount
  const both = params.direction === 'Both'
  const dir = params.direction === 'Left' ? -1 : 1
  for (let y = 0; y < bh; y++) {
    pass(d, out, dir, y, decay, thr, params.grain, amt, seed)
    if (both) pass(d, out, -1, y, decay, thr, params.grain, amt, seed)
  }
  im.data.set(out)
  bctx.putImageData(im, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
