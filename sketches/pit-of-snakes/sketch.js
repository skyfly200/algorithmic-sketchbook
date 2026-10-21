// A pit of snakes seen from above. Each snake is a follow-the-leader chain: the head
// wanders on smooth noise and is herded back into the pit, the body trails behind it.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 0.5, min: 0.02, max: 3, step: 0.001, label: 'Slither speed', scale: 'log' },
  count: { value: 56, min: 4, max: 64, step: 1, label: 'Snakes' },
  length: { value: 0.8, min: 0.2, max: 1, step: 0.01, label: 'Length' },
  writhe: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Writhing' },
  scales: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Scale detail' },
  tongues: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Tongue flicks' },
  hue: { value: 100, min: 0, max: 360, step: 1, label: 'Hue' },
  gloom: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Gloom' },
})
rt.mapInput('beat.pulse', 'writhe', 0.3)
rt.mapInput('beat.pulse', 'tongues', 0.4)

const MAX = 64
const SEGS = 64
const CH = 8
let W = 0
let H = 0
let cx = 0
let cy = 0
let pr = 1
let floor = null

function rnd(seed) {
  const s = Math.sin(seed * 127.1) * 43758.5453
  return s - Math.floor(s)
}

function makeSnake(i) {
  const a = rnd(i + 1) * Math.PI * 2
  const r = Math.sqrt(rnd(i + 50)) * 0.95
  const s = {
    seed: i * 7.31,
    hx: Math.cos(a) * r,
    hy: Math.sin(a) * r,
    dir: rnd(i + 99) * Math.PI * 2,
    hueOff: (rnd(i + 5) - 0.5) * 50,
    lit: 0.8 + rnd(i + 8) * 0.4,
    girth: 0.8 + rnd(i + 11) * 0.5,
    flick: rnd(i + 3) * 5,
    pts: [],
  }
  for (let k = 0; k < SEGS; k++) s.pts.push({ x: s.hx, y: s.hy })
  return s
}
const snakes = Array.from({ length: MAX }, (_, i) => makeSnake(i))

function bakeFloor() {
  floor = document.createElement('canvas')
  floor.width = W
  floor.height = H
  const g = floor.getContext('2d')
  const R = Math.max(W, H) * 0.7
  const dirt = g.createRadialGradient(cx, cy, 0, cx, cy, R)
  dirt.addColorStop(0, '#241b12')
  dirt.addColorStop(1, '#0a0705')
  g.fillStyle = dirt
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.15 + rnd(i) * 0.2})`
    g.beginPath()
    g.arc(rnd(i + 700) * W, rnd(i + 800) * H, 2 + rnd(i + 1) * 6 * pr, 0, 7)
    g.fill()
  }
}

function resize() {
  pr = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * pr)
  H = canvas.height = Math.floor(window.innerHeight * pr)
  cx = W / 2
  cy = H / 2
  bakeFloor()
}
window.addEventListener('resize', resize)
resize()

let last = 0
let energy = 0
rt.onBeat(({ energy: e }) => {
  energy = Math.max(energy, Math.min(1, e || 1))
})

function step(s, dt, t, R, wr, len) {
  const ax = W * 0.55, ay = H * 0.55
  // head turns on layered sine noise; writhe scales how sharply
  const n = Math.sin(t * 1.3 + s.seed) + 0.6 * Math.sin(t * 2.9 + s.seed * 2.1)
  s.dir += n * (0.8 + wr * 3.2) * dt
  const spd = R * 1.3 * (0.18 + 0.12 * Math.sin(t * 0.7 + s.seed * 3)) * (1 + rt.beat.state.pulse * 1.2)
  const d = Math.hypot(s.hx, s.hy)
  if (d > 1.0) {
    // herd back toward the middle, turning the short way
    const want = Math.atan2(-s.hy, -s.hx)
    let diff = want - s.dir
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    s.dir += diff * Math.min(1, dt * 5)
  }
  s.hx += Math.cos(s.dir) * spd * dt / ax
  s.hy += Math.sin(s.dir) * spd * dt / ay
  const p = s.pts
  p[0].x = s.hx * ax
  p[0].y = s.hy * ay
  const gap = (R * 2.4 * len) / SEGS
  for (let k = 1; k < SEGS; k++) {
    const dx = p[k - 1].x - p[k].x
    const dy = p[k - 1].y - p[k].y
    const dl = Math.hypot(dx, dy) || 1
    // lateral ripple travels down the body so the snake undulates
    const wob = Math.sin(t * 4 - k * 0.45 + s.seed) * wr * gap * 0.35
    p[k].x = p[k - 1].x - (dx / dl) * gap - (dy / dl) * wob
    p[k].y = p[k - 1].y - (dy / dl) * gap + (dx / dl) * wob
  }
}

function drawSnake(s, t, R, sc, tg, hue, gl, k0, k1) {
  const p = s.pts
  const len = SEGS
  const rad = R * 0.034 * s.girth
  const h = hue + s.hueOff
  // soft shadow under body
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  for (let k = k1 - 1; k >= k0; k -= 2) {
    const w = rad * taper(k / len) * 1.2
    ctx.beginPath()
    ctx.arc(cx + p[k].x + w * 0.4, cy + p[k].y + w * 0.5, w, 0, 7)
    ctx.fill()
  }
  for (let k = k1 - 1; k >= k0; k--) {
    const w = rad * taper(k / len)
    const x = cx + p[k].x
    const y = cy + p[k].y
    const band = Math.floor(k / 3) % 2
    const l = (18 + band * 8 * sc + 6 * Math.sin(k * 0.5)) * s.lit * (1 - gl * 0.5)
    ctx.fillStyle = `hsl(${h + band * 12},45%,${l}%)`
    ctx.beginPath()
    ctx.arc(x, y, w, 0, 7)
    ctx.fill()
    if (sc > 0.05 && w > 1.5) {
      // dorsal ridge highlight and a diamond scale mark
      ctx.fillStyle = `hsla(${h + 30},55%,${40 * s.lit}%,${0.45 * sc})`
      ctx.beginPath()
      ctx.arc(x - w * 0.2, y - w * 0.25, w * 0.4, 0, 7)
      ctx.fill()
      if (k % 3 === 0) {
        const nx = p[Math.max(k - 1, 0)].x - p[Math.min(k + 1, len - 1)].x
        const ny = p[Math.max(k - 1, 0)].y - p[Math.min(k + 1, len - 1)].y
        ctx.fillStyle = `rgba(0,0,0,${0.5 * sc})`
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.atan2(ny, nx))
        ctx.beginPath()
        ctx.moveTo(-w * 0.8, 0)
        ctx.lineTo(0, -w * 0.5)
        ctx.lineTo(w * 0.8, 0)
        ctx.lineTo(0, w * 0.5)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }
  }
  if (k0 > 0) return
  // head
  const a = Math.atan2(p[0].y - p[2].y, p[0].x - p[2].x)
  const hx = cx + p[0].x
  const hy = cy + p[0].y
  ctx.save()
  ctx.translate(hx, hy)
  ctx.rotate(a)
  ctx.fillStyle = `hsl(${h},40%,${22 * s.lit}%)`
  ctx.beginPath()
  ctx.ellipse(rad * 0.7, 0, rad * 1.6, rad * 1.1, 0, 0, 7)
  ctx.fill()
  ctx.fillStyle = `hsl(${(h + 55) % 360},95%,${55 + 20 * rt.beat.state.pulse}%)`
  for (const sd of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(rad * 1.5, sd * rad * 0.6, rad * 0.22, 0, 7)
    ctx.fill()
  }
  // forked tongue: darts out in short bursts
  const f = Math.sin(t * 9 + s.flick * 3) * Math.sin(t * 2.3 + s.flick)
  const out = Math.max(0, f) * tg
  if (out > 0.02) {
    const tl = rad * 3.2 * out
    ctx.strokeStyle = '#c4202c'
    ctx.lineWidth = Math.max(1, rad * 0.14)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(rad * 2.4, 0)
    ctx.lineTo(rad * 2.4 + tl, 0)
    ctx.moveTo(rad * 2.4 + tl, 0)
    ctx.lineTo(rad * 2.4 + tl * 1.35, -rad * 0.4 * out)
    ctx.moveTo(rad * 2.4 + tl, 0)
    ctx.lineTo(rad * 2.4 + tl * 1.35, rad * 0.4 * out)
    ctx.stroke()
  }
  ctx.restore()
}
function taper(u) {
  // fat in the first third, thin tail
  return u < 0.15 ? 0.85 + u * 1 : Math.max(0.12, 1 - Math.pow((u - 0.15) / 0.85, 1.4) * 0.9)
}

function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
  last = now
  const R = Math.min(W, H) * 0.47
  const t = rt.phase('slither', params.speed)
  energy *= 0.92
  const wr = Math.min(1, params.writhe + energy * 0.3)
  const n = Math.round(params.count)
  const len = params.length
  const sdt = dt * params.speed
  ctx.drawImage(floor, 0, 0)
  const order = []
  for (let i = 0; i < n; i++) {
    step(snakes[i], sdt, t, R, wr, len)
    order.push(i)
  }
  // fewer scale details on slow hardware
  const sc = params.scales * Math.min(1, rt.detail)
  const tg = params.tongues
  // chunks of every snake go into one depth-sorted list so bodies weave over and under each other
  const chunks = []
  for (const i of order) {
    for (let k = 0; k < SEGS; k += CH) {
      chunks.push({ i, k, z: Math.sin(k * 0.17 + snakes[i].seed * 1.7 + t * 0.4) + (k === 0 ? 2 : 0) })
    }
  }
  chunks.sort((a, b) => a.z - b.z)
  for (const c of chunks) drawSnake(snakes[c.i], t, R, sc, tg, params.hue, params.gloom, c.k, Math.min(SEGS, c.k + CH + 1))
  // darkness closing in from the edges, and a cold pool of light in the middle
  const v = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, `rgba(0,0,0,${0.15 + params.gloom * 0.5})`)
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
