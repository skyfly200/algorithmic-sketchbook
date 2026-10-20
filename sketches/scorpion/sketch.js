// Scorpion — a top-down scorpion prowling a moonlit desert floor. Legs are
// planted in world space and step (two-bone IK) when stretched too far, in an
// alternating tetrapod gait; the claws snap, and the segmented tail curls over
// the back and strikes on every beat. The carapace fluoresces like a real
// scorpion under UV light.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0.1, max: 4, step: 0.05, label: 'Walk speed', scale: 'log' },
  size: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Size', scale: 'log' },
  curl: { value: 0.55, min: 0, max: 1, step: 0.02, label: 'Tail curl' },
  sway: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Tail sway' },
  snap: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Claw snap' },
  uv: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'UV glow' },
  moon: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Moonlight' },
})
rt.mapInput('beat.pulse', 'curl', 0.3)
rt.mapInput('audio.level', 'uv', 0.25)

let W = 0, H = 0, PR = 1, sand = null
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  // Bake the sand once: speckled grain, never regenerated per frame.
  sand = document.createElement('canvas')
  sand.width = Math.max(1, W >> 1)
  sand.height = Math.max(1, H >> 1)
  const s = sand.getContext('2d')
  s.fillStyle = '#14110d'
  s.fillRect(0, 0, sand.width, sand.height)
  const n = Math.floor(sand.width * sand.height * 0.05)
  for (let i = 0; i < n; i++) {
    const v = 20 + Math.random() * 50
    s.fillStyle = `rgba(${v + 25},${v + 15},${v - 5},${0.15 + Math.random() * 0.3})`
    s.fillRect(Math.random() * sand.width, Math.random() * sand.height, 1, 1)
  }
  for (const f of feet) f.init = false
}

// --- the creature, in local space (+x = forward), lengths in "units" ---
const LEGS = []
for (let i = 0; i < 4; i++) {
  for (const side of [-1, 1]) {
    LEGS.push({ hx: 14 - i * 11, side, reach: 62 + (i === 0 || i === 3 ? 0 : 8), fwd: 16 - i * 7, gait: (i + (side > 0 ? 1 : 0)) % 2 })
  }
}
const feet = LEGS.map(() => ({ x: 0, y: 0, tx: 0, ty: 0, k: 1, init: false }))

let px = 0, py = 0, heading = 0
function path(s) {
  const ax = W * 0.28, ay = H * 0.22
  return [W * 0.5 + ax * Math.sin(s * 0.23), H * 0.5 + ay * Math.sin(s * 0.37 + 1.2)]
}

let strike = 0, lastNow = 0
rt.onBeat(() => { strike = 1 })

function lerp(a, b, t) { return a + (b - a) * t }
function ellipse(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 6.2832) }

function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016)
  lastNow = now
  const walk = rt.phase('walk', params.speed)
  const flex = rt.phase('flex', 1)
  const unit = Math.min(W, H) / 380 * params.size
  const uv = params.uv

  // pose from the path (heading from a finite difference)
  const [nx, ny] = path(walk)
  const [mx, my] = path(walk + 0.02)
  px = nx; py = ny
  heading = Math.atan2(my - ny, mx - nx)
  const ch = Math.cos(heading), sh = Math.sin(heading)
  const toWorld = (lx, ly) => [px + (lx * ch - ly * sh) * unit, py + (lx * sh + ly * ch) * unit]
  strike = Math.max(0, strike - dt * 3)

  // --- ground ---
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(sand, 0, 0, W, H)
  const moonX = W * 0.2, moonY = H * 0.15
  const g = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, Math.max(W, H) * 0.9)
  g.addColorStop(0, `rgba(150,170,220,${0.28 * params.moon})`)
  g.addColorStop(1, 'rgba(0,0,10,0.72)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // UV pool of light on the sand beneath the creature
  ctx.globalCompositeOperation = 'lighter'
  const pool = ctx.createRadialGradient(px, py, 0, px, py, 150 * unit)
  pool.addColorStop(0, `rgba(60,255,190,${0.16 * uv})`)
  pool.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = pool
  ctx.fillRect(0, 0, W, H)

  const body = (alpha) => `rgba(${Math.round(30 + 40 * uv)},${Math.round(60 + 140 * uv)},${Math.round(50 + 100 * uv)},${alpha})`
  const dark = '#0b1210'

  // draw a limb chain with a glow underlay then a dark core
  function limb(pts, w) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = body(0.28); ctx.lineWidth = (w + 4) * unit
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = dark; ctx.lineWidth = w * unit
    ctx.stroke()
    ctx.strokeStyle = body(0.55); ctx.lineWidth = Math.max(1, w * 0.25) * unit
    ctx.stroke()
  }

  // --- legs ---
  const speedNow = Math.hypot(mx - nx, my - ny) / 0.02 // px per walk-unit
  LEGS.forEach((L, i) => {
    const f = feet[i]
    const [hx, hy] = toWorld(L.hx, L.side * 10)
    const [rx, ry] = toWorld(L.hx + L.fwd, L.side * L.reach * 0.75)
    if (!f.init) { f.x = f.tx = rx; f.y = f.ty = ry; f.k = 1; f.init = true }
    const stretch = Math.hypot(f.x - rx, f.y - ry) / unit
    if (f.k >= 1 && stretch > 22 + (L.gait ? 4 : 0)) {
      // step to a spot ahead of the rest position, along the heading
      const lead = Math.min(26, 10 + speedNow * params.speed * 0.05) * unit
      f.sx = f.x; f.sy = f.y
      f.tx = rx + ch * lead; f.ty = ry + sh * lead; f.k = 0
    }
    if (f.k < 1) {
      f.k = Math.min(1, f.k + dt * 7 * Math.max(0.5, params.speed))
      const e = f.k * f.k * (3 - 2 * f.k)
      f.x = lerp(f.sx, f.tx, e); f.y = lerp(f.sy, f.ty, e)
    }
    // two-bone IK, knee bent outward
    const l1 = L.reach * 0.55 * unit, l2 = L.reach * 0.62 * unit
    let dx = f.x - hx, dy = f.y - hy
    let d = Math.hypot(dx, dy)
    const dc = Math.min(d, l1 + l2 - 0.01), a = Math.atan2(dy, dx)
    const cosK = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc)
    const ka = Math.acos(Math.max(-1, Math.min(1, cosK)))
    const bend = a + ka * (L.side > 0 ? -1 : 1) * -1
    const kx = hx + Math.cos(bend) * l1, ky = hy + Math.sin(bend) * l1
    const lift = f.k < 1 ? Math.sin(f.k * Math.PI) * 0.25 : 0
    limb([[hx, hy], [kx, ky], [lerp(kx, f.x, 1), lerp(ky, f.y, 1)]], 5 * (1 + lift))
  })

  // --- tail: base at the rear, curling over the back toward the head ---
  const segs = 7
  let tx = -34, ty = 0, ta = Math.PI
  const curl = Math.min(1.2, params.curl + strike * 0.35)
  const tailPts = [toWorld(tx, ty)]
  for (let i = 0; i < segs; i++) {
    const u = i / (segs - 1)
    const len = 15 - i * 0.7
    ta += (curl * 0.55 + Math.sin(flex * 1.3 - i * 0.5) * 0.12 * params.sway) * (0.5 + u)
    ta += Math.sin(flex * 0.7 + i * 0.4) * 0.05 * params.sway
    tx += Math.cos(ta) * len; ty += Math.sin(ta) * len
    tailPts.push(toWorld(tx, ty))
  }
  for (let i = 0; i < segs; i++) {
    const a = tailPts[i], b = tailPts[i + 1]
    limb([a, b], 11 - i * 0.9)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = dark
    ellipse(b[0], b[1], (7 - i * 0.5) * unit, (6.4 - i * 0.5) * unit, 0); ctx.fill()
  }
  // sting: a hooked barb that flares on a strike
  const last = tailPts[segs], prev = tailPts[segs - 1]
  const sa = Math.atan2(last[1] - prev[1], last[0] - prev[0])
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = `rgba(255,120,200,${0.15 + 0.6 * strike})`
  ellipse(last[0] + Math.cos(sa) * 7 * unit, last[1] + Math.sin(sa) * 7 * unit, (8 + strike * 10) * unit, (8 + strike * 10) * unit, 0); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = dark
  ctx.beginPath()
  ctx.moveTo(last[0] + Math.cos(sa + 1.57) * 4 * unit, last[1] + Math.sin(sa + 1.57) * 4 * unit)
  ctx.quadraticCurveTo(last[0] + Math.cos(sa) * 16 * unit, last[1] + Math.sin(sa) * 16 * unit,
    last[0] + Math.cos(sa + 0.7) * 17 * unit, last[1] + Math.sin(sa + 0.7) * 17 * unit)
  ctx.lineTo(last[0] + Math.cos(sa - 1.57) * 4 * unit, last[1] + Math.sin(sa - 1.57) * 4 * unit)
  ctx.fill()

  // --- claws (pedipalps): arm, forearm, pincer; the pincer snaps ---
  for (const side of [-1, 1]) {
    const snapAng = (0.25 + 0.2 * Math.max(0, Math.sin(flex * 5 + side))) * (0.3 + params.snap)
    const sway = Math.sin(flex * 0.9 + side) * 0.12
    const base = [toWorld(30, side * 9)][0]
    const elbow = toWorld(52, side * 30)
    const wrist = toWorld(72, side * (20 + sway * 30))
    limb([base, elbow, wrist], 8)
    const cw = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0])
    for (const j of [-1, 1]) {
      const ang = cw + j * snapAng
      const tip = [wrist[0] + Math.cos(ang) * 26 * unit, wrist[1] + Math.sin(ang) * 26 * unit]
      limb([wrist, tip], 7)
    }
  }

  // --- carapace and abdomen (drawn last so legs and tail tuck under) ---
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = toWorld(-4 - i * 5.6, 0)
    const w = 17 - i * 1.5
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = body(0.2); ellipse(ax, ay, (w + 3) * unit, (w * 0.9 + 3) * unit, heading); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = dark; ellipse(ax, ay, w * unit, w * 0.9 * unit, heading); ctx.fill()
    ctx.strokeStyle = body(0.55); ctx.lineWidth = 1.5 * unit
    ctx.beginPath(); ctx.ellipse(ax, ay, w * unit, w * 0.9 * unit, heading, -2.2, 2.2); ctx.stroke()
  }
  const [cx, cy] = toWorld(16, 0)
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = body(0.25); ellipse(cx, cy, 25 * unit, 20 * unit, heading); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = dark; ellipse(cx, cy, 22 * unit, 17 * unit, heading); ctx.fill()
  ctx.strokeStyle = body(0.7); ctx.lineWidth = 1.6 * unit
  ctx.beginPath(); ctx.ellipse(cx, cy, 22 * unit, 17 * unit, heading, 0, 6.2832); ctx.stroke()
  // eyes
  ctx.globalCompositeOperation = 'lighter'
  for (const s of [-1, 1]) {
    const [ex, ey] = toWorld(24, s * 4)
    ctx.fillStyle = `rgba(150,255,220,${0.4 + 0.5 * uv * 0.5})`
    ellipse(ex, ey, 2.2 * unit, 2.2 * unit, 0); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
