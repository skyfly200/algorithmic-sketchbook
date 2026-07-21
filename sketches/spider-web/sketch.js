// Glimmering Spider Web — an orb-weaver's web strung across the dark: straight
// radial spokes and catenary-sagging spiral threads, hung with dew droplets
// that catch a slowly wheeling light and flash like tiny prisms. The whole web
// breathes on a faint breeze; a pointer tug pulls it; beats set the dew ablaze.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  spokes: { value: 14, min: 6, max: 28, step: 1, label: 'Spokes' },
  rings: { value: 12, min: 4, max: 24, step: 1, label: 'Spiral rings' },
  sag: { value: 0.18, min: 0, max: 0.5, step: 0.01, label: 'Thread sag' },
  dew: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Dew amount' },
  shimmer: { value: 1, min: 0, max: 2, step: 0.05, label: 'Shimmer' },
  sway: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Breeze' },
  hue: { value: 200, min: 0, max: 360, step: 1, label: 'Dew hue' },
})
rt.mapInput('audio.pulse', 'shimmer', 0.6)
rt.mapInput('audio.level', 'sway', 0.4)

let W = 0, H = 0, R = 0, cx = 0, cy = 0
let drops = [] // dew droplets: { a (spoke angle), rr (0..1 along spoke), size, phase }
let px = 0, py = 0, tpx = 0, tpy = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  cx = W * 0.5; cy = H * 0.46
  R = Math.min(W, H) * 0.46
  build()
}
function build() {
  drops = []
  const n = Math.round(90 * params.dew * rt.detail)
  for (let i = 0; i < n; i++) {
    drops.push({
      a: rt.rng(), // 0..1 fraction around the ring (interpolated onto threads)
      rr: rt.random(0.18, 1), // radial position
      size: rt.random(1.1, 3.2) * rt.pixelRatio,
      phase: rt.random(0, Math.PI * 2),
      big: rt.rng() < 0.12,
    })
  }
}
window.addEventListener('pointermove', (e) => { tpx = (e.clientX * rt.pixelRatio - cx) / R; tpy = (e.clientY * rt.pixelRatio - cy) / R })
window.addEventListener('pointerout', () => { tpx = 0; tpy = 0 })

// A web vertex at spoke index s (0..spokes) and ring t (0..1), with the whole
// web swaying + tugged by the pointer, and each spiral segment sagging inward.
function vert(sFrac, t, sway, tugx, tugy) {
  const ang = sFrac * Math.PI * 2
  // sag pulls mid-span points toward the centre a touch (catenary-ish)
  const r = t * R
  let x = cx + Math.cos(ang) * r
  let y = cy + Math.sin(ang) * r
  // breeze sway grows toward the rim
  x += sway * r * 0.05
  y += Math.sin(ang * 2 + sway) * r * 0.02
  // pointer tug, strongest at the rim
  x += tugx * r * 0.28
  y += tugy * r * 0.28
  return { x, y, ang, r }
}

let t0 = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  if (Math.round(90 * params.dew * rt.detail) !== drops.length) build()
  px += (tpx - px) * 0.08; py += (tpy - py) * 0.08
  const sway = Math.sin(t * 0.6) * params.sway
  const spokes = Math.round(params.spokes)
  const rings = Math.round(params.rings)

  // night background with a faint foliage vignette
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.8)
  bg.addColorStop(0, '#0a0f0c')
  bg.addColorStop(1, '#04070a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // the wheeling light direction (for the dew highlights)
  const lightA = t * 0.35
  const lx = Math.cos(lightA), ly = Math.sin(lightA)

  ctx.lineCap = 'round'
  // --- spokes ---
  ctx.strokeStyle = 'rgba(200, 220, 235, 0.16)'
  ctx.lineWidth = Math.max(0.6, 0.9 * rt.pixelRatio)
  for (let s = 0; s < spokes; s++) {
    const a = s / spokes
    ctx.beginPath()
    ctx.moveTo(cx + px * R * 0.05, cy + py * R * 0.05)
    const steps = 6
    for (let k = 1; k <= steps; k++) {
      const v = vert(a, k / steps, sway, px, py)
      ctx.lineTo(v.x, v.y)
    }
    ctx.stroke()
  }
  // --- spiral rings (each a polygon that sags inward between spokes) ---
  ctx.strokeStyle = 'rgba(190, 210, 230, 0.13)'
  for (let ri = 1; ri <= rings; ri++) {
    const t = 0.14 + (ri / rings) * 0.86
    ctx.beginPath()
    for (let s = 0; s <= spokes; s++) {
      const v = vert(s / spokes, t, sway, px, py)
      if (s === 0) ctx.moveTo(v.x, v.y)
      else {
        // sag: pull the segment midpoint toward the centre
        const prev = vert((s - 1) / spokes, t, sway, px, py)
        const mx = (prev.x + v.x) / 2, my = (prev.y + v.y) / 2
        const sagx = mx + (cx - mx) * params.sag
        const sagy = my + (cy - my) * params.sag
        ctx.quadraticCurveTo(sagx, sagy, v.x, v.y)
      }
    }
    ctx.stroke()
  }

  // --- dew droplets: refractive beads that flash as the light sweeps past ---
  ctx.globalCompositeOperation = 'lighter'
  const hue = params.hue
  for (const d of drops) {
    const v = vert(d.a, d.rr, sway, px, py)
    // alignment of this droplet's facing with the light → specular flash
    const nx = Math.cos(v.ang), ny = Math.sin(v.ang)
    const align = Math.max(0, nx * lx + ny * ly)
    const flash = Math.pow(align, 3) * (0.5 + 0.5 * Math.sin(d.phase + t * 2))
    const bright = (0.18 + flash * params.shimmer) * (0.7 + rt.beat.state.pulse * 0.6)
    const sz = d.size * (d.big ? 1.8 : 1) * (1 + flash * 0.4)
    // watery bead body
    const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, sz * 2.4)
    g.addColorStop(0, `hsla(${hue}, 90%, 88%, ${Math.min(1, bright)})`)
    g.addColorStop(0.4, `hsla(${hue + 20}, 80%, 60%, ${bright * 0.4})`)
    g.addColorStop(1, 'hsla(0,0%,0%,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(v.x, v.y, sz * 2.4, 0, 6.28); ctx.fill()
    // hot specular pinpoint
    if (flash > 0.15) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash * params.shimmer)})`
      ctx.beginPath(); ctx.arc(v.x - nx * sz * 0.4, v.y - ny * sz * 0.4, sz * 0.5, 0, 6.28); ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
