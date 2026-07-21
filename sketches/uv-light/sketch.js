// UV Light — a blacklight over a live source: the scene sinks into a deep
// violet murk while bright, saturated regions fluoresce in electric colours
// and bloom, the way fluorescent pigments glow under ultraviolet. A slow
// "lamp" sweep brightens whatever it passes over.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  darkness: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Room darkness' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fluoresce' },
  threshold: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Glow threshold' },
  shift: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Colour shift' },
  lamp: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Lamp sweep' },
  tint: { value: 265, min: 200, max: 320, step: 1, label: 'UV tint' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'glow', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
const bloom = document.createElement('canvas')
const glx = bloom.getContext('2d')

let W = 0, H = 0, bw = 0, bh = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 640; const s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s)); bh = buf.height = Math.max(2, Math.round(H * s))
  bloom.width = W >> 1; bloom.height = H >> 1
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const img = bctx.getImageData(0, 0, bw, bh); const d = img.data
  const tintR = 0.5 + 0.5 * Math.cos((params.tint * Math.PI) / 180)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    // fluoresce: saturated OR bright pixels light up in shifted electric hue
    const fl = Math.max(0, (sat * 0.7 + lum * 0.5) - params.threshold) * params.glow
    if (fl > 0.02) {
      // rotate hue toward acid green/magenta/cyan
      const shift = params.shift
      d[i] = Math.min(255, (g * shift + r * (1 - shift)) * (1 + fl) * 1.4)
      d[i + 1] = Math.min(255, (b * shift + g * (1 - shift)) * (1 + fl) * 1.5)
      d[i + 2] = Math.min(255, (r * shift + b * (1 - shift)) * (1 + fl) * 1.4)
    } else {
      // sink into violet murk
      const k = 1 - params.darkness * 0.92
      d[i] = r * k + 20 * params.darkness
      d[i + 1] = g * k * 0.6
      d[i + 2] = b * k + 40 * params.darkness
    }
  }
  bctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(buf, 0, 0, W, H)

  // bloom the fluorescing bits
  glx.clearRect(0, 0, bloom.width, bloom.height)
  glx.filter = `brightness(1.5) contrast(1.6) blur(${3 * rt.pixelRatio}px)`
  glx.drawImage(buf, 0, 0, bloom.width, bloom.height)
  glx.filter = 'none'
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.7 * params.glow
  ctx.drawImage(bloom, 0, 0, W, H)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // moving lamp glow
  if (params.lamp > 0.01) {
    const lx = W * (0.5 + 0.42 * Math.sin(t * 0.4))
    const ly = H * (0.5 + 0.3 * Math.cos(t * 0.33))
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.4)
    g.addColorStop(0, `hsla(${params.tint}, 90%, 60%, ${params.lamp * 0.12})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
