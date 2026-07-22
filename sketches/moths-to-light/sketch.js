// Moths to a Light — moths mobbing a lamp at night. Each moth steers to hold
// the light at a fixed bearing (the celestial-compass instinct a nearby bulb
// corrupts into a spiral), plus erratic jitter, so they wheel and dive at the
// glow, wings blurring. They occasionally overshoot/"singe" and loop back.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  swarm: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Swarm size' },
  attraction: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Attraction' },
  erratic: { value: 1, min: 0.1, max: 3, step: 0.05, label: 'Erraticness' },
  speed: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Speed' },
  flutter: { value: 1, min: 0, max: 2, step: 0.05, label: 'Wing flutter' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Lamp glow' },
  hue: { value: 45, min: 0, max: 360, step: 1, label: 'Lamp hue' },
  trail: { value: 0.5, min: 0, max: 0.9, step: 0.02, label: 'Motion blur' },
})
rt.mapInput('audio.level', 'erratic', 0.4)

let W = 0, H = 0, PR = 1
const moths = []
let lampX = 0, lampY = 0, tLampX = 0, tLampY = 0
function make() {
  const a = rt.random(0, 6.28)
  return {
    x: rt.random(0, W), y: rt.random(0, H), a,
    v: rt.random(0.7, 1.3),
    pref: rt.random(-0.5, 0.5), // preferred bearing offset to the light
    flap: rt.random(0, 6.28), flapSp: rt.random(14, 22),
    size: rt.random(4, 8) * PR, tone: rt.random(0.5, 1),
    singe: 0,
  }
}
function want() { return Math.max(3, Math.round(24 * params.swarm * rt.detail)) }
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  lampX = tLampX = W / 2; lampY = tLampY = H * 0.4
}
window.addEventListener('pointermove', (e) => { tLampX = e.clientX * PR; tLampY = e.clientY * PR })

let flare = 0
rt.onBeat(({ energy }) => { flare = 0.5 + energy * 0.6 })

function drawMoth(m, t) {
  const wing = Math.sin(m.flap) * params.flutter
  ctx.save()
  ctx.translate(m.x, m.y)
  ctx.rotate(m.a)
  const s = m.size
  const bright = 0.35 + m.tone * 0.4
  // wings (two flapping wings; the flutter foreshortens them as they beat)
  ctx.fillStyle = `rgba(${200 * bright | 0},${180 * bright | 0},${150 * bright | 0},0.85)`
  const spread = 0.55 + 0.45 * Math.abs(Math.cos(m.flap)) // width narrows on the down-beat
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-s * 0.8 * spread, dir * s * (0.9 + wing * 0.3), -s * 1.4 * spread, dir * s * 0.3)
    ctx.quadraticCurveTo(-s * 0.9 * spread, dir * s * 0.1, 0, 0)
    ctx.fill()
  }
  // body
  ctx.fillStyle = `rgba(60,50,42,0.95)`
  ctx.beginPath(); ctx.ellipse(-s * 0.3, 0, s * 0.7, s * 0.22, 0, 0, 6.28); ctx.fill()
  ctx.restore()
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  flare = Math.max(0, flare - dt * 1.5)
  lampX += (tLampX - lampX) * 0.06; lampY += (tLampY - lampY) * 0.06
  while (moths.length < want()) moths.push(make())
  while (moths.length > want()) moths.pop()

  // night background with motion-blur persistence
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(6,7,12,${1 - params.trail * 0.92})`
  ctx.fillRect(0, 0, W, H)

  // lamp glow
  const lr = Math.min(W, H) * 0.22 * params.glow * (1 + flare * 0.4)
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, lr)
  g.addColorStop(0, `hsla(${params.hue}, 100%, 92%, ${0.9})`)
  g.addColorStop(0.2, `hsla(${params.hue}, 100%, 70%, ${0.5})`)
  g.addColorStop(1, `hsla(${params.hue}, 100%, 50%, 0)`)
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(lampX, lampY, lr, 0, 6.28); ctx.fill()
  // bulb
  ctx.fillStyle = `hsl(${params.hue}, 100%, 96%)`
  ctx.beginPath(); ctx.arc(lampX, lampY, 5 * PR * (1 + flare * 0.3), 0, 6.28); ctx.fill()

  ctx.globalCompositeOperation = 'source-over'
  for (const m of moths) {
    const dx = lampX - m.x, dy = lampY - m.y
    const dist = Math.hypot(dx, dy) + 1e-3
    const toLight = Math.atan2(dy, dx)
    // steer to hold the light at the preferred bearing (spiral behaviour)
    let want = toLight + m.pref
    if (m.singe > 0) { want = toLight + Math.PI; m.singe -= dt } // fleeing after a singe
    let d = want - m.a
    d = Math.atan2(Math.sin(d), Math.cos(d))
    m.a += d * params.attraction * 2.2 * dt
    m.a += (rt.rng() - 0.5) * params.erratic * 3 * dt // erratic flutter of heading
    const sp = (60 + 40 * m.v) * params.speed * PR
    m.x += Math.cos(m.a) * sp * dt
    m.y += Math.sin(m.a) * sp * dt
    m.flap += m.flapSp * dt * (1 + params.flutter)
    // singe if it dives into the bulb
    if (dist < 14 * PR && m.singe <= 0) { m.singe = rt.random(0.5, 1.2); m.pref = rt.random(-0.6, 0.6) }
    // keep on screen
    if (m.x < -20) m.x = W + 20; else if (m.x > W + 20) m.x = -20
    if (m.y < -20) m.y = H + 20; else if (m.y > H + 20) m.y = -20
    // moths near the lamp catch its light
    ctx.globalAlpha = Math.min(1, 0.5 + (lr - Math.min(dist, lr)) / lr * 0.5)
    drawMoth(m, t)
    ctx.globalAlpha = 1
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
