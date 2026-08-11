// Ink Bleed — read a live source as ink laid on wet paper and let the water run
// it. A persistent ink field is re-inked from the source each frame, then the
// water advects it along a chosen direction, spreads it sideways by capillary
// blur and breaks the leading edge into feathered fingers, so darks bloom and
// drip while the drawing keeps redrawing itself underneath. Carries the source
// colour into the runs, or bleeds mono black on paper.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const DIRS = { Down: [0, 1], Up: [0, -1], Left: [-1, 0], Right: [1, 0] }
const params = rt.params({
  direction: { value: 'Down', type: 'select', options: Object.keys(DIRS), label: 'Water runs' },
  flow: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Flow speed' },
  bleed: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Capillary spread' },
  wetness: { value: 0.7, min: 0, max: 0.98, step: 0.01, label: 'Wetness (dwell)' },
  inkiness: { value: 0.5, min: 0.05, max: 1, step: 0.02, label: 'Inkiness' },
  feather: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Edge feather' },
  mono: { value: false, type: 'bool', label: 'Mono (black ink)' },
  paper: { value: '#f4efe3', type: 'color', label: 'Paper' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'flow', 0.3)

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
const out = document.createElement('canvas')
const octx = out.getContext('2d')
let W = 0, H = 0, bw = 0, bh = 0
let ink, ink2, col, col2, outImg // float fields + output image
function alloc() {
  const n = bw * bh
  ink = new Float32Array(n); ink2 = new Float32Array(n)
  col = new Float32Array(n * 3); col2 = new Float32Array(n * 3)
  out.width = bw; out.height = bh
  outImg = octx.createImageData(bw, bh)
}
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 440, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
  alloc()
}
function hexRgb(h) {
  const v = parseInt(h.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
// cheap hash noise for the feathered leading edge
function hn(x, y) { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n) }

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const sd = bctx.getImageData(0, 0, bw, bh).data
  const [dx, dy] = DIRS[params.direction]
  const flow = params.flow, spread = params.bleed, retain = params.wetness
  const feather = params.feather, mono = params.mono
  const [pr, pg, pb] = hexRgb(params.paper)
  const inkGain = params.inkiness
  const step = 1 + Math.round(flow * 2) // how many cells the water pulls per frame

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x, i3 = i * 3, si = i * 4
      // source ink: darkness (and a touch of saturation) becomes wet ink
      const r = sd[si], g = sd[si + 1], b = sd[si + 2]
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      let sInk = Math.max(0, (1 - lum) - (1 - inkGain) * 0.4) * (0.6 + inkGain)
      if (sInk > 1) sInk = 1

      // advect: pull ink from upstream (behind the flow) with lateral blur
      const ux = x - dx * step, uy = y - dy * step
      let a = 0, cr = 0, cg = 0, cb = 0, wsum = 0
      for (let k = -1; k <= 1; k++) {
        // sample perpendicular to flow for capillary spread
        const sx = ux + (dy ? k : 0), sy = uy + (dx ? k : 0)
        if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue
        const w = k === 0 ? 1 : spread * 0.6
        const j = sy * bw + sx, j3 = j * 3
        a += ink[j] * w; cr += col[j3] * w; cg += col[j3 + 1] * w; cb += col[j3 + 2] * w; wsum += w
      }
      if (wsum > 0) { a /= wsum; cr /= wsum; cg /= wsum; cb /= wsum }
      // feather the leading edge: randomly starve thin runs so they finger out
      const edge = 1 - feather * 0.9 * hn(x * 0.7 + t * 3, y * 0.7)
      let run = a * retain * edge

      // combine the running ink with freshly inked source (source wins where drawn)
      let ni, ncr, ncg, ncb
      if (sInk >= run) {
        ni = sInk
        if (mono) { ncr = 20; ncg = 16; ncb = 14 } else { ncr = r; ncg = g; ncb = b }
      } else {
        ni = run
        ncr = cr; ncg = cg; ncb = cb
      }
      ink2[i] = ni
      col2[i3] = ncr; col2[i3 + 1] = ncg; col2[i3 + 2] = ncb
    }
  }
  // swap fields
  let ti = ink; ink = ink2; ink2 = ti
  let tc = col; col = col2; col2 = tc

  // composite ink over paper
  const od = outImg.data
  for (let i = 0, i3 = 0, si = 0; i < bw * bh; i++, i3 += 3, si += 4) {
    let a = ink[i]; if (a > 1) a = 1
    // ink density is nonlinear so pools read dark and thin runs stay pale
    const av = a * a * (3 - 2 * a)
    od[si] = pr * (1 - av) + col[i3] * av
    od[si + 1] = pg * (1 - av) + col[i3 + 1] * av
    od[si + 2] = pb * (1 - av) + col[i3 + 2] * av
    od[si + 3] = 255
  }
  octx.putImageData(outImg, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(out, 0, 0, W, H)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
