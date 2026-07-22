// Light Through Leaves — dappled canopy light over a live source: layers of
// drifting "leaf" noise mask a warm sunlight field, so soft shadows and
// bright light-pools sway across the scene as if wind were moving branches
// overhead. The gaps flicker and the whole canopy breathes on the breeze.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  coverage: { value: 0.55, min: 0.1, max: 0.9, step: 0.02, label: 'Canopy density' },
  wind: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind' },
  softness: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Shadow softness' },
  warmth: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Sun warmth' },
  contrast: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Light contrast' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('time.sin', 'wind', 0.5)

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
    const ry = r * rt.random(0.5, 1), rot = rt.random(0, 6)
    // Draw each blob wrapped across all nine tile offsets so the texture tiles
    // seamlessly — otherwise the 256px tile seams read as a visible grid in
    // the dappled light.
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const px = cx + ox * S, py = cy + oy * S
      const g = x.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, 'rgba(255,255,255,0.9)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.beginPath(); x.ellipse(px, py, r, ry, rot, 0, Math.PI * 2); x.fill()
    }
  }
  // Blur with a wrapped copy so the blur itself doesn't introduce a seam.
  const c2 = document.createElement('canvas'); c2.width = c2.height = S
  const x2 = c2.getContext('2d'); x2.filter = 'blur(4px)'
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) x2.drawImage(c, ox * S, oy * S)
  return c2
}
const leafA = bakeLeaves(1, 0), leafB = bakeLeaves(1.6, 40)
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
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
