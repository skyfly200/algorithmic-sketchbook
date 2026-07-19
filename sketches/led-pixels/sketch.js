// LED Pixels — an addressable LED rig (WS2812-style) simulated pixel by
// pixel: strip, ring, matrix or spiral layouts wired in serpentine order,
// running classic pixel patterns. Every show control is a param, and the
// defaults are mapped to Art-Net DMX channels (run `npm run artnet-bridge`
// and a lighting desk drives it: ch1 dimmer, ch2 hue, ch3 speed, ch4
// spread) — with mic level feeding the VU pattern as a fallback.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const LAYOUTS = ['strip', 'ring', 'matrix', 'spiral']
const PATTERNS = ['rainbow', 'chase', 'breathe', 'sparkle', 'vu meter', 'fire', 'plasma']

const params = rt.params({
  layout: { value: rt.pick(LAYOUTS), type: 'select', options: LAYOUTS, label: 'Layout' },
  pattern: { value: rt.pick(['rainbow', 'chase', 'plasma']), type: 'select', options: PATTERNS, label: 'Pattern' },
  count: { value: 180, min: 20, max: 600, step: 1, label: 'Pixels' },
  brightness: { value: 1, min: 0, max: 1, step: 0.01, label: 'Dimmer (ch1)' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Hue (ch2)' },
  speed: { value: 1, min: 0, max: 4, step: 0.02, label: 'Speed (ch3)' },
  spread: { value: 1, min: 0.1, max: 3, step: 0.02, label: 'Spread (ch4)' },
  level: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'VU level' },
  diffuse: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Diffusion' },
})
// Art-Net first (a desk owns the rig), audio as the live fallback.
rt.mapInput('artnet.ch1', 'brightness', 1)
rt.mapInput('artnet.ch2', 'hue', 1)
rt.mapInput('artnet.ch3', 'speed', 1)
rt.mapInput('artnet.ch4', 'spread', 1)
rt.mapInput('audio.level', 'level', 1)
rt.mapInput('audio.pulse', 'brightness', 0.25)

let W = 0
let H = 0
const core = document.createElement('canvas') // crisp LED cores, bloomed up later
const cctx = core.getContext('2d')
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  core.width = W
  core.height = H
  layoutDirty = true
}

// --- layouts: pixel positions in wiring order -------------------------------
let leds = [] // { x, y }
let layoutDirty = true
let builtFor = ''
function buildLayout() {
  const n = Math.round(params.count)
  leds = []
  const m = Math.min(W, H)
  if (params.layout === 'strip') {
    // serpentine rows across the screen, like taped-up strip runs
    const rows = Math.max(1, Math.round(Math.sqrt(n / (W / H)) / 2))
    const per = Math.ceil(n / rows)
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per)
      const k = i % per
      const rev = r % 2 === 1
      const x = W * 0.06 + (W * 0.88 * (rev ? per - 1 - k : k)) / Math.max(1, per - 1)
      const y = H * 0.5 + (r - (rows - 1) / 2) * Math.min(H * 0.7 / Math.max(1, rows), H * 0.22)
      leds.push({ x, y })
    }
  } else if (params.layout === 'ring') {
    const R = m * 0.38
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      leds.push({ x: W / 2 + Math.cos(a) * R, y: H / 2 + Math.sin(a) * R })
    }
  } else if (params.layout === 'matrix') {
    const cols = Math.round(Math.sqrt(n * (W / H)))
    const rows = Math.ceil(n / cols)
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const k = i % cols
      const rev = r % 2 === 1 // serpentine wiring
      leds.push({
        x: W * 0.08 + (W * 0.84 * (rev ? cols - 1 - k : k)) / Math.max(1, cols - 1),
        y: H * 0.08 + (H * 0.84 * r) / Math.max(1, rows - 1),
      })
    }
  } else {
    // spiral out from the centre
    for (let i = 0; i < n; i++) {
      const f = i / n
      const a = f * Math.PI * 2 * (3 + n / 90)
      const R = m * 0.44 * Math.sqrt(f)
      leds.push({ x: W / 2 + Math.cos(a) * R, y: H / 2 + Math.sin(a) * R })
    }
  }
  builtFor = `${params.layout}|${Math.round(params.count)}|${W}x${H}`
}

// --- patterns: color for pixel i at time t, as [h, s, v] --------------------
const sparkles = new Map() // i -> energy
let chasePhase = 0
let last = 0
rt.onBeat(({ energy }) => {
  const n = Math.round(params.count)
  for (let k = 0; k < 4 + energy * 14; k++) sparkles.set(Math.floor(rt.rng() * n), 1)
})

function pixel(i, n, t) {
  const hue = params.hue
  const sp = params.spread
  switch (params.pattern) {
    case 'rainbow':
      return [hue + (i / n) * 360 * sp + t * 40 * params.speed, 1, 1]
    case 'chase': {
      const d = (((i - chasePhase) % n) + n) % n
      const v = Math.exp(-d / (2 + n * 0.04 * sp))
      return [hue + d * 1.2, 1, v]
    }
    case 'breathe':
      return [hue + Math.sin(i * 0.05 * sp) * 18, 0.95, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.7 * params.speed))]
    case 'sparkle': {
      const e = sparkles.get(i) ?? 0
      return [hue + (rt.rng() - 0.5) * 30, e > 0.5 ? 0.25 : 0.9, 0.04 + e]
    }
    case 'vu meter': {
      const f = i / n
      if (f > params.level) return [hue, 0.4, 0.03]
      return [f < 0.6 ? 130 : f < 0.85 ? 55 : 5, 1, 0.9]
    }
    case 'fire': {
      const fl = 0.5 + 0.5 * Math.sin(t * 11 * params.speed + i * 13.7) * Math.sin(t * 7 + i * 5.1)
      const v = Math.max(0.05, Math.min(1, 0.35 + fl * 0.8 - (i / n) * 0.25 * sp))
      return [20 + fl * 30, 1, v]
    }
    case 'plasma': {
      const p = leds[i]
      const u = (p.x / W) * 6 * sp
      const w = (p.y / H) * 6 * sp
      const v = Math.sin(u + t * 2 * params.speed) + Math.sin(w + t * 1.6) + Math.sin((u + w + t) * 0.7)
      return [hue + v * 55, 1, 0.45 + 0.4 * Math.sin(v * Math.PI * 0.5)]
    }
  }
  return [hue, 1, 1]
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  const key = `${params.layout}|${Math.round(params.count)}|${W}x${H}`
  if (layoutDirty || key !== builtFor) {
    buildLayout()
    layoutDirty = false
  }
  const n = leds.length

  chasePhase += dt * params.speed * n * 0.35
  for (const [i, e] of sparkles) {
    const ne = e - dt * 2.2
    ne <= 0 ? sparkles.delete(i) : sparkles.set(i, ne)
  }
  if (params.pattern === 'sparkle' && rt.rng() < 0.35) {
    sparkles.set(Math.floor(rt.rng() * n), 1)
  }

  // backdrop + wiring path
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.fillStyle = '#07080b'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(120, 128, 150, 0.14)'
  ctx.lineWidth = 1.5 * rt.pixelRatio
  ctx.beginPath()
  for (let i = 0; i < n; i++) i === 0 ? ctx.moveTo(leds[i].x, leds[i].y) : ctx.lineTo(leds[i].x, leds[i].y)
  ctx.stroke()

  // crisp cores
  const sz = Math.max(2, Math.min(14, (Math.min(W, H) / Math.sqrt(n)) * 0.16)) * (params.layout === 'matrix' ? 1.2 : 1)
  cctx.clearRect(0, 0, W, H)
  const dim = params.brightness
  for (let i = 0; i < n; i++) {
    const [h, s, v] = pixel(i, n, t)
    const vv = Math.min(1, Math.max(0, v)) * dim
    // dark chip when off, glowing die when lit
    cctx.fillStyle = vv < 0.02
      ? 'rgba(30,32,38,0.9)'
      : `hsl(${((h % 360) + 360) % 360}, ${s * 100}%, ${10 + vv * 62}%)`
    cctx.fillRect(leds[i].x - sz / 2, leds[i].y - sz / 2, sz, sz)
  }

  ctx.drawImage(core, 0, 0)
  // diffusion bloom: the whole core layer blurred and added back, twice
  if (params.diffuse > 0.02) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, 0.95 * params.diffuse)
    ctx.filter = `blur(${sz * 0.9}px)`
    ctx.drawImage(core, 0, 0)
    ctx.globalAlpha = 0.6 * params.diffuse
    ctx.filter = `blur(${sz * 3}px)`
    ctx.drawImage(core, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
