// Rock Layers — an extreme close-up of a sedimentary rock face, the camera
// slowly panning across it. Horizontal strata are folded and warped into
// organic, smoothly undulating bands that pinch and swell; fine cross-bedding
// laminates the thicker beds. The whole face drifts continuously, as if you were
// tracking sideways along a cliff, with a soft raking light for relief.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  strata: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Layer thickness' },
  fold: { value: 1, min: 0, max: 2, step: 0.05, label: 'Folding' },
  detail: { value: 1, min: 0, max: 2, step: 0.05, label: 'Cross-bedding' },
  pan: { value: 0.5, min: -2, max: 2, step: 0.05, label: 'Pan speed' },
  drift: { value: 0.12, min: -1, max: 1, step: 0.02, label: 'Vertical drift' },
  light: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Light / warmth' },
})
rt.mapInput('audio.level', 'pan', 0.5)

// Sandstone / ironstone / siltstone palette — ochres, iron reds, creams, greys.
const PALETTE = [
  [178, 120, 78], [150, 92, 58], [200, 152, 106], [120, 70, 48], [214, 172, 122],
  [166, 104, 66], [190, 132, 86], [132, 82, 62], [206, 158, 112], [152, 96, 70],
  [184, 128, 92], [124, 86, 74], [196, 146, 98], [142, 90, 54],
]

let W = 0, H = 0, PR = 1
let layers = []
let Htot = 0
let folds = []
let maxFold = 0
function build() {
  // shared large-scale folds applied to every boundary → parallel folded strata
  folds = [
    { a: 0.06 * H, k: (Math.PI * 2) / (1.7 * W), p: rt.random(0, 6.28) },
    { a: 0.035 * H, k: (Math.PI * 2) / (0.85 * W), p: rt.random(0, 6.28) },
    { a: 0.018 * H, k: (Math.PI * 2) / (0.42 * W), p: rt.random(0, 6.28) },
  ]
  maxFold = folds.reduce((s, f) => s + Math.abs(f.a), 0) * 2 + 0.05 * H
  // a tall repeating stack of beds, tiled vertically so the face can drift forever
  layers = []
  let y = 0, idx = 0
  const target = H * 2.4
  while (y < target) {
    const thick = rt.random(0.022, 0.06) * H * params.strata
    const base = PALETTE[idx % PALETTE.length]
    const v = rt.random(-14, 14)
    const color = [base[0] + v, base[1] + v * 0.8, base[2] + v * 0.6]
    layers.push({
      top: y, thick, color,
      wobA: rt.random(3, 11) * PR, wobK: (Math.PI * 2) / rt.random(0.3 * W, 0.9 * W), wobP: rt.random(0, 6.28),
    })
    y += thick; idx++
  }
  Htot = y
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

function fold(wx) {
  let s = 0
  for (const f of folds) s += f.a * Math.sin(wx * f.k + f.p)
  return s
}
// Screen-Y of a boundary with world top `topW` and its own small wobble, at
// screen column x, given the camera offsets.
function boundaryY(topW, wobA, wobK, wobP, x, camX, camY) {
  const wx = x + camX
  return topW - camY + fold(wx) + wobA * Math.sin(wx * wobK + wobP)
}

let last = 0, camX = 0, camY = 0, builtStrata = 1
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  if (params.strata !== builtStrata) { builtStrata = params.strata; build() }

  camX += params.pan * 42 * PR * dt
  camY += params.drift * 30 * PR * dt
  camY = ((camY % Htot) + Htot) % Htot // wrap into the tiled stack

  const step = Math.max(5, Math.floor(W / 180)) * PR
  const warm = params.light
  const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v

  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, W, H)

  const kStart = Math.floor((camY - maxFold) / Htot) - 1
  const kEnd = Math.ceil((camY + H + maxFold) / Htot) + 1
  for (let k = kStart; k <= kEnd; k++) {
    const off = k * Htot
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i]
      const next = layers[(i + 1) % layers.length]
      const nextTop = (i + 1 < layers.length ? next.top : Htot) + off
      const topW = L.top + off
      // cull beds fully off-screen
      if (topW - camY - maxFold > H || nextTop - camY + maxFold < 0) continue

      // build the band: top boundary L→R, bottom boundary (next bed's top) R→L
      ctx.beginPath()
      for (let x = 0; x <= W + step; x += step) {
        const y = boundaryY(topW, L.wobA, L.wobK, L.wobP, Math.min(x, W), camX, camY)
        if (x === 0) ctx.moveTo(0, y); else ctx.lineTo(Math.min(x, W), y)
      }
      for (let x = W; x >= -step; x -= step) {
        const xx = Math.max(x, 0)
        const y = boundaryY(nextTop, next.wobA, next.wobK, next.wobP, xx, camX, camY)
        ctx.lineTo(xx, y)
      }
      ctx.closePath()

      // warm/cool-graded fill; a little brighter toward the top of the bed
      const cr = clamp(L.color[0] * (0.82 + warm * 0.36))
      const cg = clamp(L.color[1] * (0.82 + warm * 0.24))
      const cb = clamp(L.color[2] * (0.86 + (1 - warm) * 0.14))
      ctx.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`
      ctx.fill()

      // cross-bedding: thin darker laminations parallel to the top boundary
      if (params.detail > 0.01 && L.thick > 0.03 * H) {
        const lines = Math.min(3, Math.floor(L.thick / (0.02 * H)))
        ctx.lineWidth = 1 * PR
        ctx.strokeStyle = `rgba(${(cr * 0.55) | 0},${(cg * 0.5) | 0},${(cb * 0.45) | 0},${0.28 * params.detail})`
        for (let li = 1; li <= lines; li++) {
          const frac = li / (lines + 1)
          ctx.beginPath()
          for (let x = 0; x <= W + step; x += step) {
            const xx = Math.min(x, W)
            const yt = boundaryY(topW, L.wobA, L.wobK, L.wobP, xx, camX, camY)
            const yb = boundaryY(nextTop, next.wobA, next.wobK, next.wobP, xx, camX, camY)
            const y = yt + (yb - yt) * frac
            if (x === 0) ctx.moveTo(0, y); else ctx.lineTo(xx, y)
          }
          ctx.stroke()
        }
      }
    }
  }

  // raking light + shadow: a soft diagonal highlight drifting across the face,
  // plus a vignette, to give the flat bands some relief and depth.
  const lx = (0.5 + 0.5 * Math.sin(camX * 0.002)) * W
  const lg = ctx.createLinearGradient(lx - W * 0.5, 0, lx + W * 0.5, H)
  ctx.globalCompositeOperation = 'overlay'
  lg.addColorStop(0, 'rgba(0,0,0,0.28)')
  lg.addColorStop(0.5, `rgba(255,240,210,${0.12 + warm * 0.12})`)
  lg.addColorStop(1, 'rgba(0,0,0,0.34)')
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, W, H)

  ctx.globalCompositeOperation = 'source-over'
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.4)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
