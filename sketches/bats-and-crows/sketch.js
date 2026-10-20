// Bats and Crows: flocks of black silhouettes streaming across a moonlit sky.
// Bats flit fast and erratically with scalloped wings; crows hold steadier lines
// and flap slowly with fingered feathers. Birds travel in loose flocks that
// share a heading and altitude band, so the swarm reads as groups, not noise.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  count: { value: 40, min: 4, max: 200, step: 1, label: 'Birds', scale: 'log' },
  mix: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Bats vs crows' },
  speed: { value: 1, min: 0.05, max: 8, step: 0.01, label: 'Travel speed', scale: 'log' },
  flap: { value: 1, min: 0.1, max: 6, step: 0.01, label: 'Flap rate', scale: 'log' },
  size: { value: 1, min: 0.25, max: 5, step: 0.01, label: 'Bird size', scale: 'log' },
  flocks: { value: 4, min: 1, max: 12, step: 1, label: 'Flocks' },
  chaos: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Erratic flight' },
  moon: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Moon' },
  hue: { value: 215, min: 0, max: 360, step: 1, label: 'Sky hue' },
})
rt.mapInput('beat.pulse', 'flap', 0.15)

const MAX = 200
const rnd = (i, a) => { const s = Math.sin(i * 12.9898 + a * 78.233) * 43758.5453; return s - Math.floor(s) }
const birds = Array.from({ length: MAX }, (_, i) => ({
  flock: i, // reassigned below from the live flock count
  bat: rnd(i, 1), // compared against the mix param so the ratio changes smoothly
  ox: rnd(i, 2) - 0.5, oy: rnd(i, 3) - 0.5, // offset inside the flock
  v: 0.85 + rnd(i, 4) * 0.3, ph: rnd(i, 5) * 6.283, sz: 0.7 + rnd(i, 6) * 0.6,
  w1: 0.6 + rnd(i, 7) * 1.4, w2: 0.4 + rnd(i, 8) * 1.1,
}))
const flockOf = Array.from({ length: 12 }, (_, f) => ({
  dir: f % 2 ? -1 : 1, y: 0.15 + rnd(f, 11) * 0.5, x0: rnd(f, 12), v: 0.04 + rnd(f, 13) * 0.04,
  r: 0.06 + rnd(f, 14) * 0.08, bob: 0.5 + rnd(f, 15),
}))

let W = 0, H = 0, bg = null

function bake() {
  bg = document.createElement('canvas')
  bg.width = W
  bg.height = H
  const g = bg.getContext('2d')
  const h = params.hue
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, `hsl(${h}, 55%, 5%)`)
  sky.addColorStop(0.7, `hsl(${h}, 40%, 14%)`)
  sky.addColorStop(1, `hsl(${h - 15}, 35%, 22%)`)
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  const mx = W * 0.72, my = H * 0.26, mr = Math.min(W, H) * 0.09
  const halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 7)
  halo.addColorStop(0, `hsla(${h + 20}, 60%, 80%, ${0.35 * params.moon})`)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, W, H)
  g.fillStyle = `hsla(${h + 30}, 40%, 92%, ${params.moon})`
  g.beginPath()
  g.arc(mx, my, mr, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = `hsla(${h}, 30%, 70%, ${0.25 * params.moon})`
  for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.3], [-0.1, 0.4, 0.15]]) {
    g.beginPath()
    g.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2)
    g.fill()
  }
  // dead-tree line along the bottom
  g.fillStyle = '#020306'
  g.beginPath()
  g.moveTo(0, H)
  for (let x = 0; x <= W; x += W / 80) {
    const n = Math.sin(x * 0.011) * 0.5 + Math.sin(x * 0.037 + 2) * 0.3 + Math.sin(x * 0.09) * 0.2
    g.lineTo(x, H * 0.93 - Math.abs(n) * H * 0.05)
  }
  g.lineTo(W, H)
  g.fill()
  bakedHue = h
  bakedMoon = params.moon
}
let bakedHue = -1, bakedMoon = -1

function resize() {
  W = canvas.width = Math.max(1, Math.round(window.innerWidth * rt.pixelRatio))
  H = canvas.height = Math.max(1, Math.round(window.innerHeight * rt.pixelRatio))
  bake()
}

// Wing in bird space: shoulder at the origin, +x outward, f in [-1, 1] is the flap
// (1 = fully up). Drawn once for the near wing and mirrored for the far one.
function batWing(f) {
  const tx = 1.0 - 0.25 * Math.abs(f), ty = -f * 0.85
  ctx.moveTo(0, -0.04)
  ctx.quadraticCurveTo(tx * 0.45, ty * 0.5 - 0.22, tx, ty)
  ctx.quadraticCurveTo(tx * 0.8, ty * 0.45 + 0.12, tx * 0.72, ty * 0.42 + 0.2)
  ctx.quadraticCurveTo(tx * 0.5, ty * 0.25 + 0.2, tx * 0.42, ty * 0.2 + 0.25)
  ctx.quadraticCurveTo(tx * 0.22, ty * 0.1 + 0.2, 0, 0.14)
}
function crowWing(f) {
  const tx = 1.25 - 0.3 * Math.abs(f), ty = -f * 0.8
  ctx.moveTo(0, -0.05)
  ctx.quadraticCurveTo(tx * 0.5, ty * 0.5 - 0.2, tx, ty - 0.05)
  // fingered trailing edge: five feather tips
  for (let k = 1; k <= 5; k++) {
    const u = 1 - k / 5
    const px = tx * (0.2 + 0.85 * u), py = ty * u * u + 0.2 + 0.1 * (1 - u) + 0.05 * Math.sin(k * 5 + f)
    ctx.lineTo(px + 0.08, py - 0.06)
    ctx.lineTo(px, py + 0.12)
  }
  ctx.lineTo(0, 0.14)
}

function drawBat(f) {
  ctx.beginPath()
  batWing(f)
  ctx.scale(-1, 1)
  batWing(f)
  ctx.scale(-1, 1)
  ctx.fill()
  // body, head with ears
  ctx.beginPath()
  ctx.ellipse(0, 0.05, 0.1, 0.2, 0, 0, Math.PI * 2)
  ctx.moveTo(-0.07, -0.13)
  ctx.lineTo(-0.075, -0.3)
  ctx.lineTo(-0.02, -0.18)
  ctx.lineTo(0.02, -0.18)
  ctx.lineTo(0.075, -0.3)
  ctx.lineTo(0.07, -0.13)
  ctx.fill()
}
function drawCrow(f) {
  ctx.beginPath()
  crowWing(f)
  ctx.scale(-1, 1)
  crowWing(f)
  ctx.scale(-1, 1)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, 0.08, 0.11, 0.26, 0, 0, Math.PI * 2)
  ctx.fill()
  // head, beak, fanned tail
  ctx.beginPath()
  ctx.arc(0, -0.2, 0.075, 0, Math.PI * 2)
  ctx.moveTo(-0.03, -0.25)
  ctx.lineTo(0, -0.42)
  ctx.lineTo(0.03, -0.25)
  ctx.moveTo(-0.07, 0.25)
  ctx.lineTo(-0.13, 0.55)
  ctx.lineTo(0.13, 0.55)
  ctx.lineTo(0.07, 0.25)
  ctx.fill()
}

function frame(now) {
  rt.tick(now)
  if (bakedHue !== params.hue || bakedMoon !== params.moon) bake()
  ctx.globalAlpha = 1
  ctx.drawImage(bg, 0, 0)

  const unit = Math.min(W, H)
  const n = Math.min(MAX, Math.round(params.count))
  const nf = Math.max(1, Math.min(12, Math.round(params.flocks)))
  const travel = rt.phase('travel', params.speed)
  const flapT = rt.phase('flap', params.flap)
  const wob = rt.phase('wob', 0.3 + params.chaos * 1.7)
  const chaos = params.chaos
  ctx.fillStyle = '#030408'

  for (let i = 0; i < n; i++) {
    const b = birds[i]
    const fl = flockOf[i % nf]
    const isBat = b.bat < params.mix
    // flock centre travels across with wrap-around; members trail and bob around it
    const span = 1.4
    let cx = (fl.x0 + fl.dir * travel * fl.v * b.v) % span
    if (cx < 0) cx += span
    const fx = cx - 0.2
    const spread = fl.r + 0.04
    const jx = Math.sin(wob * b.w1 + b.ph) * chaos * 0.05
    const jy = Math.sin(wob * b.w2 * 1.3 + b.ph * 2) * chaos * 0.07 * (isBat ? 1.6 : 0.6)
    const x = (fx + b.ox * spread * 2.5 + jx) * W
    const y = (fl.y + Math.sin(travel * 0.25 * fl.bob + i % nf) * 0.05 + b.oy * spread * 2 + jy) * H
    // heading follows the flock, with a bank from the vertical jitter
    const bank = Math.cos(wob * b.w2 * 1.3 + b.ph * 2) * chaos * 0.5
    const rate = isBat ? 2.2 : 1
    const f = Math.sin(flapT * rate * 6.283 * b.v + b.ph)
    // crows glide between flaps; bats keep beating
    const fv = isBat ? f : (f > 0.5 ? f : f * 0.35 - 0.1)
    const s = unit * 0.045 * params.size * b.sz * (isBat ? 0.8 : 1.15)
    const dist = 0.55 + 0.45 * (y / H) // nearer (lower) birds read slightly bigger

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(fl.dir * (Math.PI / 2) + bank * fl.dir * 0.6)
    ctx.scale(s * dist, s * dist)
    ctx.globalAlpha = 0.92
    if (isBat) drawBat(fv)
    else drawCrow(fv)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
