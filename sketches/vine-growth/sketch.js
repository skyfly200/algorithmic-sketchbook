// Vine Growth — climbing ivy drawn stroke by stroke onto a persistent canvas.
// Growth tips wander upward under curl noise, branch, and sprout alternating
// leaves; click plants a new vine, beats trigger branch bursts, and when the
// wall fills up the painting fades back and regrows from fresh seeds.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.1, max: 3, step: 0.05, label: 'Growth speed' },
  branching: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Branching' },
  leafiness: { value: 1, min: 0, max: 2, step: 0.05, label: 'Leaf density' },
  wander: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Wander' },
  hue: { value: 108, min: 60, max: 180, step: 1, label: 'Foliage hue' },
  bloom: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Blossoms' },
  regrow: { value: true, type: 'bool', label: 'Auto regrow' },
})
rt.mapInput('audio.pulse', 'growth', 0.8)
rt.mapInput('audio.level', 'leafiness', 0.4)

// Persistent painting layer — stems and leaves accumulate here, never cleared
// per frame (that's what makes it feel like real growth).
const paper = document.createElement('canvas')
const pctx = paper.getContext('2d')

// --- seeded value noise for organic steering -------------------------------
const P = new Uint8Array(512)
{
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rt.rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
}
const fade = (t) => t * t * (3 - 2 * t)
function vnoise(x, y) {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const h = (a, b) => P[P[a] + b] / 255
  const u = fade(xf)
  const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
  const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
  return a + fade(yf) * (b - a) // 0..1
}

// --- vine state ------------------------------------------------------------
let tips = [] // { x, y, a, thick, depth, dist, side, leafGap, life }
let inked = 0 // rough coverage budget
let fading = 0 // >0 while the wall is being washed back
const noiseSeed = rt.random(0, 100)

function plant(x, y) {
  tips.push({
    x,
    y,
    a: -Math.PI / 2 + rt.random(-0.3, 0.3),
    thick: rt.random(5, 8),
    depth: 0,
    dist: 0,
    side: rt.rng() < 0.5 ? 1 : -1,
    leafGap: rt.random(10, 26),
    life: rt.random(900, 1600),
  })
}

function branchFrom(tip, spread = 0.9) {
  if (tip.thick < 1.1) return
  tips.push({
    x: tip.x,
    y: tip.y,
    a: tip.a + rt.random(0.35, spread) * (rt.rng() < 0.5 ? 1 : -1),
    thick: tip.thick * rt.random(0.55, 0.75),
    depth: tip.depth + 1,
    dist: 0,
    side: -tip.side,
    leafGap: rt.random(10, 26),
    life: tip.life * rt.random(0.4, 0.7),
  })
}

function seedWall() {
  tips = []
  inked = 0
  const W = paper.width
  const H = paper.height
  const n = 2 + Math.round(rt.random(0, 2) + 2 * rt.detail)
  for (let i = 0; i < n; i++) plant(((i + 0.5) / n + rt.random(-0.08, 0.08)) * W, H + 10)
}

function paintWall() {
  const W = paper.width
  const H = paper.height
  const g = pctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0b0d12')
  g.addColorStop(1, '#05060a')
  pctx.fillStyle = g
  pctx.fillRect(0, 0, W, H)
  // faint plaster mottling so the vine has something to live on
  pctx.globalAlpha = 0.05
  for (let i = 0; i < 260 * rt.detail; i++) {
    const x = rt.random(0, W)
    const y = rt.random(0, H)
    pctx.fillStyle = rt.rng() < 0.5 ? '#1a1d26' : '#000'
    pctx.beginPath()
    pctx.arc(x, y, rt.random(8, 60), 0, Math.PI * 2)
    pctx.fill()
  }
  pctx.globalAlpha = 1
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  paper.width = canvas.width
  paper.height = canvas.height
  paintWall()
  seedWall()
}

// --- drawing ---------------------------------------------------------------
function leaf(x, y, a, size, hue) {
  pctx.save()
  pctx.translate(x, y)
  pctx.rotate(a)
  const light = 30 + vnoise(x * 0.01 + 40, y * 0.01) * 26
  // stalk
  pctx.strokeStyle = `hsl(${hue - 10}, 45%, ${light * 0.7}%)`
  pctx.lineWidth = Math.max(1, size * 0.08)
  pctx.beginPath()
  pctx.moveTo(0, 0)
  pctx.lineTo(size * 0.35, 0)
  pctx.stroke()
  // blade — two bezier lobes with a darker underside for depth
  pctx.translate(size * 0.35, 0)
  const grad = pctx.createLinearGradient(0, -size * 0.4, size, size * 0.2)
  grad.addColorStop(0, `hsl(${hue}, 55%, ${light}%)`)
  grad.addColorStop(1, `hsl(${hue + 14}, 60%, ${light * 0.55}%)`)
  pctx.fillStyle = grad
  pctx.beginPath()
  pctx.moveTo(0, 0)
  pctx.bezierCurveTo(size * 0.25, -size * 0.5, size * 0.95, -size * 0.28, size, 0)
  pctx.bezierCurveTo(size * 0.95, size * 0.28, size * 0.25, size * 0.5, 0, 0)
  pctx.fill()
  // midrib
  pctx.strokeStyle = `hsla(${hue - 20}, 40%, ${light * 0.5}%, 0.7)`
  pctx.lineWidth = Math.max(0.6, size * 0.04)
  pctx.beginPath()
  pctx.moveTo(0, 0)
  pctx.lineTo(size * 0.92, 0)
  pctx.stroke()
  pctx.restore()
}

function blossom(x, y, size, hue) {
  pctx.save()
  pctx.translate(x, y)
  const bh = (hue + 200) % 360
  for (let i = 0; i < 5; i++) {
    pctx.rotate((Math.PI * 2) / 5)
    pctx.fillStyle = `hsl(${bh}, 70%, 78%)`
    pctx.beginPath()
    pctx.ellipse(size * 0.5, 0, size * 0.5, size * 0.28, 0, 0, Math.PI * 2)
    pctx.fill()
  }
  pctx.fillStyle = `hsl(${(bh + 160) % 360}, 90%, 65%)`
  pctx.beginPath()
  pctx.arc(0, 0, size * 0.22, 0, Math.PI * 2)
  pctx.fill()
  pctx.restore()
}

function growTips(dt, t) {
  const W = paper.width
  const H = paper.height
  const px = rt.pixelRatio
  const speed = params.growth * 60 * px
  const hue = params.hue
  const maxTips = Math.round(90 * rt.detail) + 10

  for (let i = tips.length - 1; i >= 0; i--) {
    const tip = tips[i]
    const step = speed * dt * rt.random(0.7, 1.3)
    // curl-noise steering: gradient of the noise field, plus upward phototropism
    const ns = 0.004 / px
    const n = vnoise(tip.x * ns + noiseSeed, tip.y * ns + noiseSeed)
    tip.a += (n - 0.5) * 4.2 * params.wander * dt
    tip.a += (Math.sin(-Math.PI / 2 - tip.a) * 0.35 + Math.sin(t * 0.7 + tip.x * 0.01) * 0.06) * dt

    const nx = tip.x + Math.cos(tip.a) * step
    const ny = tip.y + Math.sin(tip.a) * step

    const light = 26 + n * 20
    pctx.strokeStyle = `hsl(${hue - 16}, 42%, ${light * 0.8}%)`
    pctx.lineWidth = Math.max(0.8, tip.thick * px * 0.5)
    pctx.lineCap = 'round'
    pctx.beginPath()
    pctx.moveTo(tip.x, tip.y)
    pctx.lineTo(nx, ny)
    pctx.stroke()

    tip.x = nx
    tip.y = ny
    tip.dist += step
    tip.life -= step / px
    tip.thick *= 1 - 0.012 * (step / (8 * px))
    inked += step * tip.thick

    // leaves alternate sides along the stem
    if (tip.dist > tip.leafGap * px * (2.2 - params.leafiness)) {
      tip.dist = 0
      tip.side = -tip.side
      if (params.leafiness > 0.05) {
        const size = (10 + tip.thick * 3.4) * px * rt.random(0.8, 1.25)
        leaf(tip.x, tip.y, tip.a + tip.side * rt.random(0.7, 1.15), size, hue + rt.random(-10, 10))
        if (rt.rng() < params.bloom * 0.22) blossom(tip.x, tip.y, size * 0.5, hue)
      }
      if (rt.rng() < 0.12 * params.branching && tips.length < maxTips) branchFrom(tip)
    }

    // die at edges, from old age, or from getting too thin
    if (tip.life <= 0 || tip.thick < 0.55 || nx < -20 || nx > W + 20 || ny < -20) {
      if (tip.thick > 0.8) blossom(tip.x, tip.y, 6 * px, hue) // terminal bud
      tips.splice(i, 1)
    }
  }

  // wall full → wash it back and start over
  const budget = W * H * 1.15
  if (params.regrow && inked > budget && fading === 0) fading = 1
  if (!tips.length && !fading) seedWall()
}

rt.onBeat(({ energy }) => {
  const alive = tips.filter((t) => t.thick > 1.2)
  const n = Math.min(alive.length, 1 + Math.round(energy * 3 * params.branching))
  for (let i = 0; i < n; i++) branchFrom(rt.pick(alive), 1.3)
})

canvas.addEventListener('pointerdown', (e) => {
  plant(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio)
})

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  if (fading > 0) {
    // gentle wash toward the wall colour; reseed once it's mostly gone
    pctx.fillStyle = 'rgba(6, 7, 11, 0.05)'
    pctx.fillRect(0, 0, paper.width, paper.height)
    fading += dt
    if (fading > 4.5) {
      fading = 0
      paintWall()
      seedWall()
    }
  } else {
    growTips(dt, t)
  }

  ctx.drawImage(paper, 0, 0)

  // beat pulse: brief warm glow over the whole wall
  const pulse = rt.beat.state.pulse
  if (pulse > 0.02) {
    ctx.fillStyle = `hsla(${params.hue}, 60%, 60%, ${pulse * 0.06})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
