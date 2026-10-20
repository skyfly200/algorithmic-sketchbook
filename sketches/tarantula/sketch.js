// A hairy tarantula stalks across moonlit ground on inverse-kinematics legs.
// Each foot plants, then steps when the body has drifted too far away.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 0.35, min: 0.01, max: 3, step: 0.001, label: 'Walk speed', scale: 'log' },
  size: { value: 1, min: 0.25, max: 4, step: 0.001, label: 'Size', scale: 'log' },
  hair: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Hairiness' },
  stride: { value: 0.55, min: 0.2, max: 1.2, step: 0.01, label: 'Stride' },
  eyes: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Eye glow' },
  moon: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Moonlight' },
})
rt.mapInput('beat.pulse', 'eyes', 0.3)

let W = 0
let H = 0
let dust = []
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const n = Math.floor(120 * rt.detail)
  dust = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() }))
}

// Body state
const body = { x: 0, y: 0, a: -Math.PI / 2, vx: 0, vy: 0 }
let inited = false
// Four leg pairs: anchor offset on the carapace (local, units of body radius), rest reach angle.
const legDefs = [
  { ax: 0.55, ay: 0.35, ang: 0.5 },
  { ax: 0.25, ay: 0.55, ang: 1.1 },
  { ax: -0.15, ay: 0.6, ang: 1.8 },
  { ax: -0.5, ay: 0.45, ang: 2.4 },
]
const feet = []
for (let s = 0; s < 2; s++) {
  for (let i = 0; i < 4; i++) {
    const side = s ? -1 : 1
    feet.push({ def: legDefs[i], side, x: 0, y: 0, fx: 0, fy: 0, t: 1, lift: 0, ready: false, grp: (i + s) % 2 })
  }
}
let palpPhase = 0

function legTarget(f, R, k) {
  const c = Math.cos(body.a), s = Math.sin(body.a)
  const reach = R * 3.4 * k
  const tx = Math.cos(f.def.ang) * reach
  const ty = Math.sin(f.def.ang) * f.side * reach
  return { x: body.x + c * tx - s * ty, y: body.y + s * tx + c * ty }
}
function anchor(f, R) {
  const c = Math.cos(body.a), s = Math.sin(body.a)
  const ax = f.def.ax * R, ay = f.def.ay * R * f.side
  return { x: body.x + c * ax - s * ay, y: body.y + s * ax + c * ay }
}

function drawLeg(f, R, hair, now) {
  const a = anchor(f, R)
  const lift = Math.sin(f.t * Math.PI) * (f.t < 1 ? 1 : 0)
  const kx = f.x, ky = f.y
  const dx = kx - a.x, dy = ky - a.y
  const d = Math.hypot(dx, dy) || 1
  const L1 = R * 2.1, L2 = R * 2.3
  const reach = Math.min(d, L1 + L2 - 0.01)
  const base = Math.atan2(dy, dx)
  const cosA = (L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach)
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)))
  // knee bends outward from the body (and up while lifting)
  const k1 = L1 * (1 + lift * 0.15)
  const c1x = a.x + Math.cos(base + ang) * k1, c1y = a.y + Math.sin(base + ang) * k1
  const c2x = a.x + Math.cos(base - ang) * k1, c2y = a.y + Math.sin(base - ang) * k1
  const o1 = Math.hypot(c1x - body.x, c1y - body.y) > Math.hypot(c2x - body.x, c2y - body.y)
  const kneeX = o1 ? c1x : c2x
  const kneeY = o1 ? c1y : c2y
  const endX = kx, endY = ky
  const w = R * 0.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // leg shadow (cast away from the moon)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = w * 0.9
  ctx.beginPath()
  ctx.moveTo(a.x + R * 0.25, a.y + R * 0.3)
  ctx.lineTo(kneeX + R * 0.4 * (1 + lift), kneeY + R * 0.5 * (1 + lift))
  ctx.lineTo(endX + R * 0.15, endY + R * 0.2)
  ctx.stroke()
  // leg
  const grad = ctx.createLinearGradient(a.x, a.y, endX, endY)
  grad.addColorStop(0, '#2a1d15')
  grad.addColorStop(1, '#14100d')
  ctx.strokeStyle = grad
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(kneeX, kneeY)
  ctx.lineWidth = w * 1.1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(kneeX, kneeY)
  ctx.lineTo(endX, endY)
  ctx.lineWidth = w * 0.75
  ctx.stroke()
  // bristles
  if (hair > 0.02) {
    ctx.strokeStyle = 'rgba(140,95,60,0.55)'
    ctx.lineWidth = Math.max(1, R * 0.02)
    ctx.beginPath()
    const segs = [[a.x, a.y, kneeX, kneeY, w * 0.55], [kneeX, kneeY, endX, endY, w * 0.4]]
    for (const [x0, y0, x1, y1, len] of segs) {
      const n = Math.floor(7 * hair * (0.5 + rt.detail * 0.5))
      const sx = x1 - x0, sy = y1 - y0
      const sl = Math.hypot(sx, sy) || 1
      for (let i = 1; i < n; i++) {
        const u = i / n
        const px = x0 + sx * u, py = y0 + sy * u
        const side = i % 2 ? 1 : -1
        const nx = (-sy / sl) * side, ny = (sx / sl) * side
        ctx.moveTo(px, py)
        ctx.lineTo(px + nx * len * 1.6 + (sx / sl) * len, py + ny * len * 1.6 + (sy / sl) * len)
      }
    }
    ctx.stroke()
  }
  // foot dust puff while planting
  if (f.t >= 1 && f.puff > 0) {
    ctx.fillStyle = `rgba(120,110,100,${f.puff * 0.25})`
    ctx.beginPath()
    ctx.arc(endX, endY, R * 0.25 * (1.5 - f.puff), 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawBody(R, hair, eyes, now) {
  ctx.save()
  ctx.translate(body.x, body.y)
  ctx.rotate(body.a)
  const bob = Math.sin(now * 0.004) * R * 0.02
  // body shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.beginPath()
  ctx.ellipse(R * 0.3, R * 0.45, R * 1.4, R * 1.0, 0, 0, Math.PI * 2)
  ctx.fill()
  // abdomen
  const g = ctx.createRadialGradient(-R * 0.9, bob - R * 0.2, R * 0.1, -R * 0.9, bob, R * 1.3)
  g.addColorStop(0, '#4a3322')
  g.addColorStop(0.7, '#1f1610')
  g.addColorStop(1, '#0d0907')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(-R * 1.0, bob, R * 1.15, R * 0.95, 0, 0, Math.PI * 2)
  ctx.fill()
  // cephalothorax
  const g2 = ctx.createRadialGradient(R * 0.2, -R * 0.15, R * 0.1, R * 0.2, 0, R * 0.9)
  g2.addColorStop(0, '#5a3f2b')
  g2.addColorStop(1, '#17100b')
  ctx.fillStyle = g2
  ctx.beginPath()
  ctx.ellipse(R * 0.25, 0, R * 0.8, R * 0.65, 0, 0, Math.PI * 2)
  ctx.fill()
  // fur
  if (hair > 0.02) {
    ctx.strokeStyle = 'rgba(170,115,70,0.45)'
    ctx.lineWidth = Math.max(1, R * 0.015)
    ctx.beginPath()
    const n = Math.floor(160 * hair * rt.detail)
    for (let i = 0; i < n; i++) {
      const th = (i * 2.399963) % (Math.PI * 2)
      const rr = Math.sqrt((i % 80) / 80)
      const onAbd = i % 2
      const cx = onAbd ? -R * 1.0 : R * 0.25
      const rx = onAbd ? R * 1.1 : R * 0.75
      const ry = onAbd ? R * 0.9 : R * 0.6
      const px = cx + Math.cos(th) * rx * rr
      const py = Math.sin(th) * ry * rr
      const l = R * 0.16 * (0.6 + ((i * 7) % 5) / 5)
      ctx.moveTo(px, py)
      ctx.lineTo(px + Math.cos(th) * l, py + Math.sin(th) * l)
    }
    ctx.stroke()
  }
  // chelicerae + palps
  const wig = Math.sin(palpPhase) * R * 0.1
  ctx.strokeStyle = '#1c130d'
  ctx.lineCap = 'round'
  ctx.lineWidth = R * 0.2
  ctx.beginPath()
  ctx.moveTo(R * 0.8, -R * 0.12)
  ctx.lineTo(R * 1.15 + wig, -R * 0.2)
  ctx.moveTo(R * 0.8, R * 0.12)
  ctx.lineTo(R * 1.15 - wig, R * 0.2)
  ctx.stroke()
  ctx.strokeStyle = '#3a2819'
  ctx.lineWidth = R * 0.14
  ctx.beginPath()
  ctx.moveTo(R * 0.7, -R * 0.4)
  ctx.lineTo(R * 1.3 + wig, -R * 0.55)
  ctx.lineTo(R * 1.55 + wig, -R * 0.35)
  ctx.moveTo(R * 0.7, R * 0.4)
  ctx.lineTo(R * 1.3 - wig, R * 0.55)
  ctx.lineTo(R * 1.55 - wig, R * 0.35)
  ctx.stroke()
  // eyes
  const eg = 0.25 + eyes * 0.75
  ctx.shadowColor = `rgba(255,60,40,${eg})`
  ctx.shadowBlur = R * 0.5 * eyes
  ctx.fillStyle = `rgba(255,${70 + 60 * eyes},50,${0.4 + 0.6 * eg})`
  for (const [ex, ey, er] of [[0.7, -0.14, 0.07], [0.7, 0.14, 0.07], [0.6, -0.26, 0.05], [0.6, 0.26, 0.05], [0.78, 0, 0.04]]) {
    ctx.beginPath()
    ctx.arc(R * ex, R * ey, R * er, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

let last = 0
let lastBeat = -10
rt.onBeat(() => { lastBeat = performance.now() })

function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
  last = now
  const R = Math.min(W, H) * 0.1 * params.size
  const phase = rt.phase('walk', params.speed)

  if (!inited) {
    body.x = W * 0.5
    body.y = H * 0.55
    inited = true
    for (const f of feet) {
      const p = legTarget(f, R, params.stride)
      f.x = f.fx = p.x
      f.y = f.fy = p.y
    }
  }

  // wander along a looping lissajous path, heading toward the next point
  const px = W * 0.5 + Math.sin(phase * 0.7) * W * 0.3
  const py = H * 0.5 + Math.sin(phase * 1.1 + 1.3) * H * 0.28
  const ex = W * 0.5 + Math.sin((phase + 0.02) * 0.7) * W * 0.3
  const ey = H * 0.5 + Math.sin((phase + 0.02) * 1.1 + 1.3) * H * 0.28
  const targetA = Math.atan2(ey - py, ex - px)
  let da = targetA - body.a
  da = Math.atan2(Math.sin(da), Math.cos(da))
  body.a += da * Math.min(1, dt * 6)
  const stalled = now - lastBeat < 300 // a beat makes it freeze for a moment
  const k = stalled ? 0.1 : 1
  body.x += (px - body.x) * Math.min(1, dt * 4 * k)
  body.y += (py - body.y) * Math.min(1, dt * 4 * k)
  palpPhase += dt * (stalled ? 40 : 6)

  // gait: alternate leg groups step when their foot is out of range
  const stepDur = Math.max(0.06, 0.25 / Math.max(0.05, params.speed + 0.2))
  const stepT = dt / stepDur
  for (const f of feet) {
    const rest = legTarget(f, R, params.stride)
    if (f.t < 1) {
      f.t = Math.min(1, f.t + stepT)
      const e = f.t * f.t * (3 - 2 * f.t)
      f.x = f.fx + (f.tx - f.fx) * e
      f.y = f.fy + (f.ty - f.fy) * e
      if (f.t >= 1) f.puff = 1
    } else {
      f.puff = Math.max(0, (f.puff || 0) - dt * 2.5)
      const off = Math.hypot(rest.x - f.x, rest.y - f.y)
      const partnerDown = feet.every((o) => o === f || o.grp === f.grp || o.t >= 1)
      if (off > R * 1.1 && partnerDown) {
        const lead = Math.hypot(body.x - px, body.y - py) < 1 ? 0 : 1
        f.fx = f.x
        f.fy = f.y
        f.tx = rest.x + Math.cos(body.a) * R * 0.5 * lead
        f.ty = rest.y + Math.sin(body.a) * R * 0.5 * lead
        f.t = 0
      }
    }
  }

  // ground: dark earth with a moon pool
  ctx.fillStyle = '#07080a'
  ctx.fillRect(0, 0, W, H)
  const mg = ctx.createRadialGradient(W * 0.35, H * 0.3, 0, W * 0.35, H * 0.3, Math.max(W, H) * 0.8)
  mg.addColorStop(0, `rgba(80,100,140,${0.35 * params.moon})`)
  mg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = mg
  ctx.fillRect(0, 0, W, H)
  for (const d of dust) {
    ctx.fillStyle = `rgba(150,160,180,${0.04 + d.r * 0.08 * params.moon})`
    ctx.fillRect(d.x, d.y, 1 + d.r * 2 * rt.pixelRatio, 1 + d.r * 2 * rt.pixelRatio)
  }

  for (const f of feet) drawLeg(f, R, params.hair, now)
  drawBody(R, params.hair, params.eyes, now)

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.75)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => { resize(); inited = false })
resize()
requestAnimationFrame(frame)
