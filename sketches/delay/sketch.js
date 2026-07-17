/**
 * Delay: a video delay line over a live source (camera / dropped photo or
 * video / demo / the Mixer layers below). The output of N frames ago is mixed
 * back over the present at `feedback` — so echoes of echoes pile up and decay,
 * like pointing a camera at its own monitor or looping two VHS decks. A hue
 * shift per echo tints each repeat further around the wheel, and a drift
 * zooms/rotates every generation so the echoes tunnel into the frame.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  delay: { value: 10, min: 1, max: 45, step: 1, label: 'Delay (frames)' },
  feedback: { value: 0.65, min: 0, max: 0.97, step: 0.01, label: 'Feedback' },
  dry: { value: 1.0, min: 0, max: 1, step: 0.02, label: 'Dry (live) level' },
  hueShift: { value: 20, min: 0, max: 120, step: 1, label: 'Hue shift / echo' },
  zoom: { value: 0.0, min: -0.06, max: 0.06, step: 0.002, label: 'Echo zoom' },
  rotate: { value: 0.0, min: -4, max: 4, step: 0.1, label: 'Echo rotate (°)' },
  additive: { value: false, type: 'bool', label: 'Additive (glow) echoes' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beat-pumped feedback: echoes swell on the music.
rt.mapInput('audio.pulse', 'feedback', 0.25)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// Ring buffer of past *outputs* (not inputs) — that's what makes it a true
// feedback delay: each echo already contains the echoes before it.
const MAX = 46
let ring = []
let head = 0

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  ring = Array.from({ length: MAX }, () => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    return c
  })
  head = 0
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  const d = Math.min(MAX - 1, Math.max(1, Math.round(params.delay)))
  const past = ring[(head - d + MAX) % MAX]

  // Compose: dry signal + transformed, tinted echo of the past output.
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  ctx.globalAlpha = params.dry
  src.draw(ctx, W, H, { mirror: params.mirror })

  if (params.feedback > 0.005) {
    // Normal mode is a convex mix — (1-fb)·live + fb·past — which decays
    // cleanly; additive mode piles the echoes into glow (and will bloom).
    ctx.globalAlpha = params.feedback
    ctx.globalCompositeOperation = params.additive ? 'lighter' : 'source-over'
    if (params.hueShift > 0.5) ctx.filter = `hue-rotate(${params.hueShift}deg)`
    const z = 1 + params.zoom
    const rot = (params.rotate * Math.PI) / 180
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.rotate(rot)
    ctx.drawImage(past, -W / 2, -H / 2)
    ctx.restore()
    ctx.filter = 'none'
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // Record this output into the ring for future echoes.
  const slot = ring[head].getContext('2d')
  slot.clearRect(0, 0, W, H)
  slot.drawImage(canvas, 0, 0)
  head = (head + 1) % MAX

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
