// Rock Layers — banded sandstone country of the West: flat-topped mesas and
// buttes cut from horizontal strata, receding ridge behind ridge into haze,
// while the sun slowly wheels and the light warms from dawn to a red sunset.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  ridges: { value: 4, min: 2, max: 7, step: 1, label: 'Ridges (depth)' },
  strata: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Strata thickness' },
  haze: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Haze' },
  timeOfDay: { value: 0.3, min: 0, max: 1, step: 0.005, label: 'Time of day' },
  daySpeed: { value: 0.3, min: 0, max: 3, step: 0.05, label: 'Day speed' },
  rugged: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Ruggedness' },
})
rt.mapInput('audio.level', 'daySpeed', 0.3)

// Desert strata palette (bottom → top of a formation).
const STRATA = [
  [120, 42, 30], [150, 66, 40], [176, 92, 52], [196, 130, 78],
  [210, 160, 110], [176, 92, 52], [150, 66, 40], [188, 110, 66],
  [214, 150, 96], [160, 74, 44],
]

let W = 0, H = 0, PR = 1
let ridges = []
function build() {
  ridges = []
  const n = Math.round(params.ridges)
  for (let r = 0; r < n; r++) {
    const buttes = []
    const count = 2 + (rt.rng() * 3 | 0)
    for (let i = 0; i < count; i++) {
      buttes.push({
        cx: rt.random(0.05, 0.95), w: rt.random(0.12, 0.34),
        top: rt.random(0.35, 0.72), spire: rt.rng() < 0.3,
        seed: rt.random(0, 100),
      })
    }
    ridges.push({ buttes, baseY: 0.55 + (r / n) * 0.42 })
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

// a mesa/butte silhouette path (flat top, near-vertical cliffs, talus flare)
function buttePath(b, baseY) {
  const cx = b.cx * W, halfW = (b.w * W) / 2
  const topY = b.top * H
  const bY = baseY * H
  const notch = (t) => Math.sin(t * 9 + b.seed) * 4 * PR * params.rugged // eroded top edge
  ctx.beginPath()
  ctx.moveTo(cx - halfW * 1.25, bY) // talus base left
  ctx.lineTo(cx - halfW, topY + (bY - topY) * 0.12)
  if (b.spire) {
    ctx.lineTo(cx - halfW * 0.3, topY)
    ctx.lineTo(cx, topY - halfW * 0.6)
    ctx.lineTo(cx + halfW * 0.3, topY)
  } else {
    const steps = 8
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      ctx.lineTo(cx - halfW + t * halfW * 2, topY + notch(t))
    }
  }
  ctx.lineTo(cx + halfW, topY + (bY - topY) * 0.12)
  ctx.lineTo(cx + halfW * 1.25, bY)
  ctx.closePath()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const phase = (params.timeOfDay + t * params.daySpeed * 0.01) % 1
  // day factor 0=night,1=noon; warmth toward dawn/dusk
  const dayF = Math.max(0, Math.sin(phase * Math.PI))
  const dusk = Math.pow(1 - Math.abs(phase - 0.5) * 2, 2) < 0.3 ? 1 : 0
  const warm = 1 - dayF * 0.4 // more orange when low sun
  const sunX = phase // 0..1 across the sky

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, H)
  const topSky = [Math.round(60 + dayF * 40), Math.round(90 + dayF * 70), Math.round(150 + dayF * 60)]
  const botSky = [Math.round(220 * warm + 30), Math.round(150 * warm + 40), Math.round(120 + dayF * 30)]
  g.addColorStop(0, `rgb(${topSky.join(',')})`)
  g.addColorStop(1, `rgb(${botSky.join(',')})`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // sun
  const sx = sunX * W, sy = H * (0.15 + (1 - dayF) * 0.4)
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.25)
  sg.addColorStop(0, `rgba(255,${Math.round(220 * warm + 20)},${Math.round(160 * warm)},0.9)`)
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sg
  ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'

  // ridges, far → near
  const n = ridges.length
  for (let r = 0; r < n; r++) {
    const ridge = ridges[r]
    const dist = 1 - r / Math.max(1, n - 1) // 1 far … 0 near
    const hazeAmt = params.haze * dist * 0.8
    const bandH = 6 * PR * params.strata * (0.6 + (1 - dist) * 0.8)
    // light side offset from the sun position
    const lightDir = sunX < 0.5 ? -1 : 1
    for (const b of ridge.buttes) {
      ctx.save()
      buttePath(b, ridge.baseY)
      ctx.clip()
      const topY = b.top * H, bY = ridge.baseY * H
      let band = 0
      for (let y = bY; y > topY - 30 * PR; y -= bandH) {
        const col = STRATA[band % STRATA.length]
        const wob = Math.sin(y * 0.02 + b.seed) * 2 * PR
        // warm-shift by time of day + slight per-band lighting
        const lr = Math.min(255, col[0] * (0.7 + warm * 0.5))
        const lg = Math.min(255, col[1] * (0.7 + warm * 0.4))
        const lb = Math.min(255, col[2] * (0.75 + dayF * 0.3))
        ctx.fillStyle = `rgb(${lr | 0},${lg | 0},${lb | 0})`
        ctx.fillRect(0, y - bandH + wob, W, bandH + 1)
        band++
      }
      // shade the lee cliff face
      const cx = b.cx * W, halfW = (b.w * W) / 2
      const shade = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
      const dark = 'rgba(20,8,4,0.45)', clear = 'rgba(20,8,4,0)'
      shade.addColorStop(0, lightDir > 0 ? dark : clear)
      shade.addColorStop(1, lightDir > 0 ? clear : dark)
      ctx.fillStyle = shade; ctx.fillRect(cx - halfW, topY, halfW * 2, bY - topY)
      ctx.restore()
      // haze veil for distance
      if (hazeAmt > 0.01) {
        ctx.save(); buttePath(b, ridge.baseY); ctx.clip()
        ctx.fillStyle = `rgba(${botSky[0]},${botSky[1]},${botSky[2]},${hazeAmt})`
        ctx.fillRect(0, 0, W, H); ctx.restore()
      }
    }
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
