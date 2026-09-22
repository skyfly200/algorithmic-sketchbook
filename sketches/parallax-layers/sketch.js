/**
 * Parallax Layers — procedural ridgelines stacked from horizon to foreground,
 * each drifting at its own speed so the scene reads with depth: far layers are
 * pale and hazy and crawl, near layers are dark and race. Move the pointer (or
 * map an input) to swing the whole stack for a hand-held parallax; a sun/moon
 * and a scatter of stars sit behind it all. Beats nudge the drift and bob the
 * light. Everything is generated from a little value-noise, so no two ridges
 * repeat.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const PALETTES = ['Dusk', 'Forest', 'Mono', 'Vapor', 'Ember']
const params = rt.params({
  layers: { value: 6, min: 2, max: 10, step: 1, label: 'Layers' },
  speed: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  depth: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Parallax depth' },
  ruggedness: { value: 0.6, min: 0.1, max: 1.2, step: 0.02, label: 'Ruggedness' },
  haze: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Atmosphere' },
  palette: { value: 'Dusk', type: 'select', options: PALETTES, label: 'Palette' },
  sunY: { value: 0.42, min: 0.05, max: 0.9, step: 0.01, label: 'Sun height' },
  sunSize: { value: 0.14, min: 0.02, max: 0.35, step: 0.01, label: 'Sun size' },
  stars: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Stars' },
  parX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Look X' },
  parY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Look Y' },
})
// Pointer looks around the scene by default (map any input to override).
rt.mapInput('mouse.x', 'parX', 1)
rt.mapInput('mouse.y', 'parY', 1)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
let W = 0, H = 0

// --- deterministic value noise (smooth 1D) ---------------------------------
function hash(n) { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s) }
function vnoise(x, seed) {
  const i = Math.floor(x), f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i + seed * 57.3) * (1 - u) + hash(i + 1 + seed * 57.3) * u
}
// Fractal ridge height in 0..1 for a horizontal position, per-layer seed.
function ridge(x, seed, rug) {
  let a = 0.5, freq = 1, sum = 0, norm = 0
  for (let o = 0; o < 4; o++) { sum += vnoise(x * freq, seed) * a; norm += a; a *= rug; freq *= 2.1 }
  return sum / norm
}

// A star field for the sky, generated once (seeded), redrawn each frame with a
// slow twinkle. Positions are in 0..1 so they rescale with the canvas.
let starList = []
function buildStars() {
  starList = []
  const n = 260
  for (let i = 0; i < n; i++) {
    starList.push({ x: hash(i * 1.7), y: hash(i * 3.1) * 0.6, r: 0.4 + hash(i * 5.9) * 1.6, ph: hash(i * 7.3) * 6.28 })
  }
}
buildStars()

// Palette → { sky:[top,bottom], sun, layer(t,depth) } where t is 0(far)..1(near).
function palette(name) {
  switch (name) {
    case 'Forest': return { sky: ['#12233a', '#3a5a52'], sun: '#ffe9a8', hueFar: 150, hueNear: 150, satFar: 20, satNear: 45, lightFar: 62, lightNear: 8 }
    case 'Mono': return { sky: ['#0b0f16', '#232a36'], sun: '#e8eefc', hueFar: 220, hueNear: 220, satFar: 8, satNear: 10, lightFar: 55, lightNear: 6 }
    case 'Vapor': return { sky: ['#2a1b4e', '#e05b8f'], sun: '#ffe08a', hueFar: 300, hueNear: 265, satFar: 45, satNear: 60, lightFar: 66, lightNear: 12 }
    case 'Ember': return { sky: ['#2a0f14', '#b5451f'], sun: '#ffd27a', hueFar: 24, hueNear: 8, satFar: 55, satNear: 70, lightFar: 58, lightNear: 8 }
    default: return { sky: ['#14213d', '#c46a63'], sun: '#ffdca0', hueFar: 260, hueNear: 230, satFar: 30, satNear: 45, lightFar: 64, lightNear: 9 } // Dusk
  }
}

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const P = palette(params.palette)
  const L = Math.round(params.layers)

  // sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, P.sky[0]); g.addColorStop(1, P.sky[1])
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // parallax offset: pointer look (centered at 0.5) scaled by depth, plus a
  // small beat bob so the scene breathes with the music.
  const lookX = (params.parX - 0.5) * 2
  const lookY = (params.parY - 0.5) * 2
  const bob = rt.beat.state.pulse * 0.02

  // sun / moon disc — sits behind the ridges, moves a touch with the look
  const sunX = W * (0.5 + lookX * 0.06 * params.depth)
  const sunY = H * (params.sunY + lookY * 0.05 * params.depth - bob)
  const sr = Math.min(W, H) * params.sunSize
  const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sr * 2.4)
  sg.addColorStop(0, P.sun); sg.addColorStop(0.35, P.sun); sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.9; ctx.fillStyle = sg
  ctx.beginPath(); ctx.arc(sunX, sunY, sr * 2.4, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = P.sun
  ctx.beginPath(); ctx.arc(sunX, sunY, sr, 0, Math.PI * 2); ctx.fill()

  // stars over the upper sky
  if (params.stars > 0.01) {
    for (const s of starList) {
      const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + s.ph)
      ctx.globalAlpha = params.stars * tw * (1 - s.y / 0.6) * 0.9
      const sx = s.x * W + lookX * 6 * params.depth
      const sy = s.y * H - lookY * 6 * params.depth
      ctx.fillStyle = '#fff'
      ctx.fillRect(sx, sy, s.r * rt.pixelRatio, s.r * rt.pixelRatio)
    }
    ctx.globalAlpha = 1
  }

  // ridgelines, far → near
  const step = Math.max(2, Math.floor(3 / rt.detail)) * Math.ceil(rt.pixelRatio)
  for (let i = 0; i < L; i++) {
    const d = L === 1 ? 1 : i / (L - 1) // 0 far … 1 near
    // near layers scroll faster and sit lower; parallax shifts them more
    const scroll = t * params.speed * (0.15 + d * 1.1) * 60
    const px = lookX * (10 + d * 90) * params.depth
    const py = lookY * (6 + d * 40) * params.depth
    const baseY = H * (0.32 + d * 0.6) - py
    const amp = H * (0.06 + d * 0.20) * (0.6 + params.ruggedness * 0.7)
    // colour: interpolate far→near, then apply atmospheric haze toward the sky
    const hue = P.hueFar + (P.hueNear - P.hueFar) * d
    const sat = P.satFar + (P.satNear - P.satFar) * d
    const light = P.lightFar + (P.lightNear - P.lightFar) * d
    const hazeMix = params.haze * (1 - d) * 0.7
    const lift = light + hazeMix * 40

    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W + step; x += step) {
      const nx = (x + scroll + px) / (W * 0.5)
      const h = ridge(nx * (0.7 + d * 0.9), i * 3.7 + 1, params.ruggedness)
      const y = baseY - (h - 0.5) * amp
      ctx.lineTo(x, y)
    }
    ctx.lineTo(W, H); ctx.closePath()
    ctx.fillStyle = `hsl(${hue} ${sat}% ${lift}%)`
    ctx.fill()
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
