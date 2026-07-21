// Blowing Bubbles — iridescent soap bubbles drift up on warm thermals: each
// bubble wobbles as a deformable ring with a thin-film rainbow sheen and a
// bright specular highlight, riding rising air currents (a curl-noise thermal
// field) and swirling sideways, occasionally popping into a puff. Click blows
// a fresh cluster; beats release a burst.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  rate: { value: 1, min: 0, max: 3, step: 0.05, label: 'Blow rate' },
  lift: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Thermal lift' },
  swirl: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Swirl' },
  size: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Bubble size' },
  sheen: { value: 1, min: 0, max: 2, step: 0.05, label: 'Iridescence' },
  wobble: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Wobble' },
})
rt.mapInput('audio.pulse', 'rate', 1.5)

let W = 0, H = 0
const bubbles = []
function make(x, y, s) {
  return {
    x: x ?? rt.random(W * 0.2, W * 0.8), y: y ?? H + rt.random(0, 60),
    r: (s ?? rt.random(0.5, 1)) * rt.random(18, 55) * rt.pixelRatio,
    vx: rt.random(-0.3, 0.3), vy: -rt.random(0.4, 1),
    phase: rt.random(0, Math.PI * 2), spin: rt.random(-1, 1),
    hue: rt.random(0, 360), life: 1, seed: rt.random(0, 100),
    lobes: 3 + (rt.rng() * 3 | 0),
  }
}
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}
canvas.addEventListener('pointerdown', (e) => {
  for (let i = 0; i < 6; i++) bubbles.push(make(e.clientX * rt.pixelRatio + rt.random(-30, 30), e.clientY * rt.pixelRatio, rt.random(0.4, 1.1)))
})
rt.onBeat(({ energy }) => { for (let i = 0; i < 3 + energy * 5; i++) bubbles.push(make()) })
let last = 0, acc = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  acc += dt * params.rate * 3
  while (acc > 1) { acc -= 1; if (bubbles.length < 140) bubbles.push(make()) }

  // dusk sky
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#141a2e'); g.addColorStop(1, '#2a1c33')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  ctx.globalCompositeOperation = 'lighter'
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    // thermal field: rising with sideways swirl
    const swirl = Math.sin(b.y * 0.004 + t * 0.7 + b.seed) * params.swirl
    b.vx += swirl * dt * 0.6
    b.vx *= 1 - 0.8 * dt
    b.vy -= params.lift * 0.15 * dt
    b.vy = Math.max(-2.2, b.vy)
    b.x += b.vx * 60 * dt * rt.pixelRatio
    b.y += b.vy * 60 * dt * rt.pixelRatio
    b.phase += b.spin * dt
    b.life -= dt * 0.04
    // pop when it drifts off the top or ages out
    if (b.y < -b.r * 2 || b.life <= 0 || rt.rng() < 0.0006) {
      if (b.life > 0.2 && b.y > 0) puff(b)
      bubbles.splice(i, 1); continue
    }
    drawBubble(b, t)
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
function drawBubble(b, t) {
  const R = b.r * params.size
  const wob = params.wobble * 0.12
  ctx.save()
  ctx.translate(b.x, b.y)
  // thin-film rainbow ring: several offset arcs in spectrum order
  ctx.lineWidth = Math.max(1, R * 0.06)
  for (let k = 0; k < 6; k++) {
    const hue = (b.hue + k * 60 + t * 30) % 360
    ctx.strokeStyle = `hsla(${hue}, 95%, 65%, ${0.3 * params.sheen})`
    ctx.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.2) {
      const rr = R * (1 + wob * Math.sin(a * b.lobes + b.phase) + k * 0.008)
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // faint fill
  const fg = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R)
  fg.addColorStop(0, `hsla(${(b.hue + 180) % 360}, 60%, 70%, 0.08)`)
  fg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = fg
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill()
  // specular highlight
  ctx.fillStyle = `rgba(255,255,255,${0.5 * params.sheen})`
  ctx.beginPath(); ctx.arc(-R * 0.35, -R * 0.35, R * 0.12, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.beginPath(); ctx.arc(R * 0.3, R * 0.25, R * 0.06, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
function puff(b) {
  for (let k = 0; k < 10; k++) {
    const a = rt.random(0, Math.PI * 2), r = b.r * rt.random(0.3, 1)
    ctx.fillStyle = `hsla(${(b.hue + k * 30) % 360}, 90%, 70%, 0.5)`
    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, b.r * 0.12, 0, Math.PI * 2); ctx.fill()
  }
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
