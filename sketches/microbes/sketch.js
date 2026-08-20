// Microbes — a microscope slide teeming with life. Centric and pennate
// diatoms show their silica frustules: rings and rows of pores laid out by
// phyllotaxis, shimmering with the thin-film / diffraction iridescence real
// diatoms flash under a lamp. Green algae filaments and desmids drift between
// them while rod, coccus and spiral bacteria jitter with Brownian motion.
// Everything is placed from the seed (the viewer's 🎲 re-rolls the slide).
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  diatoms: { value: 6, min: 0, max: 20, step: 1, label: 'Diatoms' },
  algae: { value: 5, min: 0, max: 20, step: 1, label: 'Algae' },
  bacteria: { value: 60, min: 0, max: 300, step: 5, label: 'Bacteria' },
  scale: { value: 1, min: 0.4, max: 2, step: 0.02, label: 'Scale' },
  drift: { value: 0.35, min: 0, max: 2, step: 0.01, label: 'Drift' },
  jitter: { value: 1, min: 0, max: 3, step: 0.02, label: 'Brownian' },
  iridescence: { value: 1, min: 0, max: 1.5, step: 0.02, label: 'Iridescence' },
  glow: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Glow' },
  hue: { value: 190, min: 0, max: 360, step: 1, label: 'Water hue' },
})
// A beat sends a shimmer pulse through every frustule.
rt.mapInput('audio.pulse', 'iridescence', 0.5)
rt.mapInput('audio.low', 'drift', 0.4)

let W = 0, H = 0, S = 1 // S = short-edge scale so sizes read the same on any screen
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  S = Math.min(W, H) / 900
}

// --- slide contents, rebuilt only when the seed or counts change -------------
const GOLD = Math.PI * (3 - Math.sqrt(5))
const DIATOM_KINDS = ['centric', 'triangular', 'pennate', 'oval'] // frustule shapes
let specks = [], diatoms = [], algae = [], bacteria = []
let builtFor = ''

function rand(a, b) { return a + (b - a) * rt.rng() }
function pick(arr) { return arr[Math.floor(rt.rng() * arr.length)] }

function build() {
  // Detritus specks scattered across the slide — the out-of-focus dust in the
  // reference photo. Placed in a normalized 0..1 field so resize keeps them put.
  specks = []
  const speckN = 900
  for (let i = 0; i < speckN; i++) {
    specks.push({ x: rt.rng(), y: rt.rng(), r: rand(0.2, 1.6), a: rand(0.03, 0.22), warm: rt.rng() < 0.12 })
  }

  diatoms = []
  for (let i = 0; i < params.diatoms; i++) {
    diatoms.push({
      x: rt.rng(), y: rt.rng(),
      kind: pick(DIATOM_KINDS),
      r: rand(60, 150),
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.05, 0.05),
      elong: rand(2.2, 4.2), // length:width for pennate/oval forms
      phase: rand(0, Math.PI * 2),
      vx: rand(-1, 1), vy: rand(-1, 1),
    })
  }

  algae = []
  for (let i = 0; i < params.algae; i++) {
    const desmid = rt.rng() < 0.35
    algae.push({
      x: rt.rng(), y: rt.rng(),
      rot: rand(0, Math.PI * 2),
      len: rand(120, 320), // filament length
      cells: Math.floor(rand(6, 16)),
      wobble: rand(0.4, 1.4),
      phase: rand(0, Math.PI * 2),
      hue: rand(95, 145), // greens
      desmid, r: rand(18, 34),
      vx: rand(-1, 1), vy: rand(-1, 1),
    })
  }

  bacteria = []
  const forms = ['rod', 'coccus', 'spiral']
  for (let i = 0; i < params.bacteria; i++) {
    bacteria.push({
      x: rt.rng(), y: rt.rng(),
      form: pick(forms),
      r: rand(2.5, 7),
      len: rand(3, 7), // body length in units of r
      rot: rand(0, Math.PI * 2),
      spin: rand(-2, 2),
      hue: rand(60, 190),
      // each bug keeps its own slow Brownian velocity, nudged every frame
      vx: rand(-1, 1), vy: rand(-1, 1), seed: rt.rng() * 1000,
    })
  }
  builtFor = signature()
}
function signature() {
  return [rt.seed, params.diatoms, params.algae, params.bacteria].join(':')
}

// --- iridescence: a saturated spectral colour swept by position + time -------
// Real frustule pores diffract white light into little rainbows; we fake it by
// hue-cycling along the pore index and letting a moving band brighten a subset.
function iri(base, k, t, boost) {
  const hue = (base + k * 55 + t * 40) % 360
  const band = 0.5 + 0.5 * Math.sin(k * 0.6 - t * 2)
  const sat = 70 + 25 * params.iridescence * band
  const light = 55 + 22 * band * (0.5 + boost)
  const a = 0.4 + 0.55 * band * Math.min(1, params.iridescence)
  return `hsla(${hue}, ${sat}%, ${light}%, ${a})`
}

// pore ring drawing shared by the centric body and the round parts of others
function pores(cx, cy, R, t, rings, base) {
  const boost = params.glow
  for (let ring = 1; ring <= rings; ring++) {
    const rr = (ring / rings) * R
    const count = Math.max(6, Math.floor(ring * 6))
    for (let j = 0; j < count; j++) {
      const th = (j / count) * Math.PI * 2 + ring * 0.4
      const x = cx + Math.cos(th) * rr
      const y = cy + Math.sin(th) * rr
      const pr = (0.9 + 0.5 * (ring / rings)) * S
      ctx.fillStyle = iri(base, ring + j * 0.15, t, boost)
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fill()
    }
  }
}

function drawDiatom(d, t) {
  const cx = d.x * W, cy = d.y * H
  const R = d.r * S * params.scale
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(d.rot)
  ctx.globalCompositeOperation = 'lighter'
  const base = params.hue + d.phase * 30

  if (d.kind === 'centric') {
    // glassy disc rim
    ctx.strokeStyle = `hsla(${params.hue}, 40%, 82%, 0.5)`
    ctx.lineWidth = 2.2 * S
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke()
    // phyllotaxis sunflower of pores + concentric rings
    const n = Math.floor(R * 3)
    const c = R / Math.sqrt(n)
    for (let i = 0; i < n; i++) {
      const rr = c * Math.sqrt(i)
      const th = i * GOLD + d.phase
      const x = Math.cos(th) * rr, y = Math.sin(th) * rr
      ctx.fillStyle = iri(base, i * 0.03 + rr * 0.05, t, params.glow)
      ctx.beginPath(); ctx.arc(x, y, 1.1 * S, 0, Math.PI * 2); ctx.fill()
    }
    pores(0, 0, R * 0.98, t, 7, base)
    ctx.fillStyle = `hsla(${params.hue}, 30%, 90%, 0.6)`
    ctx.beginPath(); ctx.arc(0, 0, 2.5 * S, 0, Math.PI * 2); ctx.fill()
  } else if (d.kind === 'triangular') {
    triacentric(R, t, base)
  } else {
    // pennate / oval: an elongated boat with a central raphe and cross-ribs
    const a = R, b = R / d.elong
    ctx.strokeStyle = `hsla(${params.hue}, 40%, 82%, 0.5)`
    ctx.lineWidth = 2 * S
    ctx.beginPath(); ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2); ctx.stroke()
    const ribs = Math.floor(a / (5 * S))
    for (let i = -ribs; i <= ribs; i++) {
      const fx = i / ribs
      const x = fx * a * 0.95
      const hh = b * Math.sqrt(Math.max(0, 1 - fx * fx)) * 0.9
      // a row of pores up each rib, iridescent
      const steps = Math.max(2, Math.floor(hh / (3 * S)))
      for (let s = -steps; s <= steps; s++) {
        if (s === 0) continue
        const y = (s / steps) * hh
        ctx.fillStyle = iri(base, i * 0.4 + s * 0.2, t, params.glow)
        ctx.beginPath(); ctx.arc(x, y, 1 * S, 0, Math.PI * 2); ctx.fill()
      }
    }
    // raphe line down the middle
    ctx.strokeStyle = `hsla(${params.hue}, 50%, 88%, 0.5)`
    ctx.lineWidth = 1.4 * S
    ctx.beginPath(); ctx.moveTo(-a * 0.9, 0); ctx.lineTo(a * 0.9, 0); ctx.stroke()
  }
  ctx.restore()
}

// a rounded-triangle centric diatom (like the top-left cell in the reference)
function triacentric(R, t, base) {
  ctx.strokeStyle = `hsla(${params.hue}, 40%, 82%, 0.5)`
  ctx.lineWidth = 2.2 * S
  ctx.beginPath()
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2
    // superellipse-ish rounded triangle
    const rr = R * (0.86 + 0.14 * Math.cos(3 * a))
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath(); ctx.stroke()
  const n = Math.floor(R * 2.2)
  const c = R / Math.sqrt(n)
  for (let i = 0; i < n; i++) {
    const rr = c * Math.sqrt(i)
    const th = i * GOLD
    let x = Math.cos(th) * rr, y = Math.sin(th) * rr
    const a = Math.atan2(y, x)
    const bound = R * (0.82 + 0.14 * Math.cos(3 * a))
    if (rr > bound) continue
    ctx.fillStyle = iri(base, i * 0.04, t, params.glow)
    ctx.beginPath(); ctx.arc(x, y, 1.1 * S, 0, Math.PI * 2); ctx.fill()
  }
}

function drawAlga(g, t) {
  const cx = g.x * W, cy = g.y * H
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(g.rot + Math.sin(t * 0.3 + g.phase) * 0.1)
  ctx.globalCompositeOperation = 'lighter'
  if (g.desmid) {
    // a paired, waisted desmid cell (figure-eight) with a bright chloroplast
    const r = g.r * S * params.scale
    for (const s of [-1, 1]) {
      const gx = s * r * 0.8
      const grad = ctx.createRadialGradient(gx, 0, 0, gx, 0, r)
      grad.addColorStop(0, `hsla(${g.hue}, 75%, 60%, 0.85)`)
      grad.addColorStop(0.7, `hsla(${g.hue}, 70%, 42%, 0.5)`)
      grad.addColorStop(1, `hsla(${g.hue}, 70%, 30%, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.ellipse(gx, 0, r, r * 0.82, 0, 0, Math.PI * 2); ctx.fill()
    }
  } else {
    // a filament of stacked green cells that undulates like a live strand
    const len = g.len * S * params.scale
    const cw = len / g.cells
    for (let i = 0; i < g.cells; i++) {
      const fx = (i / (g.cells - 1) - 0.5) * len
      const fy = Math.sin(i * 0.7 + t * 1.5 + g.phase) * g.wobble * 6 * S
      const cr = cw * 0.5
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, cr)
      const lum = 46 + 14 * Math.sin(i * 1.3 + t)
      grad.addColorStop(0, `hsla(${g.hue}, 70%, ${lum + 14}%, 0.9)`)
      grad.addColorStop(1, `hsla(${g.hue}, 70%, ${lum}%, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.ellipse(fx, fy, cr, cr * 0.8, 0, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.restore()
}

function drawBacterium(b, t) {
  const cx = b.x * W, cy = b.y * H
  const r = b.r * S * params.scale
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(b.rot)
  ctx.globalCompositeOperation = 'lighter'
  const col = `hsla(${b.hue}, 55%, 62%, 0.7)`
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2)
  grad.addColorStop(0, `hsla(${b.hue}, 60%, 70%, 0.85)`)
  grad.addColorStop(1, `hsla(${b.hue}, 60%, 45%, 0)`)
  if (b.form === 'coccus') {
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  } else if (b.form === 'rod') {
    ctx.strokeStyle = col
    ctx.lineCap = 'round'
    ctx.lineWidth = r * 1.6
    ctx.beginPath(); ctx.moveTo(-r * b.len * 0.5, 0); ctx.lineTo(r * b.len * 0.5, 0); ctx.stroke()
  } else {
    // spirillum: a little corkscrew
    ctx.strokeStyle = col
    ctx.lineCap = 'round'
    ctx.lineWidth = r * 0.9
    ctx.beginPath()
    const L = r * b.len
    for (let i = 0; i <= 24; i++) {
      const f = i / 24
      const x = (f - 0.5) * L * 1.4
      const y = Math.sin(f * Math.PI * 4 + t * 3) * r * 1.3
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

// Brownian + drift: nudge each organism's velocity and wrap around the edges.
function move(o, t, speed, jit) {
  o.vx += (rt2(o.seed ?? o.phase ?? 0, t) - 0.5) * jit * 0.4
  o.vy += (rt2((o.seed ?? o.phase ?? 0) + 99, t) - 0.5) * jit * 0.4
  o.vx *= 0.94; o.vy *= 0.94
  o.x += (o.vx * speed) / W
  o.y += (o.vy * speed) / H
  if (o.x < -0.1) o.x += 1.2; if (o.x > 1.1) o.x -= 1.2
  if (o.y < -0.1) o.y += 1.2; if (o.y > 1.1) o.y -= 1.2
}
// cheap deterministic noise so movement is smooth but organism-specific
function rt2(s, t) {
  const v = Math.sin(s * 12.9898 + t * 1.7) * 43758.5453
  return v - Math.floor(v)
}

function drawBackground() {
  // deep watery slide, slightly vignetted
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2)
  const h = params.hue
  g.addColorStop(0, `hsl(${h}, 22%, 13%)`)
  g.addColorStop(1, `hsl(${h}, 30%, 7%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  for (const s of specks) {
    ctx.fillStyle = s.warm
      ? `hsla(35, 60%, 70%, ${s.a})`
      : `hsla(${h}, 15%, 85%, ${s.a})`
    ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * S + 0.4, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  if (signature() !== builtFor) build()

  drawBackground()

  const speed = params.drift
  const jit = params.jitter
  for (const g of algae) { move(g, t, speed * 0.4, jit * 0.2); drawAlga(g, t) }
  for (const d of diatoms) {
    move(d, t, speed * 0.25, jit * 0.1)
    d.rot += d.spin * 0.01
    drawDiatom(d, t)
  }
  for (const b of bacteria) {
    move(b, t, speed, jit)
    b.rot += b.spin * 0.01
    drawBacterium(b, t)
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => { resize() })
resize()
requestAnimationFrame(frame)
