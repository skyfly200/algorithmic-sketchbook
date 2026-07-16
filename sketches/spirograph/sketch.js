/**
 * Spirograph — a pen fixed in a small gear rolling inside a big ring traces a
 * hypotrochoid. Integer tooth counts make the rosette close after a fixed
 * number of laps; we draw it a little each frame so you watch the loops weave,
 * and the canvas fades slowly so successive rosettes layer into a palimpsest.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  ring: { value: 96, min: 24, max: 160, step: 1, label: 'Ring teeth (R)' },
  gear: { value: 60, min: 8, max: 150, step: 1, label: 'Gear teeth (r)' },
  pen: { value: 0.8, min: 0.1, max: 1, step: 0.01, label: 'Pen offset' },
  speed: { value: 1.5, min: 0.1, max: 12, step: 0.1, label: 'Draw speed' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  spin: { value: 0.15, min: 0, max: 1.5, step: 0.02, label: 'Palette drift' },
  fade: { value: 0.005, min: 0, max: 0.06, step: 0.002, label: 'Trail fade' },
})
// Music: beats hurry the pen, loudness drifts the palette.
rt.mapInput('audio.pulse', 'speed', 0.8)
rt.mapInput('audio.volume', 'spin', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const acc = document.createElement('canvas')
const actx = acc.getContext('2d')

let W, H, scale
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  acc.width = W
  acc.height = H
  actx.fillStyle = '#05060a'
  actx.fillRect(0, 0, W, H)
  scale = Math.min(W, H) * 0.46
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a)
let theta = 0
let period = 0
let prev = null
let lastR = 0
let lastr = 0
let px = 0 // pen offset baked at restart
let hueBase = 0

function restart() {
  lastR = Math.round(params.ring)
  lastr = Math.max(1, Math.round(params.gear))
  px = params.pen
  theta = 0
  prev = null
  period = (Math.PI * 2 * lastr) / gcd(lastR, lastr) // laps until the curve closes
  hueBase = params.hue
}
restart()

// Hypotrochoid point (normalized to the display radius).
function point(th) {
  const R = lastR
  const r = lastr
  const d = px * r
  const k = R - r
  const x = k * Math.cos(th) + d * Math.cos((k / r) * th)
  const y = k * Math.sin(th) - d * Math.sin((k / r) * th)
  const norm = R + d || 1
  return [W / 2 + (x / norm) * scale, H / 2 + (y / norm) * scale]
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  if (Math.round(params.ring) !== lastR || Math.round(params.gear) !== lastr || params.pen !== px) restart()

  // Fade the accumulation buffer a touch so old rosettes dim over time.
  if (params.fade > 0) {
    actx.fillStyle = `rgba(5, 6, 10, ${params.fade})`
    actx.fillRect(0, 0, W, H)
  }

  hueBase = (hueBase + params.spin * dt * 0.1) % 1
  const dth = 0.03
  const steps = Math.max(4, Math.round(params.speed * 26 * rt.detail)) // segments this frame
  actx.lineWidth = 1.6 * rt.pixelRatio
  actx.lineCap = 'round'
  for (let s = 0; s < steps; s++) {
    theta += dth
    const [x, y] = point(theta)
    if (prev) {
      const hh = (hueBase + (theta / period) * 0.25) % 1
      actx.strokeStyle = `hsl(${hh * 360}, 85%, 62%)`
      actx.beginPath()
      actx.moveTo(prev[0], prev[1])
      actx.lineTo(x, y)
      actx.stroke()
    }
    prev = [x, y]
    if (theta >= period) {
      // Completed a full closed rosette — nudge the gear for gentle variety.
      theta = 0
      prev = null
      lastr = 8 + ((lastr - 8 + 1) % Math.max(1, lastR - 8))
      period = (Math.PI * 2 * lastr) / gcd(lastR, lastr)
    }
  }

  ctx.drawImage(acc, 0, 0)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
