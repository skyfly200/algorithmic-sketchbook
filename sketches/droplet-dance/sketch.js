/**
 * Droplet Dance — non-coalescence / "walking droplets". On a vibrating bath a
 * droplet can bounce indefinitely on a thin cushion of air instead of merging.
 * Each bounce stamps a ripple into a wave field with slow damping (the bath's
 * "memory"); the droplet then surfs the slope of that field on its next bounce,
 * so it walks across the surface, steered by its own and its neighbours' waves,
 * yet never coalesces. Click to add a droplet.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  count: { value: 9, min: 1, max: 30, step: 1, label: 'Droplets' },
  bounce: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Bounce rate' },
  memory: { value: 0.9, min: 0.6, max: 0.99, step: 0.005, label: 'Wave memory' },
  walk: { value: 1, min: 0, max: 3, step: 0.05, label: 'Walk drive' },
  hue: { value: +rt.random(0.5, 0.62).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Bath hue' },
})
// Music: beats give every droplet a synchronized kick; loudness drives walking.
rt.mapInput('audio.volume', 'walk', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const fld = document.createElement('canvas')
const fctx = fld.getContext('2d')

let W, H, gw, gh, cell
let hPrev, hCur, hNext, img
let drops = []

function resetField() {
  cell = 8 * rt.pixelRatio
  gw = Math.max(16, Math.floor(W / cell))
  gh = Math.max(16, Math.floor(H / cell))
  hPrev = new Float32Array(gw * gh)
  hCur = new Float32Array(gw * gh)
  hNext = new Float32Array(gw * gh)
  fld.width = gw
  fld.height = gh
  img = fctx.createImageData(gw, gh)
}
function newDrop(x, y) {
  return { x: x ?? rt.random(W * 0.2, W * 0.8), y: y ?? rt.random(H * 0.2, H * 0.8), vx: 0, vy: 0, r: cell * rt.random(1.4, 2.1), ph: rt.random(0, 1) }
}
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  resetField()
  drops = Array.from({ length: Math.round(params.count) }, () => newDrop())
}

const gi = (gx, gy) => gy * gw + gx

function stepField(damp) {
  const c2 = 0.22
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const i = gi(x, y)
      const lap = hCur[i - 1] + hCur[i + 1] + hCur[i - gw] + hCur[i + gw] - 4 * hCur[i]
      hNext[i] = (2 * hCur[i] - hPrev[i] + c2 * lap) * damp
    }
  }
  const t = hPrev
  hPrev = hCur
  hCur = hNext
  hNext = t
}

function bounce(d) {
  const gx = Math.max(1, Math.min(gw - 2, Math.round(d.x / cell)))
  const gy = Math.max(1, Math.min(gh - 2, Math.round(d.y / cell)))
  // Stamp a small crest at the impact point (the bounce's surface wave).
  hCur[gi(gx, gy)] += 2.6
  // Surf the slope of the memory field: accelerate downhill, away from the
  // crowd of previous crests → the droplet walks.
  const slopeX = hCur[gi(gx + 1, gy)] - hCur[gi(gx - 1, gy)]
  const slopeY = hCur[gi(gx, gy + 1)] - hCur[gi(gx, gy - 1)]
  const k = params.walk * cell * 0.9
  d.vx -= slopeX * k
  d.vy -= slopeY * k
}

function render(t) {
  // Shade the bath from the wave field's slope (a cheap normal-map lighting).
  const d = img.data
  const base = [8, 12, 22]
  const lit = hslArr(params.hue, 0.6, 0.6)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = gi(x, y)
      const sx = (x > 0 && x < gw - 1) ? hCur[i + 1] - hCur[i - 1] : 0
      const sy = (y > 0 && y < gh - 1) ? hCur[i + gw] - hCur[i - gw] : 0
      const sh = Math.max(-1, Math.min(1, (sx * 0.6 - sy * 0.8) * 0.5))
      const g = 0.5 + sh * 0.5
      d[i * 4] = base[0] + lit[0] * g * 0.6
      d[i * 4 + 1] = base[1] + lit[1] * g * 0.6
      d[i * 4 + 2] = base[2] + lit[2] * g * 0.7
      d[i * 4 + 3] = 255
    }
  }
  fctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(fld, 0, 0, W, H)

  // Droplets: shadow, glossy body, squashed at the bottom of the bounce.
  for (const dp of drops) {
    const hop = Math.abs(Math.sin(dp.ph * Math.PI)) // 0 at impact, 1 at apex
    const lift = hop * dp.r * 1.3
    const squash = 1 - (1 - hop) * 0.35
    // Shadow on the bath.
    ctx.save()
    ctx.globalAlpha = 0.28 + (1 - hop) * 0.25
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(dp.x, dp.y, dp.r * (1.1 - hop * 0.3), dp.r * 0.4 * (1.1 - hop * 0.3), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // Body (raised by the hop).
    const bx = dp.x
    const by = dp.y - lift
    const rx = dp.r / squash
    const ry = dp.r * squash
    const grad = ctx.createRadialGradient(bx - rx * 0.35, by - ry * 0.4, rx * 0.1, bx, by, rx)
    grad.addColorStop(0, hsl(params.hue, 0.4, 0.92))
    grad.addColorStop(0.4, hsl(params.hue, 0.6, 0.66))
    grad.addColorStop(1, hsl(params.hue, 0.7, 0.32))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    // Specular glint.
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(bx - rx * 0.32, by - ry * 0.4, rx * 0.18, ry * 0.14, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}
const hsl = (h, s, l) => { const c = hslArr(h, s, l); return `rgb(${c[0]}, ${c[1]}, ${c[2]})` }

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  // Keep the droplet count in sync with the param.
  const target = Math.round(params.count)
  while (drops.length < target) drops.push(newDrop())
  if (drops.length > target) drops.length = target

  // Two wave substeps per frame for a lively bath.
  stepField(params.memory)
  stepField(params.memory)

  for (const dp of drops) {
    const prevPh = dp.ph
    dp.ph += dt * params.bounce * (2 + rt.beat.state.pulse * 2)
    if (dp.ph >= 1) { dp.ph -= 1; bounce(dp) } // impact at the bottom of the cycle
    // Move + gentle drag; keep on the bath.
    dp.x += dp.vx * dt
    dp.y += dp.vy * dt
    dp.vx *= 0.94
    dp.vy *= 0.94
    if (dp.x < dp.r) { dp.x = dp.r; dp.vx = Math.abs(dp.vx) }
    if (dp.x > W - dp.r) { dp.x = W - dp.r; dp.vx = -Math.abs(dp.vx) }
    if (dp.y < dp.r) { dp.y = dp.r; dp.vy = Math.abs(dp.vy) }
    if (dp.y > H - dp.r) { dp.y = H - dp.r; dp.vy = -Math.abs(dp.vy) }
  }
  // Non-coalescence: droplets bump apart, never merge.
  for (let i = 0; i < drops.length; i++)
    for (let k = i + 1; k < drops.length; k++) {
      const a = drops[i], b = drops[k]
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.001
      const min = (a.r + b.r) * 1.05
      if (dist < min) {
        const push = (min - dist) * 0.5
        const nx = dx / dist, ny = dy / dist
        a.x -= nx * push; a.y -= ny * push
        b.x += nx * push; b.y += ny * push
        a.vx -= nx * 6; a.vy -= ny * 6
        b.vx += nx * 6; b.vy += ny * 6
      }
    }

  render(now * 0.001)
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => drops.push(newDrop(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio)))
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
