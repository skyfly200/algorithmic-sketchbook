// Rock Layers — an extreme close-up of a weathered rock face, the camera panning
// slowly across it. The surface is a baked procedural relief: a fractal-noise
// height field lit as a real 3D bump, with subtle irregular striations (bedding
// domain-warped so it never reads as regular waves), fracture cracks, and hard
// beds that jut out as shadow-casting ledges. The whole panel is tileable, so
// the pan scrolls seamlessly forever; heavy generation is baked once and only
// rebuilt (debounced) when a look param changes, keeping the pan buttery.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  strata: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Bed thickness' },
  fold: { value: 1, min: 0, max: 2, step: 0.05, label: 'Warping' },
  relief: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Surface relief' },
  cracks: { value: 1, min: 0, max: 2, step: 0.05, label: 'Cracks' },
  ledges: { value: 1, min: 0, max: 2, step: 0.05, label: 'Ledges' },
  pan: { value: 0.5, min: -2, max: 2, step: 0.05, label: 'Pan speed' },
  drift: { value: 0.15, min: -1, max: 1, step: 0.02, label: 'Vertical drift' },
  light: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Light / warmth' },
})
rt.mapInput('audio.level', 'pan', 0.5)

// Sandstone / ironstone / siltstone palette — kept close in value so the bands
// read as subtle striations rather than bold stripes.
const PALETTE = [
  [176, 126, 88], [160, 108, 74], [190, 146, 104], [146, 100, 72], [200, 160, 116],
  [168, 116, 82], [182, 132, 94], [152, 104, 76], [194, 152, 110], [164, 112, 80],
  [178, 128, 90], [156, 108, 80], [186, 140, 100], [150, 102, 70],
]

// --- procedural noise (value noise, tileable in X so the panel wraps) --------
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function hash1(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4)
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15)
  return (n >>> 0) / 4294967296
}
function vnoise(gx, gy, per) {
  const x0 = Math.floor(gx), y0 = Math.floor(gy)
  const fx = gx - x0, fy = gy - y0
  const x0m = ((x0 % per) + per) % per, x1m = (((x0 + 1) % per) + per) % per
  const v00 = hash2(x0m, y0), v10 = hash2(x1m, y0)
  const v01 = hash2(x0m, y0 + 1), v11 = hash2(x1m, y0 + 1)
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = v00 + (v10 - v00) * ux, b = v01 + (v11 - v01) * ux
  return a + (b - a) * uy
}
function vnoise1(x) {
  const x0 = Math.floor(x), fx = x - x0
  const a = hash1(x0), b = hash1(x0 + 1)
  return a + (b - a) * (fx * fx * (3 - 2 * fx))
}

let W = 0, H = 0, PR = 1
const panel = document.createElement('canvas')
const pctx = panel.getContext('2d')
let genW = 0, genH = 0, cPerPx = 0.02, bandTotal = 1

const LUTN = 1024
const colorLUT = new Float32Array(LUTN * 3)
const ledgeLUT = new Float32Array(LUTN)

// L = light direction for the bump shading (raking from the upper-left).
const Lx = -0.45, Ly = -0.52, Lz = 0.62
const iL = 1 / Math.hypot(Lx, Ly, Lz)
const lx = Lx * iL, ly = Ly * iL, lz = Lz * iL

function buildPanel() {
  // panel size: a few screens wide (so the tiling period is off-screen), capped
  // in total pixels to keep the one-time bake fast. Generated in CSS px.
  const CAP = 2600000
  let gw = Math.round(window.innerWidth * 2.4)
  let gh = Math.round(window.innerHeight * 1.3)
  const sc = Math.sqrt(CAP / (gw * gh))
  if (sc < 1) { gw = Math.round(gw * sc); gh = Math.round(gh * sc) }
  genW = gw; genH = gh
  panel.width = gw; panel.height = gh
  const seed = Math.floor(rt.random(0, 90000))

  // irregular stack of beds: random thickness, random palette pick, some hard
  // beds flagged as ledges.
  const bands = []
  let cAcc = 0
  for (let i = 0; i < 70; i++) {
    const th = rt.random(0.45, 2.0)
    const base = PALETTE[(rt.rng() * PALETTE.length) | 0]
    const v = rt.random(-9, 9)
    const ledge = rt.rng() < 0.32 ? rt.random(0.5, 1) : 0
    bands.push({ c0: cAcc, c1: cAcc + th, col: [base[0] + v, base[1] + v * 0.8, base[2] + v * 0.6], ledge })
    cAcc += th
  }
  bandTotal = cAcc
  const avgTh = bandTotal / bands.length
  const targetBands = 20 / params.strata
  cPerPx = (avgTh * targetBands) / gh
  const baseOffset = 6 // keeps the strata coordinate positive under warping

  // colour LUT with soft boundary blends (subtle transitions, not hard lines)
  {
    let bi = 0
    for (let k = 0; k < LUTN; k++) {
      const c = (k / LUTN) * bandTotal
      while (bi < bands.length - 1 && c >= bands[bi].c1) bi++
      const b = bands[bi]
      let r = b.col[0], g = b.col[1], bl = b.col[2]
      const trans = 0.2
      const dTop = c - b.c0, dBot = b.c1 - c
      if (dTop < trans && bi > 0) {
        const f = 0.5 - 0.5 * (dTop / trans), n = bands[bi - 1].col
        r += (n[0] - r) * f; g += (n[1] - g) * f; bl += (n[2] - bl) * f
      } else if (dBot < trans && bi < bands.length - 1) {
        const f = 0.5 - 0.5 * (dBot / trans), n = bands[bi + 1].col
        r += (n[0] - r) * f; g += (n[1] - g) * f; bl += (n[2] - bl) * f
      }
      colorLUT[k * 3] = r; colorLUT[k * 3 + 1] = g; colorLUT[k * 3 + 2] = bl
    }
  }
  // ledge LUT: a raised lip at each hard bed's top edge → the bump shading turns
  // it into a shelf with a lit top and a shadowed overhang beneath.
  {
    for (let k = 0; k < LUTN; k++) {
      const c = (k / LUTN) * bandTotal
      let h = 0
      for (const b of bands) {
        if (!b.ledge) continue
        const d = c - b.c0
        if (d > -1 && d < 1) h += b.ledge * Math.exp(-Math.pow((d + 0.12) / 0.4, 2))
      }
      ledgeLUT[k] = h
    }
  }

  const heightAmp = 0.7 * params.relief
  const ledgeScale = 0.6 * params.ledges
  const lutIdx = (c) => {
    let k = (c / bandTotal * LUTN) | 0
    return k < 0 ? 0 : k >= LUTN ? LUTN - 1 : k
  }
  // ridged fracture field → thin dark cracks (joints + finer hairlines)
  const ridge = (x, y, F, s) => Math.abs(vnoise((x / gw) * F + s, (y / gw) * F + s * 0.5, F) * 2 - 1)

  const N = gw * gh
  const htA = new Float32Array(N)
  const cA = new Float32Array(N)
  const crA = new Float32Array(N)

  // PASS 1 — height field (incl. ledges & crack notches), strata coord, cracks
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // fractal height
      let base = 0, amp = 1, norm = 0, per = 8, sx = (x / gw) * 8, sy = (y / gw) * 8
      for (let o = 0; o < 5; o++) { base += amp * vnoise(sx + seed, sy, per); norm += amp; amp *= 0.5; sx *= 2; sy *= 2; per *= 2 }
      base /= norm
      // domain-warped strata coordinate (irregular folds, no visible sine)
      let wsum = 0, wamp = 1, wn = 0, wper = 3, wx = (x / gw) * 3, wy = (y / gw) * 3
      for (let o = 0; o < 3; o++) { wsum += wamp * (vnoise(wx + seed + 50, wy + 50, wper) - 0.5); wn += wamp; wamp *= 0.55; wx *= 2; wy *= 2; wper *= 2 }
      const warp2 = vnoise((x / gw) * 9 + seed + 9, (y / gw) * 9, 9) - 0.5
      const c = y * cPerPx + baseOffset + (wsum / wn * 3.2 + warp2 * 0.8) * params.fold
      // cracks
      let cr = 0
      const r1 = ridge(x, y, 5, seed + 1)
      if (r1 < 0.04) cr = 1 - r1 / 0.04
      const r2 = ridge(x, y, 12, seed + 2)
      if (r2 < 0.028) cr = Math.max(cr, (1 - r2 / 0.028) * 0.75)
      cr *= params.cracks
      const i = y * gw + x
      cA[i] = c
      crA[i] = cr
      htA[i] = base * heightAmp + ledgeLUT[lutIdx(c)] * ledgeScale - cr * 0.14
    }
  }

  // PASS 2 — shade from normals, colour from strata + laminations + grain + cracks
  const img = pctx.createImageData(gw, gh)
  const d = img.data
  const warmR = 0.84 + params.light * 0.42, warmG = 0.84 + params.light * 0.24, warmB = 0.9 + (1 - params.light) * 0.12
  const bump = 3.0 * params.relief
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const hL = x > 0 ? htA[i - 1] : htA[i], hR = x < gw - 1 ? htA[i + 1] : htA[i]
      const hU = y > 0 ? htA[i - gw] : htA[i], hD = y < gh - 1 ? htA[i + gw] : htA[i]
      let nx = (hL - hR) * bump, ny = (hU - hD) * bump, nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv
      let sh = nx * lx + ny * ly + nz * lz; if (sh < 0) sh = 0
      const lightF = 0.5 + 0.95 * sh
      const ao = 0.72 + 0.28 * htA[i]

      const c = cA[i]
      const k = (c / bandTotal * LUTN) | 0
      const kk = k < 0 ? 0 : k >= LUTN ? LUTN - 1 : k
      const lam = 1 + (vnoise1(c * 5 + 13) - 0.5) * 0.16 * params.strata // fine bedding laminae
      const grain = 0.95 + 0.1 * hash2(x * 3 + seed, y * 3) // micro speckle
      const crackF = 1 - crA[i] * 0.72

      const f = lightF * ao * lam * grain * crackF
      let r = colorLUT[kk * 3] * f * warmR
      let g = colorLUT[kk * 3 + 1] * f * warmG
      let b = colorLUT[kk * 3 + 2] * f * warmB
      const p = i * 4
      d[p] = r > 255 ? 255 : r; d[p + 1] = g > 255 ? 255 : g; d[p + 2] = b > 255 ? 255 : b; d[p + 3] = 255
    }
  }
  pctx.putImageData(img, 0, 0)
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  buildPanel()
}

let last = 0, camX = 0, camY = 0
let sig = '', pendingSig = null, pendingAt = 0
function paramSig() { return [params.strata, params.fold, params.relief, params.cracks, params.ledges, params.light].join(',') }

function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now

  // debounced rebuild of the baked panel when a look param changes; pan stays live
  const s = paramSig()
  if (s !== sig) {
    if (pendingSig !== s) { pendingSig = s; pendingAt = now }
    else if (now - pendingAt > 220) { buildPanel(); sig = s; pendingSig = null }
  }

  // moving window over the tileable panel
  let winH = genH * 0.8
  let winW = winH * (W / H)
  if (winW > genW) { winW = genW; winH = winW * (H / W) }
  camX += params.pan * winW * 0.05 * dt
  camY += params.drift * 0.25 * dt
  const sx = ((camX % genW) + genW) % genW
  const sy = (genH - winH) * (0.5 + 0.48 * Math.sin(camY))

  ctx.imageSmoothingEnabled = true
  const scale = W / winW
  const w1 = Math.min(winW, genW - sx)
  ctx.drawImage(panel, sx, sy, w1, winH, 0, 0, w1 * scale, H)
  if (w1 < winW) {
    const w2 = winW - w1
    ctx.drawImage(panel, 0, sy, w2, winH, w1 * scale, 0, w2 * scale, H)
  }

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
