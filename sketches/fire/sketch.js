// Fire — a classic bottom-up flame: a heat field seeded along the base cools
// and rises each frame (the demoscene fire algorithm), coloured through a
// black-body palette, with flickering embers drifting up and smoke above.
// Click to add a hot spot; beats flare the whole blaze.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  mode: { value: 'Bonfire', type: 'select', options: ['Bonfire', 'Campfire', 'Torch', 'Candle'], label: 'Mode' },
  intensity: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Intensity' },
  cooling: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Cooling' },
  wind: { value: 0, min: -1, max: 1, step: 0.02, label: 'Wind' },
  height: { value: 0.7, min: 0.3, max: 1, step: 0.02, label: 'Flame height' },
  hue: { value: 20, min: -20, max: 60, step: 1, label: 'Hue shift' },
  embers: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Embers' },
})
// Per-mode shape of the flame base: a horizontal intensity profile across the
// grid columns (0..1), an overall intensity/cooling/ember bias, and a sway.
function modeProfile(x, t) {
  const f = x / GW // 0..1 across the width
  const m = params.mode
  if (m === 'Candle') {
    // a single slender tongue, gently swaying, low and calm
    const cx = 0.5 + Math.sin(t * 1.1) * 0.015
    const w = 0.02
    return Math.exp(-((f - cx) ** 2) / (w * w)) * 0.85
  }
  if (m === 'Torch') {
    // a fatter licking column with more turbulent sway
    const cx = 0.5 + Math.sin(t * 2.2) * 0.05 + Math.sin(t * 5) * 0.02
    const w = 0.06
    return Math.exp(-((f - cx) ** 2) / (w * w)) * 1.05
  }
  if (m === 'Campfire') {
    // a broad bed of coals with a few hotter tongues over the "logs"
    const bed = f > 0.2 && f < 0.8 ? 0.7 : 0.2
    const tongues = 0.4 * (Math.max(0, Math.sin(f * 22 + t * 3)) ** 3)
    return Math.min(1, bed + tongues)
  }
  return 1 // Bonfire: full-width base
}
// Per-mode biases so each really feels different, not just narrower.
const modeBias = {
  Bonfire: { intensity: 1, ember: 1, cool: 1 },
  Campfire: { intensity: 0.9, ember: 1.5, cool: 1.05 },
  Torch: { intensity: 1.05, ember: 0.7, cool: 0.95 },
  Candle: { intensity: 0.7, ember: 0.25, cool: 1.15 },
}
rt.mapInput('audio.level', 'intensity', 0.6)
rt.mapInput('audio.pulse', 'height', 0.2)

// low-res heat grid, palette-mapped and scaled up
let GW = 0, GH = 0, heat = null, img = null, low = null, lctx = null
const PAL = new Uint8Array(256 * 3)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  // black → red → orange → yellow → white
  const r = Math.min(255, v * 3 * 255)
  const g = Math.min(255, Math.max(0, (v - 0.33) * 3) * 255)
  const b = Math.min(255, Math.max(0, (v - 0.66) * 3) * 255)
  PAL[i * 3] = r; PAL[i * 3 + 1] = g; PAL[i * 3 + 2] = b
}
const embers = []
let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  GW = Math.max(80, Math.round(W / (4 * rt.pixelRatio)))
  GH = Math.max(60, Math.round(H / (4 * rt.pixelRatio)))
  heat = new Float32Array(GW * GH)
  low = document.createElement('canvas'); low.width = GW; low.height = GH
  lctx = low.getContext('2d')
  img = lctx.createImageData(GW, GH)
}
let flare = 0
rt.onBeat(({ energy }) => { flare = 0.4 + energy * 0.5 })
canvas.addEventListener('pointerdown', (e) => {
  const gx = Math.floor((e.clientX / window.innerWidth) * GW)
  const gy = Math.floor((e.clientY / window.innerHeight) * GH)
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    const i = (gy + y) * GW + (gx + x)
    if (i >= 0 && i < heat.length) heat[i] = 1
  }
})
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  flare = Math.max(0, flare - dt * 2)

  // seed the bottom row with hot, flickering values, shaped by the mode
  const bias = modeBias[params.mode] ?? modeBias.Bonfire
  const base = (1 + flare) * params.intensity * bias.intensity
  for (let x = 0; x < GW; x++) {
    const prof = modeProfile(x, t)
    heat[(GH - 1) * GW + x] = Math.min(1.4, base * prof * (0.6 + rt.rng() * 0.8))
  }
  // propagate upward with cooling + wind drift
  const cool = 0.02 * params.cooling * bias.cool * (1.5 - params.height)
  const windPix = Math.round(params.wind * 1.5)
  for (let y = 0; y < GH - 1; y++) {
    for (let x = 0; x < GW; x++) {
      const sx = (x + windPix + GW) % GW
      const below = heat[(y + 1) * GW + sx]
      const l = heat[(y + 1) * GW + ((sx - 1 + GW) % GW)]
      const r = heat[(y + 1) * GW + ((sx + 1) % GW)]
      let v = (below * 2 + l + r) / 4 - cool - rt.rng() * 0.015
      heat[y * GW + x] = Math.max(0, v)
    }
  }
  // palette map to the low canvas
  const d = img.data
  for (let i = 0; i < heat.length; i++) {
    let idx = Math.min(255, Math.max(0, Math.round(heat[i] * 255)))
    const j = i * 4
    d[j] = PAL[idx * 3]; d[j + 1] = PAL[idx * 3 + 1]; d[j + 2] = PAL[idx * 3 + 2]; d[j + 3] = 255
  }
  lctx.putImageData(img, 0, 0)

  ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `hue-rotate(${params.hue - 20}deg)`
  ctx.drawImage(low, 0, 0, W, H)
  ctx.filter = 'none'

  // embers rising from the flame tops — rate + spread depend on the mode
  const emberRate = params.embers * bias.ember
  if (emberRate > 0.01) {
    // narrow modes (candle/torch) throw embers from a tight central column
    const spread = params.mode === 'Candle' ? 0.03 : params.mode === 'Torch' ? 0.08 : 0.3
    if (rt.rng() < emberRate) embers.push({ x: W * (0.5 + rt.random(-spread, spread)), y: H * 0.7, vy: -rt.random(40, 120) * rt.pixelRatio, life: 1, s: rt.random(1, 3) * rt.pixelRatio })
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]
      e.x += Math.sin(t * 3 + e.y * 0.01) * 20 * dt + params.wind * 30 * dt
      e.y += e.vy * dt; e.vy += 20 * dt; e.life -= dt * 0.6
      if (e.life <= 0) { embers.splice(i, 1); continue }
      ctx.fillStyle = `hsla(${30 + params.hue + rt.rng() * 20}, 100%, 65%, ${e.life})`
      ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
