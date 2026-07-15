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
  density: { value: +rt.random(1.3, 1.9).toFixed(2), min: 0.2, max: 2.5, step: 0.05, label: 'Agent density' },
  speed: { value: +rt.random(0.7, 1.2).toFixed(2), min: 0.2, max: 3, step: 0.05, label: 'Move speed' },
  sensorAngle: { value: Math.round(rt.random(20, 42)), min: 5, max: 90, step: 1, label: 'Sensor angle°' },
  sensorDist: { value: Math.round(rt.random(8, 15)), min: 2, max: 30, step: 1, label: 'Sensor distance' },
  turn: { value: +rt.random(0.35, 0.7).toFixed(2), min: 0.05, max: 1.5, step: 0.05, label: 'Turn speed' },
  decay: { value: +rt.random(0.955, 0.975).toFixed(3), min: 0.8, max: 0.995, step: 0.005, label: 'Trail persistence' },
  deposit: { value: 1.6, min: 0.2, max: 4, step: 0.05, label: 'Deposit' },
  hue: { value: +rt.random(0.12, 0.2).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  grow: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Growth (spawn)' },
})
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
  const R = Math.min(W, H) * 0.06
  for (let i = 0; i < target; i++) {
    // Spawn in a small central disc so the mesh grows outward from the middle.
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
  const sp = params.speed
  const turn = params.turn
  const dep = params.deposit * 40

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
  const d = params.decay
  for (let y = 0; y < H; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < H - 1 ? y + 1 : H - 1
    for (let x = 0; x < W; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < W - 1 ? x + 1 : W - 1
      const s =
        trail[y0 * W + x0] + trail[y0 * W + x] + trail[y0 * W + x1] +
        trail[y * W + x0] + trail[y * W + x] + trail[y * W + x1] +
        trail[y1 * W + x0] + trail[y1 * W + x] + trail[y1 * W + x1]
      next[y * W + x] = (s / 9) * d
    }
  }
  const t = trail
  trail = next
  next = t
}

function applyFood() {
  for (let k = foods.length - 1; k >= 0; k--) {
    const f = foods[k]
    const r = 14
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        const x = (f.x + dx) | 0
        const y = (f.y + dy) | 0
        if (x >= 0 && x < W && y >= 0 && y < H) trail[y * W + x] += 6
      }
    }
    if (--f.life <= 0) foods.splice(k, 1)
  }
}

// Spawn a few new wanderers at the colony edge so it keeps creeping outward.
function growEdge() {
  const add = Math.round(params.grow * 30 * rt.detail)
  const grown = new Float32Array((agents.length / 3 + add) * 3)
  grown.set(agents)
  const base = agents.length / 3
  for (let i = 0; i < add; i++) {
    const a = rt.rng() * Math.PI * 2
    const r = Math.min(W, H) * (0.1 + rt.rng() * 0.35)
    grown[(base + i) * 3] = Math.min(W - 2, Math.max(1, W / 2 + Math.cos(a) * r))
    grown[(base + i) * 3 + 1] = Math.min(H - 2, Math.max(1, H / 2 + Math.sin(a) * r))
    grown[(base + i) * 3 + 2] = a + Math.PI // head roughly outward-ish
  }
  agents = grown
}
let frameNo = 0

function render() {
  const data = img.data
  const [hr, hg, hb] = hsl(params.hue, 0.85, 0.55)
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, trail[i] * 0.04)
    const g = Math.pow(v, 0.55)
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
  applyFood()
  step()
  diffuseDecay()
  if (params.grow > 0 && (frameNo++ & 3) === 0 && agents.length / 3 < W * H * 0.6) growEdge()
  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  foods.push({ x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, life: 90 })
  hint.style.opacity = 0
})

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
