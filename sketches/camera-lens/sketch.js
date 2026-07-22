/**
 * Camera lens: put a real lens between you and a live source (camera, a dropped
 * photo/video, the demo, or — in the Mixer/Patch — the layers below). A focal
 * plane you can rack with the mouse defines what's sharp; everything a "depth"
 * away from it dissolves into aperture blur / bokeh. On top sit the things that
 * make glass read as glass: highlight bloom, a smear of lens dirt that lights
 * up against bright areas, and a soft vignette.
 *
 * There's no true depth here (the source is flat), so depth is modelled as
 * distance from a focal band — a tilt-shift plane, or a radial "portrait"
 * focus around the centre.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource, clamp } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  focalPlane: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Focal plane' },
  autoScan: { value: false, type: 'bool', label: 'Auto-scan focus' },
  scanSpeed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Auto-scan speed' },
  focusDepth: { value: 0.3, min: 0.03, max: 1, step: 0.01, label: 'Focus depth' },
  aperture: { value: +rt.random(0.35, 0.8).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Aperture (blur)' },
  radial: { value: rt.rng() < 0.35, type: 'bool', label: 'Radial focus (portrait)' },
  bloom: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Highlight bloom' },
  dirt: { value: +rt.random(0.2, 0.7).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Lens dirt' },
  vignette: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Rack focus by moving the mouse up and down — works with no permissions.
rt.mapInput('mouse.y', 'focalPlane', 0.5)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// Work canvases: a blur/bloom layer and a tiny buffer for average brightness.
const blurC = document.createElement('canvas')
const blurCtx = blurC.getContext('2d')
const tiny = document.createElement('canvas')
tiny.width = 24
tiny.height = 16
const tinyCtx = tiny.getContext('2d', { willReadFrequently: true })

// Procedural lens-dirt texture (smudges, dust specks, a couple of hairs),
// rebuilt on resize. It's screen-blended so it only ever adds light — the way
// grime on a lens veils and flares against a bright scene.
let dirtC = null
function buildDirt(W, H) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const d = c.getContext('2d')
  const R = () => Math.random()
  // Greasy smudges: large, soft, slightly elongated bright blobs.
  for (let i = 0; i < 16; i++) {
    const x = R() * W
    const y = R() * H
    const r = (0.06 + R() * 0.16) * Math.min(W, H)
    d.save()
    d.translate(x, y)
    d.rotate(R() * Math.PI)
    d.scale(1, 0.4 + R() * 0.7)
    const g = d.createRadialGradient(0, 0, 0, 0, 0, r)
    const a = 0.05 + R() * 0.12
    g.addColorStop(0, `rgba(210,215,230,${a})`)
    g.addColorStop(0.6, `rgba(180,190,210,${a * 0.4})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    d.fillStyle = g
    d.beginPath()
    d.arc(0, 0, r, 0, Math.PI * 2)
    d.fill()
    d.restore()
  }
  // Dust specks.
  for (let i = 0; i < 900; i++) {
    const x = R() * W
    const y = R() * H
    const r = (0.4 + R() * 1.8) * (Math.min(W, H) / 900 + 0.5)
    d.fillStyle = `rgba(230,235,245,${0.06 + R() * 0.5})`
    d.beginPath()
    d.arc(x, y, r, 0, Math.PI * 2)
    d.fill()
  }
  // A few stray hairs / fibres.
  d.lineCap = 'round'
  for (let i = 0; i < 9; i++) {
    let x = R() * W
    let y = R() * H
    d.strokeStyle = `rgba(220,225,235,${0.08 + R() * 0.18})`
    d.lineWidth = 0.6 + R() * 1.2
    d.beginPath()
    d.moveTo(x, y)
    const steps = 6 + (R() * 10) | 0
    let a = R() * Math.PI * 2
    for (let s = 0; s < steps; s++) {
      a += (R() - 0.5) * 1.1
      x += Math.cos(a) * (6 + R() * 14)
      y += Math.sin(a) * (6 + R() * 14)
      d.lineTo(x, y)
    }
    d.stroke()
  }
  return c
}

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  blurC.width = W
  blurC.height = H
  dirtC = buildDirt(W, H)
}

// Average scene brightness (0..1) — lens dirt and bloom lean on it.
function avgBrightness() {
  try {
    src.draw(tinyCtx, tiny.width, tiny.height, { mirror: params.mirror })
    const d = tinyCtx.getImageData(0, 0, tiny.width, tiny.height).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    return s / (d.length / 4) / 255
  } catch {
    return 0.5
  }
}

// Auto-scan: a camera hunting for focus — pull to a new focal plane, ease in
// (with a little settling wobble), hold, then rack to another.
let scanCur = 0.5, scanTarget = 0.5, scanNext = 0, lastT = 0
function autoFocal(t) {
  const dt = Math.min(0.05, lastT ? t - lastT : 0.016)
  lastT = t
  if (t > scanNext) { scanTarget = rt.random(0.15, 0.85); scanNext = t + rt.random(2.4, 5) / Math.max(0.2, params.scanSpeed) }
  scanCur += (scanTarget - scanCur) * Math.min(1, dt * 2.4 * params.scanSpeed)
  // a faint focus-breathing wobble as it settles
  return Math.max(0, Math.min(1, scanCur + Math.sin(t * 6) * 0.01 * Math.abs(scanTarget - scanCur)))
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  const fp = params.autoScan ? autoFocal(t) : params.focalPlane
  const mirror = params.mirror
  const bright = avgBrightness()

  // --- sharp base ---
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  src.draw(ctx, W, H, { mirror })

  // --- depth-of-field: overlay a blurred copy, masked to fade in away from the
  // focal band (or focal ring, in radial mode). ---
  const bpx = params.aperture * 22 * Math.max(0.6, rt.pixelRatio)
  if (bpx > 0.4) {
    blurCtx.globalCompositeOperation = 'source-over'
    blurCtx.globalAlpha = 1
    blurCtx.clearRect(0, 0, W, H)
    blurCtx.filter = `blur(${bpx}px)`
    src.draw(blurCtx, W, H, { mirror })
    blurCtx.filter = 'none'

    // Keep the blur only where it's out of focus (destination-in alpha mask).
    blurCtx.globalCompositeOperation = 'destination-in'
    const depth = params.focusDepth
    if (params.radial) {
      const cx = W / 2
      const cy = fp * H
      const rIn = depth * 0.5 * Math.min(W, H)
      const rOut = rIn + depth * 0.9 * Math.min(W, H) + 1
      const g = blurCtx.createRadialGradient(cx, cy, rIn, cx, cy, rOut)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,1)')
      blurCtx.fillStyle = g
    } else {
      const c = fp
      const hw = depth * 0.5
      const g = blurCtx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(clamp(c - hw, 0.0001, 0.9998), 'rgba(0,0,0,1)')
      g.addColorStop(clamp(c, 0.0002, 0.9999), 'rgba(0,0,0,0)')
      g.addColorStop(clamp(c + hw, 0.0003, 1), 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,1)')
      blurCtx.fillStyle = g
    }
    blurCtx.fillRect(0, 0, W, H)
    blurCtx.globalCompositeOperation = 'source-over'

    ctx.drawImage(blurC, 0, 0)
  }

  // --- highlight bloom: blurred bright-pass added back over the frame ---
  if (params.bloom > 0.01) {
    blurCtx.globalCompositeOperation = 'source-over'
    blurCtx.globalAlpha = 1
    blurCtx.clearRect(0, 0, W, H)
    blurCtx.filter = `brightness(0.55) contrast(2.4) blur(${8 * rt.pixelRatio}px)`
    src.draw(blurCtx, W, H, { mirror })
    blurCtx.filter = 'none'
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = params.bloom * (0.5 + 0.7 * bright)
    ctx.drawImage(blurC, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // --- lens dirt: screen-blended so it flares against bright areas ---
  if (params.dirt > 0.01 && dirtC) {
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = params.dirt * (0.22 + 0.95 * bright)
    ctx.drawImage(dirtC, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // --- vignette ---
  if (params.vignette > 0.01) {
    const g = ctx.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.35,
      W / 2,
      H / 2,
      Math.max(W, H) * 0.72,
    )
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${params.vignette * 0.85})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
