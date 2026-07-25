// Film Tone — a darkroom grade for a live source: sepia, black & white,
// negative or cyanotype, with filmic contrast, grain and a vignette. A simple
// per-pixel tone map applied over the shared source pipeline (camera, a dropped
// clip/photo, the demo, or the layers below in the Mixer/Patch).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Sepia', type: 'select', options: ['Sepia', 'Black & White', 'Negative', 'Cyanotype'], label: 'Tone' },
  strength: { value: 1, min: 0, max: 1, step: 0.02, label: 'Strength' },
  contrast: { value: 1.15, min: 0.5, max: 2.2, step: 0.05, label: 'Contrast' },
  brightness: { value: 0, min: -0.4, max: 0.4, step: 0.02, label: 'Brightness' },
  grain: { value: 0.12, min: 0, max: 0.6, step: 0.02, label: 'Film grain' },
  vignette: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'grain', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })

let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 720
  const s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
}

// Map a 0..255 luminance onto a two-point colour ramp (shadow → highlight).
function ramp(l, lo, hi) {
  const k = l / 255
  return [lo[0] + (hi[0] - lo[0]) * k, lo[1] + (hi[1] - lo[1]) * k, lo[2] + (hi[2] - lo[2]) * k]
}
const SEPIA_LO = [42, 26, 12], SEPIA_HI = [255, 240, 200]
const CYAN_LO = [8, 22, 54], CYAN_HI = [214, 236, 255]

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const img = bctx.getImageData(0, 0, bw, bh)
  const d = img.data
  const mode = params.mode
  const mix = params.strength
  const con = params.contrast
  const bright = params.brightness * 255
  const grain = params.grain
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2]
    let r, g, b
    if (mode === 'Negative') {
      r = 255 - r0; g = 255 - g0; b = 255 - b0
      r = (r - 128) * con + 128 + bright; g = (g - 128) * con + 128 + bright; b = (b - 128) * con + 128 + bright
      if (grain > 0.001) { const n = (Math.random() - 0.5) * grain * 90; r += n; g += n; b += n }
    } else {
      // filmic luminance, contrasted around mid grey then lifted/dropped
      let l = 0.299 * r0 + 0.587 * g0 + 0.114 * b0
      l = (l - 128) * con + 128 + bright
      if (grain > 0.001) l += (Math.random() - 0.5) * grain * 110
      l = l < 0 ? 0 : l > 255 ? 255 : l
      if (mode === 'Black & White') { r = g = b = l }
      else if (mode === 'Cyanotype') { const c = ramp(l, CYAN_LO, CYAN_HI); r = c[0]; g = c[1]; b = c[2] }
      else { const c = ramp(l, SEPIA_LO, SEPIA_HI); r = c[0]; g = c[1]; b = c[2] } // Sepia
    }
    d[i] = r0 + (r - r0) * mix
    d[i + 1] = g0 + (g - g0) * mix
    d[i + 2] = b0 + (b - b0) * mix
  }
  bctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, 0, 0, W, H)

  // vignette drawn at full res so it stays smooth
  if (params.vignette > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.33, W / 2, H / 2, Math.max(W, H) * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${params.vignette * 0.9})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
