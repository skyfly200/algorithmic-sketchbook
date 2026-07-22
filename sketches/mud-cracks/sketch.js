// Mud Cracks — a drying mud flat that fractures into polygonal tiles. A cellular
// (Worley) fracture network, plus finer secondary cracks inside the big plates,
// is baked once into a distance field; each frame the dryness sets how wide/deep
// the cracks have opened. Cracks open progressively (regions dry at different
// rates), tiles curl at their edges (bump-shaded from the field gradient) and
// cast shadow into the gaps, and the mud shifts wet-brown → dusty tan. Drag to
// wet the surface and the cracks heal, then re-open as it dries again.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  dryness: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Dryness' },
  autoDry: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Drying cycle' },
  scale: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Tile size' },
  crackWidth: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Crack width' },
  curl: { value: 1, min: 0, max: 2, step: 0.05, label: 'Edge curl' },
  detail: { value: 1, min: 0, max: 2, step: 0.05, label: 'Fine cracks' },
  hue: { value: 27, min: 0, max: 45, step: 1, label: 'Mud hue' },
})
rt.mapInput('audio.level', 'dryness', 0.3)

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(gx, gy, per) {
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0
  const m = (a) => ((a % per) + per) % per
  const v00 = hash2(m(x0), y0), v10 = hash2(m(x0 + 1), y0)
  const v01 = hash2(m(x0), y0 + 1), v11 = hash2(m(x0 + 1), y0 + 1)
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = v00 + (v10 - v00) * ux, b = v01 + (v11 - v01) * ux
  return a + (b - a) * uy
}
function smooth01(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t) }
function hsl(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))
  return [f(0), f(8), f(4)]
}

let W = 0, H = 0, PR = 1
// render buffer (below device res, then upscaled) + baked static fields
let RW = 0, RH = 0, img = null, low = null, lctx = null
let edge = null   // distance to the nearest cell boundary (px) — small = crack
let tone = null   // per-pixel plate tone
let openF = null  // per-pixel "opens at this dryness" threshold → progressive cracking

// jittered-grid Worley: returns F2−F1 (edge distance, px) and the nearest cell hash
function worley(px, py, cell, seed) {
  const gx = px / cell, gy = py / cell
  const xi = Math.floor(gx), yi = Math.floor(gy)
  let f1 = 1e9, f2 = 1e9, id = 0
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cxi = xi + ox, cyi = yi + oy
    const fx = cxi + hash2(cxi + seed, cyi * 131 + seed)
    const fy = cyi + hash2(cxi + seed + 17, cyi * 131 + seed + 91)
    const dx = fx - gx, dy = fy - gy
    const dd = dx * dx + dy * dy
    if (dd < f1) { f2 = f1; f1 = dd; id = hash2(cxi * 92821 + seed, cyi * 53987 + seed) }
    else if (dd < f2) { f2 = dd }
  }
  return { e: (Math.sqrt(f2) - Math.sqrt(f1)) * cell, id }
}

function build() {
  const CAP = 900000
  RW = Math.round(window.innerWidth)
  RH = Math.round(window.innerHeight)
  const sc = Math.sqrt(CAP / (RW * RH)); if (sc < 1) { RW = Math.round(RW * sc); RH = Math.round(RH * sc) }
  low = document.createElement('canvas'); low.width = RW; low.height = RH
  lctx = low.getContext('2d'); img = lctx.createImageData(RW, RH)
  const N = RW * RH
  edge = new Float32Array(N); tone = new Float32Array(N); openF = new Float32Array(N)
  const seed = Math.floor(rt.random(0, 90000))
  const big = Math.max(24, RH * 0.14 / params.scale)
  const small = big * 0.42
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const i = y * RW + x
      const b = worley(x, y, big, seed)
      const s = worley(x, y, small, seed + 7)
      // primary plate boundaries, plus finer secondary cracks inside the plates
      edge[i] = Math.min(b.e, s.e / (0.5 + params.detail))
      tone[i] = 0.5 + (b.id - 0.5) * 0.6
      // regions dry (and so crack) at different times → progressive fracturing
      openF[i] = vnoise((x / RW) * 3 + seed + 3, (y / RH) * 3, 3) * 0.7
    }
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

const wet = { x: -1e9, y: -1e9, amt: 0 }
function wetAt(e) {
  wet.x = (e.clientX / window.innerWidth) * RW
  wet.y = (e.clientY / window.innerHeight) * RH
  wet.amt = 1
}
window.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') wetAt(e) })
window.addEventListener('pointerdown', wetAt)

let sig = '', pending = null, pendingAt = 0
function paramSig() { return [params.scale, params.detail].join(',') }

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  // rebuild the baked field only when the geometry params change (debounced)
  const s = paramSig()
  if (s !== sig) { if (pending !== s) { pending = s; pendingAt = now } else if (now - pendingAt > 200) { build(); sig = s; pending = null } }

  // global dryness with an optional slow wet↔dry cycle
  let dry = params.dryness
  if (params.autoDry > 0.01) dry = Math.max(0, Math.min(1, dry + Math.sin(t * params.autoDry * 0.3) * 0.4))
  wet.amt = Math.max(0, wet.amt - 0.012)

  const hue = params.hue
  const cwMax = (RH * 0.02) * params.crackWidth
  const curl = params.curl
  const d = img.data
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const i = y * RW + x
      // local dryness: a dragged wet spot re-moistens the nearby ground
      let ldry = dry
      if (wet.amt > 0.01) {
        const dd = Math.hypot(x - wet.x, y - wet.y)
        ldry = Math.max(0, ldry - wet.amt * Math.max(0, 1 - dd / (RH * 0.18)))
      }
      // has this spot's crack opened yet, and how wide?
      const opened = smooth01(openF[i], openF[i] + 0.15, ldry)
      const cw = cwMax * (0.25 + ldry * 0.9) * opened
      const e = edge[i]
      const crack = 1 - smooth01(cw * 0.5, cw + 1, e) // 1 deep in crack → 0 on the plate

      // plate colour: wet = dark rich brown, dry = pale dusty tan
      const lig = (18 + ldry * 26) * (0.85 + tone[i] * 0.3)
      const sat = 45 - ldry * 22
      // edge curl / bevel: shade from the gradient of the edge field so plate
      // rims catch light on one side and fall into shadow toward the crack
      const eL = x > 0 ? edge[i - 1] : e, eR = x < RW - 1 ? edge[i + 1] : e
      const eU = y > 0 ? edge[i - RW] : e, eD = y < RH - 1 ? edge[i + RW] : e
      const bevel = (-(eR - eL) * 0.6 - (eD - eU) * 0.7) * curl * opened // lit upper-left
      const rim = smooth01(cw, cw + RH * 0.02, e) // only near the crack lip

      let L = lig + bevel * 14 * rim
      L = Math.max(4, Math.min(70, L))
      let [r, g, b] = hsl(hue, sat, L)
      const darken = 1 - crack * (0.82 + ldry * 0.12) // recessed, damp shadow in the crack
      r *= darken; g *= darken; b *= darken
      const p = i * 4
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255
    }
  }
  lctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(low, 0, 0, W, H)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
