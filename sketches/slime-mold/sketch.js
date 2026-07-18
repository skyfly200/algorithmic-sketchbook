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
  forage: { value: 1.0, min: 0, max: 2, step: 0.05, label: 'Forage (margin advance)' },
  chemotaxis: { value: 2.0, min: 0, max: 4, step: 0.05, label: 'Chemotaxis (to food)' },
  prune: { value: 1.0, min: 0.1, max: 3, step: 0.05, label: 'Prune (retraction)' },
  veins: { value: 0.4, min: 0, max: 0.9, step: 0.02, label: 'Vein sharpening' },
  reach: { value: 1.1, min: 0.3, max: 2.5, step: 0.05, label: 'Chem reach' },
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

let W, H, mass, chem, mtmp, ctmp, noise, terrain, wavePhase, img, sim, sctx, vblur, vtmp
let massFrac = 0 // fraction of the dish covered — drives density regulation
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
  vblur = new Float32Array(W * H)
  vtmp = new Float32Array(W * H)
  // Static heterogeneity of the substrate — breaks the radial symmetry of the
  // point food sources so the network nucleates as irregular reticulated veins
  // rather than perfect concentric rings.
  noise = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) noise[i] = 0.7 + rt.random(0, 0.6)
  // Smooth low-frequency terrain: a few random sinusoids. It biases where the
  // foraging front pushes fastest, so the colony explores as irregular lobes and
  // fingers reaching in different directions rather than perfect concentric rings.
  terrain = new Float32Array(W * H)
  const waves = Array.from({ length: 4 }, () => ({
    fx: rt.random(-1, 1) * 5.5 / W, fy: rt.random(-1, 1) * 5.5 / H, ph: rt.random(0, 6.28), a: rt.random(0.3, 0.7),
  }))
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0
      for (const w of waves) v += w.a * Math.sin(x * w.fx * Math.PI * 2 + y * w.fy * Math.PI * 2 + w.ph)
      terrain[idx(x, y)] = Math.max(0.15, 1 + v)
    }
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
  const R = Math.round(Math.max(3, Math.min(W, H) * 0.05))
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      if (x * x + y * y > R * R) continue
      const px = cx + x
      const py = cy + y
      if (px >= 0 && px < W && py >= 0 && py < H) mass[py * W + px] = 1
    }
  foods.length = 0
  foods.push({ x: cx, y: cy, amount: 1, home: true }) // the home flake keeps a base
  // Scatter a few resources out in the field so the colony explores and reaches
  // toward food from a distance by default (click to drop more).
  const nFood = 3 + Math.floor(rt.random(0, 3))
  let a0 = rt.random(0, Math.PI * 2)
  for (let k = 0; k < nFood; k++) {
    a0 += (Math.PI * 2) / nFood + rt.random(-0.5, 0.5)
    const rr = Math.min(W, H) * rt.random(0.16, 0.32)
    foods.push({ x: cx + Math.cos(a0) * rr, y: cy + Math.sin(a0) * rr, amount: 1 })
  }
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
        // A strong source: its gradient (flux) stays above the growth threshold
        // out to a large radius, so veins nucleate and reach the food from afar.
        chem[idx(px, py)] += 0.3 * f.amount
      }
    }
  }

  // 2) Chem diffusion (4-neighbour) + strong decay so it forms a local gradient;
  //    the body consumes it hard, so chem flows from food into the colony (the
  //    gradient the margin climbs). `reach` widens the foraging radius.
  const spread = Math.min(0.23, 0.24 * params.reach) // cap for numerical stability (avoids flood)
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
  const starveBase = params.prune * 0.06
  const pulse = params.pulse
  const waveK = 0.09 // spatial frequency of the travelling contraction wave
  // Density regulation: finite protoplasm. As coverage rises, new growth is
  // throttled toward zero so the colony can't flood — it plateaus into a
  // reaching, reticulated network across every seed and food layout.
  const grow2 = Math.max(0.06, 1 - Math.max(0, massFrac - 0.2) * 4)
  let massSum = 0
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
      const grow = forageBase * (1 + b * pulse * 0.35) // wave breathes the growth (kept gentle so it doesn't ring)
      const starve = starveBase * (1 - b * pulse * 0.5)
      const nMax = Math.max(mass[idx(xl, y)], mass[idx(xr, y)], mass[idx(x, yu)], mass[idx(x, yd)])
      let m = mass[i]
      const c = chem[i]
      if (nMax > 0.06 && m < nMax) {
        // Margin cell advances: a substrate-biased blind creep that pushes
        // pseudopods outward to *explore* the dish (physically crossing the gaps
        // that chemoattractant can't diffuse across), plus a chemotactic pull up
        // the food gradient that steers and thickens the ones nearing a resource.
        m += grow2 * grow * (0.11 * noise[i] + chemo * c) * (nMax - m)
      }
      // Standing tissue is sustained by chem *flux* (the gradient it sits on): high
      // near food and along the veins between resources, ~0 on flat plateaus, so
      // idle exploratory bulk starves to dark while flux-fed routes thicken into
      // the persistent network reaching every resource it has found.
      const flux = Math.abs(chem[idx(xr, y)] - chem[idx(xl, y)]) + Math.abs(chem[idx(x, yd)] - chem[idx(x, yu)])
      m += 4.5 * noise[i] * flux
      // Self-reinforcing growth (a Fisher–KPP reaction on existing tissue): the
      // plasmodium spreads outward as a living front, so it survives the gaps
      // between food zones and explores the dish. The density throttle caps how
      // far it ranges; chem flux then thickens the routes that found food.
      // Regrowth targets ~0.75, not full thickness: bulk tissue sits below
      // saturation, leaving headroom for the aggregation pass to differentiate
      // it into tubes; only chem-flux-fed veins push all the way to 1.
      m += grow2 * 0.3 * terrain[i] * m * (0.75 - m)
      m -= starve
      m = m < 0 ? 0 : m > 1 ? 1 : m
      mtmp[i] = m
      massSum += m
    }
  }
  massFrac = massSum / (W * H)
  const ms = mass
  mass = mtmp
  mtmp = ms

  // 4) Cohesion pass. A light diffusion keeps the body a continuous sheet (no
  //    checkerboard), while a nonlinear contrast term driven by `veins` pulls
  //    faint cells down and firm cells up — so diffuse foraging fronts fade
  //    unless they are reinforced, and surviving mass tightens into tubes.
  const k = params.veins
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v)
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : 0
    const yd = y < H - 1 ? y + 1 : H - 1
    const yu3 = cl(y - 3, H - 1)
    const yd3 = cl(y + 3, H - 1)
    const yu2 = cl(y - 2, H - 1)
    const yd2 = cl(y + 2, H - 1)
    for (let x = 0; x < W; x++) {
      const xl = x > 0 ? x - 1 : 0
      const xr = x < W - 1 ? x + 1 : W - 1
      const xl3 = cl(x - 3, W - 1)
      const xr3 = cl(x + 3, W - 1)
      const xl2 = cl(x - 2, W - 1)
      const xr2 = cl(x + 2, W - 1)
      const i = idx(x, y)
      // Mexican-hat aggregation: short-range activation (4-neighbour average)
      // minus a wider inhibition ring (radius ~3). On a uniform plateau the two
      // cancel, so nothing blows up — but any dent or crest at the ring scale
      // self-amplifies, and the interior differentiates into a labyrinth of
      // tubes ~one ring-radius wide: the reticulated Physarum vein look.
      const near = (mass[idx(xl, y)] + mass[idx(xr, y)] + mass[idx(x, yu)] + mass[idx(x, yd)]) * 0.25
      const far =
        (mass[idx(xl3, y)] + mass[idx(xr3, y)] + mass[idx(x, yu3)] + mass[idx(x, yd3)] +
          mass[idx(xl2, yu2)] + mass[idx(xr2, yu2)] + mass[idx(xl2, yd2)] + mass[idx(xr2, yd2)]) * 0.125
      // Light cohesion smoothing (keeps the sheet continuous, no checkerboard)…
      let m = mass[i] * 0.55 + near * 0.45
      // …then the activator–inhibitor term that carves the tubes.
      m += k * 1.1 * (near - far)
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

  // Display-side vein extraction: a wide separable box blur of the mass, then
  // an unsharp ridge boost — cells above their neighbourhood (tube crests) pop
  // bright while the surrounding membrane sinks toward dark. This is purely a
  // rendering pass; the simulated field (and behaviour) is untouched.
  const R = 3
  const inv = 1 / (2 * R + 1)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let acc = 0
    for (let x = -R; x <= R; x++) acc += mass[row + Math.min(W - 1, Math.max(0, x))]
    for (let x = 0; x < W; x++) {
      vtmp[row + x] = acc * inv
      const xa = Math.min(W - 1, x + R + 1)
      const xs = Math.max(0, x - R)
      acc += mass[row + xa] - mass[row + xs]
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0
    for (let y = -R; y <= R; y++) acc += vtmp[Math.min(H - 1, Math.max(0, y)) * W + x]
    for (let y = 0; y < H; y++) {
      vblur[y * W + x] = acc * inv
      const ya = Math.min(H - 1, y + R + 1)
      const ys = Math.max(0, y - R)
      acc += vtmp[ya * W + x] - vtmp[ys * W + x]
    }
  }

  const kv = 1.2 + params.veins * 2.6 // ridge boost strength
  for (let i = 0; i < W * H; i++) {
    const m = mass[i]
    // Ridge-enhanced display value: crests lifted, membrane pressed down.
    let v = m + kv * (m - vblur[i])
    v = v < 0 ? 0 : v > 1 ? 1 : v
    const g = Math.pow(v, 1.25) // >1 gamma keeps the gaps properly dark
    // Blend toward a lighter core on the thick veins.
    const t = Math.min(1, v * 1.5)
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

