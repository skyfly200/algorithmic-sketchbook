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
  wiggle: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'Wander (chaos)' },
  deposit: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Trail deposit' },
  decay: { value: 0.06, min: 0.02, max: 0.3, step: 0.005, label: 'Evaporation' },
  // Outward foraging drive: how hard the colony pushes its frontier out from
  // the inoculation point, so it advances as a lobed fan trailing a vein net
  // (like a real Physarum spreading across a dish) rather than milling in place.
  spread: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Foraging drive' },
  hue: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Hue' },
})
// Music: beats surge the crawl, loudness thickens the trails.
rt.mapInput('audio.pulse', 'speed', 0.5)
rt.mapInput('audio.volume', 'deposit', 0.4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W, H, trail, tmp, img, sim, sctx
let agents = null // Float32Array packed [x, y, heading] * N
let nAgents = 0
let srcX = 0, srcY = 0 // the inoculation point the colony grows out from
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
  srcX = W / 2; srcY = H / 2
  for (let i = 0; i < nAgents; i++) respawn(i * 3)
}
// (Re)seat an agent at the inoculation point, facing outward — used to launch
// the colony and to recycle explorers that reach the dish edge, so a steady
// stream keeps feeding veins out from the source.
function respawn(o) {
  const a = rt.random(0, Math.PI * 2)
  const r = Math.sqrt(rt.rng()) * Math.min(W, H) * 0.06
  agents[o] = srcX + Math.cos(a) * r
  agents[o + 1] = srcY + Math.sin(a) * r
  agents[o + 2] = a // face outward
}
function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  build()
}

canvas.addEventListener('pointerdown', (e) => {
  foods.push({ x: (e.clientX / window.innerWidth) * W, y: (e.clientY / window.innerHeight) * H, born: performance.now(), ang: rt.random(0, Math.PI * 2) })
  if (foods.length > 12) foods.shift()
})

// A single rolled-oat flake — a pale, ridged oval with a central groove — drawn
// where you dropped food, shrinking as the colony consumes it.
function drawOat(cctx, x, y, r, ang, life) {
  cctx.save()
  cctx.translate(x, y)
  cctx.rotate(ang)
  const w = r * (0.7 + life * 0.3)
  // soft shadow
  cctx.fillStyle = 'rgba(0,0,0,0.25)'
  cctx.beginPath(); cctx.ellipse(1.5, 2, w * 1.05, w * 0.62, 0, 0, 6.28); cctx.fill()
  // oat body
  const g = cctx.createLinearGradient(0, -w * 0.6, 0, w * 0.6)
  g.addColorStop(0, '#f3e6c4')
  g.addColorStop(1, '#d9c294')
  cctx.fillStyle = g
  cctx.beginPath(); cctx.ellipse(0, 0, w, w * 0.6, 0, 0, 6.28); cctx.fill()
  // central groove
  cctx.strokeStyle = 'rgba(150,120,70,0.6)'; cctx.lineWidth = Math.max(1, w * 0.06)
  cctx.beginPath(); cctx.moveTo(-w * 0.75, 0); cctx.lineTo(w * 0.75, 0); cctx.stroke()
  // a few flat-roll ridges + flecks
  cctx.strokeStyle = 'rgba(190,165,110,0.5)'; cctx.lineWidth = Math.max(0.5, w * 0.03)
  for (let k = -2; k <= 2; k++) {
    if (k === 0) continue
    cctx.beginPath(); cctx.ellipse(0, k * w * 0.16, w * (1 - Math.abs(k) * 0.18), w * 0.06, 0, 0, 6.28); cctx.stroke()
  }
  cctx.restore()
}

// Bounded (non-wrapping) field: clamp sample coordinates so the trail doesn't
// wrap around the dish edges.
function sample(x, y) {
  const xi = x < 0 ? 0 : x >= W ? W - 1 : x | 0
  const yi = y < 0 ? 0 : y >= H ? H - 1 : y | 0
  return trail[yi * W + xi]
}

function step() {
  const SA = (params.sensorAngle * Math.PI) / 180
  const SD = params.sensorDist
  const TA = (params.turn * Math.PI) / 180
  const sp = params.speed
  const dep = params.deposit * 0.6
  const wig = params.wiggle
  const drive = params.spread
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
    // Foraging drive: nudge the heading outward from the source, but only where
    // the trail is still faint (the frontier) — established veins hold their
    // shape, so the fan advances while the network behind it stays put.
    if (drive > 0) {
      const here = trail[(y | 0) * W + (x | 0)]
      const w = drive * 0.08 * Math.max(0, 1 - here * 0.7)
      if (w > 0.0005) {
        let d = Math.atan2(y - srcY, x - srcX) - h
        d = Math.atan2(Math.sin(d), Math.cos(d))
        h += d * w
      }
    }
    x += Math.cos(h) * sp
    y += Math.sin(h) * sp
    // reached the dish edge → recycle back to the source to keep feeding veins
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) { respawn(o); continue }
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
  // the food: a single oat flake at each drop point, being eaten over time
  const kx = canvas.width / W, ky = canvas.height / H
  const oatR = Math.min(canvas.width, canvas.height) * 0.03
  for (const f of foods) {
    const life = Math.max(0, 1 - (performance.now() - f.born) / 14000)
    if (life <= 0) continue
    drawOat(ctx, f.x * kx, f.y * ky, oatR, f.ang ?? 0, life)
  }
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
