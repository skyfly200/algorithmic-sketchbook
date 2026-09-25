// Dither — ordered (Bayer), Floyd-Steinberg, Atkinson, and random dithering
// applied to a live source, with configurable palette size and pixel scale.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Floyd-Steinberg', type: 'select', options: ['Ordered', 'Floyd-Steinberg', 'Atkinson', 'Random'], label: 'Algorithm' },
  levels: { value: 4, min: 2, max: 16, step: 1, label: 'Palette levels' },
  scale: { value: 3, min: 1, max: 8, step: 1, label: 'Pixel scale' },
  colour: { value: true, type: 'bool', label: 'Colour' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// Off-screen buffers
const small = document.createElement('canvas')
const sctx = small.getContext('2d', { willReadFrequently: true })
const out = document.createElement('canvas')
const octx = out.getContext('2d')

let W = 0, H = 0

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

// 4×4 Bayer matrix (normalised 0–1)
const BAYER4 = new Float32Array([
   0/16,  8/16,  2/16, 10/16,
  12/16,  4/16, 14/16,  6/16,
   3/16, 11/16,  1/16,  9/16,
  15/16,  7/16, 13/16,  5/16,
])

function quantise(v, levels) {
  const step = 1 / (levels - 1)
  return Math.round(v / step) * step
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }

function dither(imageData, mode, levels, colour) {
  const d = imageData.data
  const w = imageData.width
  const h = imageData.height
  // working float planes
  const r = new Float32Array(w * h)
  const g = new Float32Array(w * h)
  const b = new Float32Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const px = i * 4
    if (colour) {
      r[i] = d[px]     / 255
      g[i] = d[px + 1] / 255
      b[i] = d[px + 2] / 255
    } else {
      // luminance
      const lum = (d[px] * 0.299 + d[px + 1] * 0.587 + d[px + 2] * 0.114) / 255
      r[i] = g[i] = b[i] = lum
    }
  }

  if (mode === 'Ordered') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        // spread ±0.5 step around threshold
        const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] - 0.5) / (levels - 1)
        r[i] = quantise(clamp01(r[i] + threshold), levels)
        g[i] = quantise(clamp01(g[i] + threshold), levels)
        b[i] = quantise(clamp01(b[i] + threshold), levels)
      }
    }
  } else if (mode === 'Floyd-Steinberg') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const or = r[i], og = g[i], ob = b[i]
        const nr = quantise(or, levels)
        const ng = quantise(og, levels)
        const nb = quantise(ob, levels)
        r[i] = nr; g[i] = ng; b[i] = nb
        const er = or - nr, eg = og - ng, eb = ob - nb
        // distribute error: right 7/16, bl 3/16, below 5/16, br 1/16
        const spread = (di, frac) => {
          if (di < 0 || di >= w * h) return
          r[di] = clamp01(r[di] + er * frac)
          g[di] = clamp01(g[di] + eg * frac)
          b[di] = clamp01(b[di] + eb * frac)
        }
        if (x + 1 < w)         spread(i + 1,       7/16)
        if (y + 1 < h) {
          if (x > 0)            spread(i + w - 1,   3/16)
                                spread(i + w,       5/16)
          if (x + 1 < w)        spread(i + w + 1,   1/16)
        }
      }
    }
  } else if (mode === 'Atkinson') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const or = r[i], og = g[i], ob = b[i]
        const nr = quantise(or, levels)
        const ng = quantise(og, levels)
        const nb = quantise(ob, levels)
        r[i] = nr; g[i] = ng; b[i] = nb
        const er = (or - nr) / 8
        const eg = (og - ng) / 8
        const eb = (ob - nb) / 8
        const spread = (di) => {
          if (di < 0 || di >= w * h) return
          r[di] = clamp01(r[di] + er)
          g[di] = clamp01(g[di] + eg)
          b[di] = clamp01(b[di] + eb)
        }
        if (x + 1 < w)          spread(i + 1)
        if (x + 2 < w)          spread(i + 2)
        if (y + 1 < h) {
          if (x > 0)             spread(i + w - 1)
                                 spread(i + w)
          if (x + 1 < w)         spread(i + w + 1)
        }
        if (y + 2 < h)           spread(i + w * 2)
      }
    }
  } else { // Random
    for (let i = 0; i < w * h; i++) {
      const noise = (Math.random() - 0.5) / (levels - 1)
      r[i] = quantise(clamp01(r[i] + noise), levels)
      g[i] = quantise(clamp01(g[i] + noise), levels)
      b[i] = quantise(clamp01(b[i] + noise), levels)
    }
  }

  // write back
  for (let i = 0; i < w * h; i++) {
    const px = i * 4
    d[px]     = r[i] * 255
    d[px + 1] = g[i] * 255
    d[px + 2] = b[i] * 255
  }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  const scale = Math.round(params.scale)
  const sw = Math.max(1, Math.round(W / scale))
  const sh = Math.max(1, Math.round(H / scale))

  if (small.width !== sw || small.height !== sh) {
    small.width = sw; small.height = sh
    out.width = sw; out.height = sh
  }

  // downscale source into small buffer
  sctx.clearRect(0, 0, sw, sh)
  src.draw(sctx, sw, sh, { mirror: params.mirror })

  // dither
  const imgData = sctx.getImageData(0, 0, sw, sh)
  dither(imgData, params.mode, Math.round(params.levels), params.colour)

  // blit dithered data to out, then scale up (nearest-neighbour) to canvas
  octx.putImageData(imgData, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(out, 0, 0, W, H)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
