// Interlace — the comb artifact of interlaced video. A real signal reads the
// even scanlines, then the odd ones a field later, so moving edges tear into
// feathered teeth. We keep the previous frame and paint its rows into the odd
// scanlines of the current one (with an optional horizontal shear to exaggerate
// the comb), then add scanline darkening.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  fieldSize: { value: 2, min: 1, max: 8, step: 1, label: 'Field line height' },
  comb: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Comb shear' },
  fieldBlend: { value: 1, min: 0, max: 1, step: 0.02, label: 'Field time-offset' },
  scanlines: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Scanline darkening' },
  oddFirst: { value: false, type: 'bool', label: 'Odd field first' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'comb', 0.4)

const src = createSource()
const cur = document.createElement('canvas')
const curx = cur.getContext('2d')
const prev = document.createElement('canvas')
const prevx = prev.getContext('2d')
// A mask of the odd scanlines (opaque rows) at the current field height.
let lineMask = document.createElement('canvas')
let scanMask = document.createElement('canvas')

let W = 0, H = 0, PR = 1, lastFieldSize = 0, lastOddFirst = false
function buildMasks() {
  const fs = Math.max(1, Math.round(params.fieldSize)) * PR
  lastFieldSize = params.fieldSize
  lastOddFirst = params.oddFirst
  lineMask.width = W; lineMask.height = H
  const lx = lineMask.getContext('2d')
  lx.clearRect(0, 0, W, H)
  lx.fillStyle = '#fff'
  const offset = params.oddFirst ? 0 : fs
  for (let y = offset; y < H; y += fs * 2) lx.fillRect(0, y, W, fs)
  scanMask.width = W; scanMask.height = H
  const sx = scanMask.getContext('2d')
  sx.clearRect(0, 0, W, H)
  sx.fillStyle = '#000'
  for (let y = 0; y < H; y += fs * 2) sx.fillRect(0, y, W, fs)
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cur.width = prev.width = W; cur.height = prev.height = H
  buildMasks()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  if (params.fieldSize !== lastFieldSize || params.oddFirst !== lastOddFirst) buildMasks()

  // roll the previous field, capture the new current frame
  prevx.clearRect(0, 0, W, H)
  prevx.drawImage(cur, 0, 0)
  curx.clearRect(0, 0, W, H)
  src.draw(curx, W, H, { mirror: params.mirror })

  // base = current frame
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(cur, 0, 0)

  // odd field: the previous frame masked to the odd scanlines, sheared sideways
  const field = scanScratch()
  const fx = field.getContext('2d')
  fx.setTransform(1, 0, 0, 1, 0, 0)
  fx.clearRect(0, 0, W, H)
  // time-offset field: blend prev toward cur by (1 - fieldBlend)
  fx.globalAlpha = 1
  fx.drawImage(prev, 0, 0)
  if (params.fieldBlend < 1) { fx.globalAlpha = 1 - params.fieldBlend; fx.drawImage(cur, 0, 0); fx.globalAlpha = 1 }
  // keep only the odd scanlines
  fx.globalCompositeOperation = 'destination-in'
  fx.drawImage(lineMask, 0, 0)
  fx.globalCompositeOperation = 'source-over'
  // draw it over the base with a horizontal shear (the comb)
  const shear = params.comb * 8 * PR * Math.sin(t * 1.7)
  ctx.drawImage(field, shear, 0)

  // scanline darkening
  if (params.scanlines > 0.01) {
    ctx.globalAlpha = params.scanlines * 0.6
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(scanMask, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

// a reusable scratch canvas for the odd field
let _scratch = null
function scanScratch() {
  if (!_scratch || _scratch.width !== W || _scratch.height !== H) {
    _scratch = document.createElement('canvas'); _scratch.width = W; _scratch.height = H
  }
  return _scratch
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
