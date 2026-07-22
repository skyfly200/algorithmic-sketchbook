// Rolling Shutter — the CMOS "jello" artifact as a live filter. A real sensor
// reads out one scanline at a time, so each band of the frame is sampled a
// moment later than the one above it. We keep a short history of source frames
// and paint each band from the instant its scanline would have been read — so
// genuine motion skews and tears — plus a synthetic wobble/skew so even a
// still image shakes like jelly, and a partial-exposure flash band.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  direction: { value: 'Top → Bottom', type: 'select', options: ['Top → Bottom', 'Bottom → Top', 'Left → Right', 'Right → Left'], label: 'Readout' },
  readout: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Readout lag (skew)' },
  bands: { value: 90, min: 12, max: 240, step: 1, label: 'Scan bands' },
  skew: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Wobble skew' },
  wobble: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Jello wobble' },
  flash: { value: 0.2, min: 0, max: 1, step: 0.02, label: 'Flash band' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'flash', 0.5)
rt.mapInput('audio.level', 'wobble', 0.3)

const src = createSource()

// Ring buffer of recent source frames, sized to the viewport aspect (capped).
const HIST = 12
const hist = Array.from({ length: HIST }, () => {
  const c = document.createElement('canvas'); c.width = 2; c.height = 2
  return c
})
let head = 0 // index of the most recently written buffer
let bw = 2, bh = 2

let W = 0, H = 0, PR = 1
function sizeBuffers() {
  const w = window.innerWidth || 640, h = window.innerHeight || 360
  const MAX = 720
  const nw = w >= h ? MAX : Math.max(2, Math.round(MAX * (w / h)))
  const nh = w >= h ? Math.max(2, Math.round(MAX * (h / w))) : MAX
  if (nw !== bw || nh !== bh) {
    bw = nw; bh = nh
    for (const c of hist) { c.width = bw; c.height = bh }
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  sizeBuffers()
}

// draw source with cover-fit into a buffer context
function coverInto(c, cv, sw, sh) {
  const scale = Math.max(c.canvas.width / sw, c.canvas.height / sh)
  const w = sw * scale, h = sh * scale
  c.drawImage(cv, (c.canvas.width - w) / 2, (c.canvas.height - h) / 2, w, h)
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  last = now
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  sizeBuffers()

  // capture the current source frame into the next ring slot
  head = (head + 1) % HIST
  const cur = hist[head].getContext('2d')
  cur.setTransform(1, 0, 0, 1, 0, 0)
  cur.globalAlpha = 1
  cur.fillStyle = '#000'
  cur.fillRect(0, 0, bw, bh)
  // draw the shared source into a temp via its own API: reuse a scratch canvas
  src.draw(cur, bw, bh, { mirror: params.mirror })

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const dir = params.direction
  const vertical = dir === 'Top → Bottom' || dir === 'Bottom → Top'
  const nBands = Math.round(params.bands)
  const span = params.readout * (HIST - 2) // frames of lag across the whole frame
  const flashPos = (t * 0.35) % 1 // sweeping flash band position

  for (let i = 0; i < nBands; i++) {
    // f: 0 at the first scanline read → 1 at the last
    let f = i / (nBands - 1)
    if (dir === 'Bottom → Top' || dir === 'Right → Left') f = 1 - f
    // pick the history frame this scanline was captured in (older → newer)
    const age = Math.round(f * span)
    const idx = (head - age + HIST * 2) % HIST
    const buf = hist[idx]
    // synthetic wobble/skew, a function of scan position + time
    const ph = i / nBands
    const shift = (Math.sin(ph * 9 + t * 6) * params.wobble * 0.04 +
      (ph - 0.5) * params.skew * 0.06) * (vertical ? W : H)

    ctx.save()
    if (vertical) {
      const y0 = Math.floor((i / nBands) * H)
      const y1 = Math.ceil(((i + 1) / nBands) * H)
      const sy0 = (i / nBands) * bh
      const sy1 = ((i + 1) / nBands) * bh
      ctx.drawImage(buf, 0, sy0, bw, sy1 - sy0, shift, y0, W, y1 - y0)
    } else {
      const x0 = Math.floor((i / nBands) * W)
      const x1 = Math.ceil(((i + 1) / nBands) * W)
      const sx0 = (i / nBands) * bw
      const sx1 = ((i + 1) / nBands) * bw
      ctx.drawImage(buf, sx0, 0, sx1 - sx0, bh, x0, shift, x1 - x0, H)
    }
    ctx.restore()

    // partial-exposure flash: a bright band sweeping across the readout
    if (params.flash > 0.01) {
      const near = 1 - Math.min(1, Math.abs(ph - flashPos) / 0.08)
      if (near > 0) {
        ctx.fillStyle = `rgba(255,255,255,${near * params.flash * 0.6})`
        if (vertical) ctx.fillRect(0, (i / nBands) * H, W, H / nBands + 1)
        else ctx.fillRect((i / nBands) * W, 0, W / nBands + 1, H)
      }
    }
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
