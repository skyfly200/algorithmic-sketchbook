// Cymatics — sand on a Chladni plate. A standing wave rings the plate; the
// grains get shaken hardest at the antinodes and hardly at all along the nodal
// lines, so a random walk whose step is scaled by the local vibration amplitude
// naturally migrates every grain onto the nodes, drawing the resonant figure.
// Sweep the frequency to morph modes, or let the live mic's pitch drive it.
// The plate can be a full-screen rectangle, a square, a disc, or a regular
// polygon (triangle … octagon).
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  frequency: { value: 3.2, min: 1, max: 10, step: 0.05, label: 'Frequency (mode)' },
  amplitude: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Drive amplitude' },
  grains: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Grain count' },
  plate: { value: 'Rectangle', type: 'select', options: ['Rectangle', 'Square', 'Circle', 'Triangle', 'Pentagon', 'Hexagon', 'Octagon'], label: 'Plate shape' },
  audioDrive: { value: true, type: 'bool', label: 'Audio pitch drives it (mic)' },
  settle: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Settle speed' },
  hue: { value: 40, min: 0, max: 360, step: 1, label: 'Sand hue' },
})
rt.mapInput('audio.level', 'amplitude', 0.4)
rt.onBeat(() => {}) // mount the mic toggle for audio-drive

let W = 0, H = 0, PR = 1, S = 0, OX = 0, OY = 0, PW = 0, PH = 0
let grains = null // packed [x, y] * N in plate coords 0..1
let nG = 0

// --- plate shape -------------------------------------------------------------
const POLY = { Triangle: 3, Pentagon: 5, Hexagon: 6, Octagon: 8 }
function plateSides() { return POLY[params.plate] || 0 }
// radial (drumhead) modes for the disc and polygons; rectangular modes otherwise
function isRadial() { return params.plate === 'Circle' || plateSides() > 0 }
const _verts = new Map()
function vertsFor(sides) {
  if (_verts.has(sides)) return _verts.get(sides)
  const v = []
  for (let k = 0; k < sides; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / sides; v.push([0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]) }
  _verts.set(sides, v); return v
}
function pointInPoly(x, y, verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
// The plate's pixel rect — the full screen for Rectangle, a centred square box
// for everything else.
function layout() {
  if (params.plate === 'Rectangle') { OX = 0; OY = 0; PW = W; PH = H }
  else { PW = PH = S; OX = (W - S) / 2; OY = (H - S) / 2 }
}

function want() { return Math.min(60000, Math.round(14000 * params.grains * rt.detail)) }
function seed() {
  nG = want()
  grains = new Float32Array(nG * 2)
  for (let i = 0; i < nG; i++) { const [u, v] = randInPlate(); grains[i * 2] = u; grains[i * 2 + 1] = v }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  S = Math.min(W, H) * 0.86
  layout()
  seed()
}

// Smoothed drive frequency, from audio pitch if enabled or the param otherwise.
let freqSm = 3.2
function driveFreq() {
  if (params.audioDrive && rt.beat.state.active) {
    const bins = rt.beat.getSpectrum()
    if (bins) {
      let peak = 0, pv = 0
      for (let i = 2; i < bins.length; i++) if (bins[i] > pv) { pv = bins[i]; peak = i }
      const f = 1 + (peak / bins.length) * 9
      freqSm += (f - freqSm) * 0.08
      return freqSm
    }
  }
  freqSm += (params.frequency - freqSm) * 0.1
  return freqSm
}

// Chladni standing-wave amplitude at plate coords (u,v)∈[0,1], mode from freq.
function amp(u, v, m, n) {
  if (isRadial()) {
    const du = u - 0.5, dv = v - 0.5
    const r = Math.hypot(du, dv) * 2
    const th = Math.atan2(dv, du)
    return Math.cos(m * th) * Math.cos(n * Math.PI * r)
  }
  const a = Math.PI
  return Math.cos(m * a * u) * Math.cos(n * a * v) - Math.cos(n * a * u) * Math.cos(m * a * v)
}
function inPlate(u, v) {
  if (params.plate === 'Circle') return Math.hypot(u - 0.5, v - 0.5) <= 0.5
  const s = plateSides()
  if (s > 0) return pointInPoly(u, v, vertsFor(s))
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}
// A fresh random point guaranteed to sit on the plate (used to sweep grains that
// have wandered off the shape back on).
function randInPlate() {
  if (params.plate === 'Circle') {
    const a = rt.random(0, Math.PI * 2), r = 0.5 * Math.sqrt(rt.rng())
    return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]
  }
  const s = plateSides()
  if (s > 0) {
    const verts = vertsFor(s)
    let u = 0.5, v = 0.5
    for (let t = 0; t < 40; t++) { u = rt.rng(); v = rt.rng(); if (pointInPoly(u, v, verts)) break }
    return [u, v]
  }
  return [rt.rng(), rt.rng()]
}
let lastPlate = 'Rectangle'

// Trace the plate outline as a path (for the darker plate fill).
function platePath() {
  if (params.plate === 'Circle') { ctx.beginPath(); ctx.arc(OX + PW / 2, OY + PH / 2, PW / 2, 0, 6.28) }
  else {
    const s = plateSides()
    if (s > 0) {
      const v = vertsFor(s)
      ctx.beginPath()
      for (let i = 0; i < v.length; i++) { const x = OX + v[i][0] * PW, y = OY + v[i][1] * PH; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      ctx.closePath()
    } else { ctx.beginPath(); ctx.rect(OX, OY, PW, PH) }
  }
}

function frame(now) {
  rt.tick(now)
  if (nG !== want()) seed()
  // Switching plate shape re-lays-out and sweeps any off-plate grains back on.
  if (params.plate !== lastPlate) {
    lastPlate = params.plate
    layout()
    for (let i = 0; i < nG; i++) {
      if (!inPlate(grains[i * 2], grains[i * 2 + 1])) { const [u, v] = randInPlate(); grains[i * 2] = u; grains[i * 2 + 1] = v }
    }
  }
  const f = driveFreq()
  const m = 1 + Math.floor(f)
  const n = 1 + Math.floor(f * 1.37 + 0.5)
  const amt = params.amplitude
  const st = params.settle

  // background + plate
  ctx.fillStyle = '#0a0b10'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#12141c'
  platePath(); ctx.fill()

  // move + draw grains
  ctx.fillStyle = `hsl(${params.hue}, 70%, 82%)`
  const step = 0.02 * st
  for (let i = 0; i < nG; i++) {
    let u = grains[i * 2], v = grains[i * 2 + 1]
    const A = Math.abs(amp(u, v, m, n))
    // random walk with a step scaled by local vibration → settles on nodes
    const kick = A * amt * step
    u += (rt.rng() - 0.5) * kick
    v += (rt.rng() - 0.5) * kick
    if (!inPlate(u, v)) { u = grains[i * 2]; v = grains[i * 2 + 1] } // reject a step off the plate
    grains[i * 2] = u; grains[i * 2 + 1] = v
    const px = OX + u * PW, py = OY + v * PH
    ctx.globalAlpha = 0.5 + (1 - Math.min(1, A)) * 0.5
    ctx.fillRect(px, py, PR, PR)
  }
  ctx.globalAlpha = 1

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
