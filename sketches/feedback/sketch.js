// Feedback — video feedback: each frame the previous output is redrawn zoomed,
// rotated and drifting, faded a touch, then the live source is composited on
// top. The result tunnels inward and trails into echoes, exactly like pointing
// a camera at the screen it's feeding. A kaleidoscopic mirror and hue-cycling
// push it fully psychedelic.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  zoom: { value: 1.05, min: 0.9, max: 1.15, step: 0.002, label: 'Zoom' },
  rotate: { value: 2, min: -20, max: 20, step: 0.2, label: 'Rotate °/frame' },
  driftX: { value: 0, min: -8, max: 8, step: 0.1, label: 'Drift X' },
  driftY: { value: 0, min: -8, max: 8, step: 0.1, label: 'Drift Y' },
  // Higher decay + a touch of zoom by default so the additive feedback doesn't
  // pin to white; drop them for longer, brighter trails.
  decay: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Decay' },
  sourceMix: { value: 0.4, min: 0.05, max: 1, step: 0.02, label: 'Source amount' },
  hueCycle: { value: 0.3, min: 0, max: 2, step: 0.02, label: 'Hue cycle' },
  mirror2: { value: false, type: 'bool', label: 'Kaleidoscope mirror' },
  mirror: { value: false, type: 'bool', label: 'Mirror source (selfie)' },
})
rt.mapInput('audio.pulse', 'zoom', 0.05)
rt.mapInput('audio.level', 'rotate', 0.4)

const src = createSource()
// The persistent feedback buffer, plus a ping-pong copy of the *previous* frame
// so the buffer is never drawn additively onto itself (that doubles brightness
// each frame and runs away to white).
const fb = document.createElement('canvas')
const fbx = fb.getContext('2d')
const prev = document.createElement('canvas')
const pbx = prev.getContext('2d')
const srcBuf = document.createElement('canvas')
const sbx = srcBuf.getContext('2d')

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  fb.width = W; fb.height = H
  prev.width = W; prev.height = H
  srcBuf.width = W; srcBuf.height = H
  fbx.fillStyle = '#000'; fbx.fillRect(0, 0, W, H)
}

let hue = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  // 1) snapshot the current buffer, then rebuild it from that copy transformed
  //    (zoom/rotate/drift) and faded — drawn as a *replacement* over black, so
  //    the loop's gain is exactly (1 − decay) and never exceeds unity.
  pbx.globalCompositeOperation = 'source-over'; pbx.globalAlpha = 1
  pbx.clearRect(0, 0, W, H)
  pbx.drawImage(fb, 0, 0)

  fbx.setTransform(1, 0, 0, 1, 0, 0)
  fbx.globalCompositeOperation = 'source-over'; fbx.globalAlpha = 1
  fbx.fillStyle = '#000'; fbx.fillRect(0, 0, W, H) // opaque black base
  fbx.save()
  fbx.translate(W / 2 + params.driftX * rt.pixelRatio, H / 2 + params.driftY * rt.pixelRatio)
  fbx.rotate((params.rotate * Math.PI) / 180)
  fbx.scale(params.zoom, params.zoom)
  if (params.hueCycle > 0.01) { hue = (hue + params.hueCycle) % 360; fbx.filter = `hue-rotate(${hue}deg)` }
  // 'lighter' over the black base with alpha = 1−decay just lays down the faded
  // copy (no addition on top of an existing buffer → no runaway)
  fbx.globalCompositeOperation = 'lighter'
  fbx.globalAlpha = Math.max(0, 1 - params.decay)
  fbx.drawImage(prev, -W / 2, -H / 2)
  fbx.restore()
  fbx.filter = 'none'
  fbx.globalAlpha = 1

  // 2) composite the live source with 'screen' — it saturates toward white but
  //    is mathematically incapable of exceeding it, so bright input can't blow
  //    the loop out the way additive 'lighter' did.
  sbx.clearRect(0, 0, W, H)
  src.draw(sbx, W, H, { mirror: params.mirror })
  fbx.globalAlpha = params.sourceMix
  fbx.globalCompositeOperation = 'screen'
  fbx.drawImage(srcBuf, 0, 0)
  fbx.globalAlpha = 1
  fbx.globalCompositeOperation = 'source-over'

  // 3) present, optionally mirrored into a kaleidoscope
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(fb, 0, 0)
  if (params.mirror2) {
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.translate(W, 0); ctx.scale(-1, 1)
    ctx.drawImage(fb, 0, 0, W / 2, H, 0, 0, W / 2, H)
    ctx.restore()
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
