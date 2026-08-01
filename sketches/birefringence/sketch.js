/**
 * Birefringence — double refraction, the way a clear rhomb of calcite splits
 * whatever you lay it over into two offset images. The upstream frame is drawn
 * twice: the ordinary ray straight through, and the extraordinary ray sheared
 * sideways by an amount and direction set like the crystal's optic axis, so
 * text and edges ghost into doubles. Turn up interference and the field breaks
 * into the shifting spectral bands you get viewing a birefringent crystal
 * between crossed polarisers. A filter: it doubles whatever feeds it (camera,
 * a dropped clip, the demo, or the layers below).
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  split: { value: 0.06, min: 0, max: 0.25, step: 0.005, label: 'Double split' },
  angle: { value: 30, min: 0, max: 360, step: 1, label: 'Optic axis' },
  spin: { value: 0, min: -1, max: 1, step: 0.02, label: 'Rotate crystal' },
  balance: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Ray balance' },
  interference: { value: 0.28, min: 0, max: 1, step: 0.02, label: 'Interference colour' },
  bands: { value: 4, min: 1, max: 12, step: 0.5, label: 'Colour bands' },
  drift: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Band drift' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'interference', 0.3)

const src = createSource()
const a = document.createElement('canvas'), actx = a.getContext('2d')  // source
const e = document.createElement('canvas'), ectx = e.getContext('2d')  // extraordinary ray

let W = 0, H = 0, PR = 1
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  a.width = e.width = W; a.height = e.height = H
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  actx.clearRect(0, 0, W, H)
  src.draw(actx, W, H, { mirror: params.mirror })

  const ang = (params.angle + t * params.spin * 40) * Math.PI / 180
  const shift = params.split * Math.min(W, H)
  const dx = Math.cos(ang) * shift, dy = Math.sin(ang) * shift
  const bal = params.balance
  const ordW = clamp(1 - 0.55 * bal, 0.25, 1)     // ordinary (undeviated) ray
  const extW = clamp(0.45 + 0.55 * bal, 0.25, 1)  // extraordinary (sheared) ray

  // extraordinary ray buffer (a straight copy; sheared when composited)
  ectx.setTransform(1, 0, 0, 1, 0, 0)
  ectx.clearRect(0, 0, W, H)
  ectx.globalAlpha = 1
  ectx.globalCompositeOperation = 'source-over'
  ectx.drawImage(a, 0, 0)

  // compose: ordinary straight through, extraordinary sheared over it
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = ordW
  ctx.drawImage(a, 0, 0)
  ctx.globalAlpha = extW
  ctx.drawImage(e, dx, dy)
  ctx.globalAlpha = 1

  // interference: recolour the whole field with drifting spectral bands, the way
  // a birefringent crystal shows Newton's-scale colours between polarisers. Uses
  // the 'color' blend so it tints without darkening; scaled by the param.
  const inter = params.interference
  if (inter > 0.01) {
    const R = Math.hypot(W, H) * 0.5
    const px = W / 2 - Math.cos(ang) * R, py = H / 2 - Math.sin(ang) * R
    const qx = W / 2 + Math.cos(ang) * R, qy = H / 2 + Math.sin(ang) * R
    const cycles = params.bands, steps = Math.max(12, Math.round(cycles * 8))
    const phase = t * params.drift
    const grad = ctx.createLinearGradient(px, py, qx, qy)
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const hue = ((u * cycles + phase) % 1 + 1) % 1 * 360
      grad.addColorStop(u, `hsl(${hue}, 90%, 55%)`)
    }
    ctx.save()
    ctx.globalCompositeOperation = 'color'
    ctx.globalAlpha = inter
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    // a faint brightness ripple along the bands adds retardation contrast
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = inter * 0.35
    const g2 = ctx.createLinearGradient(px, py, qx, qy)
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const b = 0.5 + 0.5 * Math.sin((u * cycles + phase) * Math.PI * 2)
      const c = (b * 255) | 0
      g2.addColorStop(u, `rgba(${c},${c},${c},1)`)
    }
    ctx.fillStyle = g2
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
