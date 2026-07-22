// Cymatics — sand on a Chladni plate. A standing wave rings the plate; the
// grains get shaken hardest at the antinodes and hardly at all along the nodal
// lines, so a random walk whose step is scaled by the local vibration amplitude
// naturally migrates every grain onto the nodes, drawing the resonant figure.
// Sweep the frequency to morph modes, or let the live mic's pitch drive it.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  frequency: { value: 3.2, min: 1, max: 10, step: 0.05, label: 'Frequency (mode)' },
  amplitude: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Drive amplitude' },
  grains: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Grain count' },
  plate: { value: 'Square', type: 'select', options: ['Square', 'Circle'], label: 'Plate' },
  audioDrive: { value: true, type: 'bool', label: 'Audio pitch drives it (mic)' },
  settle: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Settle speed' },
  hue: { value: 40, min: 0, max: 360, step: 1, label: 'Sand hue' },
})
rt.mapInput('audio.level', 'amplitude', 0.4)
rt.onBeat(() => {}) // mount the mic toggle for audio-drive

let W = 0, H = 0, PR = 1, S = 0, ox = 0, oy = 0
let grains = null // packed [x, y] * N in plate coords 0..1
let nG = 0
function want() { return Math.min(60000, Math.round(14000 * params.grains * rt.detail)) }
function seed() {
  nG = want()
  grains = new Float32Array(nG * 2)
  for (let i = 0; i < nG; i++) { grains[i * 2] = rt.rng(); grains[i * 2 + 1] = rt.rng() }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  S = Math.min(W, H) * 0.86
  ox = (W - S) / 2; oy = (H - S) / 2
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
  if (params.plate === 'Circle') {
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
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}

function frame(now) {
  rt.tick(now)
  if (nG !== want()) seed()
  const f = driveFreq()
  const m = 1 + Math.floor(f)
  const n = 1 + Math.floor(f * 1.37 + 0.5)
  const amt = params.amplitude
  const st = params.settle

  // plate background
  ctx.fillStyle = '#0a0b10'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#12141c'
  if (params.plate === 'Circle') { ctx.beginPath(); ctx.arc(W / 2, H / 2, S / 2, 0, 6.28); ctx.fill() }
  else ctx.fillRect(ox, oy, S, S)

  // move + draw grains
  const sandLo = `hsl(${params.hue}, 40%, 40%)`
  const sandHi = `hsl(${params.hue}, 70%, 82%)`
  ctx.fillStyle = sandHi
  const step = 0.02 * st
  for (let i = 0; i < nG; i++) {
    let u = grains[i * 2], v = grains[i * 2 + 1]
    const A = Math.abs(amp(u, v, m, n))
    // random walk with a step scaled by local vibration → settles on nodes
    const kick = A * amt * step
    u += (rt.rng() - 0.5) * kick
    v += (rt.rng() - 0.5) * kick
    if (!inPlate(u, v)) { u = grains[i * 2]; v = grains[i * 2 + 1] } // reflect back
    grains[i * 2] = u; grains[i * 2 + 1] = v
    const px = ox + u * S, py = oy + v * S
    ctx.globalAlpha = 0.5 + (1 - Math.min(1, A)) * 0.5
    ctx.fillRect(px, py, PR, PR)
  }
  ctx.globalAlpha = 1

  if (params.audioDrive && !rt.beat.state.active) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = `${13 * PR}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('click 🎤 to drive the plate with sound', W / 2, oy - 12 * PR)
    ctx.textAlign = 'left'
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
