import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  speed: { value: +rt.random(0.9, 2.2).toFixed(1), min: 0.3, max: 4, step: 0.1, label: 'Particle speed' },
  fade: { value: 0.045, min: 0.01, max: 0.15, step: 0.005, label: 'Trail fade' },
  scale: { value: +rt.random(0.7, 1.6).toFixed(2), min: 0.3, max: 3, step: 0.05, label: 'Field scale' },
  turbulence: { value: +rt.random(0.6, 1.4).toFixed(2), min: 0.2, max: 2.5, step: 0.05, label: 'Turbulence' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Base hue' },
  hueSpread: { value: Math.round(rt.random(60, 140)), min: 10, max: 260, step: 1, label: 'Hue spread' },
})
// Beats nudge the particle speed by default — remix in the controls panel.
rt.mapInput('audio.pulse', 'speed', 0.3)
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PARTICLE_COUNT = Math.round(2500 * rt.detail)
const FIELD_SCALE = 0.0022
const NSEED = rt.random(0, 100) // seeded field phase — 🎲 re-rolls the swirls

let width, height
let particles = []

function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, width, height)
  particles = Array.from({ length: PARTICLE_COUNT }, spawn)
}

function spawn() {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    hue: params.hue + Math.random() * params.hueSpread,
    life: 100 + Math.random() * 300,
  }
}

// Cheap value-noise-ish field: layered sines are good enough for pretty
// swirls and keep the sketch dependency-free.
function angleAt(x, y, t) {
  const s = FIELD_SCALE * params.scale
  const k = params.turbulence
  return (
    (Math.sin(x * s + t * 0.4 + NSEED) * 1.7 +
      Math.cos(y * s * 1.3 - t * 0.3 + NSEED) * 1.7 +
      Math.sin((x + y) * s * 0.6 + t * 0.15 + NSEED * 0.7) * 2.2) * k
  )
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  // Fade previous frame slightly to leave trails.
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(5, 6, 10, ${params.fade})`
  ctx.fillRect(0, 0, width, height)

  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    const a = angleAt(p.x, p.y, t)
    const nx = p.x + Math.cos(a) * params.speed * rt.pixelRatio
    const ny = p.y + Math.sin(a) * params.speed * rt.pixelRatio

    ctx.strokeStyle = `hsla(${p.hue}, 85%, 60%, 0.28)`
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(nx, ny)
    ctx.stroke()

    p.x = nx
    p.y = ny
    p.life--

    if (p.life <= 0 || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
      Object.assign(p, spawn())
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
