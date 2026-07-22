// Zoetrope — the Victorian animation drum. A slotted cylinder spins; through
// the slits you glimpse a strip of drawings, and each slot sweeping past swaps
// one still frame for the next, so persistence of vision fuses them into motion.
// The frame shown is locked to the drum's rotation (a slit = a frame), so as it
// spins the figure animates; slow it down and the sequence stutters.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  subject: { value: 'Runner', type: 'select', options: ['Bouncing ball', 'Runner', 'Bird', 'Blooming flower'], label: 'Subject' },
  frames: { value: 12, min: 6, max: 24, step: 1, label: 'Frames' },
  spin: { value: 1, min: -3, max: 3, step: 0.05, label: 'Spin speed' },
  slit: { value: 0.35, min: 0.1, max: 0.7, step: 0.02, label: 'Slit width' },
  strobe: { value: true, type: 'bool', label: 'Strobe (lock to frame)' },
  hue: { value: 30, min: 0, max: 360, step: 1, label: 'Drum hue' },
})
rt.mapInput('audio.pulse', 'spin', 0.6)

let W = 0, H = 0, PR = 1, cx = 0, cy = 0, Rd = 0
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cx = W / 2; cy = H * 0.56; Rd = Math.min(W, H) * 0.34
}

// Draw the subject at animation phase p∈[0,1) in a box of half-size s at (x,y).
function drawFigure(x, y, s, p, hue) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = '#f4ecd8'
  ctx.fillStyle = '#f4ecd8'
  ctx.lineWidth = Math.max(1.5, s * 0.06)
  ctx.lineCap = 'round'
  const sub = params.subject
  if (sub === 'Bouncing ball') {
    const h = Math.abs(Math.sin(p * Math.PI))
    const by = s * 0.7 - h * s * 1.3
    const squash = 1 + (1 - h) * 0.4
    ctx.beginPath(); ctx.ellipse(0, by, s * 0.28 * squash, s * 0.28 / squash, 0, 0, 6.28); ctx.fill()
    ctx.strokeStyle = 'rgba(244,236,216,0.3)'; ctx.beginPath(); ctx.moveTo(-s * 0.4, s * 0.72); ctx.lineTo(s * 0.4, s * 0.72); ctx.stroke()
  } else if (sub === 'Runner') {
    const a = p * Math.PI * 2
    // body
    ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.14, 0, 6.28); ctx.stroke() // head
    ctx.beginPath(); ctx.moveTo(0, -s * 0.36); ctx.lineTo(0, s * 0.15); ctx.stroke() // torso
    // legs
    ctx.beginPath(); ctx.moveTo(0, s * 0.15); ctx.lineTo(Math.sin(a) * s * 0.3, s * 0.15 + Math.abs(Math.cos(a)) * s * 0.4 + s * 0.05); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, s * 0.15); ctx.lineTo(Math.sin(a + Math.PI) * s * 0.3, s * 0.15 + Math.abs(Math.cos(a + Math.PI)) * s * 0.4 + s * 0.05); ctx.stroke()
    // arms
    ctx.beginPath(); ctx.moveTo(0, -s * 0.2); ctx.lineTo(Math.sin(a + Math.PI) * s * 0.26, -s * 0.05); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, -s * 0.2); ctx.lineTo(Math.sin(a) * s * 0.26, -s * 0.05); ctx.stroke()
  } else if (sub === 'Bird') {
    const flap = Math.sin(p * Math.PI * 2)
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.14, s * 0.09, 0, 0, 6.28); ctx.fill() // body
    for (const dir of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(dir * s * 0.3, -flap * s * 0.35, dir * s * 0.5, -flap * s * 0.1 + s * 0.05); ctx.stroke()
    }
  } else {
    // blooming flower: petals open over the cycle then snap closed
    const open = 0.15 + 0.85 * Math.pow(Math.sin(p * Math.PI), 0.6)
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2
      ctx.fillStyle = `hsl(${(hue + k * 12) % 360}, 80%, 65%)`
      ctx.beginPath()
      ctx.ellipse(Math.cos(ang) * s * 0.3 * open, Math.sin(ang) * s * 0.3 * open, s * 0.22 * open, s * 0.1 * open, ang, 0, 6.28)
      ctx.fill()
    }
    ctx.fillStyle = '#f2c94c'; ctx.beginPath(); ctx.arc(0, 0, s * 0.12, 0, 6.28); ctx.fill()
  }
  ctx.restore()
}

let rot = 0, last = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const N = Math.round(params.frames)
  rot += params.spin * dt * 2.2
  const seg = (Math.PI * 2) / N
  // frame index locked to rotation (strobe): each slot advances one frame
  const fIdx = params.strobe ? ((Math.floor(rot / seg) % N) + N) % N : (rot / seg) % N
  const p = (fIdx / N + 1) % 1

  ctx.fillStyle = '#0c0a08'
  ctx.fillRect(0, 0, W, H)

  // drum floor ellipse
  ctx.save()
  ctx.fillStyle = `hsl(${params.hue}, 30%, 14%)`
  ctx.beginPath(); ctx.ellipse(cx, cy + Rd * 0.5, Rd * 1.02, Rd * 0.34, 0, 0, 6.28); ctx.fill()

  // draw the cylinder wall as vertical slit posts around the drum; front-facing
  // gaps reveal the current frame of the figure.
  const slitFrac = params.slit
  for (let i = 0; i < N; i++) {
    const th = i * seg + rot
    const cxs = Math.sin(th)
    const depth = (1 - Math.cos(th)) / 2 // 0 back … 1 front
    if (Math.cos(th) > 0.1) continue // skip the far side
    const x = cx + cxs * Rd
    const scale = 0.55 + depth * 0.45
    const postW = Rd * 0.5 * (1 - slitFrac) / N * 4 * scale
    const top = cy - Rd * 0.5 * scale
    const bot = cy + Rd * 0.34 * scale
    // the gap: draw the figure seen through this slot
    ctx.save()
    ctx.beginPath(); ctx.rect(x - Rd * seg * scale * 0.5, top, Rd * seg * scale, bot - top); ctx.clip()
    drawFigure(x, (top + bot) / 2, Rd * 0.42 * scale, p, params.hue)
    ctx.restore()
    // the post (slit wall)
    const g = ctx.createLinearGradient(x - postW, 0, x + postW, 0)
    g.addColorStop(0, `hsl(${params.hue}, 45%, ${18 * scale}%)`)
    g.addColorStop(0.5, `hsl(${params.hue}, 50%, ${34 * scale}%)`)
    g.addColorStop(1, `hsl(${params.hue}, 45%, ${18 * scale}%)`)
    ctx.fillStyle = g
    ctx.fillRect(x - postW, top, postW * 2, bot - top)
  }
  // top rim
  ctx.strokeStyle = `hsl(${params.hue}, 50%, 45%)`
  ctx.lineWidth = 3 * PR
  ctx.beginPath(); ctx.ellipse(cx, cy - Rd * 0.5, Rd, Rd * 0.32, 0, 0, 6.28); ctx.stroke()
  ctx.restore()

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
