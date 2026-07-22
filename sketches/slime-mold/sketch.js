/**
 * Slime Mold — an agent-based Physarum plasmodium. Thousands of tiny agents
 * each crawl forward, sniffing a trail map at three points ahead (left / centre
 * / right) and turning toward wherever the scent is strongest, depositing their
 * own trail as they go. The trail diffuses and evaporates. Out of these three
 * rules a living, stringy, ever-reconfiguring vein network emerges — irregular,
 * organic, and never settling into a repeating pattern. Click to drop food that
 * the colony reaches toward and swarms.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.9, min: 0.2, max: 2, step: 0.05, label: 'Colony density' },
  speed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Crawl speed' },
  sensorDist: { value: 9, min: 3, max: 24, step: 0.5, label: 'Sensor distance' },
  sensorAngle: { value: 32, min: 8, max: 70, step: 1, label: 'Sensor angle°' },
  turn: { value: 38, min: 5, max: 80, step: 1, label: 'Turn°' },
  wiggle: { value: 0.18, min: 0, max: 1, step: 0.02, label: 'Wander (chaos)' },
  deposit: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Trail deposit' },
  decay: { value: 0.09, min: 0.02, max: 0.3, step: 0.005, label: 'Evaporation' },
  hue: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Hue' },
})
// Music: beats surge the crawl, loudness thickens the trails.
rt.mapInput('audio.pulse', 'speed', 0.5)
rt.mapInput('audio.volume', 'deposit', 0.4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')

let W, H, trail, tmp, img, sim, sctx
let agents = null // Float32Array packed [x, y, heading] * N
let nAgents = 0
const foods = [] // { x, y, born } in grid coords, emit trail so the colony seeks them

function wantAgents() { return Math.min(120000, Math.round(W * H * 0.14 * params.density * rt.detail)) }

function build() {
  const long = Math.min(Math.max(window.innerWidth, window.innerHeight), 520)
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  trail = new Float32Array(W * H)
  tmp = new Float32Array(W * H)
  sim = document.createElement('canvas'); sim.width = W; sim.height = H
  sctx = sim.getContext('2d')
  img = sctx.createImageData(W, H)
  seedAgents()
}
function seedAgents() {
  nAgents = wantAgents()
  agents = new Float32Array(nAgents * 3)
  const cx = W / 2, cy = H / 2, r0 = Math.min(W, H) * 0.18
  for (let i = 0; i < nAgents; i++) {
    const a = rt.random(0, Math.PI * 2)
    const r = Math.sqrt(rt.rng()) * r0
    agents[i * 3] = cx + Math.cos(a) * r
    agents[i * 3 + 1] = cy + Math.sin(a) * r
    agents[i * 3 + 2] = a
  }
}
function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  build()
}

canvas.addEventListener('pointerdown', (e) => {
  foods.push({ x: (e.clientX / window.innerWidth) * W, y: (e.clientY / window.innerHeight) * H, born: performance.now() })
  if (foods.length > 12) foods.shift()
  if (hint) hint.style.opacity = '0'
})

const wrap = (v, n) => (v < 0 ? v + n : v >= n ? v - n : v)
function sample(x, y) {
  const xi = Math.floor(wrap(x, W))
  const yi = Math.floor(wrap(y, H))
  return trail[yi * W + xi]
}

function step() {
  const SA = (params.sensorAngle * Math.PI) / 180
  const SD = params.sensorDist
  const TA = (params.turn * Math.PI) / 180
  const sp = params.speed
  const dep = params.deposit * 0.6
  const wig = params.wiggle
  for (let i = 0; i < nAgents; i++) {
    const o = i * 3
    let x = agents[o], y = agents[o + 1], h = agents[o + 2]
    const c = sample(x + Math.cos(h) * SD, y + Math.sin(h) * SD)
    const l = sample(x + Math.cos(h - SA) * SD, y + Math.sin(h - SA) * SD)
    const r = sample(x + Math.cos(h + SA) * SD, y + Math.sin(h + SA) * SD)
    if (c > l && c > r) { /* straight on */ }
    else if (c < l && c < r) h += (rt.rng() < 0.5 ? -1 : 1) * TA // valley → pick a side
    else if (l < r) h += TA
    else if (r < l) h -= TA
    h += (rt.rng() - 0.5) * wig // a little wander keeps it organic + evolving
    x = wrap(x + Math.cos(h) * sp, W)
    y = wrap(y + Math.sin(h) * sp, H)
    agents[o] = x; agents[o + 1] = y; agents[o + 2] = h
    trail[(y | 0) * W + (x | 0)] += dep
  }
}

// Food emits a puff of trail each frame, so agents climb toward it and swarm.
function emitFood(now) {
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i]
    const age = now - f.born
    if (age > 14000) { foods.splice(i, 1); continue }
    const life = 1 - age / 14000 // fades as it's "eaten"
    const rad = 5
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const d = Math.hypot(dx, dy)
      if (d > rad) continue
      const xi = (f.x + dx) | 0, yi = (f.y + dy) | 0
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue
      trail[yi * W + xi] += (1 - d / rad) * 2.5 * life
    }
  }
}

// diffuse (3x3 box blur) + evaporate
function diffuse() {
  const dk = 1 - params.decay
  for (let y = 0; y < H; y++) {
    const y0 = ((y - 1 + H) % H) * W, y1 = y * W, y2 = ((y + 1) % H) * W
    for (let x = 0; x < W; x++) {
      const x0 = (x - 1 + W) % W, x2 = (x + 1) % W
      const s = trail[y0 + x0] + trail[y0 + x] + trail[y0 + x2] +
        trail[y1 + x0] + trail[y1 + x] + trail[y1 + x2] +
        trail[y2 + x0] + trail[y2 + x] + trail[y2 + x2]
      tmp[y1 + x] = (s / 9) * dk
    }
  }
  trail.set(tmp)
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
// The neutral petri-dish grey the plasmodium grows on, so the reticulated veins
// read as a translucent chartreuse net over the dish (as in real Physarum).
const DISH = [76, 80, 78]
function render() {
  // hue centred on chartreuse-green (~82°), user-tunable across yellow→green
  const hDeg = 60 + params.hue * 90
  const d = img.data
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, trail[i] * 0.6)
    const j = i * 4
    if (v < 0.008) { d[j] = DISH[0]; d[j + 1] = DISH[1]; d[j + 2] = DISH[2]; d[j + 3] = 255; continue }
    // translucent plasmodium: faint at the fine veins, brightening and paling
    // to a creamy chartreuse at the dense advancing fan.
    const a = Math.min(1, 0.25 + v * 1.5)
    const light = Math.min(0.9, 0.32 + v * v * 0.4 + Math.pow(v, 5) * 0.35)
    const sat = 0.72 - v * 0.35
    const [r, g, b] = hsl(hDeg, sat, light)
    d[j] = Math.round(DISH[0] * (1 - a) + r * a)
    d[j + 1] = Math.round(DISH[1] * (1 - a) + g * a)
    d[j + 2] = Math.round(DISH[2] * (1 - a) + b * a)
    d[j + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  if (nAgents !== wantAgents()) seedAgents()
  emitFood(now)
  step()
  diffuse()
  render()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
