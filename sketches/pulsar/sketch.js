// Pulsar — a spinning neutron star with its magnetic axis askew: twin
// radio beams sweep the sky like a lighthouse, dipole field lines whirl
// with the star, and every time a beam crosses our line of sight the
// screen catches the flash — recorded on a scrolling pulse trace at the
// bottom, the way PSR B1919+21 introduced itself. Beats trigger starquake
// glitches that briefly spin the star up.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  period: { value: +rt.random(0.7, 1.6).toFixed(2), min: 0.15, max: 3, step: 0.01, label: 'Spin period (s)' },
  tilt: { value: Math.round(rt.random(30, 55)), min: 5, max: 85, step: 1, label: 'Magnetic tilt°' },
  beam: { value: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Beam width' },
  glow: { value: 1, min: 0.2, max: 2, step: 0.02, label: 'Glow' },
  wobble: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Precession' },
  hue: { value: Math.round(rt.random(180, 280)), min: 0, max: 360, step: 1, label: 'Hue' },
  trace: { value: false, type: 'bool', label: 'Pulse trace' },
})
rt.mapInput('audio.pulse', 'glow', 0.5)
rt.mapInput('audio.low', 'beam', 0.2)

let W = 0
let H = 0
let stars = []
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  stars = []
  const n = Math.round(240 * rt.detail)
  for (let i = 0; i < n; i++) {
    stars.push({ x: rt.random(0, W), y: rt.random(0, H), r: rt.random(0.3, 1.3) * rt.pixelRatio, tw: rt.random(0, 6) })
  }
}

// spin phase integrates so period modulation never teleports the beam;
// starquakes add a decaying spin-up
let phase = rt.random(0, Math.PI * 2)
let glitch = 0
let last = 0
rt.onBeat(({ energy }) => { glitch = Math.min(2.5, glitch + 0.6 + energy) })

const trace = [] // recent line-of-sight intensity

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  glitch *= Math.exp(-dt * 1.6)
  phase += ((Math.PI * 2) / params.period) * (1 + glitch * 0.35) * dt

  const cx = W / 2
  const cy = H * 0.46
  const R = Math.min(W, H) * 0.045 // the star
  const alpha = (params.tilt * Math.PI) / 180
  // slow free precession swings the rotation axis a little
  const axisLean = 0.12 + params.wobble * 0.3 * Math.sin(t * 0.21)
  const hue = params.hue

  // magnetic axis in 3D (y up, z toward the viewer), then leaned
  let mx = Math.sin(alpha) * Math.cos(phase)
  let my = Math.cos(alpha)
  let mz = Math.sin(alpha) * Math.sin(phase)
  const ca = Math.cos(axisLean)
  const sa = Math.sin(axisLean)
  ;[mx, my] = [mx * ca - my * sa, mx * sa + my * ca]

  // how squarely a beam points at us (either pole): a sharp gaussian around
  // closest approach, so the trace shows pulsar-like spikes over quiet sky
  const closeness = Math.abs(mz) / Math.max(0.05, Math.sin(alpha))
  // exponential in (1 - closeness): quadratic near the peak, so the trace
  // spikes cleanly with no flat top
  const flash = Math.exp(-(1 - closeness) * (20 / (0.2 + params.beam)))

  // --- sky ---
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#030409'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  for (const s of stars) {
    ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 1.7 + s.tw)
    ctx.fillStyle = '#cdd6ee'
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // faint nebula the pulsar lights up
  const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55)
  neb.addColorStop(0, `hsla(${hue}, 60%, 55%, ${0.1 + flash * 0.07 * params.glow})`)
  neb.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = neb
  ctx.fillRect(0, 0, W, H)

  const proj = Math.hypot(mx, my) + 1e-6 // beam length foreshortening
  const bang = Math.atan2(my, mx)

  // --- twin beams: gradient wedges along ±magnetic axis ---
  for (const sgn of [1, -1]) {
    const a = sgn > 0 ? bang : bang + Math.PI
    const len = Math.max(W, H) * (0.34 + 0.5 * proj)
    const wid = len * (0.05 + params.beam * 0.13) * (1.6 - proj * 0.6)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a)
    const g = ctx.createLinearGradient(0, 0, len, 0)
    const bA = (0.5 + flash * 0.8) * params.glow * (0.35 + proj * 0.65)
    g.addColorStop(0, `hsla(${hue}, 30%, 92%, ${Math.min(1, bA)})`)
    g.addColorStop(0.25, `hsla(${hue}, 75%, 65%, ${Math.min(1, bA * 0.55)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(len, -wid)
    ctx.lineTo(len, wid)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // --- dipole field lines: nested loops around the magnetic axis ---
  ctx.lineWidth = 1.1 * rt.pixelRatio
  for (let ring = 1; ring <= 4; ring++) {
    const rr = R * (2.2 + ring * 1.9)
    const squash = 0.32 + 0.5 * Math.abs(mz)
    for (const sgn of [1, -1]) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(bang + (sgn > 0 ? 0 : Math.PI))
      ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${(0.3 - ring * 0.055) * params.glow})`
      ctx.beginPath()
      ctx.ellipse(rr * 0.62, 0, rr * 0.62, rr * squash * 0.5, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // --- the star itself ---
  const heat = 1 + flash * 0.6 + glitch * 0.5
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 7 * params.glow * heat)
  core.addColorStop(0, `hsla(${hue}, 20%, 100%, 1)`)
  core.addColorStop(0.08, `hsla(${hue}, 55%, 85%, 0.9)`)
  core.addColorStop(0.3, `hsla(${hue}, 80%, 60%, 0.35)`)
  core.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, W, H)

  // full-frame flash as the beam crosses the line of sight
  if (flash > 0.02) {
    ctx.fillStyle = `hsla(${hue}, 40%, 85%, ${flash * 0.1 * params.glow})`
    ctx.fillRect(0, 0, W, H)
  }

  // --- pulse trace (scrolling line of received intensity) ---
  trace.push(flash + glitch * 0.08)
  const maxN = Math.floor(W / (2 * rt.pixelRatio))
  while (trace.length > maxN) trace.shift()
  if (params.trace) {
    ctx.globalCompositeOperation = 'source-over'
    const base = H * 0.9
    const amp = H * 0.14
    ctx.strokeStyle = `hsla(${hue}, 30%, 88%, 0.85)`
    ctx.lineWidth = 1.4 * rt.pixelRatio
    ctx.beginPath()
    for (let i = 0; i < trace.length; i++) {
      const x = W - (trace.length - i) * 2 * rt.pixelRatio
      const y = base - trace[i] * amp
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
