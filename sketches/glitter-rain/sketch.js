// Glitter Rain — a downpour of sparkling confetti flakes: thousands of tiny
// specular sequins tumble and twinkle as they catch a moving light, leaving
// faint trails, pooling in a shimmering drift at the bottom. Beats burst a
// fresh shower; the pointer scatters flakes.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  density: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Density' },
  fall: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Fall speed' },
  twinkle: { value: 1, min: 0, max: 2, step: 0.05, label: 'Twinkle' },
  size: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Flake size' },
  hue: { value: 45, min: 0, max: 360, step: 1, label: 'Hue' },
  rainbow: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Rainbow mix' },
  trails: { value: 0.5, min: 0, max: 0.95, step: 0.02, label: 'Trails' },
})
rt.mapInput('audio.pulse', 'density', 0.6)

let W = 0, H = 0
const flakes = []
function make(x, y) {
  return {
    x: x ?? rt.random(0, W), y: y ?? rt.random(-H, 0),
    vy: rt.random(0.5, 1.5), vx: rt.random(-0.4, 0.4),
    spin: rt.random(-4, 4), phase: rt.random(0, Math.PI * 2),
    s: rt.random(0.6, 1.6), hue: rt.random(0, 360),
  }
}
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, W, H)
}
function target() { return Math.round(700 * params.density * rt.detail) }
rt.onBeat(({ energy }) => { for (let i = 0; i < 60 * energy; i++) flakes.push(make(rt.random(0, W), rt.random(-H * 0.3, 0))) })
canvas.addEventListener('pointermove', (e) => {
  for (let i = 0; i < 4; i++) flakes.push(make(e.clientX * rt.pixelRatio + rt.random(-20, 20), e.clientY * rt.pixelRatio))
})
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  // trails: fade instead of clear
  ctx.fillStyle = `rgba(5,6,12,${1 - params.trails})`
  ctx.fillRect(0, 0, W, H)

  while (flakes.length < target()) flakes.push(make())
  if (flakes.length > target() * 1.5) flakes.splice(0, flakes.length - target())

  // a slow-moving key light the flakes glint toward
  const lx = W * (0.5 + 0.4 * Math.sin(t * 0.3))
  ctx.globalCompositeOperation = 'lighter'
  for (let i = flakes.length - 1; i >= 0; i--) {
    const f = flakes[i]
    f.y += f.vy * params.fall * 120 * dt * rt.pixelRatio
    f.x += f.vx * 40 * dt * rt.pixelRatio + Math.sin(t * 2 + f.phase) * 20 * dt * rt.pixelRatio
    f.phase += f.spin * dt
    if (f.y > H + 10) { flakes.splice(i, 1); continue }
    // specular twinkle: brightest when the flake's facet faces the light
    const facing = Math.abs(Math.cos(f.phase)) * (1 - Math.min(1, Math.abs(f.x - lx) / W))
    const spark = Math.pow(facing, 3) * params.twinkle
    const bright = 0.35 + spark
    const hue = params.rainbow > 0.5 ? f.hue : (params.hue + (f.hue - 180) * params.rainbow) % 360
    const sz = f.s * params.size * rt.pixelRatio * (1 + spark)
    ctx.fillStyle = `hsla(${hue}, 90%, ${55 + spark * 40}%, ${bright})`
    // rotated rectangle sequin
    const cs = Math.cos(f.phase), sn = Math.sin(f.phase)
    ctx.setTransform(cs, sn, -sn, cs, f.x, f.y)
    ctx.fillRect(-sz, -sz * 0.5, sz * 2, sz)
    if (spark > 0.4) { // star glint
      ctx.setTransform(1, 0, 0, 1, f.x, f.y)
      ctx.strokeStyle = `hsla(${hue}, 100%, 85%, ${spark})`
      ctx.lineWidth = rt.pixelRatio
      ctx.beginPath()
      ctx.moveTo(-sz * 2.5, 0); ctx.lineTo(sz * 2.5, 0); ctx.moveTo(0, -sz * 2.5); ctx.lineTo(0, sz * 2.5)
      ctx.stroke()
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
