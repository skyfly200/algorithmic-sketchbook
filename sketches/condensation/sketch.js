/**
 * Condensation — dropwise "breath figure" growth. Droplets nucleate in the
 * gaps, grow steadily, and coalesce (volume-conserving) when they overlap,
 * producing the dense packed-droplet texture of steam on a cold surface.
 * Droplets are drawn as a baked, light-shaded lens sprite for speed.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  nucleation: { value: 4, min: 0, max: 14, step: 1, label: 'Nucleation rate' },
  growth: { value: 0.35, min: 0, max: 1.6, step: 0.05, label: 'Growth speed' },
  density: { value: 1, min: 0.3, max: 1.6, step: 0.05, label: 'Droplet density' },
  drip: { value: 0, min: 0, max: 1, step: 0.05, label: 'Gravity drip' },
  tint: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Tint (0 = warm)' },
})
// Music: beats seed a burst of droplets, loudness speeds their growth.
rt.mapInput('beat.pulse', 'nucleation', 0.6)
rt.mapInput('beat.volume', 'growth', 0.7)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

let width, height
let drops = []
let maxDrops = 900
let lastNow = 0

// Baked droplet sprite (light from the top-left), drawn scaled per droplet.
const SPRITE = document.createElement('canvas')
const SPR = 128
SPRITE.width = SPRITE.height = SPR
function bakeSprite(tint) {
  const g = SPRITE.getContext('2d')
  g.clearRect(0, 0, SPR, SPR)
  const c = SPR / 2
  const R = c * 0.96
  // Warm/cool tint of the refracted body.
  const warm = [235, 225, 205]
  const cool = [210, 224, 235]
  const body = warm.map((w, i) => Math.round(w + (cool[i] - w) * tint))

  // Glassy lens: the droplet refracts the darker backing at center and bends
  // light bright around the lower rim (where a real bead focuses light).
  let grad = g.createRadialGradient(c - R * 0.18, c - R * 0.18, R * 0.1, c, c, R)
  grad.addColorStop(0, 'rgba(15, 17, 22, 0.42)') // dark refracted core
  grad.addColorStop(0.6, 'rgba(35, 40, 48, 0.22)')
  grad.addColorStop(0.85, `rgba(${body[0]}, ${body[1]}, ${body[2]}, 0.12)`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // Bright refracted crescent on the lower-right (light focused through it).
  grad = g.createRadialGradient(c + R * 0.28, c + R * 0.34, R * 0.15, c, c, R)
  grad.addColorStop(0, `rgba(${body[0]}, ${body[1]}, ${body[2]}, 0.85)`)
  grad.addColorStop(0.55, `rgba(${body[0]}, ${body[1]}, ${body[2]}, 0.18)`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.save()
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = grad
  g.fillRect(0, 0, SPR, SPR)
  g.restore()

  // Crisp Fresnel rim.
  grad = g.createRadialGradient(c, c, R * 0.78, c, c, R)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.9, 'rgba(255,255,255,0.18)')
  grad.addColorStop(0.98, 'rgba(255,255,255,0.7)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(c, c, R, 0, Math.PI * 2)
  g.fill()

  // Sharp specular hotspot, upper-left.
  const sx = c - R * 0.32
  const sy = c - R * 0.36
  grad = g.createRadialGradient(sx, sy, 0, sx, sy, R * 0.3)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(sx, sy, R * 0.3, 0, Math.PI * 2)
  g.fill()
}

let tintBaked = -1

function dropTarget() {
  // Dense packed field: roughly one droplet per ~330 px² at full density.
  return Math.round(((width * height) / 330) * rt.detail * params.density)
}

function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
  maxDrops = dropTarget()
  // Seed a dense scattering of tiny droplets so it starts covered.
  drops = []
  const seed = Math.round(maxDrops * 0.6)
  for (let i = 0; i < seed; i++) {
    drops.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: (1.5 + Math.random() * 3) * rt.pixelRatio,
      g: 0.4 + Math.random() * 1.4,
    })
  }
}

// Spatial hash for neighbour queries (nucleation + coalescence).
function buildGrid(cell) {
  const grid = new Map()
  const cols = Math.ceil(width / cell)
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]
    const key = ((d.y / cell) | 0) * cols + ((d.x / cell) | 0)
    let b = grid.get(key)
    if (!b) grid.set(key, (b = []))
    b.push(i)
  }
  return { grid, cols, cell }
}

function nearbyIndices(gh, x, y) {
  const { grid, cols, cell } = gh
  const cx = (x / cell) | 0
  const cy = (y / cell) | 0
  const out = []
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const b = grid.get((cy + j) * cols + (cx + i))
      if (b) out.push(...b)
    }
  return out
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  const minDim = Math.min(width, height)
  const maxR = minDim * 0.08
  maxDrops = dropTarget()

  // Grow every droplet a little (bigger ones grow slightly faster: more area).
  const grow = params.growth * rt.pixelRatio * 7 * dt
  for (const d of drops) d.r += grow * (0.5 + d.r / (maxR * 2)) * (d.g ?? 1)

  // Gravity drip: big droplets slide down and sweep up what they touch.
  if (params.drip > 0) {
    for (const d of drops) {
      if (d.r > maxR * 0.5) d.y += params.drip * (d.r * 0.06 + 2) * rt.pixelRatio
    }
  }

  // Keep grid cells small so dense buckets stay cheap; large droplets that
  // miss a distant partner one frame simply catch it the next.
  const cell = Math.max(14, maxR * 0.5)

  // Coalesce overlapping droplets (volume-conserving), a couple of passes for chains.
  for (let pass = 0; pass < 2; pass++) {
    const gh = buildGrid(cell)
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i]
      if (!a) continue
      for (const k of nearbyIndices(gh, a.x, a.y)) {
        if (k <= i) continue
        const b = drops[k]
        if (!b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        if (dist < (a.r + b.r) * 0.82) {
          const va = a.r ** 3
          const vb = b.r ** 3
          const vt = va + vb
          a.x = (a.x * va + b.x * vb) / vt
          a.y = (a.y * va + b.y * vb) / vt
          a.r = Math.cbrt(vt)
          drops[k] = null
        }
      }
    }
    drops = drops.filter(Boolean)
  }

  // Remove droplets that dripped off the bottom.
  if (params.drip > 0) drops = drops.filter((d) => d.y - d.r < height + maxR)

  // Nucleate new droplets in open gaps.
  if (drops.length < maxDrops) {
    const gh = buildGrid(cell)
    // Fill gaps aggressively so the surface stays densely covered.
    const deficit = maxDrops - drops.length
    const tries = Math.min(deficit, Math.round(params.nucleation * 30 * params.density) + 40)
    for (let n = 0; n < tries && drops.length < maxDrops; n++) {
      const x = Math.random() * width
      const y = Math.random() * height
      let open = true
      for (const k of nearbyIndices(gh, x, y)) {
        const d = drops[k]
        if (d && Math.hypot(d.x - x, d.y - y) < d.r * 0.95) {
          open = false
          break
        }
      }
      if (open) drops.push({ x, y, r: (2 + Math.random() * 2) * rt.pixelRatio, g: 0.4 + Math.random() * 1.4 })
    }
  }

  if (params.tint !== tintBaked) {
    bakeSprite(params.tint)
    tintBaked = params.tint
  }

  // --- render ---
  ctx.fillStyle = '#14161c'
  ctx.fillRect(0, 0, width, height)
  // Faint uneven backing so the glass reads as a surface.
  const bg = ctx.createRadialGradient(
    width * 0.4, height * 0.35, 0,
    width * 0.4, height * 0.35, Math.max(width, height) * 0.8,
  )
  bg.addColorStop(0, 'rgba(70, 74, 84, 0.5)')
  bg.addColorStop(1, 'rgba(20, 22, 28, 0.5)')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // Draw smallest first so big droplets sit on top.
  drops.sort((a, b) => a.r - b.r)
  for (const d of drops) {
    const s = d.r * 2.06
    ctx.drawImage(SPRITE, d.x - s / 2, d.y - s / 2, s, s)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
