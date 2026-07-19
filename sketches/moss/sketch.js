// Moss — colonies creep across a rock face as thousands of tiny stamped
// shoots. Each colony expands a noisy frontier; every dot gets a lit top and
// shadowed base so the carpet reads as velvet. Click seeds a colony, humidity
// sets the pace, and a slow dry/regrow cycle keeps the surface alive.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  humidity: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Humidity' },
  colonies: { value: 7, min: 1, max: 16, step: 1, label: 'Colonies' },
  fuzz: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Fuzziness' },
  hue: { value: 96, min: 50, max: 160, step: 1, label: 'Moss hue' },
  clump: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Clumping' },
  cycle: { value: true, type: 'bool', label: 'Dry & regrow' },
})
rt.mapInput('audio.pulse', 'humidity', 1.0)
rt.mapInput('audio.level', 'fuzz', 0.4)

// Moss accumulates on a persistent layer over a baked rock background.
const rock = document.createElement('canvas')
const moss = document.createElement('canvas')
const rctx = rock.getContext('2d')
const mctx = moss.getContext('2d')

// --- seeded value noise (fbm) for rock shading + colony boundaries ---------
const P = new Uint8Array(512)
{
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rt.rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
}
const sfade = (t) => t * t * (3 - 2 * t)
function vnoise(x, y) {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const h = (a, b) => P[P[a] + b] / 255
  const u = sfade(xf)
  const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
  const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
  return a + sfade(yf) * (b - a)
}
const fbm = (x, y) => 0.6 * vnoise(x, y) + 0.28 * vnoise(x * 2.1, y * 2.1) + 0.12 * vnoise(x * 4.7, y * 4.7)

// --- colonies --------------------------------------------------------------
// { x, y, r, hue, rough, seed } — r is the mean frontier radius; the actual
// boundary is r modulated by angular fbm so lobes and fingers form.
let cols = []
let grown = 0 // total stamped area, for the dry/regrow cycle
let phase = 'grow' // grow | dry
let dryness = 0

function colonyRadius(c, ang) {
  const lob = fbm(Math.cos(ang) * 1.3 + c.seed, Math.sin(ang) * 1.3 + c.seed)
  return c.r * (0.55 + 0.9 * lob * c.rough)
}

function seedColony(x, y) {
  cols.push({
    x,
    y,
    r: 4 * rt.pixelRatio,
    hue: params.hue + rt.random(-16, 16),
    rough: rt.random(0.7, 1.25),
    seed: rt.random(0, 60),
  })
}

function reseed() {
  cols = []
  grown = 0
  const W = moss.width
  const H = moss.height
  for (let i = 0; i < params.colonies; i++) {
    // bias seeds toward crevices (dark fbm) — moss starts where water sits
    let bx = 0
    let by = 0
    let best = 2
    for (let k = 0; k < 6; k++) {
      const x = rt.random(0.06, 0.94) * W
      const y = rt.random(0.06, 0.94) * H
      const v = fbm(x * 0.004, y * 0.004)
      if (v < best) {
        best = v
        bx = x
        by = y
      }
    }
    seedColony(bx, by)
  }
}

function paintRock() {
  const W = rock.width
  const H = rock.height
  const img = rctx.createImageData(W, H)
  const d = img.data
  const s = 0.004 / rt.pixelRatio
  // light from upper-left: shade by the noise gradient for a carved look
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x * s, y * s)
      const nx = fbm((x + 3) * s, y * s) - n
      const ny = fbm(x * s, (y + 3) * s) - n
      const lit = 0.5 - nx * 5 - ny * 5
      const v = 26 + n * 34 + lit * 26 + vnoise(x * 0.12, y * 0.12) * 7
      const i = (y * W + x) * 4
      d[i] = v * 0.94
      d[i + 1] = v
      d[i + 2] = v * 1.08
      d[i + 3] = 255
    }
  }
  rctx.putImageData(img, 0, 0)
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  rock.width = moss.width = canvas.width
  rock.height = moss.height = canvas.height
  paintRock()
  mctx.clearRect(0, 0, moss.width, moss.height)
  reseed()
}

// --- growth ----------------------------------------------------------------
function stamp(c, px) {
  // pick an angle, find the frontier there, drop a shoot near it (denser at
  // the edge, occasional infill so the middle thickens too)
  const ang = rt.random(0, Math.PI * 2)
  const edge = colonyRadius(c, ang)
  // mostly at the frontier, some infill, and a few pioneer shoots past the
  // edge so the boundary stays soft and feathered
  const roll = rt.rng()
  const frac = roll < 0.66 ? rt.random(0.82, 1.0) : roll < 0.88 ? Math.sqrt(rt.rng()) : rt.random(1.0, 1.22)
  const rr = edge * frac
  const x = c.x + Math.cos(ang) * rr
  const y = c.y + Math.sin(ang) * rr
  if (x < 0 || y < 0 || x >= moss.width || y >= moss.height) return

  // clumpy micro-height decides how lush this spot is
  const clump = fbm(x * 0.015 * params.clump, y * 0.015 * params.clump)
  if (rt.rng() > 0.25 + clump * 0.75) return

  let size = (0.9 + clump * 1.8) * params.fuzz * px * rt.random(0.7, 1.3)
  if (frac > 1) size *= 0.55 // pioneers are young and small
  const light = 22 + clump * 30 + rt.random(-4, 4)
  const hue = c.hue + clump * 12 - 6
  // shadowed base, then a lit cap nudged toward the light for the velvet read
  mctx.fillStyle = `hsl(${hue - 8}, 42%, ${light * 0.45}%)`
  mctx.beginPath()
  mctx.arc(x + size * 0.4, y + size * 0.45, size, 0, Math.PI * 2)
  mctx.fill()
  mctx.fillStyle = `hsl(${hue}, ${48 + clump * 18}%, ${light}%)`
  mctx.beginPath()
  mctx.arc(x, y, size * 0.8, 0, Math.PI * 2)
  mctx.fill()
  // sparse bright shoot tips
  if (rt.rng() < 0.1) {
    mctx.fillStyle = `hsl(${hue + 10}, 62%, ${light + 22}%)`
    mctx.fillRect(x - size * 0.2, y - size * 0.6, size * 0.4, size * 0.5)
  }
  grown += size * size * 3.1
}

function grow(dt) {
  const px = rt.pixelRatio
  const rate = params.humidity * (1 + rt.beat.state.pulse * 2.5)
  const stampsPerCol = Math.max(1, Math.round(26 * rate * rt.detail * dt * 60))
  for (const c of cols) {
    c.r += 9 * px * rate * dt * (30 / (30 + c.r / px)) // fast young, slow old
    for (let i = 0; i < stampsPerCol; i++) stamp(c, px)
  }
  // colonies drift new satellite patches once mature
  if (rt.rng() < 0.004 * rate && cols.length < params.colonies + 6) {
    const c = rt.pick(cols)
    if (c && c.r > 60 * px) {
      const a = rt.random(0, Math.PI * 2)
      const d = colonyRadius(c, a) + rt.random(20, 70) * px
      seedColony(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d)
    }
  }
  if (params.cycle && grown > moss.width * moss.height * 1.35) phase = 'dry'
}

function dry(dt) {
  // desaturate + thin the carpet, then wash it off and reseed
  dryness += dt
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = `rgba(0,0,0,${Math.min(0.06, dryness * 0.01)})`
  mctx.fillRect(0, 0, moss.width, moss.height)
  mctx.globalCompositeOperation = 'source-over'
  if (dryness > 6) {
    dryness = 0
    phase = 'grow'
    mctx.clearRect(0, 0, moss.width, moss.height)
    reseed()
  }
}

canvas.addEventListener('pointerdown', (e) => {
  seedColony(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio)
})

rt.onBeat(({ energy }) => {
  // beats fire a visible growth spurt on a random colony
  const c = rt.pick(cols)
  if (!c) return
  const px = rt.pixelRatio
  c.r += (4 + energy * 10) * px
  for (let i = 0; i < 220 * rt.detail; i++) stamp(c, px)
})

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  if (phase === 'grow') grow(dt)
  else dry(dt)

  ctx.drawImage(rock, 0, 0)
  // drying tints the whole carpet toward straw yellow
  if (phase === 'dry') {
    ctx.filter = `sepia(${Math.min(0.7, dryness * 0.15)})`
    ctx.drawImage(moss, 0, 0)
    ctx.filter = 'none'
  } else {
    ctx.drawImage(moss, 0, 0)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
