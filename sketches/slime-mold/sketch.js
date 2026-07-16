/**
 * Slime Mold — a continuous Physarum plasmodium (no agents/particles). Two grid
 * fields drive it: `mass` (the body's local thickness) and `chem` (a food
 * chemoattractant that diffuses outward from resources). Each step:
 *
 *   • food emits chem, which diffuses widely; the body consumes it, so chem
 *     flows *from* unreached food *into* the colony — a gradient to climb;
 *   • the margin (empty cells touching the body) advances, foraging outward and
 *     biased up the chem gradient toward food (chemotaxis);
 *   • everywhere, body is sustained in proportion to the chem it sits on and
 *     otherwise starves — so bulk that isn't on a path between resources recedes;
 *   • an aggregation pass sharpens the remaining mass into tubes.
 *
 * The result is real Physarum behaviour: a growing/receding foraging margin that
 * refines into an efficient vein network linking the food sources. Click to drop
 * a food resource (a red berry); the colony grows to it and eats it.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  forage: { value: +rt.random(0.7, 1.1).toFixed(2), min: 0, max: 2, step: 0.05, label: 'Forage (margin advance)' },
  chemotaxis: { value: +rt.random(1.4, 2.2).toFixed(2), min: 0, max: 4, step: 0.05, label: 'Chemotaxis (to food)' },
  prune: { value: +rt.random(0.9, 1.3).toFixed(2), min: 0.1, max: 3, step: 0.05, label: 'Prune (retraction)' },
  veins: { value: +rt.random(0.3, 0.5).toFixed(2), min: 0, max: 0.9, step: 0.02, label: 'Vein sharpening' },
  reach: { value: +rt.random(0.9, 1.3).toFixed(2), min: 0.3, max: 2.5, step: 0.05, label: 'Chem reach' },
  hue: { value: +rt.random(0.12, 0.18).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  pulse: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Pulse (grow/recede)' },
  pulseRate: { value: 0.7, min: 0, max: 12, step: 0.05, label: 'Pulse rate (→ timelapse)' },
})
// Music: beats push a foraging surge, loudness quickens the pulse.
rt.mapInput('audio.pulse', 'forage', 0.5)
rt.mapInput('audio.volume', 'pulseRate', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')

let W, H, mass, chem, mtmp, ctmp, noise, wavePhase, img, sim, sctx
const foods = []

function build() {
  const long = Math.min(Math.max(window.innerWidth, window.innerHeight), 460) // grid model — keep it lean
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  mass = new Float32Array(W * H)
  chem = new Float32Array(W * H)
  mtmp = new Float32Array(W * H)
  ctmp = new Float32Array(W * H)
  // Static heterogeneity of the substrate — breaks the radial symmetry of the
  // point food sources so the network nucleates as irregular reticulated veins
  // rather than perfect concentric rings.
  noise = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) noise[i] = 0.7 + rt.random(0, 0.6)
  // Spatial phase for the peristaltic contraction wave: distance from the
  // colony centre (so the pulse travels through the body instead of the whole
  // thing throbbing in unison), roughened by the substrate for organic fronts.
  wavePhase = new Float32Array(W * H)
  const wcx = W / 2, wcy = H / 2
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      wavePhase[idx(x, y)] = Math.hypot(x - wcx, y - wcy) + (noise[idx(x, y)] - 1) * 7
  sim = sim || document.createElement('canvas')
  sim.width = W
  sim.height = H
  sctx = sim.getContext('2d')
  img = sctx.createImageData(W, H)

  // Inoculate a small central colony sitting on its first food resource.
  const cx = (W / 2) | 0
  const cy = (H / 2) | 0
  const R = Math.max(3, Math.min(W, H) * 0.04)
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++)
      if (x * x + y * y <= R * R) mass[(cy + y) * W + cx + x] = 1
  foods.length = 0
  foods.push({ x: cx, y: cy, amount: 1, home: true }) // the home flake keeps a base
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  build()
}

const idx = (x, y) => y * W + x

// --- one simulation step -------------------------------------------------
function stepSim(phase) {
  // 1) Food emits a modest amount of chem (kept small so it stays a localized
  //    gradient rather than flooding the field).
  for (const f of foods) {
    const r = 3 + 3 * f.amount
    const cx = f.x | 0
    const cy = f.y | 0
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue
        const px = cx + x
        const py = cy + y
        if (px < 0 || px >= W || py < 0 || py >= H) continue
        chem[idx(px, py)] += 0.12 * f.amount
      }
    }
  }

  // 2) Chem diffusion (4-neighbour) + strong decay so it forms a local gradient;
  //    the body consumes it hard, so chem flows from food into the colony (the
  //    gradient the margin climbs). `reach` widens the foraging radius.
  const spread = 0.24 * params.reach
  const decay = 0.9
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : 0
    const yd = y < H - 1 ? y + 1 : H - 1
    for (let x = 0; x < W; x++) {
      const xl = x > 0 ? x - 1 : 0
      const xr = x < W - 1 ? x + 1 : W - 1
      const i = idx(x, y)
      const lap = chem[idx(xl, y)] + chem[idx(xr, y)] + chem[idx(x, yu)] + chem[idx(x, yd)] - 4 * chem[i]
      let c = (chem[i] + spread * lap) * decay
      c *= 1 - mass[i] * 0.2 // body uses up the attractant it sits on
      ctmp[i] = c > 0 ? c : 0
    }
  }
  const cs = chem
  chem = ctmp
  ctmp = cs

  // 3) Mass update. The margin only creeps forward where it can smell food
  //    (growth is gated on chem, so the colony reaches *toward* resources rather
  //    than swelling into a blob), and standing body survives only where chem is
  //    present — near food and along the overlapping gradients that link one food
  //    to another. Everywhere else a constant starvation retracts it, so bulk
  //    that isn't on a path between resources recedes and a vein network is left.
  //    Pulse rocks growth vs. starvation for the grow/recede breathing.
  const forageBase = params.forage
  const chemo = params.chemotaxis
  const starveBase = params.prune * 0.055
  const pulse = params.pulse
  const waveK = 0.09 // spatial frequency of the travelling contraction wave
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : 0
    const yd = y < H - 1 ? y + 1 : H - 1
    for (let x = 0; x < W; x++) {
      const xl = x > 0 ? x - 1 : 0
      const xr = x < W - 1 ? x + 1 : W - 1
      const i = idx(x, y)
      // Local phase of the peristaltic wave: growth crests and starvation
      // troughs sweep outward through the body as the wave travels, so mass
      // shuttles back and forth along the veins (protoplasmic streaming).
      const b = Math.sin(phase - waveK * wavePhase[i])
      const grow = forageBase * (1 + b * pulse * 0.7)
      const starve = starveBase * (1 - b * pulse * 0.5)
      const nMax = Math.max(mass[idx(xl, y)], mass[idx(xr, y)], mass[idx(x, yu)], mass[idx(x, yd)])
      let m = mass[i]
      const c = chem[i]
      if (nMax > 0.12 && m < nMax) {
        // Margin cell: chemotactic advance up the food gradient, plus a whisper
        // of blind creep so a colony can still nose toward nearby resources.
        m += grow * (0.0015 + chemo * c) * (nMax - m)
      }
      // Standing body is sustained by chem *flux* (the gradient it sits on), not
      // by chem level. A flat plateau of chem carries no flux, so idle bulk
      // starves away; only cells on the gradient lines that actually shuttle
      // attractant — near food and along the routes linking one food to another —
      // stay fed. This is what refines the colony into an efficient vein network.
      const flux = Math.abs(chem[idx(xr, y)] - chem[idx(xl, y)]) + Math.abs(chem[idx(x, yd)] - chem[idx(x, yu)])
      m += 4.5 * noise[i] * flux // chem flux sustains veins; substrate biases where
      m -= starve // constant retraction; only flux-carrying body survives
      mtmp[i] = m < 0 ? 0 : m > 1 ? 1 : m
    }
  }
  const ms = mass
  mass = mtmp
  mtmp = ms

  // 4) Cohesion pass. A light diffusion keeps the body a continuous sheet (no
  //    checkerboard), while a nonlinear contrast term driven by `veins` pulls
  //    faint cells down and firm cells up — so diffuse foraging fronts fade
  //    unless they are reinforced, and surviving mass tightens into tubes.
  const k = params.veins
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : 0
    const yd = y < H - 1 ? y + 1 : H - 1
    const yu2 = y > 1 ? y - 2 : 0
    const yd2 = y < H - 2 ? y + 2 : H - 1
    for (let x = 0; x < W; x++) {
      const xl = x > 0 ? x - 1 : 0
      const xr = x < W - 1 ? x + 1 : W - 1
      const xl2 = x > 1 ? x - 2 : 0
      const xr2 = x < W - 2 ? x + 2 : W - 1
      const i = idx(x, y)
      // Wide (radius-2) neighbourhood average — a fatter blur that raises the
      // pattern wavelength, so bands coalesce into a few bold branching veins
      // separated by broad dark gaps rather than many thin concentric rings.
      const near = (mass[idx(xl, y)] + mass[idx(xr, y)] + mass[idx(x, yu)] + mass[idx(x, yd)])
      const far = (mass[idx(xl2, y)] + mass[idx(xr2, y)] + mass[idx(x, yu2)] + mass[idx(x, yd2)])
      const avg = near * 0.08 + far * 0.045 // neighbour weights sum to 0.5
      // Smooth toward the neighbourhood, then bias by how a cell compares to it:
      // above-average cells firm up, below-average cells thin out.
      let m = mass[i] * 0.5 + avg
      m += k * 0.18 * (m - avg)
      mtmp[i] = m < 0 ? 0 : m > 1 ? 1 : m
    }
  }
  const ms2 = mass
  mass = mtmp
  mtmp = ms2

  // 5) Food consumption: a resource covered by the body is eaten (home persists).
  for (let kk = foods.length - 1; kk >= 0; kk--) {
    const f = foods[kk]
    const cover = mass[idx(Math.min(W - 1, Math.max(0, f.x | 0)), Math.min(H - 1, Math.max(0, f.y | 0)))]
    if (!f.home) {
      f.amount -= cover * 0.004
      if (f.amount <= 0) foods.splice(kk, 1)
    }
  }
}

function hslRGB(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

function render() {
  const data = img.data
  const [hr, hg, hb] = hslRGB(params.hue, 0.85, 0.55)
  const [er, eg, eb] = hslRGB(params.hue + 0.04, 0.9, 0.72) // brighter vein cores
  for (let i = 0; i < W * H; i++) {
    const m = mass[i]
    const g = Math.pow(Math.min(1, m * 1.15), 0.7)
    // Blend toward a lighter core on the thick veins.
    const t = Math.min(1, m * 1.4)
    data[i * 4] = (hr * (1 - t) + er * t) * g * 255
    data[i * 4 + 1] = (hg * (1 - t) + eg * t) * g * 255
    data[i * 4 + 2] = (hb * (1 - t) + eb * t) * g * 255
    data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sim, 0, 0, canvas.width, canvas.height)

  // Food resources: distinct red berries drawn on top; shrink as they're eaten.
  const sx = canvas.width / W
  const sy = canvas.height / H
  for (const f of foods) {
    if (f.home) continue
    const cx = f.x * sx
    const cy = f.y * sy
    const rr = (5 + 6 * f.amount) * sx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.7)
    grad.addColorStop(0, `rgba(255, 130, 80, ${0.95 * f.amount})`)
    grad.addColorStop(0.5, `rgba(230, 45, 40, ${0.55 * f.amount})`)
    grad.addColorStop(1, 'rgba(180, 20, 20, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, rr * 1.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(255, 160, 100, ${0.9 * f.amount})`
    ctx.beginPath()
    ctx.arc(cx, cy, rr * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

let pulsePhase = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  pulsePhase += params.pulseRate * dt
  // A couple of sub-steps per frame keeps the front moving at a good pace.
  stepSim(pulsePhase)
  stepSim(pulsePhase)
  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  foods.push({
    x: ((e.clientX - r.left) / r.width) * W,
    y: ((e.clientY - r.top) / r.height) * H,
    amount: 1,
  })
  if (hint) hint.style.opacity = 0
})

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
