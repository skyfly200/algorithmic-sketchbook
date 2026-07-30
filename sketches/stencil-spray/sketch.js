// Stencil Spray — airbrushed card-suit stencils.
//
// Each suit (heart, spade, club, diamond, sparkle) is rasterised once into a
// signed distance field. A spray halo is a function of that distance: densest
// right at the stencil edge and feathering outward, so the suit reads as clean
// negative space punched out of a cloud of paint on grainy paper. Because we
// hold real distance fields we can crossfade two suits by lerping their SDFs,
// giving a smooth morph from one symbol to the next. Beat pulses can bloom the
// spray. Everything (colours, halo width, grain, cycle) is a live param.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  autoCycle: { value: true, type: 'bool', label: 'auto cycle' },
  shape: { value: 0, min: 0, max: 11, step: 1, label: 'shape (manual)' },
  order: { value: 'In order', type: 'select', options: ['In order', 'Random'], label: 'cycle order' },
  transition: { value: 'Morph', type: 'select', options: ['Morph', 'Cut'], label: 'transition' },
  cycle: { value: 0.18, min: 0.02, max: 0.8, step: 0.01, label: 'cycle speed' },
  size: { value: 1.0, min: 0.5, max: 1.8, step: 0.01, label: 'stencil size' },
  spray: { value: 0.34, min: 0.05, max: 1.0, step: 0.01, label: 'halo width' },
  edge: { value: 0.16, min: 0.02, max: 0.6, step: 0.01, label: 'edge softness' },
  grain: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'spray grain' },
  fill: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'inside glow' },
  burn: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'core burn' },
  spin: { value: 0.0, min: -0.6, max: 0.6, step: 0.01, label: 'spin' },
  sprayHue: { value: 335, min: 0, max: 360, step: 1, label: 'spray hue' },
  spraySat: { value: 92, min: 0, max: 100, step: 1, label: 'spray sat' },
  bgHue: { value: 18, min: 0, max: 360, step: 1, label: 'paper hue A' },
  bgHue2: { value: 46, min: 0, max: 360, step: 1, label: 'paper hue B' },
  bgLight: { value: 52, min: 10, max: 90, step: 1, label: 'paper light' },
  paper: { value: 0.28, min: 0, max: 0.8, step: 0.01, label: 'paper grain' },
  pulse: { value: 0.5, min: 0, max: 1.5, step: 0.01, label: 'beat bloom' },
})
rt.mapInput('beat.pulse', 'pulse', 0.0) // opt-in; user can raise it

// ------------------------------------------------------------------- shapes
// Each draws a filled white silhouette centred in a GRID×GRID context, sized by
// `s` (half-extent in px). Unions of primitives keep the paths simple. The set
// is generic — card suits plus stars, a crescent, a flower, a bolt and a few
// polygons — and the sketch morphs/cuts between any of them.
const SHAPES = [
  'heart', 'spade', 'club', 'diamond', 'sparkle',
  'star', 'crescent', 'flower', 'bolt', 'hexagon', 'triangle', 'drop',
]

function drawHeart(c, cx, cy, s, flip = 1) {
  // two lobes + a triangle down to the point
  const lr = s * 0.56
  const ly = cy - flip * s * 0.28
  c.beginPath()
  c.arc(cx - s * 0.5, ly, lr, 0, Math.PI * 2)
  c.arc(cx + s * 0.5, ly, lr, 0, Math.PI * 2)
  c.fill()
  c.beginPath()
  c.moveTo(cx - s * 1.02, ly + flip * lr * 0.15)
  c.lineTo(cx + s * 1.02, ly + flip * lr * 0.15)
  c.lineTo(cx, cy + flip * s * 1.05)
  c.closePath()
  c.fill()
}
function drawStem(c, cx, cy, s) {
  // the little flared foot under a spade / club
  c.beginPath()
  c.moveTo(cx - s * 0.12, cy + s * 0.35)
  c.lineTo(cx + s * 0.12, cy + s * 0.35)
  c.lineTo(cx + s * 0.42, cy + s * 1.0)
  c.lineTo(cx - s * 0.42, cy + s * 1.0)
  c.closePath()
  c.fill()
}
// n-pointed star / sparkle: `pts` points alternating outer/inner radius.
function drawStar(c, cx, cy, s, pts, outR, inR) {
  c.beginPath()
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? s * outR : s * inR
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
  }
  c.closePath()
  c.fill()
}
function drawPoly(c, cx, cy, s, sides, rot = -Math.PI / 2) {
  c.beginPath()
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
  }
  c.closePath()
  c.fill()
}
function drawShape(c, name, cx, cy, s) {
  c.fillStyle = '#fff'
  if (name === 'heart') {
    drawHeart(c, cx, cy, s, 1)
  } else if (name === 'spade') {
    drawHeart(c, cx, cy - s * 0.08, s, -1) // heart pointing up
    drawStem(c, cx, cy + s * 0.35, s * 0.9)
  } else if (name === 'club') {
    const r = s * 0.44
    c.beginPath()
    c.arc(cx, cy - s * 0.42, r, 0, Math.PI * 2)
    c.arc(cx - s * 0.5, cy + s * 0.1, r, 0, Math.PI * 2)
    c.arc(cx + s * 0.5, cy + s * 0.1, r, 0, Math.PI * 2)
    c.fill()
    drawStem(c, cx, cy + s * 0.3, s * 0.95)
  } else if (name === 'diamond') {
    c.beginPath()
    c.moveTo(cx, cy - s * 1.05)
    c.lineTo(cx + s * 0.72, cy)
    c.lineTo(cx, cy + s * 1.05)
    c.lineTo(cx - s * 0.72, cy)
    c.closePath()
    c.fill()
  } else if (name === 'sparkle') {
    drawStar(c, cx, cy, s, 4, 1.05, 0.28) // four-point sparkle, deep notches
  } else if (name === 'star') {
    drawStar(c, cx, cy, s, 5, 1.05, 0.46) // classic five-point star
  } else if (name === 'crescent') {
    // outer disc minus an offset disc → a crescent (even-odd fill)
    c.beginPath()
    c.arc(cx, cy, s * 0.95, 0, Math.PI * 2)
    c.arc(cx + s * 0.42, cy - s * 0.04, s * 0.82, 0, Math.PI * 2)
    c.fill('evenodd')
  } else if (name === 'flower') {
    // a ring of petals around a centre — union of overlapping discs
    const petals = 6, pr = s * 0.46
    c.beginPath()
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * Math.PI * 2
      c.moveTo(cx + Math.cos(a) * s * 0.52 + pr, cy + Math.sin(a) * s * 0.52)
      c.arc(cx + Math.cos(a) * s * 0.52, cy + Math.sin(a) * s * 0.52, pr, 0, Math.PI * 2)
    }
    c.moveTo(cx + s * 0.5, cy); c.arc(cx, cy, s * 0.5, 0, Math.PI * 2)
    c.fill()
  } else if (name === 'bolt') {
    // a lightning bolt zig-zag
    const p = [[-0.1, -1.02], [0.4, -1.02], [-0.02, -0.12], [0.34, -0.12], [-0.4, 1.02], [-0.04, 0.1], [-0.46, 0.1]]
    c.beginPath()
    p.forEach(([x, y], i) => (i ? c.lineTo(cx + x * s, cy + y * s) : c.moveTo(cx + x * s, cy + y * s)))
    c.closePath()
    c.fill()
  } else if (name === 'hexagon') {
    drawPoly(c, cx, cy, s * 1.02, 6, 0)
  } else if (name === 'triangle') {
    drawPoly(c, cx, cy, s * 1.05, 3)
  } else if (name === 'drop') {
    // a teardrop: pointed at the top, round at the bottom
    c.beginPath()
    c.moveTo(cx, cy - s * 1.0)
    c.bezierCurveTo(cx + s * 0.92, cy - s * 0.12, cx + s * 0.72, cy + s * 0.98, cx, cy + s * 0.98)
    c.bezierCurveTo(cx - s * 0.72, cy + s * 0.98, cx - s * 0.92, cy - s * 0.12, cx, cy - s * 1.0)
    c.closePath()
    c.fill()
  }
}

// -------------------------------------------------------------- distance field
// Felzenszwalb 1-D squared distance transform.
function edt1d(f, n, d, v, z) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}
function edt2d(grid, W, H) {
  // grid: Float64Array, 0 = seed, Infinity elsewhere -> squared distance
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x]
    edt1d(f, H, d, v, z)
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x]
    edt1d(f, W, d, v, z)
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x]
  }
}
// Signed distance (px): +outside, -inside.
function buildSDF(name, G) {
  const off = document.createElement('canvas')
  off.width = off.height = G
  const c = off.getContext('2d')
  c.clearRect(0, 0, G, G)
  drawShape(c, name, G / 2, G / 2, G * 0.32)
  const px = c.getImageData(0, 0, G, G).data
  const inside = new Uint8Array(G * G)
  for (let i = 0; i < G * G; i++) inside[i] = px[i * 4 + 3] > 127 ? 1 : 0
  const fg = new Float64Array(G * G)
  const bg = new Float64Array(G * G)
  // NB: seed empty cells with a large *finite* value — Felzenszwalb's parabola
  // maths does f[q]-f[v] subtractions, and Infinity-Infinity would be NaN.
  const FAR = 1e12
  for (let i = 0; i < G * G; i++) {
    fg[i] = inside[i] ? 0 : FAR // dist to shape (for outside px)
    bg[i] = inside[i] ? FAR : 0 // dist to edge (for inside px)
  }
  edt2d(fg, G, G)
  edt2d(bg, G, G)
  const sdf = new Float32Array(G * G)
  for (let i = 0; i < G * G; i++) sdf[i] = Math.sqrt(fg[i]) - Math.sqrt(bg[i])
  return sdf
}

// --------------------------------------------------------------- render state
let G = 0
let sdfs = []
let grain = null // static per-cell noise, sampled with a rolling offset
let field = null
let fieldCtx = null
let img = null
let paperTile = null

function rebuild() {
  const want = Math.max(90, Math.min(190, Math.round(150 * rt.detail)))
  if (want === G) return
  G = want
  sdfs = SHAPES.map((s) => buildSDF(s, G))
  grain = new Float32Array(G * G)
  for (let i = 0; i < grain.length; i++) grain[i] = Math.random()
  field = document.createElement('canvas')
  field.width = field.height = G
  fieldCtx = field.getContext('2d')
  img = fieldCtx.createImageData(G, G)
  // paper grain tile (grey noise) reused every frame
  const P = 128
  paperTile = document.createElement('canvas')
  paperTile.width = paperTile.height = P
  const pc = paperTile.getContext('2d')
  const pim = pc.createImageData(P, P)
  for (let i = 0; i < P * P; i++) {
    const g = 128 + (Math.random() - 0.5) * 150
    pim.data[i * 4] = pim.data[i * 4 + 1] = pim.data[i * 4 + 2] = g
    pim.data[i * 4 + 3] = 255
  }
  pc.putImageData(pim, 0, 0)
}

function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360
  s /= 100
  v /= 100
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

// Generic shape-shifter: hold the current shape, then either morph or cut to a
// next shape chosen in order or at random. Two live distance fields (curIdx,
// nxtIdx) are lerped by `morphAmt`, so any shape can dissolve into any other.
let curIdx = 0
let nxtIdx = 1
let slotT = 0 // 0..1 progress through the current shape's slot
let prevNow = 0
function pickNext(cur) {
  if (params.order === 'Random' && SHAPES.length > 1) {
    let n
    do { n = Math.floor(Math.random() * SHAPES.length) } while (n === cur)
    return n
  }
  return (cur + 1) % SHAPES.length
}

function frame(now) {
  rt.tick(now)
  rebuild()
  const dt = Math.min(0.05, (now - prevNow) * 0.001 || 0.016)
  prevNow = now
  const W = canvas.width,
    H = canvas.height

  // --- paper background: warm gradient + reused grain tile ------------------
  const [ra, ga, ba] = hsv(params.bgHue, 40, params.bgLight)
  const [rb, gb, bb] = hsv(params.bgHue2, 46, params.bgLight * 0.82)
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, `rgb(${ra | 0},${ga | 0},${ba | 0})`)
  grad.addColorStop(1, `rgb(${rb | 0},${gb | 0},${bb | 0})`)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  if (params.paper > 0 && paperTile) {
    // tile 1:1 so the grain stays fine (a stretched draw gives coarse blocks)
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = params.paper
    ctx.fillStyle = ctx.createPattern(paperTile, 'repeat')
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // --- advance the shape-shifter -------------------------------------------
  const N = SHAPES.length
  const cut = params.transition === 'Cut'
  let m = 0
  if (params.autoCycle) {
    slotT += dt * params.cycle
    if (slotT >= 1) { slotT -= Math.floor(slotT); curIdx = nxtIdx; nxtIdx = pickNext(curIdx) }
    // Cut: hold the current shape, snap at the slot boundary. Morph: hold, then
    // cross-dissolve to the next over the last stretch of the slot.
    if (!cut) {
      const mt = Math.max(0, Math.min(1, (slotT - 0.55) / 0.4))
      m = mt * mt * (3 - 2 * mt)
    }
  } else {
    const target = ((Math.round(params.shape) % N) + N) % N
    nxtIdx = target
    if (cut || target === curIdx) {
      curIdx = target; slotT = 0; m = 0
    } else {
      slotT += dt * 3
      if (slotT >= 1) { curIdx = target; slotT = 0; m = 0 }
      else m = slotT * slotT * (3 - 2 * slotT)
    }
  }
  const a = sdfs[curIdx]
  const b = sdfs[nxtIdx]

  // --- spray field ----------------------------------------------------------
  const pulse = rt.beat.state.pulse * params.pulse
  const [sr, sg, sb] = hsv(params.sprayHue, params.spraySat, 100)
  const Wout = params.spray * G * 0.6 * (1 + pulse * 0.6) // halo falloff (px)
  const Win = Math.max(1.2, params.edge * G * 0.28) // inner leak (px)
  const grainAmt = params.grain
  const burn = params.burn
  const fillAmt = params.fill * (1 + pulse * 0.4)
  const goff = (Math.floor(now * 0.06) * 613) % grain.length // animate stipple
  const data = img.data
  const size = G * G
  for (let i = 0; i < size; i++) {
    const d = a[i] + (b[i] - a[i]) * m // morphed signed distance
    let al
    if (d >= 0) al = Math.exp(-d / Wout)
    else al = Math.exp(d / Win) // <1, sharp inner edge
    // inside glow (positive-stencil look): brighten toward centre
    if (fillAmt > 0 && d < 0) al = Math.max(al, fillAmt * Math.min(1, -d / (Wout * 0.9)))
    // stipple grain
    const gv = grain[(i + goff) % grain.length]
    al *= 1 - grainAmt * (1 - gv)
    if (al <= 0.003) {
      data[i * 4 + 3] = 0
      continue
    }
    if (al > 1) al = 1
    // densest paint burns darker at the core
    const k = 1 - burn * al * al
    data[i * 4] = sr * k
    data[i * 4 + 1] = sg * k
    data[i * 4 + 2] = sb * k
    data[i * 4 + 3] = al * 255
  }
  fieldCtx.putImageData(img, 0, 0)

  // --- composite the (upscaled, hence soft) spray over the paper -----------
  // square covers the viewport at size≈1 (suit fills the frame like the
  // reference); larger zooms in, smaller pulls back to a floating stencil
  const span = Math.max(W, H) * params.size * 1.05
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate(params.spin * now * 0.001)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(field, -span / 2, -span / 2, span, span)
  ctx.restore()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
