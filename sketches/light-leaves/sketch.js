// Light Through Leaves — dappled canopy light over a live source: layers of
// drifting "leaf" noise mask a warm sunlight field, so soft shadows and
// bright light-pools sway across the scene as if wind were moving branches
// overhead. The gaps flicker, the whole canopy breathes, and warm godray
// shafts angle down through the brightest gaps.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  coverage: { value: 0.55, min: 0.1, max: 0.9, step: 0.02, label: 'Canopy density' },
  wind: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind' },
  softness: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Shadow softness' },
  warmth: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Sun warmth' },
  contrast: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Light contrast' },
  shafts: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'God rays' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('time.sin', 'wind', 0.5)
rt.mapInput('audio.level', 'shafts', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
// baked leaf-gap noise tiles (blobby light gaps)
function bakeLeaves(scale, seedOff) {
  const S = 256
  const c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d')
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S)
  x.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 90; i++) {
    const cx = rt.random(0, S), cy = rt.random(0, S), r = rt.random(6, 26) * scale
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.beginPath(); x.ellipse(cx, cy, r, r * rt.random(0.5, 1), rt.random(0, 6), 0, Math.PI * 2); x.fill()
  }
  const c2 = document.createElement('canvas'); c2.width = c2.height = S
  const x2 = c2.getContext('2d'); x2.filter = 'blur(4px)'; x2.drawImage(c, 0, 0)
  return c2
}
const leafA = bakeLeaves(1, 0), leafB = bakeLeaves(1.6, 40)
// Irregular god-ray definitions, baked once so the shafts aren't a regular
// picket-fence of stripes. Each ray has its own base position, width, angle
// jitter and brightness, and drifts on its own slow phase.
const rays = Array.from({ length: 6 }, () => ({
  base: rt.random(-0.42, 0.42), // fraction of width, off-centre
  w: rt.random(0.05, 0.13), // ray width as fraction of width
  bright: rt.random(0.5, 1),
  phase: rt.random(0, Math.PI * 2),
  drift: rt.random(0.2, 0.6),
}))
const mask = document.createElement('canvas')
const mx = mask.getContext('2d')

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  mask.width = Math.max(2, W >> 1); mask.height = Math.max(2, H >> 1)
}
function tile(img, ox, oy, scale) {
  const mw = mask.width, mh = mask.height
  const ts = 256 * scale
  const x0 = -(((ox % ts) + ts) % ts), y0 = -(((oy % ts) + ts) % ts)
  for (let y = y0; y < mh; y += ts) for (let x = x0; x < mw; x += ts) mx.drawImage(img, x, y, ts, ts)
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  src.draw(ctx, W, H, { mirror: params.mirror })

  // build the light mask from two drifting leaf layers
  const mw = mask.width, mh = mask.height
  mx.globalCompositeOperation = 'source-over'
  mx.fillStyle = '#000'; mx.fillRect(0, 0, mw, mh)
  mx.globalCompositeOperation = 'lighter'
  const sway = Math.sin(t * 0.6 * params.wind) * 30
  const v = t * 12 * params.wind
  tile(leafA, v * 0.5 + sway, v * 0.15, 1.4)
  tile(leafB, -v * 0.3 + sway * 0.6, v * 0.1, 2.0)
  mx.globalCompositeOperation = 'source-over'

  // darken the scene by the inverse of the mask (shadows), keep light in gaps
  const shadow = (1 - params.coverage)
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.filter = `blur(${params.softness * 8 * rt.pixelRatio}px)`
  // draw a mid-gray tinted mask: bright gaps = light, dark = shadow
  // compose: base darkness + mask lightness
  const tmp = document.createElement('canvas'); tmp.width = mw; tmp.height = mh
  const tc = tmp.getContext('2d')
  tc.fillStyle = `rgb(${60 + shadow * 40},${55 + shadow * 40},${50 + shadow * 40})`
  tc.fillRect(0, 0, mw, mh)
  tc.globalCompositeOperation = 'screen'
  tc.drawImage(mask, 0, 0)
  ctx.drawImage(tmp, 0, 0, W, H)
  ctx.restore()

  // warm light-pools added where the canopy is open
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `blur(${params.softness * 6 * rt.pixelRatio}px)`
  ctx.globalAlpha = params.contrast
  const warm = document.createElement('canvas'); warm.width = mw; warm.height = mh
  const wc = warm.getContext('2d')
  wc.fillStyle = `hsl(${45 - params.warmth * 15}, ${60 + params.warmth * 30}%, 55%)`
  wc.fillRect(0, 0, mw, mh)
  wc.globalCompositeOperation = 'destination-in'
  wc.drawImage(mask, 0, 0)
  ctx.drawImage(warm, 0, 0, W, H)
  ctx.restore()
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'

  // Angled god-ray shafts from the top — soft, irregularly spaced and tapered
  // so they read as sunlight breaking through branches, not as parallel bars.
  if (params.shafts > 0.01) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${(6 + params.softness * 18) * rt.pixelRatio}px)`
    ctx.translate(W * 0.5, 0)
    ctx.rotate(0.22 + Math.sin(t * 0.25) * 0.06)
    for (const r of rays) {
      // slow lateral sway + a gentle brightness flicker per ray
      const x = r.base * W + Math.sin(t * r.drift + r.phase) * W * 0.05
      const w = r.w * W
      const flick = 0.7 + 0.3 * Math.sin(t * (0.8 + r.drift) + r.phase * 2)
      const a = params.shafts * 0.16 * r.bright * flick
      // a soft-edged wedge that fades toward the bottom
      const g = ctx.createLinearGradient(0, -H * 0.2, 0, H * 1.3)
      g.addColorStop(0, `hsla(48, 92%, 72%, ${a})`)
      g.addColorStop(0.55, `hsla(46, 88%, 66%, ${a * 0.4})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      // widen toward the bottom (a real shaft spreads as it descends)
      ctx.beginPath()
      ctx.moveTo(x - w * 0.35, -H * 0.2)
      ctx.lineTo(x + w * 0.35, -H * 0.2)
      ctx.lineTo(x + w * 0.9, H * 1.3)
      ctx.lineTo(x - w * 0.9, H * 1.3)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
