// Cable Knit — a panel of hand-knitted wool with Aran cable ropes. The fabric is
// drawn strand by strand: every bit of yarn is a rounded tube (a dark base stroke
// with a bright core), so it catches light like real wool. The ground is
// stockinette (rows of interlocking knit "V"s) or ribbing; each cable is a
// two-ply rope whose strands weave with a sine path — the back ply is drawn, then
// the front ply on top, so they cross over and under like a real cable. Purl
// "bump" gutters flank the cables so the ropes stand proud, and the whole piece
// scrolls slowly as if it is being knitted off the needles.
//
// Speed: nothing in the fabric changes as it scrolls, so it is laid out with a
// period of P rows (a whole number of cable twists, and a whole number of pixels
// tall) and baked once into a seamless tile; each frame just draws that tile at
// the scroll offset. The bake is redone only when a layout/colour param or the
// size changes; while one of those is being swept every frame the fabric is
// drawn directly, as before. Sheen (mapped to the audio pulse) is handled by
// baking two sheen levels and cross-fading between them.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  gauge: { value: 30, min: 10, max: 52, step: 1, label: 'Stitch gauge' },
  ground: { value: 'Stockinette', type: 'select', options: ['Stockinette', 'Ribbing'], label: 'Ground' },
  cableEvery: { value: 8, min: 4, max: 20, step: 1, label: 'Cable spacing' },
  cableWidth: { value: 4, min: 2, max: 8, step: 1, label: 'Cable width' },
  twist: { value: 5, min: 2, max: 12, step: 0.5, label: 'Cable twist' },
  speed: { value: 0.5, min: -2, max: 2, step: 0.05, label: 'Knit speed' },
  thickness: { value: 1, min: 0.6, max: 1.6, step: 0.05, label: 'Yarn weight' },
  sheen: { value: 0.6, min: 0, max: 1.2, step: 0.05, label: 'Wool sheen' },
  wobble: { value: 0.35, min: 0, max: 1, step: 0.05, label: 'Hand-knit wobble' },
  hue: { value: 24, min: 0, max: 360, step: 1, label: 'Yarn hue' },
  sat: { value: 26, min: 0, max: 80, step: 1, label: 'Yarn saturation' },
  light: { value: 62, min: 30, max: 85, step: 1, label: 'Yarn lightness' },
})
rt.mapInput('audio.pulse', 'sheen', 0.4)

const TAU = Math.PI * 2
const PERIOD_MIN = 24 // rows before the hand-knit wobble repeats
const STABLE_FRAMES = 10 // frames a layout must hold before it is baked
let W = 0, H = 0, PR = 1
let scrollPx = 0
let lastNow = 0

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}

const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360}, ${Math.max(0, Math.min(100, s))}%, ${Math.max(0, Math.min(100, l))}%)`
// stable per-stitch pseudo-noise for hand-knit irregularity
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s) }
const mod = (a, n) => ((a % n) + n) % n
const gcd = (a, b) => (b ? gcd(b, a % b) : a)

// Draw a length of yarn as a rounded tube: a dark base, a lighter core, and a
// thin specular sheen offset up-left toward the light.
function yarn(ctx, pts, width, dark, core, hi, sheen) {
  if (pts.length < 2) return
  const trace = (dx, dy) => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy)
    ctx.stroke()
  }
  ctx.strokeStyle = dark; ctx.lineWidth = width; trace(0, 0)
  ctx.strokeStyle = core; ctx.lineWidth = width * 0.6; trace(0, 0)
  if (sheen > 0.01) { ctx.strokeStyle = hi; ctx.lineWidth = width * 0.22; trace(-width * 0.16, -width * 0.16) }
}

// Layout shared by the direct and baked paths, rebuilt when its key changes.
let L = null
function getLayout() {
  const gauge = Math.round(params.gauge)
  const cw = Math.round(params.cableWidth)
  const every = Math.max(cw + 2, Math.round(params.cableEvery))
  const tw = Math.max(1, params.twist)
  const key = [W, H, gauge, params.ground, cw, every, tw, params.thickness, params.wobble, params.hue, params.sat, params.light].join('|')
  if (L && L.key === key) return L
  const stitchW = W / gauge
  // the cable's crossing pattern repeats every p0 rows (twist is in half rows)
  const k2 = Math.round(tw * 2)
  const p0 = Math.abs(tw * 2 - k2) < 1e-6 ? k2 / gcd(2, k2) : Math.max(1, Math.round(tw))
  const P = p0 * Math.ceil(PERIOD_MIN / p0)
  // shorter rows pack the knit tighter vertically; nudged (by < 1/P px) so P rows
  // are a whole number of pixels and the tile repeats seamlessly
  const T = Math.max(1, Math.round(P * stitchW * 0.6))
  const rowH = T / P
  // which stitch columns belong to a cable panel, and each cable's centre column
  const inCable = new Array(gauge).fill(0) // 0 = ground, 1 = cable, 2 = purl gutter
  const cableCenters = []
  for (let c = Math.floor(every / 2); c < gauge; c += every) {
    cableCenters.push(c)
    const lo = c - Math.floor(cw / 2)
    for (let q = 0; q < cw; q++) if (lo + q >= 0 && lo + q < gauge) inCable[lo + q] = 1
    if (lo - 1 >= 0) inCable[lo - 1] = 2
    if (lo + cw < gauge) inCable[lo + cw] = 2
  }
  L = { key, gauge, cw, tw, stitchW, rowH, P, T, inCable, cableCenters }
  return L
}

// Draw fabric rows r0..r1 (inclusive) with row wr at y = wr * rowH - y0. Row
// noise and cable phase use wr mod P, so the fabric is exactly P rows periodic.
function drawFabric(ctx, r0, r1, y0, sheen) {
  const { gauge, cw, tw, stitchW, rowH, P, inCable, cableCenters } = L
  const hue = params.hue, sat = params.sat, lig = params.light
  const dark = hsl(hue, sat, lig - 16), core = hsl(hue, sat * 0.8, lig + 4)
  const hi = hsl(hue, sat * 0.5, Math.min(96, lig + 22 + sheen * 14))
  const purlDark = hsl(hue, sat, lig - 22), purlCore = hsl(hue, sat * 0.8, lig - 6)
  const wob = params.wobble
  const baseW = stitchW * 0.54 * params.thickness // fat yarn so neighbouring stitches push together
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // one knit "V" stitch: two legs from the top corners to a shared low point
  const knitV = (colX, y, jx, jy, w, d, co, h) => {
    // legs reach the full cell width and the V dips into the row below, so
    // stitches interlock top-to-bottom with no gaps
    const mx = colX + stitchW * 0.5 + jx, my = y + rowH * 1.16 + jy, ty = y - rowH * 0.16 + jy
    yarn(ctx, [[colX - stitchW * 0.04 + jx, ty], [colX + stitchW * 0.28 + jx, y + rowH * 0.5], [mx, my]], w, d, co, h, sheen)
    yarn(ctx, [[colX + stitchW * 1.04 + jx, ty], [colX + stitchW * 0.72 + jx, y + rowH * 0.5], [mx, my]], w, d, co, h, sheen)
  }
  const purlBump = (colX, y, jx, jy) => {
    const cx = colX + stitchW / 2 + jx, cy = y + rowH / 2 + jy
    // full-cell-width bump so the purl gutter reads as solid wool, not gaps
    yarn(ctx, [[cx - stitchW * 0.52, cy], [cx + stitchW * 0.52, cy]], baseW * 1.15, purlDark, purlCore, hi, sheen)
  }

  // --- ground stitches. Cable columns get a static knit base too, so where the
  //     woven plies slide apart they reveal fabric, not black. ---
  for (let c = 0; c < gauge; c++) {
    const colX = c * stitchW
    const ribPurl = params.ground === 'Ribbing' && c % 2 === 1
    for (let wr = r0; wr <= r1; wr++) {
      const wm = mod(wr, P)
      const y = wr * rowH - y0
      const jx = (hash(c, wm) - 0.5) * stitchW * 0.12 * wob
      const jy = (hash(c + 7, wm) - 0.5) * rowH * 0.1 * wob
      if (inCable[c] === 2 || ribPurl) purlBump(colX, y, jx, jy)
      else knitV(colX, y, jx, jy, baseW, dark, core, hi)
    }
  }

  // --- cables: the same knit stitches, but the column runs are split into two
  //     groups that weave across each other and cross over/under, exactly how a
  //     cable is worked. The front group is drawn last so it laps over. ---
  const cabDark = hsl(hue, sat, lig - 15), cabCore = hsl(hue, sat * 0.85, lig + 7)
  const cabHi = hsl(hue, sat * 0.5, Math.min(97, lig + 24 + sheen * 16))
  for (const c of cableCenters) {
    const lo = c - Math.floor(cw / 2)
    const half = Math.max(1, Math.round(cw / 2))
    const amp = (cw - half) * stitchW * 0.5 // how far each group slides sideways
    // no flat backing — the ropes weave on black, so the gaps between the two
    // plies read as the shadow down the centre of a real cable
    for (let wr = r0; wr <= r1; wr++) {
      const wm = mod(wr, P)
      const y = wr * rowH - y0
      const ph = wm * (TAU / tw)
      const frontG = Math.cos(ph) >= 0 ? 0 : 1
      // draw the back group first, then the front group over it
      for (let pass = 0; pass < 2; pass++) {
        const g = pass === 0 ? 1 - frontG : frontG
        const sh = Math.sin(ph + g * Math.PI) * amp
        const j0 = g === 0 ? 0 : half, j1 = g === 0 ? half : cw
        for (let j = j0; j < j1; j++) {
          const colX = (lo + j) * stitchW + sh
          const jy = (hash(lo + j + 31, wm) - 0.5) * rowH * 0.08 * wob
          knitV(colX, y, 0, jy, baseW, cabDark, cabCore, cabHi)
        }
      }
    }
  }
}

// --- baked tiles: one P-row tile per sheen level, made at startup and resized
//     as needed (never created in the frame loop) ---
const tiles = [0, 1, 2].map(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  return { cv, ctx: cv.getContext('2d'), key: null, sheen: NaN, used: 0 }
})
let useClock = 0
function tileFor(sheen) {
  const hit = tiles.find((t) => t.key === L.key && t.sheen === sheen)
  if (hit) { hit.used = ++useClock; return hit }
  const t = tiles.reduce((a, b) => (a.key !== L.key ? a : b.key !== L.key ? b : a.used <= b.used ? a : b))
  if (t.cv.width !== W || t.cv.height !== L.T) { t.cv.width = W; t.cv.height = L.T }
  else t.ctx.clearRect(0, 0, W, L.T)
  t.ctx.fillStyle = '#000'
  t.ctx.fillRect(0, 0, W, L.T)
  // rows -2..P+1 cover every stitch that reaches into [0, T), in the same order
  // as a direct draw, so the tile's edges match its wrapped neighbours exactly
  drawFabric(t.ctx, -2, L.P + 1, 0, sheen)
  t.key = L.key; t.sheen = sheen; t.used = ++useClock
  return t
}
function blitTile(t, off, alpha) {
  ctx.globalAlpha = alpha
  for (let y = -off; y < H; y += L.T) ctx.drawImage(t.cv, 0, y)
  ctx.globalAlpha = 1
}

let lastKey = null, stable = 1e9, sweeping = false
const SHEEN_MAX = 1.2 // the param's max

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  getLayout()
  const rowH = L.rowH
  scrollPx += params.speed * dt * rowH * 3
  const spx = Math.round(scrollPx) // whole-pixel scroll keeps the tile crisp
  // a one-off change re-bakes at once; a second change within a few frames
  // means a param is being swept, so draw directly until it settles
  if (L.key !== lastKey) { sweeping = stable < STABLE_FRAMES; lastKey = L.key; stable = 0 } else stable++

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // black ground: the yarn is dense enough that only the deep interstices show,
  // reading as the shadow between stitches
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const sheen = params.sheen
  if (sweeping && stable < STABLE_FRAMES) {
    // layout is being swept: draw directly (rows as before: one above the top,
    // enough to pass the bottom edge)
    const baseRow = Math.floor(spx / rowH)
    const rows = Math.ceil(H / rowH) + 2
    drawFabric(ctx, baseRow - 1, baseRow + rows - 1, spx, sheen)
  } else {
    const off = mod(spx, L.T)
    if (sheen <= 0.01) blitTile(tileFor(0), off, 1)
    else {
      // the highlight colour is linear in sheen, so a cross-fade between two
      // baked sheen levels reproduces any level in between
      const base = rt.values.sheen
      const lo = Math.max(0.0101, Math.min(base, sheen))
      if (sheen - lo < 1e-4) blitTile(tileFor(lo), off, 1)
      else {
        const hiS = Math.max(SHEEN_MAX, sheen)
        const a = tileFor(lo), b = tileFor(hiS)
        blitTile(a, off, 1)
        blitTile(b, off, (sheen - lo) / (hiS - lo))
      }
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
