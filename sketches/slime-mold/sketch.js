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
  density: { value: 1.2, min: 0.2, max: 2, step: 0.05, label: 'Colony density' },
  speed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Crawl speed' },
  sensorDist: { value: 7, min: 3, max: 24, step: 0.5, label: 'Sensor distance' },
  sensorAngle: { value: 32, min: 8, max: 70, step: 1, label: 'Sensor angle°' },
  turn: { value: 38, min: 5, max: 80, step: 1, label: 'Turn°' },
  wiggle: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'Wander (chaos)' },
  deposit: { value: 1.1, min: 0.2, max: 2, step: 0.05, label: 'Trail deposit' },
  decay: { value: 0.05, min: 0.02, max: 0.3, step: 0.005, label: 'Evaporation' },
  // Outward foraging drive: how hard the colony pushes its frontier out from
  // the inoculation point, so it advances as a lobed fan trailing a vein net
  // (like a real Physarum spreading across a dish) rather than milling in place.
  spread: { value: 0.32, min: 0, max: 1.5, step: 0.05, label: 'Foraging drive' },
  // Vein sharpening: a gentle unsharp feedback that pulls a little protoplasm out
  // of the faint mesh into the strong routes, so thick transport trunks emerge
  // and taper to fine twigs — the vein *hierarchy* real Physarum shows — while
  // the reticulated net behind the front survives. Push it high to prune toward
  // a few bold tubes; keep it low for a dense, lacy web.
  sharpen: { value: 0.32, min: 0, max: 1, step: 0.02, label: 'Vein sharpening' },
  glisten: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Wet sheen' },
  bloom: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Glow' },
  hue: { value: 0.44, min: 0, max: 1, step: 0.01, label: 'Tint (gold ↔ green)' },
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
  const long = Math.min(Math.max(window.innerWidth, window.innerHeight), 600)
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
  // Scatter agents across the whole dish, each facing a random way. This is what
  // grows a full-frame reticulated web (loops, anastomosis, a real vein
  // hierarchy) instead of a handful of radial spokes shooting from a single
  // seed. Sensor-following + deposition does the rest.
  for (let i = 0; i < nAgents; i++) {
    const o = i * 3
    agents[o] = rt.random(0, W)
    agents[o + 1] = rt.random(0, H)
    agents[o + 2] = rt.random(0, Math.PI * 2)
  }
  // faint noise so the first steps have something to break symmetry against
  if (trail) { trail.fill(0); for (let i = 0; i < W * H; i++) if (rt.rng() < 0.04) trail[i] = rt.rng() * rt.rng() * 0.4 }
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
    // Bounce off the dish rim (reflect the heading) so agents keep weaving the
    // network across the whole frame instead of being teleported back to a
    // central seed — that reflection is what lets the web fill the dish.
    if (x < 1) { x = 1; h = Math.PI - h }
    else if (x >= W - 1) { x = W - 2; h = Math.PI - h }
    if (y < 1) { y = 1; h = -h }
    else if (y >= H - 1) { y = H - 2; h = -h }
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

// diffuse (Gaussian 3x3) + vein-sharpening feedback + evaporate
const CAP = 6 // protoplasm density ceiling — keeps sharpening from running away
function diffuse() {
  const dk = 1 - params.decay
  const sh = params.sharpen
  for (let y = 0; y < H; y++) {
    const y0 = ((y - 1 + H) % H) * W, y1 = y * W, y2 = ((y + 1) % H) * W
    for (let x = 0; x < W; x++) {
      const x0 = (x - 1 + W) % W, x2 = (x + 1) % W
      // Gaussian 3x3 (1 2 1 / 2 4 2 / 1 2 1) — far more isotropic than a flat box
      // blur, so a point source no longer spreads into an axis-aligned cross.
      const s = trail[y0 + x0] + 2 * trail[y0 + x] + trail[y0 + x2] +
        2 * trail[y1 + x0] + 4 * trail[y1 + x] + 2 * trail[y1 + x2] +
        trail[y2 + x0] + 2 * trail[y2 + x] + trail[y2 + x2]
      const blur = s / 16
      const c = trail[y1 + x]
      // Unsharp mask: add back a fraction of the high-frequency detail (c − blur)
      // so ridges gain and hollows lose — but scale it by how much protoplasm is
      // actually here (min(1, c·2)) so the empty agar stays smooth instead of
      // sparkling. This is what carves the thick-trunk / fine-twig hierarchy.
      const v = blur + sh * (c - blur) * Math.min(1, c)
      tmp[y1 + x] = Math.max(0, Math.min(CAP, v * dk))
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
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
// The dark, faintly warm agar the plasmodium grows on (as in the macro shots):
// near-black so the plasmodium reads as glowing gold veins, greenish at the fine
// foraging mesh and paling to a wet cream sheen along the thick transport tubes.
const DISH = [10, 13, 9]
function render() {
  const tint = (params.hue - 0.5) * 40 // <0 warmer/gold · >0 cooler/green
  const glis = params.glisten
  const d = img.data
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, trail[i] * 0.26)
    const j = i * 4
    if (v < 0.006) { d[j] = DISH[0]; d[j + 1] = DISH[1]; d[j + 2] = DISH[2]; d[j + 3] = 255; continue }
    // Colour by vein weight: the faint frontier mesh runs green (~95°), thick
    // trunks swing to gold (~46°). Lightness climbs with weight; a steep core
    // term paints the wet, near-white sheen down the middle of the biggest tubes
    // only, so fine twigs stay dim and dark and the hierarchy reads.
    const mix = smooth(0.1, 0.7, v)
    const hDeg = (88 - 44 * mix) + tint
    const sat = 0.98 - 0.34 * v
    const light = 0.06 + 0.5 * Math.pow(v, 0.7)
    let [r, g, b] = hsl(hDeg, sat, light)
    const gloss = Math.pow(v, 5) * glis
    r += (252 - r) * gloss; g += (247 - g) * gloss; b += (205 - b) * gloss
    // frontier mesh stays translucent over the agar; trunks go opaque
    const a = Math.min(1, 0.1 + v * 2.6)
    d[j] = Math.round(DISH[0] * (1 - a) + r * a)
    d[j + 1] = Math.round(DISH[1] * (1 - a) + g * a)
    d[j + 2] = Math.round(DISH[2] * (1 - a) + b * a)
    d[j + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)
  // Bloom: a blurred, additive re-draw so the bright veins bleed a soft glow
  // into the agar — the luminous wet look of a lit plasmodium.
  if (params.bloom > 0.001) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = params.bloom
    try { ctx.filter = `blur(${Math.max(2, Math.max(canvas.width, canvas.height) * 0.004)}px)` } catch { /* older browsers: plain additive */ }
    ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)
    ctx.filter = 'none'
    ctx.restore()
  }
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
