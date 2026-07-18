import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  sides: { value: 3 + Math.floor(rt.random(0, 10)), min: 3, max: 12, step: 1, label: 'Polygon sides' },
  ringSpeed: { value: +rt.random(0.6, 1.8).toFixed(2), min: 0.3, max: 3, step: 0.1, label: 'Ring speed' },
  trail: { value: 0.18, min: 0.05, max: 0.4, step: 0.01, label: 'Trail fade' },
})
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')

let width, height
const rings = []
let hue = Math.round(rt.random(0, 360)) // seeded start — 🎲 re-rolls the palette walk

function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
}

rt.onBeat(({ energy }) => {
  hue = (hue + 47) % 360
  const count = 1 + Math.round(energy * 2)
  for (let i = 0; i < count; i++) {
    rings.push({
      x: width * (0.2 + Math.random() * 0.6),
      y: height * (0.2 + Math.random() * 0.6),
      r: 0,
      speed: (3 + Math.random() * 5) * rt.pixelRatio,
      hue: hue + Math.random() * 40,
      alpha: 0.9,
    })
  }
  hint.style.opacity = 0
})

// Manual fallback so the sketch works without a microphone.
canvas.addEventListener('pointerdown', () => rt.beat.trigger(1))

function frame(now) {
  rt.tick(now)

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(5, 6, 10, ${params.trail})`
  ctx.fillRect(0, 0, width, height)

  ctx.globalCompositeOperation = 'lighter'

  // Center polygon breathes with the beat pulse and live audio level.
  const pulse = rt.beat.state.pulse
  const level = rt.beat.state.level
  const sides = Math.round(params.sides)
  const radius = (0.08 + pulse * 0.10 + level * 0.08) * Math.min(width, height)
  ctx.beginPath()
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2 + now * 0.0003
    const x = width / 2 + Math.cos(a) * radius
    const y = height / 2 + Math.sin(a) * radius
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.strokeStyle = `hsla(${hue}, 90%, ${55 + pulse * 30}%, ${0.35 + pulse * 0.6})`
  ctx.lineWidth = (2 + pulse * 6) * rt.pixelRatio
  ctx.stroke()

  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i]
    ring.r += ring.speed * params.ringSpeed
    ring.alpha *= 0.975
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${ring.hue}, 85%, 62%, ${ring.alpha})`
    ctx.lineWidth = 2.5 * rt.pixelRatio
    ctx.stroke()
    if (ring.alpha < 0.02) rings.splice(i, 1)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
