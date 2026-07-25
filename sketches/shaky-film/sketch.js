// Shaky Film — a rickety old-projector look for a live source: the frame weaves
// and jitters in the gate, jumps as the film slips a frame, flickers in exposure,
// and is peppered with grain, drifting hair/dust and the occasional vertical
// scratch. A slight overscan hides the black edges as it shakes. Fully filmic
// damage — pair it with Film Tone for sepia/black & white.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  shake: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Gate weave / shake' },
  jump: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Frame jumps' },
  flicker: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Exposure flicker' },
  grain: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Grain' },
  scratches: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Scratches' },
  dust: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Dust & hair' },
  vignette: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'shake', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

// A static grain tile we re-blit with a random offset each frame — far cheaper
// than generating per-pixel noise every frame.
const grainC = document.createElement('canvas')
const gctx = grainC.getContext('2d')
function buildGrain() {
  const S = 256
  grainC.width = S; grainC.height = S
  const img = gctx.createImageData(S, S)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  gctx.putImageData(img, 0, 0)
}

let W = 0, H = 0, minDim = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  minDim = Math.min(W, H)
  buf.width = W; buf.height = H
}

// scratches persist a few frames and drift horizontally, like a hair caught in
// the gate; each has an x, a lifetime, a width and whether it's a bright or dark line.
const scratches = []
// gate weave: smooth low-frequency drift from two summed sines with wandering
// phase, plus a fast jitter component.
let weaveT = 0
let jumpY = 0, jumpHold = 0

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  bctx.clearRect(0, 0, W, H)
  src.draw(bctx, W, H, { mirror: params.mirror })

  // --- motion: gate weave + jitter + occasional frame jump ---
  weaveT += 0.016
  const sh = params.shake
  const weaveX = (Math.sin(weaveT * 3.1) + 0.5 * Math.sin(weaveT * 7.7 + 1)) * sh * minDim * 0.006
  const weaveY = (Math.cos(weaveT * 2.3) + 0.5 * Math.sin(weaveT * 6.1 + 2)) * sh * minDim * 0.006
  const jitX = (Math.random() - 0.5) * sh * minDim * 0.004
  const jitY = (Math.random() - 0.5) * sh * minDim * 0.004
  // frame jump: now and then the image slips vertically and snaps back
  if (jumpHold > 0) jumpHold--
  else if (Math.random() < params.jump * 0.03) { jumpY = (Math.random() - 0.5) * H * 0.12 * params.jump; jumpHold = 2 + (Math.random() * 4 | 0) }
  else jumpY *= 0.6
  const rot = (Math.sin(weaveT * 1.7) * 0.5 + jitX * 0.02 / (minDim * 0.004 || 1)) * sh * 0.01

  // overscan so the shaking never reveals black borders
  const over = 1 + 0.06 + sh * 0.05
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W / 2 + weaveX + jitX, H / 2 + weaveY + jitY + jumpY)
  ctx.rotate(rot)
  ctx.scale(over, over)
  ctx.drawImage(buf, -W / 2, -H / 2, W, H)
  ctx.restore()

  // --- exposure flicker: a translucent black/white veil that wavers ---
  if (params.flicker > 0.01) {
    const fl = (Math.sin(weaveT * 21) * 0.5 + 0.5) * (0.4 + 0.6 * Math.random())
    const dark = fl < 0.5
    ctx.globalAlpha = params.flicker * 0.28 * Math.abs(fl - 0.5) * 2
    ctx.fillStyle = dark ? '#000' : '#fff'
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
  }

  // --- grain ---
  if (params.grain > 0.01) {
    ctx.globalAlpha = params.grain * 0.5
    ctx.globalCompositeOperation = 'overlay'
    const ox = (Math.random() * grainC.width) | 0
    const oy = (Math.random() * grainC.height) | 0
    const gs = Math.max(1, minDim / 340)
    for (let x = -ox; x < W; x += grainC.width * gs) {
      for (let y = -oy; y < H; y += grainC.height * gs) {
        ctx.drawImage(grainC, x, y, grainC.width * gs, grainC.height * gs)
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  // --- scratches: spawn, draw and age ---
  if (params.scratches > 0.01 && Math.random() < params.scratches * 0.35) {
    scratches.push({ x: Math.random() * W, life: 3 + (Math.random() * 20 | 0), w: rt.random(0.6, 2.4) * rt.pixelRatio, bright: Math.random() < 0.7, vx: rt.random(-0.4, 0.4) * rt.pixelRatio })
  }
  for (let i = scratches.length - 1; i >= 0; i--) {
    const s = scratches[i]
    s.x += s.vx; s.life--
    if (s.life <= 0) { scratches.splice(i, 1); continue }
    ctx.globalAlpha = 0.35 * Math.min(1, s.life / 6)
    ctx.fillStyle = s.bright ? 'rgba(255,255,245,0.9)' : 'rgba(20,14,8,0.9)'
    ctx.fillRect(s.x, 0, s.w, H)
  }
  ctx.globalAlpha = 1

  // --- dust & hair specks ---
  if (params.dust > 0.01) {
    const n = (params.dust * 14) | 0
    for (let i = 0; i < n; i++) {
      if (Math.random() > 0.5) continue
      const x = Math.random() * W, y = Math.random() * H
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,250,0.5)'
      if (Math.random() < 0.15) { // an occasional hair
        ctx.strokeStyle = 'rgba(10,8,4,0.6)'; ctx.lineWidth = rt.pixelRatio
        ctx.beginPath(); ctx.moveTo(x, y)
        let a = Math.random() * 6.28
        for (let k = 0; k < 5; k++) { a += rt.random(-0.8, 0.8); ctx.lineTo(x + Math.cos(a) * 8 * rt.pixelRatio, y + Math.sin(a) * 8 * rt.pixelRatio) }
        ctx.stroke()
      } else {
        ctx.beginPath(); ctx.arc(x, y, rt.random(0.6, 2) * rt.pixelRatio, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  // --- vignette ---
  if (params.vignette > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${params.vignette * 0.9})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
buildGrain()
resize()
requestAnimationFrame(frame)
