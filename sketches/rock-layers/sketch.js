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
function smooth01(e0, e1, x) {
  let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
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

  const ledgeScale = 0.6 * params.ledges
  const lutIdx = (c) => {
    let k = (c / bandTotal * LUTN) | 0
    return k < 0 ? 0 : k >= LUTN ? LUTN - 1 : k
  }
  // Worley/cellular fracture: F2-F1 near zero traces cell boundaries, giving a
  // realistic branching polygonal joint network with natural Y-junctions. Cells
  // are stretched vertically (aspect) so joints tend sub-vertical between beds.
  // The grid wraps in X (cols) so cracks stay seamless across the tiling.
  function worley(x, y, cell, aspect, s) {
    const gx = x / cell, gy = y / (cell * aspect)
    const xi = Math.floor(gx), yi = Math.floor(gy)
    const cols = Math.max(1, Math.round(gw / cell))
    let f1 = 1e9, f2 = 1e9
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cxi = xi + ox, cyi = yi + oy
      const cxm = ((cxi % cols) + cols) % cols
      const fxp = cxi + hash2(cxm + s, cyi * 131 + s)
      const fyp = cyi + hash2(cxm + s + 17, cyi * 131 + s + 91)
      const dx = fxp - gx, dy = fyp - gy
      const dd = dx * dx + dy * dy
      if (dd < f1) { f2 = f1; f1 = dd } else if (dd < f2) { f2 = dd }
    }
    return Math.sqrt(f2) - Math.sqrt(f1)
  }
  const cellBig = Math.max(24, gh * 0.16)
  const cellSmall = Math.max(12, gh * 0.07)

  const N = gw * gh
  const htA = new Float32Array(N)
  const cA = new Float32Array(N)
  const crA = new Float32Array(N)
  const surfA = new Float32Array(N)

  // PASS 1 — height field (bumpy macro form + detail + ledges − crack notches),
  // strata coordinate (draped over the bumps), and the fracture field.
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // macro bumps: a few low-frequency octaves → big rolling lumps & hollows
      let macro = 0, ma = 1, mn = 0, mp = 2, mx = (x / gw) * 2, my = (y / gw) * 2
      for (let o = 0; o < 3; o++) { macro += ma * vnoise(mx + seed, my, mp); mn += ma; ma *= 0.5; mx *= 2; my *= 2; mp *= 2 }
      macro /= mn
      // finer surface detail on top of the bumps
      let det = 0, da = 1, dn = 0, dp = 14, dx2 = (x / gw) * 14, dy2 = (y / gw) * 14
      for (let o = 0; o < 4; o++) { det += da * vnoise(dx2 + seed + 3, dy2, dp); dn += da; da *= 0.5; dx2 *= 2; dy2 *= 2; dp *= 2 }
      det /= dn
      const surface = macro * 0.72 + det * 0.28
      // domain-warped strata coordinate (irregular folds), draped over the bumps
      let wsum = 0, wamp = 1, wn = 0, wper = 3, wx = (x / gw) * 3, wy = (y / gw) * 3
      for (let o = 0; o < 3; o++) { wsum += wamp * (vnoise(wx + seed + 50, wy + 50, wper) - 0.5); wn += wamp; wamp *= 0.55; wx *= 2; wy *= 2; wper *= 2 }
      const c = y * cPerPx + baseOffset + (wsum / wn * 3.2) * params.fold + (macro - 0.5) * 5.0
      // fracture network: chunky joints + finer cracks, gated into zones so the
      // face isn't cracked everywhere, with slightly varying width.
      const gate = smooth01(0.42, 0.62, macro) * 0.7 + 0.3
      const wide = 0.03 + 0.02 * vnoise((x / gw) * 6 + seed + 4, (y / gw) * 6, 6)
      let cr = (1 - smooth01(0, wide, worley(x, y, cellBig, 1.35, seed + 1))) * gate
      const fine = (1 - smooth01(0, wide * 0.6, worley(x, y, cellSmall, 1.5, seed + 2))) * gate * 0.7
      cr = Math.max(cr, fine) * params.cracks
      const i = y * gw + x
      cA[i] = c
      crA[i] = cr
      surfA[i] = surface
      htA[i] = surface * (0.9 * params.relief) + ledgeLUT[lutIdx(c)] * ledgeScale - cr * 0.32
    }
  }

  // PASS 2 — dual-scale bump shading (macro form + fine texture), strata colour,
  // laminations, grain and carved cracks.
  const img = pctx.createImageData(gw, gh)
  const d = img.data
  const warmR = 0.84 + params.light * 0.42, warmG = 0.84 + params.light * 0.24, warmB = 0.9 + (1 - params.light) * 0.12
  const st = Math.max(2, Math.round(gh * 0.006)) // wide stencil captures the big bumps
  const bMacro = 2.4 * params.relief, bMicro = 1.4 * params.relief
  const cl = (i) => i < 0 ? 0 : i >= N ? N - 1 : i
  for (let y = 0; y < gh; y++) {
    const yu = y > st ? -st : 0, yd = y < gh - st ? st : 0
    const i0 = y * gw
    for (let x = 0; x < gw; x++) {
      const i = i0 + x
      const xl = x > st ? x - st : 0, xr = x < gw - st ? x + st : gw - 1
      // macro slope from the wide stencil + fine slope from immediate neighbours
      let nx = (htA[i0 + xl] - htA[i0 + xr]) * bMacro + (htA[cl(i - 1)] - htA[cl(i + 1)]) * bMicro
      let ny = (htA[cl(i + yu * gw)] - htA[cl(i + yd * gw)]) * bMacro + (htA[cl(i - gw)] - htA[cl(i + gw)]) * bMicro
      let nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv
      let sh = nx * lx + ny * ly + nz * lz; if (sh < 0) sh = 0
      const lightF = 0.42 + 1.02 * sh
      const ao = 0.6 + 0.4 * surfA[i] // recesses/hollows sit in shadow → reads 3D

      const c = cA[i]
      const k = (c / bandTotal * LUTN) | 0
      const kk = k < 0 ? 0 : k >= LUTN ? LUTN - 1 : k
      const lam = 1 + (vnoise1(c * 5 + 13) - 0.5) * 0.16 * params.strata // fine bedding laminae
      const grain = 0.95 + 0.1 * hash2(x * 3 + seed, y * 3) // micro speckle
      const crackF = 1 - crA[i] * 0.8

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
