// Cable Knit — a panel of hand-knitted wool with Aran cable ropes. The fabric is
// drawn strand by strand: every bit of yarn is a rounded tube (a dark base stroke
// with a bright core), so it catches light like real wool. The ground is
// stockinette (rows of interlocking knit "V"s) or ribbing; each cable is a
// two-ply rope whose strands weave with a sine path — the back ply is drawn, then
// the front ply on top, so they cross over and under like a real cable. Purl
// "bump" gutters flank the cables so the ropes stand proud, and the whole piece
// scrolls slowly as if it is being knitted off the needles.
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

// Draw a length of yarn as a rounded tube: a dark base, a lighter core, and a
// thin specular sheen offset up-left toward the light.
function yarn(pts, width, dark, core, hi) {
  if (pts.length < 2) return
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const trace = (dx, dy) => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy)
    ctx.stroke()
  }
  ctx.strokeStyle = dark; ctx.lineWidth = width; trace(0, 0)
  ctx.strokeStyle = core; ctx.lineWidth = width * 0.6; trace(0, 0)
  if (params.sheen > 0.01) { ctx.strokeStyle = hi; ctx.lineWidth = width * 0.22; trace(-width * 0.16, -width * 0.16) }
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  const gauge = Math.round(params.gauge)
  const stitchW = W / gauge
  const rowH = stitchW * 0.72
  scrollPx += params.speed * dt * rowH * 3

  const hue = params.hue, sat = params.sat, lig = params.light
  const dark = hsl(hue, sat, lig - 16), core = hsl(hue, sat * 0.8, lig + 4)
  const hi = hsl(hue, sat * 0.5, Math.min(96, lig + 22 + params.sheen * 14))
  const wob = params.wobble

  // felted-wool ground so any gaps read as fabric, not black
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = hsl(hue, sat, lig - 8)
  ctx.fillRect(0, 0, W, H)

  // which stitch columns belong to a cable panel, and each cable's centre column
  const cw = Math.round(params.cableWidth)
  const every = Math.max(cw + 2, Math.round(params.cableEvery))
  const inCable = new Array(gauge).fill(0)   // 0 = ground, 1 = cable, 2 = purl gutter
  const cableCenters = []
  for (let c = Math.floor(every / 2); c < gauge; c += every) {
    cableCenters.push(c)
    const lo = c - Math.floor(cw / 2)
    for (let k = 0; k < cw; k++) if (lo + k >= 0 && lo + k < gauge) inCable[lo + k] = 1
    if (lo - 1 >= 0) inCable[lo - 1] = 2
    if (lo + cw < gauge) inCable[lo + cw] = 2
  }

  const baseW = stitchW * 0.24 * params.thickness   // ground yarn: thin so the V's read
  const subY = ((scrollPx % rowH) + rowH) % rowH
  const baseRow = Math.floor(scrollPx / rowH)
  const rows = Math.ceil(H / rowH) + 2

  // one knit "V" stitch: two legs from the top corners to a shared low point
  const knitV = (colX, y, jx, jy, w, d, co, h) => {
    const mx = colX + stitchW * 0.5 + jx, my = y + rowH * 1.02 + jy, ty = y + jy
    yarn([[colX + stitchW * 0.06 + jx, ty], [colX + stitchW * 0.28 + jx, y + rowH * 0.5], [mx, my]], w, d, co, h)
    yarn([[colX + stitchW * 0.94 + jx, ty], [colX + stitchW * 0.72 + jx, y + rowH * 0.5], [mx, my]], w, d, co, h)
  }
  const purlBump = (colX, y, jx, jy) => {
    const cx = colX + stitchW / 2 + jx, cy = y + rowH / 2 + jy
    yarn([[cx - stitchW * 0.34, cy], [cx + stitchW * 0.34, cy]], baseW * 0.92, hsl(hue, sat, lig - 22), hsl(hue, sat * 0.8, lig - 6), hi)
  }

  // --- ground stitches (skip cable columns; the cable draws its own stitches) ---
  for (let c = 0; c < gauge; c++) {
    if (inCable[c] === 1) continue
    const colX = c * stitchW
    const ribPurl = params.ground === 'Ribbing' && c % 2 === 1
    for (let r = -1; r < rows; r++) {
      const wr = baseRow + r
      const y = r * rowH - subY
      const jx = (hash(c, wr) - 0.5) * stitchW * 0.12 * wob
      const jy = (hash(c + 7, wr) - 0.5) * rowH * 0.1 * wob
      if (inCable[c] === 2 || ribPurl) purlBump(colX, y, jx, jy)
      else knitV(colX, y, jx, jy, baseW, dark, core, hi)
    }
  }

  // --- cables: the same knit stitches, but the column runs are split into two
  //     groups that weave across each other and cross over/under, exactly how a
  //     cable is worked. The front group is drawn last so it laps over. ---
  const cabDark = hsl(hue, sat, lig - 15), cabCore = hsl(hue, sat * 0.85, lig + 7)
  const cabHi = hsl(hue, sat * 0.5, Math.min(97, lig + 24 + params.sheen * 16))
  for (const c of cableCenters) {
    const lo = c - Math.floor(cw / 2)
    const half = Math.max(1, Math.round(cw / 2))
    const amp = (cw - half) * stitchW * 0.5   // how far each group slides sideways
    const ccx = c * stitchW + stitchW / 2
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineCap = 'round'; ctx.lineWidth = stitchW * cw * 0.72
    ctx.beginPath(); ctx.moveTo(ccx, 0); ctx.lineTo(ccx, H); ctx.stroke()
    for (let r = -1; r < rows; r++) {
      const wr = baseRow + r
      const y = r * rowH - subY
      const ph = wr * (TAU / Math.max(1, params.twist))
      const frontG = Math.cos(ph) >= 0 ? 0 : 1
      // draw the back group first, then the front group over it
      for (let pass = 0; pass < 2; pass++) {
        const g = pass === 0 ? 1 - frontG : frontG
        const sh = Math.sin(ph + g * Math.PI) * amp
        const j0 = g === 0 ? 0 : half, j1 = g === 0 ? half : cw
        for (let j = j0; j < j1; j++) {
          const colX = (lo + j) * stitchW + sh
          const jy = (hash(lo + j + 31, wr) - 0.5) * rowH * 0.08 * wob
          knitV(colX, y, 0, jy, baseW, cabDark, cabCore, cabHi)
        }
      }
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
