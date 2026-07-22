/**
 * Hydrophobic surface: water on something superhydrophobic (a lotus leaf, a
 * freshly waxed car) doesn't wet it — it beads into near-spherical drops that
 * sit high on the surface and roll freely at the slightest tilt, merging when
 * they touch and leaving the surface bone dry behind them (no trail — that's
 * the whole point of the effect).
 *
 * Tilt the surface with the mouse (or a device's accelerometer) to send the
 * beads rolling; drops accelerate downhill, bounce off the edges, and coalesce
 * on contact (volume-conserving, with the odd ejected satellite). With no
 * input the surface tilts itself in a slow circle so the drops keep roaming.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  tilt: { value: +rt.random(0.4, 1.0).toFixed(2), min: 0, max: 1.6, step: 0.05, label: 'Tilt (gravity)' },
  density: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: 'Wetting rate' },
  size: { value: +rt.random(0.7, 1.4).toFixed(2), min: 0.5, max: 2.2, step: 0.05, label: 'Drop size' },
  adhesion: { value: 0.12, min: 0.02, max: 0.6, step: 0.01, label: 'Adhesion (drag)' },
  gloss: { value: 0.9, min: 0.2, max: 1.5, step: 0.05, label: 'Gloss' },
  wobble: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Wobble' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Surface hue' },
})
// The device accelerometer can tilt the surface too (falls back to the mouse).
rt.mapInput('tilt.x', 'tilt', 0)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let W = 0
let H = 0
let PR = 1
let surface = null // pre-rendered matte surface with micro-texture

function buildSurface() {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const d = c.getContext('2d')
  const hue = params.hue
  const g = d.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, `hsl(${hue}, 30%, 9%)`)
  g.addColorStop(0.5, `hsl(${hue}, 24%, 6%)`)
  g.addColorStop(1, `hsl(${hue}, 34%, 11%)`)
  d.fillStyle = g
  d.fillRect(0, 0, W, H)
  // Micro-bumps: the nap of nanoscale texture that makes the surface bead.
  for (let i = 0; i < (W * H) / 900; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = Math.random() * 1.6 * PR + 0.3
    const l = Math.random() < 0.5
    d.fillStyle = l ? `hsla(${hue},40%,60%,0.05)` : 'rgba(0,0,0,0.13)'
    d.beginPath()
    d.arc(x, y, r, 0, Math.PI * 2)
    d.fill()
  }
  return c
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  surface = buildSurface()
}

// --- drops ------------------------------------------------------------------
let drops = []
const rand = (a, b) => a + Math.random() * (b - a)
function spawn(x, y, r) {
  drops.push({ x, y, vx: 0, vy: 0, r, wob: 0, wa: Math.random() * Math.PI * 2 })
}

// --- pointer tilt -----------------------------------------------------------
const ptr = { x: 0, y: 0, t: -1e9 }
function onMove(e) {
  ptr.x = e.clientX * PR
  ptr.y = e.clientY * PR
  ptr.t = performance.now()
}
window.addEventListener('pointermove', onMove)
canvas.addEventListener('pointerdown', (e) => {
  onMove(e)
  spawn(ptr.x, ptr.y, rand(6, 12) * PR * params.size)
})

function gravity(now) {
  // Mouse tilts the tray toward the cursor; with no recent mouse the tray tilts
  // itself in a slow circle. The runtime's tilt.x mapping can add to this.
  const mag = params.tilt * 0.16 * PR
  if (now - ptr.t < 2500) {
    const dx = ptr.x - W / 2
    const dy = ptr.y - H / 2
    const d = Math.hypot(dx, dy) + 1e-3
    return { gx: (dx / d) * mag, gy: (dy / d) * mag }
  }
  const a = now * 0.00035
  return { gx: Math.cos(a) * mag, gy: Math.sin(a) * mag }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const dt = last ? Math.min(2.5, (now - last) / 16.7) : 1
  last = now

  const maxDrops = Math.floor((70 + 120 * params.density) * rt.detail)
  // Condensation: new beads appear on the dry surface.
  if (drops.length < maxDrops && Math.random() < params.density * 0.5) {
    spawn(rand(0, W), rand(0, H), rand(4, 9) * PR * params.size)
  }

  const { gx, gy } = gravity(now)
  const fr = Math.pow(1 - params.adhesion, dt) // rolling drag; low = hydrophobic

  for (const d of drops) {
    // Bigger beads have more inertia but the same gravitational acceleration.
    d.vx = (d.vx + gx * dt) * fr
    d.vy = (d.vy + gy * dt) * fr
    d.x += d.vx * dt
    d.y += d.vy * dt
    if (d.wob > 0.001) d.wob *= Math.pow(0.9, dt) // surface-tension jiggle decays
  }

  // Superhydrophobic beads roll clean off the edge of the surface rather than
  // piling up against a wall — drop anything fully past the border. New beads
  // keep condensing in, so the surface stays alive.
  drops = drops.filter((d) => d.x > -d.r && d.x < W + d.r && d.y > -d.r && d.y < H + d.r)

  // Coalescence: overlapping beads merge (volume ∝ r³, momentum conserved).
  for (let i = 0; i < drops.length; i++) {
    const a = drops[i]
    for (let j = i + 1; j < drops.length; j++) {
      const b = drops[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rr = a.r + b.r
      if (dx * dx + dy * dy < rr * rr * 0.82) {
        const va = a.r ** 3
        const vb = b.r ** 3
        const m = va + vb
        a.x = (a.x * va + b.x * vb) / m
        a.y = (a.y * va + b.y * vb) / m
        a.vx = (a.vx * va + b.vx * vb) / m
        a.vy = (a.vy * va + b.vy * vb) / m
        a.r = Math.cbrt(m)
        a.wob = Math.min(1, a.wob + b.r / a.r) // the merge shudders the drop
        // A vigorous merge can flick out a satellite droplet.
        if (params.wobble > 0.2 && b.r > 6 * PR && Math.random() < 0.4) {
          const ang = Math.random() * Math.PI * 2
          const sr = b.r * 0.32
          a.r = Math.cbrt(m - sr ** 3)
          spawn(a.x + Math.cos(ang) * (a.r + sr + 2), a.y + Math.sin(ang) * (a.r + sr + 2), sr)
          const s = drops[drops.length - 1]
          s.vx = a.vx + Math.cos(ang) * 2 * PR
          s.vy = a.vy + Math.sin(ang) * 2 * PR
        }
        drops.splice(j, 1)
        j--
      }
    }
  }

  // --- render ---
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(surface, 0, 0)
  // Draw small beads first so big ones sit on top.
  drops.sort((p, q) => p.r - q.r)
  for (const d of drops) drawBead(d)

  requestAnimationFrame(frame)
}

// A glossy near-spherical bead, lit from the upper-left: contact shadow, a
// darkened refractive body, a bright rim from total internal reflection, a
// sharp specular, and a focused caustic on the far side.
function drawBead(d) {
  const wob = d.wob * params.wobble
  const rx = d.r * (1 + wob * 0.18 * Math.cos(d.wa))
  const ry = d.r * (1 - wob * 0.18 * Math.cos(d.wa))
  const hue = params.hue
  const gloss = params.gloss

  // Contact shadow (offset down-right).
  ctx.globalCompositeOperation = 'source-over'
  const sg = ctx.createRadialGradient(
    d.x + d.r * 0.28,
    d.y + d.r * 0.34,
    0,
    d.x + d.r * 0.28,
    d.y + d.r * 0.34,
    d.r * 1.35,
  )
  sg.addColorStop(0, 'rgba(0,0,0,0.45)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.ellipse(d.x + d.r * 0.28, d.y + d.r * 0.34, d.r * 1.35, d.r * 1.2, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.translate(d.x, d.y)
  ctx.scale(rx / d.r, ry / d.r)

  // Refractive body: darker in the middle (looking through to the dark
  // surface), a touch of the surface hue, brightening toward the edge.
  const bg = ctx.createRadialGradient(-d.r * 0.25, -d.r * 0.25, d.r * 0.1, 0, 0, d.r)
  bg.addColorStop(0, `hsla(${hue}, 45%, 30%, 0.55)`)
  bg.addColorStop(0.6, `hsla(${hue}, 40%, 16%, 0.5)`)
  bg.addColorStop(0.92, `hsla(${hue}, 55%, 50%, 0.5)`)
  bg.addColorStop(1, `hsla(${hue}, 60%, 70%, 0.85)`)
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.arc(0, 0, d.r, 0, Math.PI * 2)
  ctx.fill()

  // Bright rim ring (total internal reflection).
  ctx.lineWidth = Math.max(0.6, d.r * 0.06)
  ctx.strokeStyle = `hsla(${hue}, 70%, 82%, ${0.5 * gloss})`
  ctx.beginPath()
  ctx.arc(0, 0, d.r * 0.95, 0, Math.PI * 2)
  ctx.stroke()

  // Focused caustic on the lower-right — light bent through the drop.
  const cg = ctx.createRadialGradient(d.r * 0.34, d.r * 0.36, 0, d.r * 0.34, d.r * 0.36, d.r * 0.5)
  cg.addColorStop(0, `hsla(${(hue + 20) % 360}, 90%, 85%, ${0.5 * gloss})`)
  cg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.arc(0, 0, d.r, 0, Math.PI * 2)
  ctx.fill()

  // Sharp specular highlight (upper-left).
  const hg = ctx.createRadialGradient(-d.r * 0.34, -d.r * 0.38, 0, -d.r * 0.34, -d.r * 0.38, d.r * 0.5)
  hg.addColorStop(0, `rgba(255,255,255,${0.95 * gloss})`)
  hg.addColorStop(0.5, `rgba(255,255,255,${0.25 * gloss})`)
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hg
  ctx.beginPath()
  ctx.ellipse(-d.r * 0.34, -d.r * 0.38, d.r * 0.4, d.r * 0.3, -0.6, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
