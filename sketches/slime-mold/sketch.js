/**
 * Slime Mold — a Physarum polycephalum simulation. Thousands of agents crawl a
 * trail map: each senses the deposited chemoattractant a little ahead of it
 * (centre / left / right), steers toward the strongest, moves, and deposits its
 * own trail. The map diffuses and decays every frame. From this purely local
 * rule the classic reticulated vein network self-organises — the yellow
 * foraging mesh of real slime mould. It grows outward from the middle; click to
 * drop a blob of food the network reaches toward.
 *
 * (Jeff Jones' agent model. The trail sim runs at a fixed internal resolution,
 * scaled to the viewport; agent count scales with the graphics-quality detail.)
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: +rt.random(0.9, 1.3).toFixed(2), min: 0.2, max: 2.5, step: 0.05, label: 'Agent density' },
  speed: { value: +rt.random(0.7, 1.1).toFixed(2), min: 0.2, max: 3, step: 0.05, label: 'Move speed' },
  sensorAngle: { value: Math.round(rt.random(20, 40)), min: 5, max: 90, step: 1, label: 'Sensor angle°' },
  sensorDist: { value: Math.round(rt.random(8, 14)), min: 2, max: 30, step: 1, label: 'Sensor distance' },
  turn: { value: +rt.random(0.35, 0.6).toFixed(2), min: 0.05, max: 1.5, step: 0.05, label: 'Turn speed' },
  decay: { value: +rt.random(0.90, 0.94).toFixed(3), min: 0.85, max: 0.99, step: 0.005, label: 'Trail persistence' },
  deposit: { value: 1.5, min: 0.2, max: 5, step: 0.05, label: 'Deposit' },
  hue: { value: +rt.random(0.12, 0.2).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  grow: { value: 0.15, min: 0, max: 1, step: 0.02, label: 'Growth (spawn)' },
  pulse: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Pulse (expand/retreat)' },
  pulseRate: { value: 0.7, min: 0, max: 2.5, step: 0.05, label: 'Pulse rate' },
})
// Moderate per-frame diffusion — trails spread just enough to merge into
// channels; the faster decay above then prunes anything not continuously
// re-travelled, so gaps go dark and only the veins stay lit.
const DIFFUSE = 0.22
// Music: beats push a burst of deposit / speed so the mesh pulses to sound.
rt.mapInput('audio.pulse', 'deposit', 0.5)
rt.mapInput('audio.volume', 'speed', 0.4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')

// --- fixed-resolution simulation grid ---
let W, H, trail, next, agents, img, sim, sctx
const foods = [] // click-dropped attractant blobs {x, y, life}

function build() {
  const long = Math.min(Math.max(window.innerWidth, window.innerHeight), 900)
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  trail = new Float32Array(W * H)
  next = new Float32Array(W * H)
  sim = sim || document.createElement('canvas')
  sim.width = W
  sim.height = H
  sctx = sim.getContext('2d')
  img = sctx.createImageData(W, H)

  const target = Math.round(W * H * 0.13 * params.density * rt.detail)
  agents = new Float32Array(target * 3) // x, y, heading
  // Seed the whole colony disc (not a point) with random headings — a
  // distributed population is what lets channels form *between* regions into a
  // network, rather than everyone collapsing onto one central attractor.
  const R = Math.min(W, H) * 0.44
  for (let i = 0; i < target; i++) {
    const a = rt.rng() * Math.PI * 2
    const r = Math.sqrt(rt.rng()) * R
    agents[i * 3] = W / 2 + Math.cos(a) * r
    agents[i * 3 + 1] = H / 2 + Math.sin(a) * r
    agents[i * 3 + 2] = rt.rng() * Math.PI * 2
  }
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  build()
}

function sample(x, y) {
  const ix = ((x | 0) % W + W) % W
  const iy = ((y | 0) % H + H) % H
  return trail[iy * W + ix]
}

function step() {
  const n = agents.length / 3
  const sa = (params.sensorAngle * Math.PI) / 180
  const sd = params.sensorDist
  // Breathing pulse: in the expansion phase agents move a little faster and
  // deposit more (veins thicken, the margin advances); in the retreat phase the
  // opposite (and the trail decays faster below), so the whole colony pulses in
  // and out organically — no directional flow field.
  const sp = params.speed * (1 + breathe * params.pulse * 0.35)
  const turn = params.turn
  const dep = Math.max(0, params.deposit * 9 * (1 + breathe * params.pulse * 0.7))

  for (let i = 0; i < n; i++) {
    const bx = agents[i * 3]
    const by = agents[i * 3 + 1]
    let h = agents[i * 3 + 2]

    // Sense centre / left / right a little ahead.
    const c = sample(bx + Math.cos(h) * sd, by + Math.sin(h) * sd)
    const l = sample(bx + Math.cos(h - sa) * sd, by + Math.sin(h - sa) * sd)
    const r = sample(bx + Math.cos(h + sa) * sd, by + Math.sin(h + sa) * sd)
    if (c > l && c > r) {
      /* keep heading */
    } else if (l > r) h -= turn
    else if (r > l) h += turn
    else h += (rt.rng() - 0.5) * turn * 2

    let nx = bx + Math.cos(h) * sp
    let ny = by + Math.sin(h) * sp
    // Bounce off the edges (keeps the colony a growing island, not a torus).
    if (nx < 1 || nx >= W - 1) { h = Math.PI - h; nx = Math.min(W - 1.01, Math.max(1, nx)) }
    if (ny < 1 || ny >= H - 1) { h = -h; ny = Math.min(H - 1.01, Math.max(1, ny)) }

    agents[i * 3] = nx
    agents[i * 3 + 1] = ny
    agents[i * 3 + 2] = h
    trail[(ny | 0) * W + (nx | 0)] += dep
  }
}

// Diffuse (3x3 box blur) + decay, writing into `next`, then swap.
function diffuseDecay() {
  // Retreat phase decays a touch faster so the margin recedes; expansion holds.
  const d = Math.min(0.999, Math.max(0.8, params.decay + breathe * params.pulse * 0.03))
  for (let y = 0; y < H; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < H - 1 ? y + 1 : H - 1
    for (let x = 0; x < W; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < W - 1 ? x + 1 : W - 1
      const self = trail[y * W + x]
      const avg =
        (trail[y0 * W + x0] + trail[y0 * W + x] + trail[y0 * W + x1] +
          trail[y * W + x0] + self + trail[y * W + x1] +
          trail[y1 * W + x0] + trail[y1 * W + x] + trail[y1 * W + x1]) / 9
      // Light diffusion: keep most of the cell's own value (so channels build
      // up and persist) and blend only a little of the neighbourhood — a full
      // box-average every frame would smear trails away before they connect.
      next[y * W + x] = (self * (1 - DIFFUSE) + avg * DIFFUSE) * d
    }
  }
  const t = trail
  trail = next
  next = t
}

function applyFood() {
  for (let k = foods.length - 1; k >= 0; k--) {
    const f = foods[k]
    const r = 18
    // A food source is a strong, lasting attractant: it emits far above the
    // network's own trail levels every frame for a long time, so the colony has
    // time to grow a vein out to it. It slowly fades over ~40 s, then clears.
    const emit = f.life > 240 ? 55 : 55 * (f.life / 240) // gentle fade at the end
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        const x = (f.x + dx) | 0
        const y = (f.y + dy) | 0
        if (x >= 0 && x < W && y >= 0 && y < H) trail[y * W + x] += emit * (1 - d2 / (r * r))
      }
    }
    if (--f.life <= 0) foods.splice(k, 1)
  }
}

// Occasionally respawn a fraction of the agents at fresh random spots (with a
// random heading) so the network keeps exploring and reorganising — new veins
// bud, old ones prune — instead of freezing into one fixed graph.
function growEdge() {
  const n = agents.length / 3
  const move = Math.round(params.grow * 0.01 * n)
  const R = Math.min(W, H) * 0.44
  for (let k = 0; k < move; k++) {
    const i = (rt.rng() * n) | 0
    const a = rt.rng() * Math.PI * 2
    const r = Math.sqrt(rt.rng()) * R
    agents[i * 3] = W / 2 + Math.cos(a) * r
    agents[i * 3 + 1] = H / 2 + Math.sin(a) * r
    agents[i * 3 + 2] = rt.rng() * Math.PI * 2
  }
}
let frameNo = 0
let breathe = 0 // -1..1 breathing pulse (set each frame)
let pulsePhase = 0
let lastNow = 0

function render() {
  const data = img.data
  const [hr, hg, hb] = hsl(params.hue, 0.85, 0.55)
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, trail[i] * 0.03)
    const g = Math.pow(v, 0.8)
    data[i * 4] = hr * g * 255
    data[i * 4 + 1] = hg * g * 255
    data[i * 4 + 2] = hb * g * 255
    data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)
}

function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  // Advance the breathing phase (accumulated so the rate can change smoothly).
  pulsePhase += params.pulseRate * dt
  breathe = Math.sin(pulsePhase)
  applyFood()
  step()
  diffuseDecay()
  if (params.grow > 0 && (frameNo++ & 3) === 0) growEdge()
  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  foods.push({ x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, life: 2400 })
  hint.style.opacity = 0
})

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
