// Counter-Rotating Rings — a stack of concentric rings, each patterned with an
// arc/tick motif, spinning the opposite way to its neighbours. Adjacent rings
// shear against each other so the whole disc reads as interlocking gearwork; the
// outer rings turn slower than the inner ones. Ring count, spacing, arc coverage,
// tick count, speed, twist and hue span are live, and each beat kicks the spin.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  rings: { value: 10, min: 3, max: 22, step: 1, label: 'Rings' },
  spacing: { value: 1, min: 0.5, max: 1.8, step: 0.05, label: 'Ring spacing' },
  speed: { value: 1, min: -2, max: 2, step: 0.05, label: 'Spin speed' },
  gradient: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Inner-fast gradient' },
  ticks: { value: 24, min: 3, max: 72, step: 1, label: 'Ticks per ring' },
  coverage: { value: 0.55, min: 0.05, max: 1, step: 0.02, label: 'Arc coverage' },
  thickness: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Thickness' },
  twist: { value: 0.15, min: -0.6, max: 0.6, step: 0.01, label: 'Radial twist' },
  hue: { value: 205, min: 0, max: 360, step: 1, label: 'Base hue' },
  hueSpan: { value: 120, min: 0, max: 360, step: 1, label: 'Hue span' },
  glow: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Glow' },
})
rt.mapInput('audio.pulse', 'speed', 0.5)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
let angle = 0 // accumulated base rotation (so speed changes stay continuous)
let lastNow = 0
// Glow: the sharp frame is shrunk into a small canvas, blurred there, and added back
// scaled up. Far cheaper than shadowBlur on every tick.
const glowCanvas = document.createElement('canvas')
const glowCtx = glowCanvas.getContext('2d')
const GLOW_SCALE = 0.25

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  glowCanvas.width = Math.max(1, Math.round(W * GLOW_SCALE))
  glowCanvas.height = Math.max(1, Math.round(H * GLOW_SCALE))
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  const pulse = rt.beat.state.pulse
  angle += (params.speed + pulse * 0.8) * dt

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const n = Math.round(params.rings)
  const maxR = Math.min(W, H) * 0.46
  const ringStep = maxR / (n + 1) * params.spacing
  const ticks = Math.round(params.ticks)
  const lw = Math.max(1, ringStep * params.thickness * 0.7)

  ctx.lineCap = 'butt'
  for (let i = 0; i < n; i++) {
    const rr = ringStep * (i + 1)
    if (rr < ringStep * 0.4) continue
    // inner rings spin faster; neighbours alternate direction; radial twist adds a lean
    const dir = i % 2 === 0 ? 1 : -1
    const rate = 1 + (n - 1 - i) / n * params.gradient
    const ra = angle * dir * rate + i * params.twist
    const hue = (params.hue + (i / Math.max(1, n - 1) - 0.5) * params.hueSpan + 360) % 360
    const col = `hsl(${hue}, 85%, ${58 + dir * 6}%)`
    ctx.strokeStyle = col
    ctx.lineWidth = lw
    const arc = (TAU / ticks) * params.coverage
    ctx.beginPath()
    for (let k = 0; k < ticks; k++) {
      const a0 = ra + (k / ticks) * TAU
      ctx.moveTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr)
      ctx.arc(cx, cy, rr, a0, a0 + arc)
    }
    ctx.stroke()
  }

  if (params.glow > 0) {
    const gw = glowCanvas.width, gh = glowCanvas.height
    glowCtx.clearRect(0, 0, gw, gh)
    glowCtx.filter = `blur(${Math.max(1, params.glow * ringStep * GLOW_SCALE * 0.9)}px)`
    glowCtx.drawImage(canvas, 0, 0, gw, gh)
    glowCtx.filter = 'none'
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, params.glow * 1.2)
    ctx.drawImage(glowCanvas, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
