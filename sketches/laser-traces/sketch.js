/**
 * Laser Traces — a single bright galvo beam scans a vector shape onto a dark
 * wall, the way a laser projector does: one hot point races along a parametric
 * path while a phosphor buffer holds the fading glow behind it, so you watch the
 * figure get drawn stroke by stroke and smear into light. Shapes cycle through
 * Lissajous figures, rose curves, spirographs, star polygons, spirals and a
 * raster grid; the beam blanks and re-draws each loop. Beats swap the pattern
 * and flash the scale; loudness drives the scan speed.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const PATTERNS = ['Mix', 'Lissajous', 'Rose', 'Spirograph', 'Star', 'Polygon', 'Spiral', 'Grid']
const COLORS = ['Single', 'Rainbow', 'RGB']
const params = rt.params({
  pattern: { value: 'Mix', type: 'select', options: PATTERNS, label: 'Pattern' },
  speed: { value: 1.1, min: 0.1, max: 4, step: 0.05, label: 'Scan speed' },
  complexity: { value: 5, min: 2, max: 12, step: 1, label: 'Complexity' },
  persist: { value: 0.86, min: 0.4, max: 0.98, step: 0.01, label: 'Afterglow' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Glow' },
  size: { value: 0.72, min: 0.3, max: 1, step: 0.02, label: 'Size' },
  spin: { value: 0.15, min: -1, max: 1, step: 0.02, label: 'Spin' },
  jitter: { value: 0.12, min: 0, max: 1, step: 0.02, label: 'Galvo jitter' },
  colorMode: { value: 'Rainbow', type: 'select', options: COLORS, label: 'Colour' },
  hue: { value: 0.33, min: 0, max: 1, step: 0.01, label: 'Hue' },
})
// Music: loudness pushes the scan, beats swap the figure and flash the size.
rt.mapInput('audio.volume', 'speed', 0.8)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// Phosphor buffer: we fade it a little each frame and add the new beam segment,
// so the recently-scanned path glows and trails off — the laser-persistence look.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')
// Small buffer for a cheap bloom (downsample → add back blurred).
const glowBuf = document.createElement('canvas')
const gctx = glowBuf.getContext('2d')

let W = 0, H = 0, cx = 0, cy = 0, R = 0
let head = 0        // 0..1 position of the beam along the path
let loops = 0       // completed passes (drives RGB cycling / pattern morph)
let patIndex = 1    // current pattern when in "Mix"
let lastNow = 0
let clock = 0       // now(ms), for time-based colour cycling
let sizePulse = 0   // beat flash on the figure scale, decays
let mixAcc = 0      // seconds on the current figure, for Mix auto-advance

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  buf.width = W; buf.height = H
  glowBuf.width = Math.max(1, W >> 2); glowBuf.height = Math.max(1, H >> 2)
  cx = W / 2; cy = H * 0.48
  R = Math.min(W, H) * 0.42
  bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H)
}

// The active pattern (a name), honouring "Mix" which cycles on beats.
function activePattern() {
  return params.pattern === 'Mix' ? PATTERNS[1 + (patIndex % (PATTERNS.length - 1))] : params.pattern
}

// Parametric path: t in 0..1 → point in the unit box [-1,1]. `k` = complexity.
function pathPoint(t, name, k) {
  const T = t * Math.PI * 2
  switch (name) {
    case 'Lissajous': {
      const a = Math.max(1, Math.round(k) - 1), b = Math.max(1, Math.round(k * 0.6))
      return [Math.sin(a * T + Math.PI / 4), Math.sin(b * T)]
    }
    case 'Rose': {
      const r = Math.cos(k * T)
      return [r * Math.cos(T), r * Math.sin(T)]
    }
    case 'Spirograph': {
      const Rr = 1, rr = 1 / Math.max(2, Math.round(k)), d = 0.7
      const f = (Rr - rr) / rr
      const s = 1 / (Rr - rr + d)
      return [((Rr - rr) * Math.cos(T) + d * Math.cos(f * T)) * s, ((Rr - rr) * Math.sin(T) - d * Math.sin(f * T)) * s]
    }
    case 'Star': {
      const n = Math.max(3, Math.round(k)), step = Math.max(2, Math.floor(n / 2))
      const seg = t * n            // which spoke we're on
      const i = Math.floor(seg), f = seg - i
      const a0 = (i * step) * 2 * Math.PI / n - Math.PI / 2
      const a1 = ((i + 1) * step) * 2 * Math.PI / n - Math.PI / 2
      const x = Math.cos(a0) * (1 - f) + Math.cos(a1) * f
      const y = Math.sin(a0) * (1 - f) + Math.sin(a1) * f
      return [x, y]
    }
    case 'Polygon': {
      const n = Math.max(3, Math.round(k)), seg = t * n
      const i = Math.floor(seg), f = seg - i
      const a0 = i * 2 * Math.PI / n - Math.PI / 2, a1 = (i + 1) * 2 * Math.PI / n - Math.PI / 2
      return [Math.cos(a0) * (1 - f) + Math.cos(a1) * f, Math.sin(a0) * (1 - f) + Math.sin(a1) * f]
    }
    case 'Spiral': {
      const turns = Math.max(2, Math.round(k))
      const r = t, ang = T * turns
      return [r * Math.cos(ang), r * Math.sin(ang)]
    }
    case 'Grid': {
      // boustrophedon raster — the classic laser grid sweep
      const rows = Math.max(2, Math.round(k))
      const row = Math.min(rows - 1, Math.floor(t * rows))
      const f = t * rows - row
      const y = (row / (rows - 1)) * 2 - 1
      const x = (row % 2 === 0 ? f : 1 - f) * 2 - 1
      return [x, y]
    }
    default:
      return [Math.sin(T), Math.sin(2 * T)]
  }
}

function laserColor(t) {
  const mode = params.colorMode
  const baseH = params.hue * 360
  if (mode === 'RGB') { const h = [0, 120, 240][(loops + Math.floor(t * 3)) % 3]; return `hsl(${h} 100% 55%)` }
  if (mode === 'Rainbow') return `hsl(${(baseH + t * 360 + clock * 0.03) % 360} 100% 56%)`
  return `hsl(${baseH} 100% 56%)`
}

rt.onBeat(() => { patIndex++; mixAcc = 0; sizePulse = 1 }) // swap figure + flash on the beat
// Tap to fire a beat by hand (swap the figure), à la the audio-reactive sketches.
canvas.addEventListener('pointerdown', () => rt.beat.trigger(1))

function frame(now) {
  rt.tick(now)
  clock = now
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  sizePulse *= 0.9
  // In Mix, drift to the next figure every few seconds so it keeps changing even
  // with no audio (beats/taps still swap it immediately).
  if (params.pattern === 'Mix') { mixAcc += dt; if (mixAcc > 7) { mixAcc = 0; patIndex++ } }

  const name = activePattern()
  const k = params.complexity
  const rot = now * 0.0006 * params.spin
  const scale = R * params.size * (1 + sizePulse * 0.12 + rt.beat.state.pulse * 0.06)
  const jit = params.jitter * rt.pixelRatio * 1.4
  const cosR = Math.cos(rot), sinR = Math.sin(rot)
  const project = (p) => {
    // rotate, scale, tiny keystone (top narrower) so it reads as thrown on a wall
    let x = p[0] * cosR - p[1] * sinR, y = p[0] * sinR + p[1] * cosR
    const key = 1 + y * 0.12
    return [cx + x * scale * key + (Math.random() - 0.5) * jit, cy + y * scale + (Math.random() - 0.5) * jit]
  }

  // fade the phosphor, then add this frame's beam segment additively
  bctx.globalCompositeOperation = 'source-over'
  bctx.fillStyle = `rgba(0,0,0,${1 - params.persist})`
  bctx.fillRect(0, 0, W, H)
  bctx.globalCompositeOperation = 'lighter'
  bctx.lineWidth = 1.6 * rt.pixelRatio
  bctx.lineCap = 'round'; bctx.lineJoin = 'round'

  const adv = Math.min(0.7, params.speed * dt) // fraction of the path scanned this frame
  const steps = Math.max(12, Math.ceil(adv * 900))
  let prev = project(pathPoint(head % 1, name, k))
  for (let i = 1; i <= steps; i++) {
    const t = head + (adv * i) / steps
    const wrapped = Math.floor(t) > Math.floor(head + (adv * (i - 1)) / steps)
    const cur = project(pathPoint(t % 1, name, k))
    if (!wrapped) { // blank across the seam (beam off while it flies back to the start)
      bctx.strokeStyle = laserColor(t % 1)
      bctx.globalAlpha = 0.9
      bctx.beginPath(); bctx.moveTo(prev[0], prev[1]); bctx.lineTo(cur[0], cur[1]); bctx.stroke()
    }
    prev = cur
  }
  bctx.globalAlpha = 1
  // the hot scanning head
  const hp = project(pathPoint(head % 1, name, k))
  const hg = bctx.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 9 * rt.pixelRatio)
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.4, laserColor(head % 1)); hg.addColorStop(1, 'rgba(0,0,0,0)')
  bctx.fillStyle = hg
  bctx.beginPath(); bctx.arc(hp[0], hp[1], 9 * rt.pixelRatio, 0, Math.PI * 2); bctx.fill()

  const before = Math.floor(head)
  head += adv
  if (Math.floor(head) > before) loops++

  // ---- compose onto the wall ----
  // dark wall with a soft vignette + faint mottle
  const wall = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75)
  wall.addColorStop(0, '#0c0d12'); wall.addColorStop(1, '#050507')
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H)
  // the beam + phosphor, added as light
  ctx.globalCompositeOperation = 'lighter'
  ctx.drawImage(buf, 0, 0)
  // cheap bloom: downscale, blur, add back
  if (params.glow > 0.01) {
    gctx.clearRect(0, 0, glowBuf.width, glowBuf.height)
    gctx.drawImage(buf, 0, 0, glowBuf.width, glowBuf.height)
    ctx.globalAlpha = Math.min(1, params.glow)
    try { ctx.filter = `blur(${Math.max(2, W * 0.006)}px)` } catch { /* older browsers */ }
    ctx.drawImage(glowBuf, 0, 0, W, H)
    ctx.filter = 'none'; ctx.globalAlpha = 1
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
clock = performance.now()
requestAnimationFrame(frame)
