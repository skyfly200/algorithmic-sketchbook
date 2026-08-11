// Tiling — replicate a live source across an N×M grid, but let each tile drift
// away from its neighbours: a per-tile hue rotation walks across the grid, and a
// per-tile time offset pulls each cell from a different moment of a rolling
// frame history, so the same gesture ripples across the wall a beat apart. Flip
// alternate tiles into a kaleidoscopic mirror weave.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  cols: { value: 3, min: 1, max: 8, step: 1, label: 'Columns' },
  rows: { value: 3, min: 1, max: 8, step: 1, label: 'Rows' },
  hueStep: { value: 40, min: 0, max: 180, step: 1, label: 'Hue / tile°' },
  timeStep: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Time / tile (s)' },
  mirrorTiles: { value: true, type: 'bool', label: 'Mirror weave' },
  radial: { value: false, type: 'bool', label: 'Radial hue/time' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'hueStep', 0.4)

const src = createSource()
// rolling history of recent frames so tiles can sample the past
const HIST = 48
const hist = []
let W = 0, H = 0, tw = 0, th = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  // per-tile source resolution, capped so the history stays cheap
  tw = Math.max(2, Math.min(360, Math.round(W / Math.max(1, params.cols))))
  th = Math.max(2, Math.min(360, Math.round(H / Math.max(1, params.rows))))
  for (const h of hist) { h.width = tw; h.height = th }
}
function pushFrame(t) {
  let c = hist.length >= HIST ? hist.shift() : Object.assign(document.createElement('canvas'), { width: tw, height: th })
  if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th }
  const cx = c.getContext('2d')
  src.draw(cx, tw, th, { mirror: params.mirror })
  c._t = t
  hist.push(c)
}
function frameAt(t) {
  // nearest frame in history to time t
  let best = hist[hist.length - 1], bd = Infinity
  for (const h of hist) { const dd = Math.abs(h._t - t); if (dd < bd) { bd = dd; best = h } }
  return best
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  const cols = Math.round(params.cols), rows = Math.round(params.rows)
  if (tw > W / cols + 2 || th > H / rows + 2) resize()
  pushFrame(t)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  const cw = W / cols, ch = H / rows
  const cxi = (cols - 1) / 2, cyi = (rows - 1) / 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rank = params.radial ? Math.hypot(c - cxi, r - cyi) : (r * cols + c)
      const past = frameAt(t - rank * params.timeStep)
      const hue = rank * params.hueStep
      ctx.save()
      const x0 = c * cw, y0 = r * ch
      ctx.beginPath(); ctx.rect(x0, y0, cw + 1, ch + 1); ctx.clip()
      let sx = 1, sy = 1, tx = x0, ty = y0
      if (params.mirrorTiles) {
        if (c % 2) { sx = -1; tx = x0 + cw }
        if (r % 2) { sy = -1; ty = y0 + ch }
      }
      ctx.translate(tx, ty); ctx.scale(sx, sy)
      ctx.filter = hue ? `hue-rotate(${hue}deg)` : 'none'
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(past, 0, 0, cw, ch)
      ctx.restore()
    }
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
