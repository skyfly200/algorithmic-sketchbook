/**
 * Gems — a slowly turning cluster of faceted mineral crystals: brassy pyrite
 * cubes, clear quartz points, amethyst, citrine, rose quartz, emerald, ruby,
 * sapphire, fluorite octahedra and diamond. Each crystal is a little polyhedron
 * built from its real habit (cube, hexagonal point, table, bipyramid or
 * octahedron), lit facet-by-facet with a fixed studio light so faces flash as
 * the druse rotates. Translucent stones let their back facets glow through;
 * pyrite reads as metal. Bright facets throw star glints that pulse on the beat.
 *
 * Variety, crystal count, cluster size, spin, light angle, facet contrast,
 * sparkle and glow are live. Turn on the mic and each beat flares the sparkle.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  variety: {
    value: 'Mixed', type: 'select', label: 'Gemstone',
    options: ['Mixed', 'Pyrite', 'Quartz', 'Amethyst', 'Citrine', 'Rose Quartz', 'Emerald', 'Ruby', 'Sapphire', 'Fluorite', 'Diamond'],
  },
  count: { value: 18, min: 5, max: 40, step: 1, label: 'Crystals' },
  size: { value: 1, min: 0.55, max: 1.7, step: 0.02, label: 'Cluster size' },
  spin: { value: 0.25, min: -1, max: 1, step: 0.02, label: 'Spin' },
  light: { value: 40, min: 0, max: 360, step: 1, label: 'Light angle' },
  facet: { value: 1, min: 0.4, max: 1.5, step: 0.02, label: 'Facet contrast' },
  sparkle: { value: 0.85, min: 0, max: 1.6, step: 0.02, label: 'Sparkle' },
  glow: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Glow' },
})
rt.mapInput('audio.level', 'sparkle', 0.6)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1

// --- tiny 3D helpers ---------------------------------------------------------
function subv(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function rotY(p, s, c) { return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c] }
function rotX(p, s, c) { return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c] }

// --- crystal habits (unit meshes, base seated at y = 0) ----------------------
function ring(y, r, n = 6, phase = 0) {
  const o = []
  for (let k = 0; k < n; k++) { const a = phase + (k / n) * TAU; o.push([Math.cos(a) * r, y, Math.sin(a) * r]) }
  return o
}
function seatBase(m) {
  let miny = Infinity
  for (const v of m.v) if (v[1] < miny) miny = v[1]
  for (const v of m.v) v[1] -= miny
  return m
}
function habitCube() {
  const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
  const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]]
  return seatBase({ v, f })
}
function habitOcta() {
  const v = [[1.15, 0, 0], [-1.15, 0, 0], [0, 1.5, 0], [0, -1.5, 0], [0, 0, 1.15], [0, 0, -1.15]]
  const f = [[2, 0, 4], [2, 4, 1], [2, 1, 5], [2, 5, 0], [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5]]
  return seatBase({ v, f })
}
// hexagonal prism + pyramidal termination (quartz-family point)
function habitPoint(body = 1.6, cap = 0.8, r = 0.62) {
  const bot = ring(0, r), top = ring(body, r), apex = [0, body + cap, 0]
  const v = [...bot, ...top, apex]
  const A = 12, f = []
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; f.push([i, j, 6 + j, 6 + i]) }   // sides
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; f.push([6 + i, 6 + j, A]) }        // termination
  f.push([0, 1, 2, 3, 4, 5])                                                              // base
  return seatBase({ v, f })
}
// hexagonal prism with a flat table (emerald / beryl)
function habitTable(body = 1.7, r = 0.72) {
  const bot = ring(0, r), top = ring(body, r)
  const v = [...bot, ...top], f = []
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; f.push([i, j, 6 + j, 6 + i]) }
  f.push([6, 7, 8, 9, 10, 11]); f.push([0, 1, 2, 3, 4, 5])
  return seatBase({ v, f })
}
// hexagonal bipyramid (ruby / sapphire)
function habitBipyr(h = 1.2, r = 0.8) {
  const mid = ring(h, r), top = [0, 2 * h, 0], botA = [0, 0, 0]
  const v = [...mid, top, botA], T = 6, B = 7, f = []
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; f.push([i, j, T]) }
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; f.push([j, i, B]) }
  return seatBase({ v, f })
}

const HABITS = {
  cube: habitCube(), octa: habitOcta(), point: habitPoint(),
  shortPoint: habitPoint(1.0, 0.7, 0.68), table: habitTable(), bipyr: habitBipyr(),
}
// index of the apex vertex for point habits (used to tint terminations)
const APEX_IDX = { point: 12, shortPoint: 12 }

// --- species: colour (0..1 rgb), habit, material -----------------------------
function C(r, g, b) { return [r, g, b] }
const SPECIES = {
  Pyrite: { habit: 'cube', col: C(0.95, 0.76, 0.24), alpha: 1, metal: 1, shin: 34, spec: C(1, 0.95, 0.65), striae: 1, sizeMul: 0.72 },
  Quartz: { habit: 'point', col: C(0.90, 0.94, 0.98), alpha: 0.66, metal: 0, shin: 90, spec: C(1, 1, 1), sizeMul: 1 },
  Amethyst: { habit: 'point', col: C(0.52, 0.32, 0.78), alpha: 0.7, metal: 0, shin: 80, spec: C(1, 0.95, 1), tip: C(0.36, 0.18, 0.62), sizeMul: 1 },
  Citrine: { habit: 'point', col: C(0.92, 0.66, 0.20), alpha: 0.72, metal: 0, shin: 78, spec: C(1, 0.98, 0.85), sizeMul: 0.98 },
  'Rose Quartz': { habit: 'shortPoint', col: C(0.93, 0.68, 0.74), alpha: 0.72, metal: 0, shin: 60, spec: C(1, 0.96, 0.97), sizeMul: 0.92 },
  Emerald: { habit: 'table', col: C(0.10, 0.68, 0.42), alpha: 0.74, metal: 0, shin: 70, spec: C(0.9, 1, 0.95), sizeMul: 0.92 },
  Ruby: { habit: 'bipyr', col: C(0.80, 0.14, 0.28), alpha: 0.8, metal: 0, shin: 84, spec: C(1, 0.92, 0.94), sizeMul: 0.9 },
  Sapphire: { habit: 'bipyr', col: C(0.18, 0.34, 0.82), alpha: 0.8, metal: 0, shin: 84, spec: C(0.92, 0.96, 1), sizeMul: 0.9 },
  Fluorite: { habit: 'octa', col: C(0.32, 0.72, 0.66), alpha: 0.72, metal: 0, shin: 66, spec: C(0.95, 1, 1), sizeMul: 0.95 },
  Diamond: { habit: 'octa', col: C(0.94, 0.96, 1.0), alpha: 0.6, metal: 0, shin: 120, spec: C(1, 1, 1), sizeMul: 0.82 },
}
const SPECIES_NAMES = Object.keys(SPECIES)

// --- cluster generation (seeded, stable across resizes) ----------------------
let crystals = []
let genSig = ''
function buildCluster() {
  const n = Math.round(params.count)
  genSig = n + '|' + params.variety + '|' + rt.seed
  crystals = []
  for (let i = 0; i < n; i++) {
    // seat each crystal on a shallow rocky mound and let it grow up-and-outward,
    // so the whole thing reads as a druse of crystals on their matrix
    const baseAz = rt.random(0, TAU)
    const baseR = Math.sqrt(rt.random(0, 1)) * 1.35
    const bx = Math.cos(baseAz) * baseR, bz = Math.sin(baseAz) * baseR
    const baseY = -0.7 + (1 - baseR / 1.35) * 0.45
    const pos = [bx, baseY, bz]
    // grow mostly up, tilted outward away from the centre + a little jitter
    const dir = norm([
      bx * 0.55 + rt.random(-0.3, 0.3),
      1.15 + rt.random(-0.2, 0.35),
      bz * 0.55 + rt.random(-0.3, 0.3),
    ])
    // orthonormal basis mapping local +y to dir
    const up = dir
    const a = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const right = norm(cross(a, up))
    const fwd = cross(up, right)
    const name = params.variety === 'Mixed' ? SPECIES_NAMES[(rt.rng() * SPECIES_NAMES.length) | 0] : params.variety
    const sp = SPECIES[name] || SPECIES.Quartz
    const scale = rt.random(0.5, 1.15) * sp.sizeMul
    crystals.push({ sp, pos, right, up, fwd, spin: rt.random(0, TAU), scale })
  }
}

// map a crystal's local habit vertex into world space
function toWorld(c, lv) {
  const s = Math.sin(c.spin), co = Math.cos(c.spin)
  const x = lv[0] * co + lv[2] * s, z = -lv[0] * s + lv[2] * co, y = lv[1]
  const sc = c.scale
  return [
    c.pos[0] + (c.right[0] * x + c.up[0] * y + c.fwd[0] * z) * sc,
    c.pos[1] + (c.right[1] * x + c.up[1] * y + c.fwd[1] * z) * sc,
    c.pos[2] + (c.right[2] * x + c.up[2] * y + c.fwd[2] * z) * sc,
  ]
}

// --- render ------------------------------------------------------------------
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}

let beatPulse = 0
rt.onBeat(() => { beatPulse = 1 })

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
function rgbOf(col, spec, specCol, k, rim) {
  const r = col[0] * k + specCol[0] * spec + rim
  const g = col[1] * k + specCol[1] * spec + rim
  const b = col[2] * k + specCol[2] * spec + rim
  return `rgb(${(clamp01(r) * 255) | 0},${(clamp01(g) * 255) | 0},${(clamp01(b) * 255) | 0})`
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  beatPulse *= 0.90
  const sig = Math.round(params.count) + '|' + params.variety + '|' + rt.seed
  if (sig !== genSig) buildCluster()

  // background: deep velvet with a soft central glow
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, Math.hypot(W, H) * 0.6)
  bg.addColorStop(0, '#15101d'); bg.addColorStop(0.5, '#0b0812'); bg.addColorStop(1, '#050308')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  const gSpin = t * params.spin * 0.6
  const gs = Math.sin(gSpin), gc = Math.cos(gSpin)
  const tilt = -0.34, ts = Math.sin(tilt), tc = Math.cos(tilt)
  const focal = 9
  const scale = Math.min(W, H) * 0.15 * params.size
  const cx = W * 0.5, cy = H * 0.5
  const la = (params.light * Math.PI) / 180
  const L = norm([Math.cos(la) * 0.8, 0.5, Math.sin(la) * 0.8])
  const half = norm([L[0], L[1], L[2] + 1]) // Blinn half-vector (view dir +z)
  const shinMul = params.facet

  // soft contact shadow, then the rocky matrix mound the crystals sit on
  const baseY = cy + scale * 1.05
  ctx.save()
  const sh = ctx.createRadialGradient(cx, baseY + scale * 0.4, 0, cx, baseY + scale * 0.4, scale * 2.8)
  sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sh
  ctx.beginPath(); ctx.ellipse(cx, baseY + scale * 0.4, scale * 2.8, scale * 0.6, 0, 0, TAU); ctx.fill()
  ctx.restore()
  // matrix: a dark stony mound with a few jagged facets, lit weakly from the light
  const mg = ctx.createRadialGradient(cx - scale * 0.5, baseY - scale * 0.4, 0, cx, baseY, scale * 2.2)
  mg.addColorStop(0, '#4a4652'); mg.addColorStop(0.5, '#2b2830'); mg.addColorStop(1, '#141118')
  ctx.fillStyle = mg
  ctx.beginPath(); ctx.ellipse(cx, baseY, scale * 1.9, scale * 0.85, 0, 0, TAU); ctx.fill()
  // a scatter of rock facets for texture
  let rk = 20345 + (rt.seed & 0xffff)
  const rrand = () => { rk = (rk * 1664525 + 1013904223) >>> 0; return rk / 4294967296 }
  for (let i = 0; i < 26; i++) {
    const a = rrand() * TAU, rr = Math.sqrt(rrand()) * 1.75
    const px = cx + Math.cos(a) * rr * scale, py = baseY + Math.sin(a) * rr * scale * 0.42
    const sz = (0.14 + rrand() * 0.22) * scale
    const sh2 = 0.16 + rrand() * 0.22
    ctx.fillStyle = `rgba(${(60 * sh2 * 3) | 0},${(56 * sh2 * 3) | 0},${(66 * sh2 * 3) | 0},0.85)`
    ctx.beginPath()
    const sides = 4 + ((rrand() * 3) | 0)
    for (let k = 0; k <= sides; k++) {
      const aa = (k / sides) * TAU + a
      const rad = sz * (0.6 + rrand() * 0.5)
      const X = px + Math.cos(aa) * rad, Y = py + Math.sin(aa) * rad * 0.8
      k === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y)
    }
    ctx.closePath(); ctx.fill()
  }

  // build the face list across all crystals
  const faces = []
  for (const c of crystals) {
    const mesh = HABITS[c.sp.habit]
    const apex = APEX_IDX[c.sp.habit]
    const vv = new Array(mesh.v.length)
    let cxv = 0, cyv = 0, czv = 0
    for (let i = 0; i < mesh.v.length; i++) {
      let p = toWorld(c, mesh.v[i])
      p = rotY(p, gs, gc); p = rotX(p, ts, tc)
      vv[i] = p; cxv += p[0]; cyv += p[1]; czv += p[2]
    }
    const inv = 1 / mesh.v.length
    const center = [cxv * inv, cyv * inv, czv * inv]
    for (let fi = 0; fi < mesh.f.length; fi++) {
      const idx = mesh.f[fi]
      const a = vv[idx[0]], b = vv[idx[1]], d = vv[idx[2]]
      let n = norm(cross(subv(b, a), subv(d, a)))
      const fcx = (a[0] + b[0] + d[0]) / 3, fcy = (a[1] + b[1] + d[1]) / 3, fcz = (a[2] + b[2] + d[2]) / 3
      if (n[0] * (fcx - center[0]) + n[1] * (fcy - center[1]) + n[2] * (fcz - center[2]) < 0) n = [-n[0], -n[1], -n[2]]
      const front = n[2] > 0
      if (c.sp.alpha >= 1 && !front) continue // cull backfaces on opaque stones
      const diff = Math.max(0, dot(n, L))
      const spec = Math.pow(Math.max(0, dot(n, half)), c.sp.shin * shinMul) * (front ? 1 : 0.3)
      const rim = c.sp.alpha < 1 ? (1 - Math.abs(n[2])) * 0.18 * (front ? 1 : 0.4) : 0
      const poly = []
      for (const vi of idx) {
        const p = vv[vi]
        const s = (focal / (focal - p[2])) * scale
        poly.push(cx + p[0] * s, cy - p[1] * s)
      }
      // amethyst-style tint on terminations that include the apex vertex
      const tip = c.sp.tip && apex !== undefined && idx.includes(apex) ? c.sp.tip : null
      faces.push({ poly, z: fcz, sp: c.sp, diff, spec, rim, front, tip })
    }
  }
  faces.sort((p, q) => p.z - q.z) // far first

  // draw facets
  const glints = []
  for (const f of faces) {
    const sp = f.sp
    const amb = sp.metal ? 0.44 : 0.30 // metals keep more fill light in shadow
    const k = amb + (1 - amb) * f.diff
    const col = rgbOf(f.tip || sp.col, f.spec, sp.spec, k, f.rim)
    ctx.globalAlpha = f.front ? sp.alpha : sp.alpha * 0.5
    ctx.beginPath()
    ctx.moveTo(f.poly[0], f.poly[1])
    for (let i = 2; i < f.poly.length; i += 2) ctx.lineTo(f.poly[i], f.poly[i + 1])
    ctx.closePath()
    ctx.fillStyle = col
    ctx.fill()
    // facet edge for crisp gem definition
    ctx.globalAlpha = f.front ? 0.5 : 0.18
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(0.6, PR * 0.7)
    ctx.strokeStyle = sp.metal ? 'rgba(60,42,10,0.85)' : `rgba(255,255,255,${0.35 + f.spec * 0.5})`
    ctx.stroke()
    // pyrite striations: fine parallel lines across the face
    if (sp.striae && f.front && f.poly.length === 8) {
      ctx.globalAlpha = 0.22
      ctx.strokeStyle = 'rgba(40,28,6,0.9)'
      ctx.lineWidth = Math.max(0.5, PR * 0.5)
      const [x0, y0, x1, y1, x2, y2, x3, y3] = f.poly
      ctx.beginPath()
      for (let s = 0.15; s < 1; s += 0.16) {
        ctx.moveTo(x0 + (x3 - x0) * s, y0 + (y3 - y0) * s)
        ctx.lineTo(x1 + (x2 - x1) * s, y1 + (y2 - y1) * s)
      }
      ctx.stroke()
    }
    if (f.front && f.spec > 0.12) glints.push(f)
  }

  // star glints on the brightest facets
  ctx.globalCompositeOperation = 'lighter'
  glints.sort((a, b) => b.spec - a.spec)
  const maxG = Math.round(8 + params.sparkle * 14)
  const pulse = 0.6 + 0.4 * Math.min(1, beatPulse + rt.beat.state.pulse)
  for (let i = 0; i < glints.length && i < maxG; i++) {
    const f = glints[i]
    let sx = 0, sy = 0
    for (let k = 0; k < f.poly.length; k += 2) { sx += f.poly[k]; sy += f.poly[k + 1] }
    const m = 2 / f.poly.length; sx *= m; sy *= m
    const b = Math.min(1, f.spec * 1.4) * params.sparkle * pulse
    if (b <= 0.02) continue
    const rad = (6 + f.spec * 26) * PR * (0.7 + params.glow * 0.6)
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad)
    g.addColorStop(0, `rgba(255,255,255,${0.9 * b})`)
    g.addColorStop(0.3, `rgba(255,255,255,${0.28 * b})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, TAU); ctx.fill()
    // four-point sparkle cross
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * b})`
    ctx.lineWidth = Math.max(0.8, PR)
    const arm = rad * 1.5
    ctx.beginPath()
    ctx.moveTo(sx - arm, sy); ctx.lineTo(sx + arm, sy)
    ctx.moveTo(sx, sy - arm); ctx.lineTo(sx, sy + arm)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
buildCluster()
requestAnimationFrame(frame)
