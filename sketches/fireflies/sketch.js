// Fireflies — a warm dusk swarm: dozens of soft glowing motes drift on a slow
// swirling air current, each blinking on its own rhythm. Turn up "Sync" and
// they fall into step and pulse together the way real fireflies do; on the
// beat the whole swarm flashes. Pointer gently stirs the nearby air.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  count: { value: 1, min: 0.3, max: 2.2, step: 0.05, label: 'Swarm density' },
  speed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  glow: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Glow size' },
  blink: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Blink rate' },
  sync: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Sync' },
  // Slowly breathe the coupling up and down so the swarm keeps falling into
  // unison and drifting apart again, the way real firefly choruses wax and wane.
  phaseDrift: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Phase drift' },
  driftRate: { value: 0.5, min: 0.05, max: 2, step: 0.05, label: 'Drift rate' },
  // Injects a breathing amount of randomness into each bug's blink + heading,
  // so order dissolves into chaos and re-forms.
  chaos: { value: 0.25, min: 0, max: 1, step: 0.02, label: 'Chaos' },
  hue: { value: 55, min: 0, max: 360, step: 1, label: 'Glow hue' },
  trail: { value: 0.4, min: 0, max: 0.95, step: 0.02, label: 'Trails' },
})
rt.mapInput('audio.level', 'speed', 0.5)
rt.mapInput('audio.pulse', 'blink', 0.4)

let W = 0, H = 0
let flies = []
let px = -1e5, py = -1e5, tpx = -1e5, tpy = -1e5

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  build()
}
function build() {
  const n = Math.round(90 * params.count * rt.detail)
  flies = []
  for (let i = 0; i < n; i++) {
    const depth = rt.rng() // 0 far … 1 near
    flies.push({
      x: rt.random(0, W), y: rt.random(0, H),
      depth,
      size: (1.2 + depth * 2.6) * rt.pixelRatio,
      bias: rt.random(-0.6, 0.6), // personal heading offset
      spd: rt.random(0.7, 1.3),
      phase: rt.random(0, Math.PI * 2), // blink phase
      rate: rt.random(0.7, 1.35), // personal blink rate
      hue: params.hue + rt.random(-14, 16),
    })
  }
  flies.sort((a, b) => a.depth - b.depth) // far first, near drawn on top
}

// A slow, smooth swirl of "air" — layered waves so motes meander in eddies
// instead of straight lines.
function flow(x, y, t) {
  return (
    Math.sin(x * 0.0016 + t * 0.25) * 1.6 +
    Math.cos(y * 0.0018 - t * 0.2) * 1.4 +
    Math.sin((x + y) * 0.0011 + t * 0.15) * 1.0
  )
}

window.addEventListener('pointermove', (e) => { tpx = e.clientX * rt.pixelRatio; tpy = e.clientY * rt.pixelRatio })
window.addEventListener('pointerout', () => { tpx = -1e5; tpy = -1e5 })

let globalPhase = 0
let flash = 0
rt.onBeat(({ energy }) => { flash = Math.min(1, 0.5 + energy * 0.6) })

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  if (Math.round(90 * params.count * rt.detail) !== flies.length) build()
  px += (tpx - px) * 0.12; py += (tpy - py) * 0.12
  flash = Math.max(0, flash - dt * 1.6)

  // dusk background with a soft persistence so glows leave gentle trails
  const fade = 1 - params.trail * 0.94
  ctx.globalCompositeOperation = 'source-over'
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgba(8, 10, 22, ${fade})`)
  g.addColorStop(0.6, `rgba(10, 9, 20, ${fade})`)
  g.addColorStop(1, `rgba(16, 10, 18, ${fade})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  const rate = params.blink * 1.4
  globalPhase += dt * rate
  // Coupling breathes: base Sync modulated by a slow sine so the chorus falls
  // in and out of unison over time (Phase drift controls how deep it breathes).
  const breathe = 0.5 + 0.5 * Math.sin(t * params.driftRate * 0.5)
  const sync = params.sync * (1 - params.phaseDrift) + params.sync * params.phaseDrift * breathe
  // Chaos also breathes (offset phase) so disorder swells and subsides.
  const chaosNow = params.chaos * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * params.driftRate * 0.5 + 2.1)))

  ctx.globalCompositeOperation = 'lighter'
  for (const f of flies) {
    // meander along the flow field, with a personal bias and depth-scaled speed
    const heading = flow(f.x, f.y, t) + f.bias + (chaosNow ? (rt.rng() - 0.5) * chaosNow * 3 : 0)
    const v = (18 + f.depth * 34) * params.speed * f.spd * rt.pixelRatio
    f.x += Math.cos(heading) * v * dt
    f.y += Math.sin(heading) * v * dt
    // pointer stirs nearby air (pushes motes outward a little)
    const dx = f.x - px, dy = f.y - py
    const dd = dx * dx + dy * dy
    const rad = 150 * rt.pixelRatio
    if (dd < rad * rad) {
      const d = Math.sqrt(dd) || 1
      const push = (1 - d / rad) * 40 * rt.pixelRatio * dt
      f.x += (dx / d) * push; f.y += (dy / d) * push
    }
    // wrap softly around the edges
    if (f.x < -20) f.x = W + 20; else if (f.x > W + 20) f.x = -20
    if (f.y < -20) f.y = H + 20; else if (f.y > H + 20) f.y = -20

    // blink: personal phase, pulled toward the global phase by Sync so the
    // swarm can flash in unison (as real fireflies entrain to each other)
    f.phase += dt * rate * f.rate
    if (sync > 0) {
      let diff = globalPhase - f.phase
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // wrap to -π..π
      f.phase += diff * sync * dt * 2.5
    }
    // chaos scrambles each bug's blink timing, fighting the pull to unison
    if (chaosNow) f.phase += (rt.rng() - 0.5) * chaosNow * dt * 9
    const s = Math.max(0, Math.sin(f.phase))
    // a sharp blink over a faint ever-present body glow, so the swarm never
    // fully vanishes between flashes (as real fireflies keep a dim ember)
    let bright = 0.08 + s * s * s * 0.92
    bright = Math.min(1, bright + flash * 0.9) // beat flashes the whole swarm
    const r = f.size * (2.5 + params.glow * 4.5) * (0.6 + bright * 0.6)
    const grd = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
    const a = bright * (0.5 + f.depth * 0.5)
    grd.addColorStop(0, `hsla(${f.hue}, 95%, 72%, ${a})`)
    grd.addColorStop(0.35, `hsla(${f.hue - 8}, 95%, 55%, ${a * 0.5})`)
    grd.addColorStop(1, 'hsla(50, 90%, 50%, 0)')
    ctx.fillStyle = grd
    ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill()
    // hot core
    ctx.fillStyle = `hsla(${f.hue + 6}, 100%, 88%, ${bright})`
    ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (0.7 + bright * 0.5), 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
