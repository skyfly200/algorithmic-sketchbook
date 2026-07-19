// Glow — a bloom pass for any live source: bright regions are isolated
// (contrast crush), blurred at two radii, and added back over the image, so
// lights, screens and skies flare the way they do on a dreamy lens. Beats
// kick the bloom brighter.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  intensity: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'Intensity' },
  radius: { value: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Radius' },
  threshold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Threshold' },
  saturate: { value: 1.25, min: 0.5, max: 2.5, step: 0.05, label: 'Bloom color' },
  dim: { value: 0.15, min: 0, max: 0.7, step: 0.01, label: 'Dim scene' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'intensity', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// bloom is extracted at quarter resolution
const bloom = document.createElement('canvas')
const bctx = bloom.getContext('2d')

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  bloom.width = Math.max(2, W >> 2)
  bloom.height = Math.max(2, H >> 2)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  src.draw(ctx, W, H, { mirror: params.mirror })

  // settle the scene down so the bloom has room to shine
  if (params.dim > 0.005) {
    ctx.fillStyle = `rgba(0, 0, 0, ${params.dim})`
    ctx.fillRect(0, 0, W, H)
  }

  const boost = params.intensity * (1 + rt.beat.state.pulse * 0.8)
  if (boost > 0.01) {
    const bw = bloom.width
    const bh = bloom.height
    // bright-pass: contrast crush approximates a luminance threshold
    const crush = 1 + params.threshold * 3
    const lift = 1 - params.threshold * 0.55
    const r1 = (2 + params.radius * 8) // px at quarter res
    bctx.filter = `contrast(${crush}) brightness(${lift}) saturate(${params.saturate}) blur(${r1}px)`
    bctx.drawImage(canvas, 0, 0, bw, bh)
    bctx.filter = 'none'

    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, boost * 0.7)
    ctx.drawImage(bloom, 0, 0, W, H)
    // wide second tail: the same buffer, blurred again on the way up
    ctx.filter = `blur(${params.radius * 24 * rt.pixelRatio}px)`
    ctx.globalAlpha = Math.min(1, boost * 0.45)
    ctx.drawImage(bloom, 0, 0, W, H)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
