/**
 * Luminol — the forensic chemiluminescence reaction. A dark scene hides a
 * blood-stain pattern (impact spatter, cast-off arc, a smeared handprint,
 * footprints or a pool with drips). A spray front sweeps across, and wherever it
 * wets the latent stain the luminol flares up in eerie glowing blue-cyan —
 * flashing bright, fizzing with sparks, then fading over several seconds as the
 * reaction dies. Then it re-sprays and re-reveals. Turn on the mic and each beat
 * triggers a fresh spray. Pattern, glow, bloom, spray speed, persistence,
 * density, hue and sparkle are all live.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  pattern: { value: 'Spatter', type: 'select', options: ['Spatter', 'Cast-off', 'Handprint', 'Footprints', 'Pool & drips'], label: 'Stain pattern' },
  glow: { value: 1, min: 0.2, max: 2.2, step: 0.05, label: 'Glow' },
  spread: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Bloom' },
  spraySpeed: { value: 0.3, min: 0.06, max: 1, step: 0.02, label: 'Spray speed' },
  persistence: { value: 5, min: 1.5, max: 12, step: 0.5, label: 'Persistence' },
  density: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Stain density' },
  hue: { value: 198, min: 160, max: 250, step: 1, label: 'Glow hue' },
  sparkle: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Sparkle' },
  auto: { value: true, type: 'bool', label: 'Auto re-spray' },
})
rt.mapInput('audio.level', 'glow', 0.4)
rt.mapInput('audio.pulse', 'sparkle', 0.4)

const TAU = Math.PI * 2
const A = 0.18, cosA = Math.cos(A), sinA = Math.sin(A) // spray sweep axis
let W = 0, H = 0, PR = 1, minS = 0
let bgTex = null

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  minS = Math.min(W, H)
  buildBg()
  respray()
}
// baked dark scene: cool near-black with faint grain and a vignette
function buildBg() {
  bgTex = document.createElement('canvas'); bgTex.width = W; bgTex.height = H
  const g = bgTex.getContext('2d')
  g.fillStyle = '#03040b'; g.fillRect(0, 0, W, H)
  const n = Math.floor((W * H) / 1400)
  for (let i = 0; i < n; i++) {
    const b = rt.random(0.02, 0.09)
    g.fillStyle = `rgba(120,140,170,${b})`
    g.fillRect(rt.random(0, W), rt.random(0, H), PR, PR)
  }
  const v = g.createRadialGradient(W / 2, H / 2, minS * 0.25, W / 2, H / 2, minS * 0.85)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.72)')
  g.fillStyle = v; g.fillRect(0, 0, W, H)
}

// --- latent stain pattern ----------------------------------------------------
let marks = []
function pushMark(nx, ny, nr, elong, ang) {
  marks.push({
    x: nx * W, y: ny * H, r: Math.max(1.5, nr * minS), elong, ang,
    u: nx * cosA + ny * sinA, a: 0, lit: false, peak: false, age: 0,
  })
}
function buildPattern() {
  marks = []
  const d = params.density
  const rnd = rt.random
  const rot = (dx, dy, cx, cy, s, r) => [cx + (dx * Math.cos(r) - dy * Math.sin(r)) * s, cy + (dx * Math.sin(r) + dy * Math.cos(r)) * s]

  if (params.pattern === 'Spatter') {
    const impacts = 1 + (rnd(0, 1.6 * d) | 0)
    for (let m = 0; m < impacts; m++) {
      const cx = rnd(0.28, 0.72), cy = rnd(0.3, 0.7)
      const dir = rnd(0, TAU), arc = rnd(0.5, 1.4)
      for (let k = 0; k < 6; k++) pushMark(cx + rnd(-0.02, 0.02), cy + rnd(-0.02, 0.02), rnd(0.02, 0.05), 1, 0) // pooled core
      const n = Math.round(70 * d)
      for (let k = 0; k < n; k++) {
        const ang = dir + rnd(-1, 1) * arc
        const dist = Math.pow(rnd(0, 1), 1.7) * 0.34
        const nx = cx + Math.cos(ang) * dist, ny = cy + Math.sin(ang) * dist * 0.94
        const sz = Math.max(0.004, 0.02 * (1 - dist * 1.6))
        pushMark(nx, ny, sz, 1 + dist * 4, ang) // outer droplets streak radially
      }
    }
  } else if (params.pattern === 'Cast-off') {
    // a swung arc of droplets flung off a moving edge
    const cx = rnd(0.2, 0.5), cy = rnd(0.2, 0.5), rr = rnd(0.4, 0.7)
    const a0 = rnd(-0.4, 0.2), a1 = a0 + rnd(1.6, 2.4)
    const n = Math.round(60 * d)
    for (let k = 0; k < n; k++) {
      const t = k / n
      const a = a0 + (a1 - a0) * t
      const jit = rnd(-0.02, 0.02)
      const nx = cx + Math.cos(a) * (rr + jit), ny = cy + Math.sin(a) * (rr + jit)
      const sz = 0.006 + 0.014 * (0.5 + 0.5 * Math.sin(t * 9))
      pushMark(nx, ny, sz, 2.2, a + Math.PI / 2)
    }
  } else if (params.pattern === 'Handprint') {
    const hx = rnd(0.35, 0.65), hy = rnd(0.4, 0.66), hs = rnd(0.14, 0.2), r = rnd(-0.5, 0.5)
    // palm
    for (let k = 0; k < Math.round(26 * d); k++) {
      const dx = rnd(-0.5, 0.5), dy = rnd(0.15, 0.85)
      const [nx, ny] = rot(dx, dy, hx, hy, hs, r)
      pushMark(nx, ny, rnd(0.012, 0.03), 1.2, r + Math.PI / 2)
    }
    // four fingers + thumb
    const fingers = [[-0.42, 1.9], [-0.16, 2.15], [0.12, 2.1], [0.4, 1.8], [-0.72, 0.65]]
    for (const [fx, fl] of fingers) {
      const seg = Math.round(5 * d) + 3
      for (let s = 0; s < seg; s++) {
        const dy = 0.75 + (fl - 0.75) * (s / seg)
        const [nx, ny] = rot(fx + rnd(-0.03, 0.03), dy, hx, hy, hs, r)
        pushMark(nx, ny, rnd(0.01, 0.02), 1.3, r + Math.PI / 2)
      }
    }
  } else if (params.pattern === 'Footprints') {
    for (let f = 0; f < 2; f++) {
      const fx = 0.4 + f * 0.16, fy = 0.62 - f * 0.16, fs = rnd(0.12, 0.16), r = rnd(-0.3, 0.1) + f * 0.15
      // sole
      for (let k = 0; k < Math.round(30 * d); k++) {
        const dy = rnd(-0.9, 0.6), w = 0.42 * (1 - Math.abs(dy) * 0.3)
        const [nx, ny] = rot(rnd(-w, w), dy, fx, fy, fs, r)
        pushMark(nx, ny, rnd(0.008, 0.018), 1, 0)
      }
      // heel
      for (let k = 0; k < Math.round(14 * d); k++) {
        const [nx, ny] = rot(rnd(-0.3, 0.3), rnd(0.75, 1.15), fx, fy, fs, r)
        pushMark(nx, ny, rnd(0.01, 0.02), 1, 0)
      }
    }
  } else {
    // Pool & drips
    const cx = rnd(0.35, 0.65), cy = rnd(0.28, 0.45)
    for (let k = 0; k < Math.round(40 * d); k++) {
      const ang = rnd(0, TAU), dist = Math.pow(rnd(0, 1), 0.5) * 0.12
      pushMark(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.7, rnd(0.02, 0.05), 1, 0)
    }
    const drips = Math.round(5 * d) + 2
    for (let dpi = 0; dpi < drips; dpi++) {
      const dx = cx + rnd(-0.1, 0.1), top = cy + 0.06
      const len = rnd(0.1, 0.4), seg = Math.round(len * 40 * d)
      for (let s = 0; s < seg; s++) {
        const ny = top + (len) * (s / seg)
        pushMark(dx + rnd(-0.008, 0.008), ny, rnd(0.004, 0.012) * (1 - s / seg * 0.5), 2.5, Math.PI / 2)
      }
      pushMark(dx, top + len, rnd(0.012, 0.02), 1, 0) // bead at the end
    }
  }
}

// --- spray + reaction state --------------------------------------------------
let front = -0.3, spraying = true
const spray = [] // airborne mist particles
function respray() {
  front = -0.3; spraying = true
  buildPattern()
}
rt.onBeat(() => { if (front > 0.55 || !spraying) respray() })

function col(h, l, a) { return `hsla(${h}, 100%, ${l}%, ${a})` }

function drawMark(m) {
  const a = Math.min(1.4, m.a * params.glow)
  if (a <= 0.01) return
  const bloom = 1 + 0.6 * Math.exp(-m.age * 3) // wet spread right after it lights
  const R = m.r * (0.7 + 0.5 * m.a) * bloom * (1 + params.spread * 0.9)
  const h = params.hue
  ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang); ctx.scale(m.elong, 1)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
  g.addColorStop(0, col(h - 8, 92, Math.min(1, a)))
  g.addColorStop(0.32, col(h, 60, 0.5 * a))
  g.addColorStop(1, col(h + 6, 45, 0))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill()
  ctx.restore()
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now

  // advance the spray front and light up marks it crosses
  if (spraying) {
    front += params.spraySpeed * dt
    // airborne mist near the front
    for (let i = 0; i < 4; i++) {
      const v = rt.random(-0.15, 1.35)
      const nx = front * cosA - v * sinA, ny = front * sinA + v * cosA
      spray.push({ x: nx * W, y: ny * H, vx: (cosA * 12 + rt.random(-6, 6)) * PR, vy: (sinA * 12 + rt.random(2, 14)) * PR, life: 1 })
    }
    if (front > 1.55) spraying = false
  }
  let maxA = 0
  for (const m of marks) {
    if (!m.lit && front >= m.u) { m.lit = true }
    if (m.lit) {
      m.age += dt
      if (!m.peak) { m.a += dt * 7; if (m.a >= 1) { m.a = 1; m.peak = true } }
      else m.a *= Math.exp(-dt / params.persistence)
      if (m.a > maxA) maxA = m.a
    }
  }
  if (!spraying && maxA < 0.02 && params.auto) respray()

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(bgTex, 0, 0)

  ctx.globalCompositeOperation = 'lighter'
  for (const m of marks) drawMark(m)

  // sparkle: the reaction fizzing on freshly-wet, still-bright marks
  const spk = params.sparkle
  if (spk > 0) {
    for (const m of marks) {
      if (m.a < 0.15) continue
      if (rt.rng() < spk * 0.5 * m.a) {
        const rr = m.r * (1 + params.spread) * rt.random(0.2, 1.1)
        const ang = rt.random(0, TAU)
        const sx = m.x + Math.cos(ang) * rr, sy = m.y + Math.sin(ang) * rr
        const s = PR * rt.random(0.6, 1.8)
        ctx.fillStyle = col(params.hue - 10, 96, 0.9 * m.a)
        ctx.beginPath(); ctx.arc(sx, sy, s, 0, TAU); ctx.fill()
      }
    }
  }

  // airborne mist
  for (let i = spray.length - 1; i >= 0; i--) {
    const p = spray[i]
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6
    if (p.life <= 0) { spray.splice(i, 1); continue }
    ctx.fillStyle = col(params.hue, 70, 0.05 * p.life)
    ctx.beginPath(); ctx.arc(p.x, p.y, PR * 2.4, 0, TAU); ctx.fill()
  }

  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
