// Painterly — repaint any source with oriented brush strokes. A reduced copy of
// the frame gives a colour + gradient field; strokes are laid perpendicular to
// the gradient (i.e. along contours) so they flow around forms, exactly how a
// painter follows edges. The medium (watercolour / oil / charcoal / ink /
// pastel) changes the stroke shape, opacity, colour treatment and paper.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  style: { value: 'Watercolour', type: 'select', options: ['Watercolour', 'Oil', 'Charcoal', 'Ink', 'Pastel'], label: 'Medium' },
  brush: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Brush size' },
  density: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Density' },
  length: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Stroke length' },
  edges: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Edge strength' },
  paper: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Paper texture' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'density', 0.3)

const src = createSource()
// reduced field buffer (colour + luminance/gradient sampled from here)
const fb = document.createElement('canvas')
const fbx = fb.getContext('2d', { willReadFrequently: true })
let fw = 2, fh = 2, fdata = null, lum = null
// paper texture, baked once
let paper = null

let W = 0, H = 0, PR = 1
function buildPaper() {
  paper = document.createElement('canvas'); paper.width = W; paper.height = H
  const p = paper.getContext('2d')
  p.fillStyle = '#f3ecdd'; p.fillRect(0, 0, W, H)
  for (let i = 0; i < (W * H) / 400; i++) {
    const x = Math.random() * W, y = Math.random() * H
    p.fillStyle = `rgba(${Math.random() < 0.5 ? '150,140,120' : '255,255,245'},${Math.random() * 0.06})`
    p.fillRect(x, y, 1.5 * PR, 1.5 * PR)
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  const long = 300
  fw = W >= H ? long : Math.round(long * (W / H))
  fh = W >= H ? Math.round(long * (H / W)) : long
  fb.width = fw; fb.height = fh
  buildPaper()
}

function coverInto(c, cv, sw, sh, tw, th) {
  const s = Math.max(tw / sw, th / sh)
  c.drawImage(cv, (tw - sw * s) / 2, (th - sh * s) / 2, sw * s, sh * s)
}

function styleBg() {
  const s = params.style
  if (s === 'Ink') return '#f6f3ec'
  if (s === 'Charcoal') return '#d9d3c6'
  return null // watercolour/oil/pastel start from the paper
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  // 1) sample the source into the reduced field buffer + read pixels
  fbx.clearRect(0, 0, fw, fh)
  src.draw(fbx, fw, fh, { mirror: params.mirror })
  fdata = fbx.getImageData(0, 0, fw, fh).data
  if (!lum || lum.length !== fw * fh) lum = new Float32Array(fw * fh)
  for (let i = 0; i < fw * fh; i++) {
    const j = i * 4
    lum[i] = (fdata[j] * 0.299 + fdata[j + 1] * 0.587 + fdata[j + 2] * 0.114) / 255
  }

  // 2) lay the ground
  const style = params.style
  const bg = styleBg()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H) }
  else { ctx.drawImage(paper, 0, 0) }

  const sx = W / fw, sy = H / fh
  const base = (18 * params.brush) * PR
  const nStrokes = Math.round((W * H) / (base * base) * 1.6 * params.density)
  ctx.lineCap = 'round'

  for (let n = 0; n < nStrokes; n++) {
    const gx = (Math.random() * fw) | 0
    const gy = (Math.random() * fh) | 0
    const i = gy * fw + gx
    // sobel gradient at this cell
    const xl = Math.max(0, gx - 1), xr = Math.min(fw - 1, gx + 1)
    const yt = Math.max(0, gy - 1), yb = Math.min(fh - 1, gy + 1)
    const gxv = (lum[gy * fw + xr] - lum[gy * fw + xl])
    const gyv = (lum[yb * fw + gx] - lum[yt * fw + gx])
    const grad = Math.hypot(gxv, gyv)
    const ang = Math.atan2(gyv, gxv) + Math.PI / 2 // along the contour
    const j = i * 4
    let r = fdata[j], g = fdata[j + 1], b = fdata[j + 2]

    const x = gx * sx + (Math.random() - 0.5) * base
    const y = gy * sy + (Math.random() - 0.5) * base
    const len = base * (1.4 + grad * 2) * params.length
    const wdt = base * 0.5

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)

    if (style === 'Charcoal' || style === 'Ink') {
      const dark = 1 - lum[i]
      if (style === 'Ink') {
        // only draw where there's an edge or deep shadow → linework
        const on = grad * 3 * params.edges + Math.max(0, dark - 0.55) * 1.5
        if (on < 0.12) { ctx.restore(); continue }
        ctx.strokeStyle = `rgba(20,18,24,${Math.min(0.9, on)})`
        ctx.lineWidth = wdt * 0.5
      } else {
        ctx.strokeStyle = `rgba(30,28,32,${Math.min(0.7, dark * 0.7 + grad * params.edges)})`
        ctx.lineWidth = wdt
      }
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke()
      ctx.restore(); continue
    }

    // colour styles
    let a = 0.9, lw = wdt
    if (style === 'Watercolour') { a = 0.22; lw = wdt * 1.6; r = r * 0.7 + 255 * 0.3; g = g * 0.7 + 255 * 0.3; b = b * 0.7 + 255 * 0.3 }
    else if (style === 'Pastel') { a = 0.5; lw = wdt * 1.2; r = r * 0.75 + 235 * 0.25; g = g * 0.75 + 230 * 0.25; b = b * 0.75 + 225 * 0.25 }
    else { a = 0.92; lw = wdt } // Oil: opaque impasto
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`
    ctx.lineWidth = lw
    ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke()
    // oil gets a bright impasto highlight edge
    if (style === 'Oil') {
      ctx.strokeStyle = `rgba(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)},0.25)`
      ctx.lineWidth = lw * 0.4
      ctx.beginPath(); ctx.moveTo(-len / 2, -lw * 0.25); ctx.lineTo(len / 2, -lw * 0.25); ctx.stroke()
    }
    ctx.restore()
  }

  // 3) edge accent + paper wash for the wet media
  if ((style === 'Watercolour' || style === 'Pastel') && params.paper > 0.01) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = params.paper * 0.5
    ctx.drawImage(paper, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
