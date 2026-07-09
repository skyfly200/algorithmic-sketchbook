// Shared runtime: quality/FPS settings from the viewer + beat detection.
// rt.onBeat(({ energy }) => { ... }) fires on detected beats (mounts a mic
// toggle); rt.beat.state.pulse decays 1 -> 0 after each beat.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Your sketch here — a pulsing circle to start with.
  const r = (Math.sin(t * 2) * 0.25 + 0.75) * Math.min(canvas.width, canvas.height) * 0.2
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'hsl(230, 80%, 70%)'
  ctx.lineWidth = 3 * rt.pixelRatio
  ctx.stroke()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
