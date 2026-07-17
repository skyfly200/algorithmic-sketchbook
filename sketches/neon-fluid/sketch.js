/**
 * Neon fluid: thousands of luminous particles swept along a divergence-free
 * curl-noise flow field, leaving glowing trails on a dark ground. Curl of a
 * scrolling fractal potential gives an incompressible, fluid-like velocity
 * field (it swirls instead of piling up); additive blending plus a bloom pass
 * make the streaks read as neon. Drag to stir the fluid; beats pulse the flow.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  flow: { value: 1.0, min: 0.2, max: 3, step: 0.05, label: 'Flow speed' },
  swirl: { value: 1.0, min: 0.3, max: 2.5, step: 0.05, label: 'Swirl' },
  scale: { value: 1.0, min: 0.4, max: 2.5, step: 0.05, label: 'Field scale' },
  density: { value: 0.7, min: 0.15, max: 1, step: 0.05, label: 'Particles' },
  fade: { value: 0.09, min: 0.02, max: 0.3, step: 0.01, label: 'Trail length' },
  glow: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Bloom' },
  hue: { value: 185, min: 0, max: 360, step: 1, label: 'Base hue' },
  hueSpread: { value: 170, min: 0, max: 260, step: 1, label: 'Hue spread' },
})
rt.mapInput('audio.volume', 'flow', 0.6)
rt.mapInput('audio.pulse', 'swirl', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// Persistent trail buffer — particles accumulate here and fade over time. The
// display canvas composites this plus a bloom pass, so bloom never feeds back.
const trailC = document.createElement('canvas')
const trailCtx = trailC.getContext('2d')
const glowC = document.createElement('canvas')
const glowCtx = glowC.getContext('2d')

// --- value-noise fractal for the flow potential -----------------------------
const seedOff = rt.rng() * 1000
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seedOff) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
}
function fbm(x, y) {
  let sum = 0
  let amp = 0.5
  let f = 1
  let norm = 0
  for (let i = 0; i < 4; i++) {
    sum += amp * vnoise(x * f, y * f)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

let W = 0
let H = 0
let PR = 1
let ps = null // particle state: x,y arrays
let hueA = null
let N = 0
let tScroll = 0

function alloc() {
  N = Math.floor((5200 * params.density) * (0.5 + rt.detail))
  ps = { x: new Float32Array(N), y: new Float32Array(N), h: new Float32Array(N) }
  for (let i = 0; i < N; i++) {
    ps.x[i] = Math.random() * W
    ps.y[i] = Math.random() * H
    ps.h[i] = Math.random()
  }
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  for (const c of [trailC, glowC]) {
    c.width = W
    c.height = H
  }
  trailCtx.fillStyle = '#000'
  trailCtx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#04040a'
  ctx.fillRect(0, 0, W, H)
  alloc()
}

// --- pointer stirring -------------------------------------------------------
const mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, active: false }
function setMouse(e) {
  const nx = e.clientX * PR
  const ny = e.clientY * PR
  mouse.vx = nx - mouse.x
  mouse.vy = ny - mouse.y
  mouse.x = nx
  mouse.y = ny
  mouse.active = true
}
canvas.addEventListener('pointerdown', (e) => {
  mouse.down = true
  setMouse(e)
})
window.addEventListener('pointermove', setMouse)
window.addEventListener('pointerup', () => (mouse.down = false))

let lastDensity = -1
function frame(now) {
  rt.tick(now)
  if (params.density !== lastDensity) {
    alloc()
    lastDensity = params.density
  }

  // Fade the trail buffer toward black — this is the trail length.
  trailCtx.globalCompositeOperation = 'source-over'
  trailCtx.globalAlpha = 1
  trailCtx.fillStyle = `rgba(0,0,0,${params.fade})`
  trailCtx.fillRect(0, 0, W, H)

  tScroll += 0.0016 * params.flow
  const sc = (0.0022 / PR) * params.scale // spatial frequency of the field
  const spd = 2.4 * PR * params.flow
  const curlAmt = params.swirl
  const eps = 1.2
  const hueBase = params.hue
  const spread = params.hueSpread

  trailCtx.globalCompositeOperation = 'lighter'
  const mvx = mouse.vx
  const mvy = mouse.vy
  const stir = mouse.down || (mouse.active && (Math.abs(mvx) + Math.abs(mvy)) > 0.5)
  const stirR = 150 * PR
  mouse.vx *= 0.8
  mouse.vy *= 0.8

  for (let i = 0; i < N; i++) {
    let x = ps.x[i]
    let y = ps.y[i]

    // Curl of the scrolling potential → divergence-free velocity.
    const px = x * sc
    const py = y * sc + tScroll
    const n1 = fbm(px, py + eps)
    const n2 = fbm(px, py - eps)
    const n3 = fbm(px + eps, py)
    const n4 = fbm(px - eps, py)
    let vx = (n1 - n2) * curlAmt
    let vy = -(n3 - n4) * curlAmt
    const inv = spd / (Math.hypot(vx, vy) + 1e-4)
    vx *= inv
    vy *= inv

    // Pointer stir: push particles along the drag near the cursor.
    if (stir) {
      const dx = x - mouse.x
      const dy = y - mouse.y
      const d2 = dx * dx + dy * dy
      if (d2 < stirR * stirR) {
        const f = 1 - Math.sqrt(d2) / stirR
        vx += mvx * f * 1.6
        vy += mvy * f * 1.6
      }
    }

    x += vx
    y += vy

    // Wrap around the edges and re-seed a fraction for freshness.
    if (x < 0) x += W
    else if (x >= W) x -= W
    if (y < 0) y += H
    else if (y >= H) y -= H

    ps.x[i] = x
    ps.y[i] = y

    const speed = Math.hypot(vx, vy) / spd
    const h = (hueBase + ps.h[i] * spread + speed * 40) % 360
    const light = 52 + speed * 24
    trailCtx.fillStyle = `hsl(${h}, 100%, ${light}%)`
    trailCtx.fillRect(x, y, PR, PR)
  }
  trailCtx.globalCompositeOperation = 'source-over'

  // Composite to the display: dark ground + the trail buffer + a bloom pass
  // (blurred trail added on top). Bloom is display-only, never fed back.
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#04040a'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  ctx.drawImage(trailC, 0, 0)
  if (params.glow > 0.02) {
    glowCtx.globalCompositeOperation = 'source-over'
    glowCtx.globalAlpha = 1
    glowCtx.clearRect(0, 0, W, H)
    glowCtx.filter = `blur(${3.5 * PR}px)`
    glowCtx.drawImage(trailC, 0, 0)
    glowCtx.filter = 'none'
    ctx.globalAlpha = params.glow
    ctx.drawImage(glowC, 0, 0)
    ctx.globalAlpha = 1
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
