/**
 * Lens Flare over a live source (camera / dropped photo or video / demo / the
 * Mixer layers below). The flare anchors to the brightest point of the image
 * (smoothed so it glides, not jitters) or to a click-and-drag position. It's
 * built from the classic anamorphic kit: a hot core with chromatic halo, a
 * horizontal cyan streak, a ring, and a chain of polygonal ghosts spaced
 * along the line from the light through the frame centre — all additive, all
 * scaled by how bright the found light actually is.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource, clamp } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  intensity: { value: 0.8, min: 0, max: 2, step: 0.05, label: 'Intensity' },
  burst: { value: +rt.random(0.6, 1.0).toFixed(2), min: 0, max: 1.5, step: 0.05, label: 'Radial burst' },
  spikes: { value: 2 * Math.round(rt.random(5, 9)), min: 4, max: 24, step: 1, label: 'Burst spikes' },
  streak: { value: +rt.random(0.1, 0.35).toFixed(2), min: 0, max: 1.5, step: 0.05, label: 'Anamorphic streak' },
  ghosts: { value: Math.round(rt.random(4, 9)), min: 0, max: 12, step: 1, label: 'Ghosts' },
  halo: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Halo ring' },
  chroma: { value: +rt.random(0.3, 0.9).toFixed(2), min: 0, max: 1, step: 0.05, label: 'Chromatic fringe' },
  threshold: { value: 0.55, min: 0.1, max: 0.95, step: 0.01, label: 'Light threshold' },
  auto: { value: true, type: 'bool', label: 'Track brightest point' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// The flare surges with the music.
rt.mapInput('audio.volume', 'intensity', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

const tiny = document.createElement('canvas')
tiny.width = 48
tiny.height = 32
const tctx = tiny.getContext('2d', { willReadFrequently: true })

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

// Smoothed light position + strength.
const light = { x: 0.7, y: 0.3, s: 0.8 }
const manual = { x: 0.7, y: 0.3, active: false }
canvas.addEventListener('pointerdown', (e) => {
  manual.active = true
  manual.x = e.clientX / window.innerWidth
  manual.y = e.clientY / window.innerHeight
})
window.addEventListener('pointermove', (e) => {
  if (e.buttons) {
    manual.x = e.clientX / window.innerWidth
    manual.y = e.clientY / window.innerHeight
    manual.active = true
  }
})

function findLight() {
  try {
    src.draw(tctx, tiny.width, tiny.height, { mirror: params.mirror })
    const d = tctx.getImageData(0, 0, tiny.width, tiny.height).data
    let best = -1
    let bx = 0
    let by = 0
    for (let y = 0; y < tiny.height; y++) {
      for (let x = 0; x < tiny.width; x++) {
        const i = (y * tiny.width + x) * 4
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        if (l > best) {
          best = l
          bx = x
          by = y
        }
      }
    }
    const lum = best / 255
    return { x: (bx + 0.5) / tiny.width, y: (by + 0.5) / tiny.height, lum }
  } catch {
    return null
  }
}

// One additive glow blob.
function glow(x, y, r, rgb, a) {
  if (r < 0.5 || a <= 0.003) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${a})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function poly(x, y, r, sides, rgb, a, rot) {
  if (r < 0.5 || a <= 0.003) return
  ctx.fillStyle = `rgba(${rgb},${a})`
  ctx.beginPath()
  for (let i = 0; i < sides; i++) {
    const ang = rot + (i / sides) * Math.PI * 2
    const px = x + Math.cos(ang) * r
    const py = y + Math.sin(ang) * r
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  // Base image.
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  src.draw(ctx, W, H, { mirror: params.mirror })

  // Where's the light?
  let target = null
  if (!params.auto || manual.active) {
    target = { x: manual.x, y: manual.y, lum: 1 }
  } else {
    target = findLight()
  }
  if (target) {
    light.x += (target.x - light.x) * 0.12
    light.y += (target.y - light.y) * 0.12
    light.s += (target.lum - light.s) * 0.1
  }

  // Below threshold the flare fades out rather than popping.
  const over = clamp((light.s - params.threshold) / (1 - params.threshold), 0, 1)
  const I = params.intensity * (params.auto && !manual.active ? over : 1)
  if (I <= 0.01) {
    requestAnimationFrame(frame)
    return
  }

  const lx = light.x * W
  const ly = light.y * H
  const cx = W / 2
  const cy = H / 2
  const m = Math.min(W, H)
  const flicker = 1 + 0.06 * Math.sin(t * 13.7) + 0.04 * Math.sin(t * 7.1)

  ctx.globalCompositeOperation = 'lighter'

  // Hot core + chromatic fringe.
  glow(lx, ly, m * 0.05 * flicker, '255,255,255', 0.9 * I)
  glow(lx, ly, m * 0.16 * flicker, '255,235,200', 0.45 * I)

  // Radial starburst: fine spikes radiating in every direction from the light
  // (the diaphragm diffraction star), so the default flare reads radial.
  if (params.burst > 0.01) {
    const n = Math.round(params.spikes)
    const len = m * (0.22 + 0.55 * params.burst) * flicker
    ctx.save()
    ctx.translate(lx, ly)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.0
      const long = i % 2 === 0 ? 1 : 0.5 // alternating long/short rays
      const ll = len * long * (0.7 + 0.6 * Math.abs(Math.sin(i * 1.3 + t)))
      const g = ctx.createLinearGradient(0, 0, Math.cos(a) * ll, Math.sin(a) * ll)
      g.addColorStop(0, `rgba(255,240,210,${0.5 * I * params.burst})`)
      g.addColorStop(0.5, `rgba(255,210,170,${0.12 * I * params.burst})`)
      g.addColorStop(1, 'rgba(255,200,160,0)')
      ctx.strokeStyle = g
      ctx.lineWidth = Math.max(1, m * 0.004 * long)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * ll, Math.sin(a) * ll)
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
  }
  if (params.chroma > 0.01) {
    glow(lx - m * 0.01, ly, m * 0.2, '255,80,60', 0.12 * I * params.chroma)
    glow(lx + m * 0.01, ly, m * 0.23, '80,120,255', 0.12 * I * params.chroma)
  }

  // Anamorphic streak: a long thin horizontal cyan blur.
  if (params.streak > 0.01) {
    const sw = W * 0.9 * params.streak
    const g = ctx.createLinearGradient(lx - sw, ly, lx + sw, ly)
    g.addColorStop(0, 'rgba(80,160,255,0)')
    g.addColorStop(0.5, `rgba(150,210,255,${0.5 * I})`)
    g.addColorStop(1, 'rgba(80,160,255,0)')
    ctx.fillStyle = g
    const sh = m * 0.006 * (1 + params.streak)
    ctx.fillRect(lx - sw, ly - sh, sw * 2, sh * 2)
    glow(lx, ly, m * 0.02, '200,235,255', 0.8 * I)
  }

  // Halo ring around the frame centre side of the light.
  if (params.halo > 0.01) {
    const hr = m * 0.28
    ctx.strokeStyle = `rgba(255,190,140,${0.22 * I * params.halo})`
    ctx.lineWidth = m * 0.02
    ctx.beginPath()
    ctx.arc(lx, ly, hr, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(140,180,255,${0.14 * I * params.halo})`
    ctx.lineWidth = m * 0.012
    ctx.beginPath()
    ctx.arc(lx, ly, hr * 1.06, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Ghost chain along the light→centre line, mirrored past centre.
  const gn = Math.round(params.ghosts)
  for (let i = 1; i <= gn; i++) {
    const f = (i / gn) * 2.2 - 0.2 // spacing along the axis, past the centre
    const gx = lx + (cx - lx) * 2 * f
    const gy = ly + (cy - ly) * 2 * f
    const hue = [ '120,220,160', '255,160,120', '160,140,255', '255,220,140', '120,180,255', '240,140,200' ][i % 6]
    const r = m * (0.02 + 0.05 * Math.abs(Math.sin(i * 2.4))) * (0.6 + 0.8 * Math.abs(f - 0.5))
    if (i % 3 === 0) poly(gx, gy, r, 6, hue, 0.14 * I, i)
    else glow(gx, gy, r, hue, 0.16 * I)
  }

  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
