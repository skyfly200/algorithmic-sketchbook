// Polarization — a live source seen through crossed polarizers over a stressed
// birefringent film: luminance is read as an optical retardation and mapped
// through the Michel-Lévy interference-colour chart, so the image dissolves
// into shimmering bands of spectral colour. A rotating analyzer sweeps the
// whole palette; thickness sets how many orders of colour appear.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  retardation: { value: 1.2, min: 0.2, max: 4, step: 0.05, label: 'Retardation' },
  analyzer: { value: 0, min: 0, max: 180, step: 1, label: 'Analyzer angle' },
  spin: { value: 0.2, min: -1, max: 1, step: 0.02, label: 'Analyzer spin' },
  stress: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Stress bands' },
  mix: { value: 0.9, min: 0, max: 1, step: 0.02, label: 'Effect mix' },
  brightness: { value: 1.1, min: 0.4, max: 2, step: 0.05, label: 'Brightness' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.mid', 'analyzer', 90)
rt.mapInput('audio.pulse', 'retardation', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })

// approximate Michel-Lévy: retardation (nm-ish 0..~3000) → interference colour
function interference(ret, cross) {
  // sum of three cos² channels at R,G,B wavelengths, with the analyzer term
  const lam = [650, 550, 450]
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const phase = (Math.PI * ret) / lam[c] * 1000
    let v = Math.sin(phase) ** 2
    v = cross ? v : 1 - v // crossed vs parallel polarizers
    out[c] = v
  }
  return out
}
// precompute a 512-entry LUT over retardation
const LUT = new Float32Array(512 * 3)
function buildLUT(analyzerDeg) {
  const cross = true
  for (let i = 0; i < 512; i++) {
    const ret = (i / 512) * 3000 * params.retardation
    const [r, g, b] = interference(ret, cross)
    // analyzer rotation mixes crossed↔parallel smoothly
    const a = (analyzerDeg * Math.PI) / 180
    const m = Math.cos(a) ** 2
    const p = interference(ret, false)
    LUT[i * 3] = r * m + p[0] * (1 - m)
    LUT[i * 3 + 1] = g * m + p[1] * (1 - m)
    LUT[i * 3 + 2] = b * m + p[2] * (1 - m)
  }
}

let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 700; const s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s)); bh = buf.height = Math.max(2, Math.round(H * s))
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  const analyzer = (params.analyzer + t * params.spin * 60) % 180
  buildLUT(analyzer)
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const img = bctx.getImageData(0, 0, bw, bh); const d = img.data
  const bright = params.brightness, mix = params.mix
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    // stress bands: add spatial ripple to the retardation from position
    const idx = i / 4
    const x = idx % bw, y = (idx / bw) | 0
    const stress = params.stress * (Math.sin(x * 0.05) + Math.cos(y * 0.05)) * 0.15
    let li = Math.max(0, Math.min(511, Math.round((lum + stress) * 511)))
    const nr = LUT[li * 3] * 255 * bright
    const ng = LUT[li * 3 + 1] * 255 * bright
    const nb = LUT[li * 3 + 2] * 255 * bright
    d[i] = r * (1 - mix) + nr * mix
    d[i + 1] = g * (1 - mix) + ng * mix
    d[i + 2] = b * (1 - mix) + nb * mix
  }
  bctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
