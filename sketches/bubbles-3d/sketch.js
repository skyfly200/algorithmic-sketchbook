// Soap Bubbles 3D — photoreal-ish bubbles shaded as lit spheres. Each bubble is
// a see-through core with a Fresnel-bright rim, swirling thin-film interference
// colours (bands that shift as the film thickness varies), a crisp specular
// glare that slides across the surface as a virtual light orbits, and a soft
// reflected window-glare. They jostle, wobble on surface tension, and pop.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  count: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Bubble count' },
  size: { value: 1, min: 0.4, max: 2.2, step: 0.05, label: 'Bubble size' },
  lightOrbit: { value: 1, min: 0, max: 4, step: 0.05, label: 'Light orbit speed' },
  film: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Film thickness' },
  iridescence: { value: 1, min: 0, max: 2, step: 0.05, label: 'Iridescence' },
  wobble: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Wobble' },
  drift: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift' },
})
rt.mapInput('audio.level', 'lightOrbit', 0.5)
rt.mapInput('audio.pulse', 'wobble', 0.4)

let W = 0, H = 0, PR = 1
const bubbles = []
function make(x, y, s) {
  return {
    x: x ?? rt.random(0, W), y: y ?? rt.random(0, H),
    r: (s ?? rt.random(0.4, 1)) * rt.random(40, 95) * PR,
    vx: rt.random(-0.3, 0.3), vy: rt.random(-0.5, -0.1),
    filmPhase: rt.random(0, 6.28), // per-bubble film-thickness offset
    lobes: 3 + (rt.rng() * 3 | 0), wob: rt.random(0, 6.28),
    spin: rt.random(-0.4, 0.4), life: 1,
  }
}
function want() { return Math.max(3, Math.round(16 * params.count * rt.detail)) }
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}
canvas.addEventListener('pointerdown', (e) => {
  for (let i = 0; i < 4; i++) bubbles.push(make(e.clientX * PR + rt.random(-40, 40), e.clientY * PR + rt.random(-40, 40), rt.random(0.4, 1)))
})

function hsl(h, s, l, a) { return `hsla(${h},${s}%,${l}%,${a})` }

// Draw one bubble as a lit sphere at (x,y,R). `lx,ly` is the unit light dir.
function drawBubble(b, t, lx, ly) {
  const R = b.r * params.size
  if (R < 2) return
  ctx.save()
  ctx.translate(b.x, b.y)

  // wobbling outline clip so the bubble deforms on surface tension
  const wob = params.wobble * 0.06
  ctx.beginPath()
  for (let a = 0; a <= Math.PI * 2 + 0.06; a += 0.12) {
    const rr = R * (1 + wob * Math.sin(a * b.lobes + b.wob + t * b.spin))
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.save()
  ctx.clip()

  // 1) glassy body — dark, transparent core brightening toward the rim (Fresnel)
  const body = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R)
  body.addColorStop(0, 'rgba(10,16,28,0.05)')
  body.addColorStop(0.7, 'rgba(30,45,70,0.10)')
  body.addColorStop(0.93, 'rgba(160,200,255,0.30)')
  body.addColorStop(1, 'rgba(220,240,255,0.6)')
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill()

  // 2) thin-film interference: bands whose hue depends on radius (path length)
  //    and drift with the film thickness → swirling soap-film colour
  ctx.globalCompositeOperation = 'lighter'
  const bands = 7
  const drift = t * 0.5 + b.filmPhase
  for (let k = 0; k < bands; k++) {
    const rf = (k + 0.5) / bands
    const hue = ((rf * 720 * params.film + drift * 60 + Math.sin(rf * 6 + drift) * 40) % 360 + 360) % 360
    const g = ctx.createRadialGradient(-R * 0.15, -R * 0.15, R * Math.max(0, rf - 0.14), -R * 0.15, -R * 0.15, R * (rf + 0.02))
    g.addColorStop(0, hsl(hue, 90, 62, 0))
    g.addColorStop(0.5, hsl(hue, 90, 62, 0.16 * params.iridescence))
    g.addColorStop(1, hsl(hue, 90, 62, 0))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill()
  }

  // 3) primary specular glare — a hot spot where the light hits the sphere,
  //    positioned by the (orbiting) light direction so it slides as light moves
  const sx = -lx * R * 0.5, sy = -ly * R * 0.5
  const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.42)
  spec.addColorStop(0, 'rgba(255,255,255,0.95)')
  spec.addColorStop(0.4, 'rgba(255,255,255,0.35)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.beginPath(); ctx.arc(sx, sy, R * 0.42, 0, Math.PI * 2); ctx.fill()

  // 4) a soft reflected "window" glare, offset from the specular
  const wx = lx * R * 0.4, wy = ly * R * 0.4
  const win = ctx.createRadialGradient(wx, wy, 0, wx, wy, R * 0.3)
  win.addColorStop(0, 'rgba(180,220,255,0.35)')
  win.addColorStop(1, 'rgba(180,220,255,0)')
  ctx.fillStyle = win
  ctx.beginPath(); ctx.arc(wx, wy, R * 0.3, 0, Math.PI * 2); ctx.fill()

  ctx.restore() // remove clip
  // 5) crisp Fresnel rim stroke on top
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineWidth = Math.max(1, R * 0.02)
  ctx.strokeStyle = 'rgba(200,230,255,0.5)'
  ctx.beginPath(); ctx.arc(0, 0, R * 0.99, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function pop(b) {
  ctx.globalCompositeOperation = 'lighter'
  for (let k = 0; k < 14; k++) {
    const a = rt.random(0, Math.PI * 2), r = b.r * rt.random(0.4, 1.1)
    ctx.fillStyle = hsl(rt.random(0, 360), 90, 72, 0.5)
    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, b.r * 0.08, 0, Math.PI * 2); ctx.fill()
  }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  while (bubbles.length < want()) bubbles.push(make())

  // dim studio background
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#070a13'); g.addColorStop(1, '#0c0713')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // the orbiting light direction (shared) — this is what slides the glares
  const la = t * params.lightOrbit * 0.6
  const lx = Math.cos(la), ly = Math.sin(la) * 0.6 - 0.4

  // gentle mutual jostling + drift
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    b.vy -= 0.02 * params.drift * dt * 60
    b.x += b.vx * params.drift * dt * 30 * PR
    b.y += b.vy * params.drift * dt * 30 * PR
    b.vx += Math.sin(b.y * 0.003 + t) * 0.01 * params.drift
    // wrap / recycle
    if (b.y < -b.r * 2 || b.life <= 0 || rt.rng() < 0.0004) {
      if (b.y > 0 && b.life > 0.3) pop(b)
      bubbles.splice(i, 1); continue
    }
    if (b.x < -b.r) b.x = W + b.r; else if (b.x > W + b.r) b.x = -b.r
  }
  // draw big-to-small so small bubbles sit in front
  bubbles.sort((a, c) => c.r - a.r)
  for (const b of bubbles) drawBubble(b, t, lx, ly)
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
