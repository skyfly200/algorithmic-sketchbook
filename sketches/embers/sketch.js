// Embers — a column of sparks rising from an unseen fire. Each ember lifts on
// the updraft, is shoved around by a curl-noise-ish turbulent field, cools
// from white-hot through orange to a dim red as it ages, and winks out. Beats
// throw up a burst of fresh sparks; wind shears the whole column sideways.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  rate: { value: 0.7, min: 0.05, max: 1, step: 0.02, label: 'Spawn rate' },
  updraft: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Updraft' },
  turbulence: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Turbulence' },
  wind: { value: 0.15, min: -1.5, max: 1.5, step: 0.05, label: 'Wind' },
  glow: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Glow' },
  cooling: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Cooling' },
  spread: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Source spread' },
})
rt.mapInput('audio.level', 'updraft', 0.4)
rt.mapInput('audio.pulse', 'rate', 0.4)

let W = 0, H = 0, PR = 1
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}

// A cheap smooth flow field for the turbulent air (two summed sines per axis).
function flow(x, y, t) {
  const fx = Math.sin(y * 0.006 + t * 0.9) + 0.5 * Math.sin(x * 0.01 - t * 1.3)
  const fy = Math.cos(x * 0.008 - t * 0.7) + 0.4 * Math.sin(y * 0.012 + t)
  return [fx, fy]
}

const sparks = []
function spawn(burst = 1) {
  const cx = W * 0.5
  const sw = W * 0.5 * params.spread
  sparks.push({
    x: cx + rt.random(-sw, sw),
    y: H + rt.random(0, 20 * PR),
    vx: rt.random(-10, 10) * PR,
    vy: -rt.random(50, 140) * PR * params.updraft,
    life: 1,
    decay: rt.random(0.18, 0.4) * params.cooling,
    size: rt.random(0.8, 2.6) * PR * burst,
    seed: rt.random(0, 6.28),
  })
}
rt.onBeat(({ energy }) => {
  const n = Math.round(20 + energy * 40)
  for (let i = 0; i < n; i++) spawn(1.2)
})

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now

  // trailing fade instead of a hard clear, so sparks leave a soft streak
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(10, 5, 3, 0.28)'
  ctx.fillRect(0, 0, W, H)

  const want = params.rate * 6
  for (let i = 0; i < want; i++) if (rt.rng() < params.rate) spawn()

  ctx.globalCompositeOperation = 'lighter'
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    const [fx, fy] = flow(s.x, s.y, t + s.seed)
    s.vx += (fx * 40 * params.turbulence + params.wind * 60) * dt * PR
    s.vy += (fy * 20 * params.turbulence - 30 * params.updraft) * dt * PR // buoyancy
    s.vx *= 0.98
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.life -= s.decay * dt
    if (s.life <= 0 || s.y < -20) { sparks.splice(i, 1); continue }
    // colour: white-hot → yellow → orange → deep red as life falls
    const l = s.life
    const hue = 20 + l * 40
    const light = 40 + l * 45
    const r = s.size * (0.6 + l * 0.8)
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3 * params.glow)
    g.addColorStop(0, `hsla(${hue}, 100%, ${Math.min(92, light + 25)}%, ${l})`)
    g.addColorStop(0.4, `hsla(${hue}, 100%, ${light}%, ${l * 0.5})`)
    g.addColorStop(1, 'hsla(15, 100%, 30%, 0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 3 * params.glow, 0, Math.PI * 2); ctx.fill()
    // hot core
    ctx.fillStyle = `hsla(${hue + 10}, 100%, ${Math.min(96, light + 35)}%, ${l})`
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.6, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
