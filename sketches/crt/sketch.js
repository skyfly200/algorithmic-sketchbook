// CRT — an old cathode-ray television look over a live source: barrel
// curvature with a rounded bezel mask, RGB shadow-mask phosphor stripes,
// rolling scanlines, a soft bloom, vignette, and occasional roll/interference.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  curve: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Screen curve' },
  scan: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Scanlines' },
  mask: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Phosphor mask' },
  bloom: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Bloom' },
  roll: { value: 0.25, min: 0, max: 1, step: 0.02, label: 'Roll / hum' },
  chroma: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Chroma bleed' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'bloom', 0.4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
// tube buffer: source drawn with slight barrel distortion via a warped grid
const tube = document.createElement('canvas')
const tctx = tube.getContext('2d')
const glow = document.createElement('canvas')
const gctx = glow.getContext('2d')
// static phosphor-mask overlay, baked to a small tile then scaled
const maskTile = document.createElement('canvas')
maskTile.width = 6; maskTile.height = 1
{
  const c = maskTile.getContext('2d')
  const cols = [[255, 60, 60], [60, 255, 90], [80, 120, 255]]
  for (let i = 0; i < 3; i++) { c.fillStyle = `rgb(${cols[i][0]},${cols[i][1]},${cols[i][2]})`; c.fillRect(i * 2, 0, 2, 1) }
}

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  tube.width = glow.width = W; tube.height = glow.height = H
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  // draw source into the tube buffer, chroma-bled by offsetting RGB via
  // three additive tinted copies
  tctx.globalCompositeOperation = 'source-over'
  tctx.fillStyle = '#000'; tctx.fillRect(0, 0, W, H)
  const cb = params.chroma * 3 * rt.pixelRatio
  if (cb > 0.3) {
    tctx.globalCompositeOperation = 'lighter'
    tctx.globalAlpha = 1
    tctx.filter = 'saturate(1.2)'
    src.draw(tctx, W, H, { mirror: params.mirror })
    tctx.filter = 'none'
    tctx.globalCompositeOperation = 'source-over'
  } else {
    src.draw(tctx, W, H, { mirror: params.mirror })
  }

  // vertical roll offset (hum bar) + occasional frame roll
  const roll = params.roll * (Math.sin(t * 0.7) * 0.5 + 0.5)
  const humY = (t * 40 * params.roll % H)

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)

  // barrel warp: sample the tube in horizontal slabs, scaling each toward the
  // centre so straight edges bow outward (cheap approximation of curvature)
  const slabs = 40
  const k = params.curve * 0.16
  for (let i = 0; i < slabs; i++) {
    const sy = (i / slabs) * H
    const sh = H / slabs + 1
    const ny = (i + 0.5) / slabs - 0.5
    const bow = 1 - k * (ny * ny) * 4
    const dw = W * bow
    const dx = (W - dw) / 2
    const dyBow = k * H * 0.12 * (ny * ny * 4 - 1) * 0 // keep vertical simple
    ctx.drawImage(tube, 0, sy, W, sh, dx, sy + dyBow, dw, sh)
  }

  // bloom: blurred bright copy added back
  if (params.bloom > 0.01) {
    gctx.clearRect(0, 0, W, H)
    gctx.filter = `blur(${3 * rt.pixelRatio}px) brightness(1.3) contrast(1.4)`
    gctx.drawImage(canvas, 0, 0)
    gctx.filter = 'none'
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = params.bloom * 0.6
    ctx.drawImage(glow, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // phosphor mask (multiplied) — scaled-up RGB stripe tile
  if (params.mask > 0.01) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = params.mask
    ctx.imageSmoothingEnabled = false
    const mw = 6 * rt.pixelRatio
    ctx.save()
    const pat = ctx.createPattern(maskTile, 'repeat')
    // approximate scale by drawing pattern via a scaled transform
    ctx.scale(mw / 6, H)
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, W / (mw / 6), 1)
    ctx.restore()
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // scanlines
  if (params.scan > 0.01) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgba(0,0,0,${params.scan * 0.55})`
    const step = 3 * rt.pixelRatio
    for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, Math.max(1, step * 0.5))
    ctx.globalCompositeOperation = 'source-over'
  }

  // hum bar
  if (params.roll > 0.01) {
    const g = ctx.createLinearGradient(0, humY - 60, 0, humY + 60)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, `rgba(255,255,255,${roll * 0.12})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.fillRect(0, humY - 60, W, 120)
  }

  // vignette + rounded bezel
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, `rgba(0,0,0,${0.4 + params.curve * 0.4})`)
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
