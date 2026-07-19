// Mist — a fine bright haze over a live source: highlights diffuse into a
// soft pearly bloom, contrast lifts toward white in the distance, and slow
// translucent veils breathe across the frame. Where Fog swallows the scene,
// Mist makes it glow like early morning light.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  haze: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Haze' },
  diffusion: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Diffusion' },
  veil: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Moving veils' },
  pearl: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Pearl (warm→cool)' },
  breathe: { value: 1, min: 0, max: 3, step: 0.05, label: 'Breath speed' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'diffusion', 0.3)
rt.mapInput('time.sin', 'haze', 0.12)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// small buffer for the blurred diffusion pass
const soft = document.createElement('canvas')
const sctx = soft.getContext('2d')

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  soft.width = Math.max(2, W >> 2)
  soft.height = Math.max(2, H >> 2)
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

  // atmospheric lift: the whole scene climbs toward a milky white
  const warm = 1 - params.pearl
  const mistR = 235 * warm + 215 * params.pearl
  const mistG = 232 * warm + 226 * params.pearl
  const mistB = 222 * warm + 240 * params.pearl
  ctx.fillStyle = `rgba(${mistR}, ${mistG}, ${mistB}, ${params.haze * 0.38})`
  ctx.fillRect(0, 0, W, H)

  // diffusion: blurred copy of the lifted scene screened back on top, so
  // highlights halo the way they do through water vapour
  if (params.diffusion > 0.01) {
    sctx.filter = `blur(${3 + params.diffusion * 9}px) brightness(1.12)`
    sctx.drawImage(canvas, 0, 0, soft.width, soft.height)
    sctx.filter = 'none'
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = params.diffusion * 0.75
    ctx.drawImage(soft, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // slow breathing veils: broad soft white bands drifting diagonally
  if (params.veil > 0.01) {
    const b = params.breathe
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 3; i++) {
      const ph = t * 0.07 * b + i * 2.1
      const cx = W * (0.5 + 0.45 * Math.sin(ph + i))
      const cy = H * (0.5 + 0.4 * Math.cos(ph * 0.8 + i * 1.7))
      const rad = Math.max(W, H) * (0.5 + 0.18 * Math.sin(ph * 1.3))
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      const a = params.veil * (0.1 + 0.05 * Math.sin(t * 0.23 * b + i)) * (1 + rt.beat.state.pulse * 0.4)
      g.addColorStop(0, `rgba(${mistR}, ${mistG}, ${mistB}, ${Math.max(0, a)})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
