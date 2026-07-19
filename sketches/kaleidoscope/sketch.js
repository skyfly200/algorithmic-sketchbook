/**
 * Kaleidoscope over a live source (camera / dropped photo or video / demo /
 * the Mixer-Patch layers below). Classic mirror-tube optics: one wedge of the
 * scene is sampled and reflected around the centre — segments alternate
 * mirrored and unmirrored so edges always match, exactly like a two-mirror
 * kaleidoscope. The wedge slowly orbits the source (steer it with the mouse),
 * the whole mandala turns, and beats kick the rotation.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  segments: { value: 2 * Math.round(rt.random(3, 8)), min: 4, max: 24, step: 2, label: 'Segments' },
  spin: { value: +rt.random(0.05, 0.3).toFixed(2), min: -1, max: 1, step: 0.01, label: 'Mandala spin' },
  orbit: { value: +rt.random(0.1, 0.35).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Wedge orbit' },
  zoom: { value: 1.15, min: 0.6, max: 2.5, step: 0.05, label: 'Sample zoom' },
  srcX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sample X' },
  srcY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sample Y' },
})
// Steer the sampled wedge with the mouse; beats kick the mandala's spin.
rt.mapInput('mouse.x', 'srcX', 0.5)
rt.mapInput('mouse.y', 'srcY', 0.5)
rt.mapInput('audio.pulse', 'spin', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// The source is drawn once per frame into a square buffer (a fixed-resolution
// stand-in for a world square big enough that a full wedge never out-runs it);
// one wedge of it is baked per frame, then stamped n times alternately
// mirrored — that alternation is what makes every seam line up.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')
const wedgeC = document.createElement('canvas')
const wctx = wedgeC.getContext('2d')

let W = 0
let H = 0
let S = 0 // mandala radius (covers the screen corners)
let worldK = 1 // world px per buffer px
const WANDER = 0.22 // sample point wander, as a fraction of S
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  S = Math.hypot(W, H) / 2
  const side = 1024
  buf.width = side
  buf.height = side
  // The buffer's square must cover wedge length + wander in every direction.
  worldK = (2 * (S * (1.05 + WANDER))) / side
  wedgeC.width = Math.ceil(S) + 2
  wedgeC.height = Math.ceil(S) + 2
}

let spinPhase = 0
let orbitPhase = 0
let lastNow = 0

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  spinPhase += params.spin * dt * 2
  orbitPhase += params.orbit * dt
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  // Refresh the square source buffer (cover-fit, optionally zoomed).
  const side = buf.width
  bctx.save()
  bctx.translate(side / 2, side / 2)
  bctx.scale(params.zoom, params.zoom)
  bctx.translate(-side / 2, -side / 2)
  src.draw(bctx, side, side)
  bctx.restore()

  const n = Math.max(4, 2 * Math.round(params.segments / 2)) // even count
  const wedge = (Math.PI * 2) / n
  const cx = W / 2
  const cy = H / 2
  // The steerable sample point (buffer px), orbiting gently so the mandala
  // churns even untouched — clamped so a full wedge always fits the buffer.
  const wanderPx = (S * WANDER) / worldK
  const bx = side / 2 + (params.srcX - 0.5) * 2 * wanderPx + Math.cos(orbitPhase) * wanderPx * 0.35
  const by = side / 2 + (0.5 - params.srcY) * 2 * wanderPx + Math.sin(orbitPhase * 1.3) * wanderPx * 0.35

  // Bake the wedge: apex at (0,0), spanning angles 0..wedge.
  wctx.save()
  wctx.clearRect(0, 0, wedgeC.width, wedgeC.height)
  wctx.beginPath()
  wctx.moveTo(0, 0)
  wctx.arc(0, 0, S + 2, -0.006, wedge + 0.006)
  wctx.closePath()
  wctx.clip()
  wctx.rotate(orbitPhase * 0.5) // slow churn of the sampled patch
  wctx.scale(worldK, worldK)
  wctx.drawImage(buf, -bx, -by)
  wctx.restore()

  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)

  // Stamp the wedge n times: even copies straight, odd copies mirrored and
  // advanced one slot — so every seam meets its own mirror image.
  for (let i = 0; i < n; i++) {
    ctx.save()
    ctx.translate(cx, cy)
    if (i % 2) {
      ctx.rotate(spinPhase + (i + 1) * wedge)
      ctx.scale(1, -1)
    } else {
      ctx.rotate(spinPhase + i * wedge)
    }
    ctx.drawImage(wedgeC, 0, 0)
    ctx.restore()
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
