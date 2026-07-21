// Lightning — branching bolts crack across a stormy sky: a recursive
// midpoint-displaced main channel from a random top strike to the ground,
// forked side-branches, a screen-wide flash on each strike, and lingering
// afterglow. Beats trigger strikes; click summons one at the pointer.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  rate: { value: 1, min: 0, max: 4, step: 0.05, label: 'Strike rate' },
  branches: { value: 1, min: 0, max: 2, step: 0.05, label: 'Forking' },
  jag: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Jaggedness' },
  flash: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Flash' },
  hue: { value: 210, min: 0, max: 360, step: 1, label: 'Bolt hue' },
  onBeat: { value: true, type: 'bool', label: 'Strike on beat' },
})
rt.mapInput('audio.pulse', 'rate', 2)

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}
const bolts = [] // { segs: [[x,y]...], life, forks }
let flashLevel = 0

function makeBolt(x0, y0, x1, y1, depth) {
  // midpoint displacement into a jagged polyline
  let pts = [[x0, y0], [x1, y1]]
  const disp = Math.hypot(x1 - x0, y1 - y0) * 0.18 * params.jag
  for (let it = 0; it < 6; it++) {
    const next = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      const nx = -(b[1] - a[1]), ny = b[0] - a[0]
      const len = Math.hypot(nx, ny) || 1
      const d = (rt.rng() - 0.5) * disp / (it + 1)
      next.push(a, [mx + (nx / len) * d, my + (ny / len) * d])
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  const forks = []
  if (depth > 0) {
    for (let i = 2; i < pts.length - 2; i++) {
      if (rt.rng() < 0.04 * params.branches) {
        const [px, py] = pts[i]
        const ang = Math.atan2(pts[i + 1][1] - py, pts[i + 1][0] - px) + rt.random(-0.9, 0.9)
        const len = rt.random(60, 200) * rt.pixelRatio
        forks.push(makeBolt(px, py, px + Math.cos(ang) * len, py + Math.sin(ang) * len, depth - 1))
      }
    }
  }
  return { segs: pts, forks }
}
function strike(x) {
  const x0 = x ?? rt.random(W * 0.2, W * 0.8)
  bolts.push({ bolt: makeBolt(x0, 0, x0 + rt.random(-W * 0.15, W * 0.15), H, 2), life: 1 })
  flashLevel = Math.max(flashLevel, params.flash)
}
rt.onBeat(({ energy }) => { if (params.onBeat && rt.rng() < 0.5 + energy * 0.3) strike() })
canvas.addEventListener('pointerdown', (e) => strike(e.clientX * rt.pixelRatio))

let last = 0
let acc = 0
function drawBolt(b, alpha, hue) {
  ctx.strokeStyle = `hsla(${hue}, 30%, 96%, ${alpha})`
  ctx.shadowColor = `hsl(${hue}, 90%, 65%)`
  ctx.shadowBlur = 18 * rt.pixelRatio
  ctx.lineWidth = 2.2 * rt.pixelRatio
  ctx.beginPath()
  ctx.moveTo(b.segs[0][0], b.segs[0][1])
  for (const p of b.segs) ctx.lineTo(p[0], p[1])
  ctx.stroke()
  for (const f of b.forks) drawBolt(f, alpha * 0.6, hue)
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  // random ambient strikes at the set rate
  acc += dt * params.rate
  if (!params.onBeat && acc > 1) { acc = 0; if (rt.rng() < 0.5) strike() }

  // sky: dark stormy gradient, brightened by the flash
  const g = ctx.createLinearGradient(0, 0, 0, H)
  const fl = flashLevel
  g.addColorStop(0, `hsl(${params.hue}, 40%, ${6 + fl * 40}%)`)
  g.addColorStop(1, `hsl(${params.hue + 20}, 30%, ${3 + fl * 20}%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  flashLevel = Math.max(0, flashLevel - dt * 3)

  ctx.globalCompositeOperation = 'lighter'
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]
    // bright full-intensity hold, then a quick decay — a bolt lingers ~0.5s
    drawBolt(b.bolt, Math.min(1, b.life * 1.6), params.hue)
    b.life -= dt * 2.0
    if (b.life <= 0) bolts.splice(i, 1)
  }
  ctx.shadowBlur = 0
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
