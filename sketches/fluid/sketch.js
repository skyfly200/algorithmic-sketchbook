/**
 * Fluid — a real-time incompressible fluid on a grid, after Jos Stam's "Stable
 * Fluids": semi-Lagrangian advection carries the velocity field and coloured dye
 * along the flow, a Jacobi pressure solve keeps it divergence-free (so it swirls
 * instead of piling up), and vorticity confinement feeds energy back into the
 * curl so the eddies stay lively. Drag to push the fluid and inject dye; it also
 * runs itself with drifting emitters. Grid solved on an offscreen and upscaled.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  force: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Push force' },
  swirl: { value: 3, min: 0, max: 8, step: 0.1, label: 'Vorticity (swirl)' },
  fade: { value: 0.5, min: 0, max: 2, step: 0.02, label: 'Dye fade' },
  iters: { value: 14, min: 4, max: 40, step: 1, label: 'Solver quality' },
  emit: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'Auto emitters' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette' },
})
// Music: beats shove the fluid, loudness spins up the swirl.
rt.mapInput('audio.pulse', 'force', 0.7)
rt.mapInput('audio.volume', 'swirl', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const sim = document.createElement('canvas')
const sctx = sim.getContext('2d')

// Grid: interior W×H with a 1-cell border (arrays sized gw×gh).
let W, H, gw, gh, N
let u, v, u0, v0, dr, dg, db, dr0, dg0, db0, p, div, curl, img
const IX = (i, j) => i + gw * j

function alloc(n) { return new Float32Array(n) }
function build() {
  const long = Math.round(Math.min(Math.max(window.innerWidth, window.innerHeight), 220) * rt.detail)
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  gw = W + 2
  gh = H + 2
  N = gw * gh
  ;[u, v, u0, v0, dr, dg, db, dr0, dg0, db0, p, div, curl] = Array.from({ length: 13 }, () => alloc(N))
  sim.width = W
  sim.height = H
  img = sctx.createImageData(W, H)
}
function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  build()
}

// --- Stam solver ---------------------------------------------------------
function setBnd(b, x) {
  for (let i = 1; i <= W; i++) {
    x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)]
    x[IX(i, H + 1)] = b === 2 ? -x[IX(i, H)] : x[IX(i, H)]
  }
  for (let j = 1; j <= H; j++) {
    x[IX(0, j)] = b === 1 ? -x[IX(1, j)] : x[IX(1, j)]
    x[IX(W + 1, j)] = b === 1 ? -x[IX(W, j)] : x[IX(W, j)]
  }
  x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)])
  x[IX(0, H + 1)] = 0.5 * (x[IX(1, H + 1)] + x[IX(0, H)])
  x[IX(W + 1, 0)] = 0.5 * (x[IX(W, 0)] + x[IX(W + 1, 1)])
  x[IX(W + 1, H + 1)] = 0.5 * (x[IX(W, H + 1)] + x[IX(W + 1, H)])
}
function linSolve(b, x, x0, a, c, iters) {
  const ic = 1 / c
  for (let k = 0; k < iters; k++) {
    for (let j = 1; j <= H; j++) {
      for (let i = 1; i <= W; i++) {
        const idx = IX(i, j)
        x[idx] = (x0[idx] + a * (x[idx - 1] + x[idx + 1] + x[idx - gw] + x[idx + gw])) * ic
      }
    }
    setBnd(b, x)
  }
}
function advect(b, d, d0, uu, vv, dt) {
  const dtx = dt * W
  const dty = dt * H
  for (let j = 1; j <= H; j++) {
    for (let i = 1; i <= W; i++) {
      const idx = IX(i, j)
      let x = i - dtx * uu[idx]
      let y = j - dty * vv[idx]
      if (x < 0.5) x = 0.5; else if (x > W + 0.5) x = W + 0.5
      if (y < 0.5) y = 0.5; else if (y > H + 0.5) y = H + 0.5
      const i0 = x | 0, i1 = i0 + 1
      const j0 = y | 0, j1 = j0 + 1
      const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1
      d[idx] =
        s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) +
        s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)])
    }
  }
  setBnd(b, d)
}
function project(uu, vv, pp, dv, iters) {
  const h = 1 / Math.max(W, H)
  for (let j = 1; j <= H; j++)
    for (let i = 1; i <= W; i++) {
      const idx = IX(i, j)
      dv[idx] = -0.5 * h * (uu[idx + 1] - uu[idx - 1] + vv[idx + gw] - vv[idx - gw])
      pp[idx] = 0
    }
  setBnd(0, dv); setBnd(0, pp)
  linSolve(0, pp, dv, 1, 4, iters)
  for (let j = 1; j <= H; j++)
    for (let i = 1; i <= W; i++) {
      const idx = IX(i, j)
      uu[idx] -= (0.5 * (pp[idx + 1] - pp[idx - 1])) / h
      vv[idx] -= (0.5 * (pp[idx + gw] - pp[idx - gw])) / h
    }
  setBnd(1, uu); setBnd(2, vv)
}
// Vorticity confinement: push velocity back toward the local curl so eddies
// don't dissipate — the classic trick for lively, turbulent-looking fluid.
function vorticity(eps, dt) {
  for (let j = 1; j <= H; j++)
    for (let i = 1; i <= W; i++) {
      const idx = IX(i, j)
      curl[idx] = Math.abs((v[idx + 1] - v[idx - 1] - u[idx + gw] + u[idx - gw]) * 0.5)
    }
  for (let j = 2; j <= H - 1; j++)
    for (let i = 2; i <= W - 1; i++) {
      const idx = IX(i, j)
      let nx = (curl[idx + 1] - curl[idx - 1]) * 0.5
      let ny = (curl[idx + gw] - curl[idx - gw]) * 0.5
      const len = Math.hypot(nx, ny) + 1e-5
      nx /= len; ny /= len
      const c = (v[idx + 1] - v[idx - 1] - u[idx + gw] + u[idx - gw]) * 0.5
      u[idx] += eps * dt * (ny * c) * W
      v[idx] += eps * dt * (-nx * c) * H
    }
}

function velStep(dt, iters) {
  if (params.swirl > 0) vorticity(params.swirl * 0.03, dt)
  project(u, v, p, div, iters)
  ;[u, u0] = [u0, u]
  ;[v, v0] = [v0, v]
  advect(1, u, u0, u0, v0, dt)
  advect(2, v, v0, u0, v0, dt)
  project(u, v, p, div, iters)
}
function dyeStep(dt) {
  ;[dr, dr0] = [dr0, dr]; advect(0, dr, dr0, u, v, dt)
  ;[dg, dg0] = [dg0, dg]; advect(0, dg, dg0, u, v, dt)
  ;[db, db0] = [db0, db]; advect(0, db, db0, u, v, dt)
  const k = 1 - params.fade * 0.02
  for (let i = 0; i < N; i++) { dr[i] *= k; dg[i] *= k; db[i] *= k }
}

function hslRGB(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
// Splat velocity + coloured dye into the grid around (gx,gy) in grid coords.
function splat(gx, gy, fx, fy, col, rad) {
  const r2 = rad * rad
  const r = Math.ceil(rad)
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const i = (gx + dx) | 0, j = (gy + dy) | 0
      if (i < 1 || i > W || j < 1 || j > H) continue
      const w = Math.exp(-d2 / (r2 * 0.4))
      const idx = IX(i, j)
      u[idx] += fx * w
      v[idx] += fy * w
      dr[idx] += col[0] * w
      dg[idx] += col[1] * w
      db[idx] += col[2] * w
    }
}

function render() {
  const data = img.data
  for (let j = 1; j <= H; j++)
    for (let i = 1; i <= W; i++) {
      const idx = IX(i, j)
      const o = ((j - 1) * W + (i - 1)) * 4
      data[o] = Math.min(255, dr[idx] * 255)
      data[o + 1] = Math.min(255, dg[idx] * 255)
      data[o + 2] = Math.min(255, db[idx] * 255)
      data[o + 3] = 255
    }
  sctx.putImageData(img, 0, 0)
  ctx.fillStyle = '#04050a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)
}

// --- interaction + auto emitters -----------------------------------------
const hint = document.getElementById('hint')
const pointer = { x: 0, y: 0, px: 0, py: 0, down: false, moved: false }
function toGrid(e) {
  const r = canvas.getBoundingClientRect()
  return [1 + (e.clientX - r.left) / r.width * W, 1 + (e.clientY - r.top) / r.height * H]
}
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = toGrid(e)
  pointer.x = pointer.px = x
  pointer.y = pointer.py = y
  pointer.down = true
})
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toGrid(e)
  pointer.px = pointer.x
  pointer.py = pointer.y
  pointer.x = x
  pointer.y = y
  pointer.moved = true
  if (hint) hint.style.opacity = 0
})
window.addEventListener('pointerup', () => (pointer.down = false))

let hueDrift = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.03, lastNow ? (now - lastNow) / 1000 : 0.016)
  lastNow = now
  hueDrift += dt * 0.05
  const iters = Math.round(params.iters)

  // Mouse drag: push the fluid and inject dye along the drag.
  if (pointer.down && pointer.moved) {
    const fx = (pointer.x - pointer.px) * params.force * 6
    const fy = (pointer.y - pointer.py) * params.force * 6
    const col = hslRGB((params.hue + hueDrift) % 1, 0.9, 0.6)
    splat(pointer.x, pointer.y, fx, fy, col, Math.max(3, W * 0.03))
    pointer.px = pointer.x
    pointer.py = pointer.y
    pointer.moved = false
  }

  // Auto emitters: a couple of drifting jets keep it alive with no input.
  if (params.emit > 0) {
    const t = now * 0.001
    for (let e = 0; e < 2; e++) {
      const ph = t * (0.3 + e * 0.17) + e * 2.1
      const gx = 1 + W * (0.5 + 0.32 * Math.cos(ph * 1.3 + e))
      const gy = 1 + H * (0.5 + 0.32 * Math.sin(ph + e * 2))
      const ang = ph * 1.7
      const f = params.emit * params.force * 2.2
      const col = hslRGB((params.hue + hueDrift + e * 0.4) % 1, 0.9, 0.6)
      splat(gx, gy, Math.cos(ang) * f, Math.sin(ang) * f, col.map((c) => c * params.emit), Math.max(2.5, W * 0.02))
    }
  }

  velStep(dt, iters)
  dyeStep(dt)
  render()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
