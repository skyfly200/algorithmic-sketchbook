// Stained Glass — recompose a live source as a leaded stained-glass window. A
// drifting Voronoi mosaic cuts the frame into glass panes; each pane takes a
// single saturated colour sampled from the source under it, lit with a soft
// glassy sheen, and the panes are separated by dark leaded "came" lines. A
// filter: it re-glazes whatever feeds it (camera, a clip, the demo, layers).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  cell: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Pane size' },
  lead: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Leading width' },
  saturation: { value: 1.4, min: 0.6, max: 2.2, step: 0.05, label: 'Glass saturation' },
  sheen: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Glass sheen' },
  drift: { value: 0.3, min: 0, max: 1.5, step: 0.05, label: 'Drift' },
  irregular: { value: 0.8, min: 0, max: 1, step: 0.02, label: 'Irregularity' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'sheen', 0.4)

const src = createSource()
const sc = document.createElement('canvas'), scx = sc.getContext('2d', { willReadFrequently: true })
const low = document.createElement('canvas'), lctx = low.getContext('2d')

let W = 0, H = 0, PR = 1, RW = 0, RH = 0, img = null, sdata = null
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  const long = Math.max(200, Math.round(340 * rt.detail))
  RW = W >= H ? long : Math.round(long * (W / H))
  RH = W >= H ? Math.round(long * (H / W)) : long
  sc.width = RW; sc.height = RH
  low.width = RW; low.height = RH
  img = lctx.createImageData(RW, RH)
}
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  scx.clearRect(0, 0, RW, RH)
  src.draw(scx, RW, RH, { mirror: params.mirror })
  sdata = scx.getImageData(0, 0, RW, RH).data

  const cell = Math.max(6, 26 * params.cell * (RW / 340))
  const irr = params.irregular
  const leadW = params.lead * cell * 0.32 + 0.6
  const sat = params.saturation
  const sheen = params.sheen
  const dr = params.drift
  const out = img.data
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      // jittered-grid Voronoi: nearest (F1) and 2nd (F2) seeds around this pixel
      const gx = x / cell, gy = y / cell
      const xi = Math.floor(gx), yi = Math.floor(gy)
      let f1 = 1e9, f2 = 1e9, sx = 0, sy = 0
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const ci = xi + ox, cj = yi + oy
        const jx = 0.5 + (hash2(ci, cj * 131) - 0.5) * irr + Math.sin(t * dr + ci * 1.7) * dr * 0.18
        const jy = 0.5 + (hash2(ci + 57, cj * 131 + 9) - 0.5) * irr + Math.cos(t * dr + cj * 1.3) * dr * 0.18
        const fx = (ci + jx) * cell, fy = (cj + jy) * cell
        const dx = fx - x, dy = fy - y, dd = dx * dx + dy * dy
        if (dd < f1) { f2 = f1; f1 = dd; sx = fx; sy = fy } else if (dd < f2) f2 = dd
      }
      const edge = Math.sqrt(f2) - Math.sqrt(f1) // small = near a pane boundary
      // sample the source colour at the pane's seed → one flat colour per pane
      let si = ((Math.min(RH - 1, Math.max(0, sy | 0)) * RW) + Math.min(RW - 1, Math.max(0, sx | 0))) * 4
      let r = sdata[si], g = sdata[si + 1], b = sdata[si + 2]
      // boost saturation so the glass glows like coloured light
      const lum = r * 0.299 + g * 0.587 + b * 0.114
      r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat
      // glassy sheen: brighter toward the pane centre + a diagonal light streak
      const rc = 1 - Math.min(1, Math.sqrt(f1) / (cell * 0.9))
      const streak = 0.5 + 0.5 * Math.sin((x + y) * 0.06 + t * 0.5)
      const glass = 1 + sheen * (rc * 0.35 + streak * 0.12 - 0.12)
      r *= glass; g *= glass; b *= glass
      // leaded came: darken toward the pane boundaries
      const lead = 1 - Math.min(1, edge / leadW)
      const k = 1 - lead * 0.92
      const i = (y * RW + x) * 4
      out[i] = Math.max(6, Math.min(255, r * k))
      out[i + 1] = Math.max(6, Math.min(255, g * k))
      out[i + 2] = Math.max(8, Math.min(255, b * k))
      out[i + 3] = 255
    }
  }
  lctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(low, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
