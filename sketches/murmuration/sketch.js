// Murmuration — a dusk flock of starlings run as boids (separation, alignment,
// cohesion) over a spatial grid so hundreds of birds stay cheap. A wheeling
// predator (and your pointer) triggers a startle-wave that scatters the flock
// into ribbons that ripple out and re-form. Density does the rest: thousands
// of tiny dark dashes overlapping into breathing clouds against a fading sky.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  flock: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Flock size' },
  separation: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Separation' },
  alignment: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Alignment' },
  cohesion: { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Cohesion' },
  fear: { value: 1, min: 0, max: 3, step: 0.05, label: 'Predator fear' },
  speed: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Speed' },
  sky: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Dusk ↔ night' },
})
rt.mapInput('audio.pulse', 'fear', 0.5)
rt.mapInput('audio.level', 'speed', 0.3)

let W = 0, H = 0, PR = 1
let birds = []
const VIS = 34 // neighbour radius (screen px, pre-DPR)
function wantN() { return Math.round(520 * params.flock * rt.detail) }
function build() {
  const n = wantN()
  birds = []
  for (let i = 0; i < n; i++) {
    const a = rt.random(0, 6.28)
    birds.push({ x: rt.random(0, W), y: rt.random(0, H * 0.7), vx: Math.cos(a), vy: Math.sin(a) })
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })
window.addEventListener('pointerout', () => { ptr.t = -1e9 })

// uniform grid for neighbour lookups
let cell = 1, cols = 1, rows = 1
let grid = []
function rebuildGrid() {
  cell = VIS * PR
  cols = Math.max(1, Math.ceil(W / cell))
  rows = Math.max(1, Math.ceil(H / cell))
  grid = Array.from({ length: cols * rows }, () => [])
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i]
    const cx = Math.min(cols - 1, Math.max(0, (b.x / cell) | 0))
    const cy = Math.min(rows - 1, Math.max(0, (b.y / cell) | 0))
    grid[cy * cols + cx].push(i)
  }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  if (birds.length !== wantN()) build()

  // fading dusk-to-night sky
  const sk = params.sky
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgb(${Math.round(28 - sk * 20)},${Math.round(40 - sk * 30)},${Math.round(70 - sk * 45)})`)
  g.addColorStop(0.6, `rgb(${Math.round(70 - sk * 55)},${Math.round(70 - sk * 55)},${Math.round(95 - sk * 65)})`)
  g.addColorStop(1, `rgb(${Math.round(150 - sk * 120)},${Math.round(120 - sk * 100)},${Math.round(120 - sk * 95)})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  rebuildGrid()

  // predator: an automatic wheeling hawk, or the pointer when it's active
  const usePtr = performance.now() - ptr.t < 1500
  const hawkX = usePtr ? ptr.x : W * (0.5 + 0.4 * Math.cos(t * 0.25))
  const hawkY = usePtr ? ptr.y : H * (0.4 + 0.25 * Math.sin(t * 0.4))
  const fearR = 120 * PR
  const maxSpd = (2.6 + params.speed * 2.2) * PR
  const R = VIS * PR
  const R2 = R * R

  ctx.fillStyle = `rgba(${Math.round(12 + sk * 6)},${Math.round(14 + sk * 4)},${Math.round(20)},0.9)`
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i]
    let ax = 0, ay = 0
    let sepx = 0, sepy = 0, alx = 0, aly = 0, cox = 0, coy = 0, cnt = 0
    const gcx = Math.min(cols - 1, Math.max(0, (b.x / cell) | 0))
    const gcy = Math.min(rows - 1, Math.max(0, (b.y / cell) | 0))
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = gcx + ox, gy = gcy + oy
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue
        const bucket = grid[gy * cols + gx]
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k]
          if (j === i) continue
          const o = birds[j]
          const dx = b.x - o.x, dy = b.y - o.y
          const d2 = dx * dx + dy * dy
          if (d2 > R2 || d2 === 0) continue
          const d = Math.sqrt(d2)
          sepx += dx / d2 * R; sepy += dy / d2 * R // push away, stronger when close
          alx += o.vx; aly += o.vy
          cox += o.x; coy += o.y
          cnt++
        }
      }
    }
    if (cnt) {
      ax += sepx * 0.06 * params.separation
      ay += sepy * 0.06 * params.separation
      ax += (alx / cnt) * 0.9 * params.alignment
      ay += (aly / cnt) * 0.9 * params.alignment
      ax += ((cox / cnt) - b.x) * 0.0009 * params.cohesion
      ay += ((coy / cnt) - b.y) * 0.0009 * params.cohesion
    }
    // flee the predator
    const pdx = b.x - hawkX, pdy = b.y - hawkY
    const pd2 = pdx * pdx + pdy * pdy
    if (pd2 < fearR * fearR) {
      const pd = Math.sqrt(pd2) || 1
      const f = (1 - pd / fearR) * 3.5 * params.fear
      ax += (pdx / pd) * f
      ay += (pdy / pd) * f
    }
    // soft centering so the flock keeps to the sky, not the corners
    ax += (W * 0.5 - b.x) * 0.00015
    ay += (H * 0.42 - b.y) * 0.00025

    b.vx += ax * dt * 60
    b.vy += ay * dt * 60
    // clamp speed
    const sp = Math.hypot(b.vx, b.vy) || 1
    const want = Math.min(maxSpd, Math.max(maxSpd * 0.55, sp))
    b.vx = b.vx / sp * want
    b.vy = b.vy / sp * want
    b.x += b.vx
    b.y += b.vy
    // wrap horizontally, bounce off top/bottom softly
    if (b.x < -10) b.x = W + 10; else if (b.x > W + 10) b.x = -10
    if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) }
    else if (b.y > H) { b.y = H; b.vy = -Math.abs(b.vy) }

    // draw a short dash oriented along velocity — density makes the cloud
    const len = 3.2 * PR
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - (b.vx / want) * len, b.y - (b.vy / want) * len)
    ctx.lineWidth = 1.6 * PR
    ctx.strokeStyle = ctx.fillStyle
    ctx.stroke()
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
