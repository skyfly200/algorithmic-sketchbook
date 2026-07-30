// Funhouse Mirror — the carnival hall of warped mirrors over a live source.
// Each frame is redrawn as horizontal then vertical strips, each stretched or
// squeezed by a distortion profile, so the image bulges, pinches, ripples and
// wobbles like a sheet of curved silvered glass. A filter: it warps whatever
// feeds it (camera, a dropped clip, the demo, or the layers below).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  mode: { value: 'Carnival', type: 'select', options: ['Wavy', 'Bulge', 'Pinch', 'Carnival'], label: 'Mirror' },
  amount: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Distortion' },
  frequency: { value: 3, min: 0.5, max: 10, step: 0.1, label: 'Ripples' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.05, label: 'Wobble speed' },
  vertical: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Vertical warp' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'amount', 0.4)

const src = createSource()
const a = document.createElement('canvas'), actx = a.getContext('2d') // source
const b = document.createElement('canvas'), bctx = b.getContext('2d') // after horizontal warp

let W = 0, H = 0, PR = 1
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  a.width = b.width = W; a.height = b.height = H
}

// distortion factor + lateral shift for a strip at normalised position f∈[0,1]
function profile(f, t) {
  const m = params.mode, amp = params.amount
  const wave = Math.sin(f * Math.PI * 2 * params.frequency + t * params.speed * 2)
  const bulge = Math.cos((f - 0.5) * Math.PI) // 1 centre → 0 ends
  let scale = 1, shift = 0
  if (m === 'Wavy') { scale = 1 + amp * 0.5 * wave; shift = amp * 0.12 * wave }
  else if (m === 'Bulge') scale = 1 + amp * 0.9 * bulge
  else if (m === 'Pinch') scale = 1 - amp * 0.7 * bulge
  else { scale = 1 + amp * (0.6 * bulge + 0.35 * wave); shift = amp * 0.08 * Math.sin(f * Math.PI * 2 * params.frequency * 0.5 + t * params.speed) }
  return { scale: Math.max(0.15, scale), shift }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  actx.clearRect(0, 0, W, H)
  src.draw(actx, W, H, { mirror: params.mirror })

  const step = Math.max(2, Math.round(2 * PR))
  // pass 1: horizontal warp — each row stretched about the centre by scale(y)
  bctx.clearRect(0, 0, W, H)
  bctx.drawImage(a, 0, 0) // base fills any gaps a shrinking strip would leave
  for (let y = 0; y < H; y += step) {
    const p = profile(y / H, t)
    const dw = W * p.scale
    const dx = (W - dw) / 2 + p.shift * W
    bctx.drawImage(a, 0, y, W, step, dx, y, dw, step)
  }
  // pass 2: vertical warp — each column stretched about the centre by scale(x)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(b, 0, 0) // base fills any gaps a shrinking strip would leave
  const vamt = params.vertical
  for (let x = 0; x < W; x += step) {
    const p = vamt > 0.01 ? profile(x / W + 0.37, t * 0.8 + 1.3) : { scale: 1, shift: 0 }
    const sc = 1 + (p.scale - 1) * vamt
    const dh = H * sc
    const dy = (H - dh) / 2 + p.shift * H * vamt
    ctx.drawImage(b, x, 0, step, H, x, dy, step, dh)
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
