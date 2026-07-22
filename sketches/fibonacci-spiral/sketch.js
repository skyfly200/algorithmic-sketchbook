// Fibonacci Spiral — a sunflower phyllotaxis: N seeds placed at the golden
// angle (137.5°) spiralling out from the centre, revealing the parastichy
// spirals in opposing families. Seeds bloom outward, pulse with the beat,
// and a golden-ratio rectangle spiral can overlay the arrangement.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const GOLD = Math.PI * (3 - Math.sqrt(5))
const params = rt.params({
  seeds: { value: 900, min: 100, max: 2500, step: 10, label: 'Seeds' },
  spacing: { value: 1, min: 0.5, max: 2, step: 0.02, label: 'Spacing' },
  angle: { value: 137.5, min: 130, max: 145, step: 0.05, label: 'Divergence°' },
  dotSize: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Seed size' },
  spin: { value: 0.15, min: -1, max: 1, step: 0.01, label: 'Spin' },
  hue: { value: 40, min: 0, max: 360, step: 1, label: 'Hue' },
  hueSpread: { value: 60, min: 0, max: 200, step: 1, label: 'Hue spread' },
  overlay: { value: false, type: 'bool', label: 'Golden spiral' },
})
rt.mapInput('audio.pulse', 'dotSize', 0.4)
rt.mapInput('audio.mid', 'angle', 0.3)

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}
let grow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  grow = Math.min(1, grow + 0.01)
  ctx.fillStyle = '#08060c'; ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const n = Math.round(params.seeds * grow)
  // scale seed spacing so the outermost seed reaches the screen corner → the
  // phyllotaxis fills the whole viewport regardless of seed count / aspect
  const c = params.spacing * 0.55 * Math.hypot(W, H) / Math.sqrt(params.seeds)
  const ang = (params.angle * Math.PI) / 180
  const spin = t * params.spin
  const pulse = rt.beat.state.pulse
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < n; i++) {
    const r = c * Math.sqrt(i)
    const theta = i * ang + spin
    const x = cx + Math.cos(theta) * r
    const y = cy + Math.sin(theta) * r
    const fr = i / n
    const hue = (params.hue + fr * params.hueSpread + t * 10) % 360
    const size = (1.2 + fr * 2) * params.dotSize * rt.pixelRatio * (1 + pulse * 0.5 * (1 - fr))
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2)
    g.addColorStop(0, `hsla(${hue}, 90%, 68%, 0.95)`)
    g.addColorStop(1, `hsla(${hue}, 90%, 40%, 0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, size * 2, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  // golden logarithmic spiral overlay
  if (params.overlay) {
    ctx.strokeStyle = `hsla(${params.hue + 180}, 60%, 75%, 0.5)`
    ctx.lineWidth = 1.5 * rt.pixelRatio
    ctx.beginPath()
    const b = Math.log(1.618) / (Math.PI / 2)
    for (let a = 0; a < Math.PI * 8; a += 0.05) {
      const r = 2 * Math.exp(b * a)
      const x = cx + Math.cos(a + spin) * r
      const y = cy + Math.sin(a + spin) * r
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
