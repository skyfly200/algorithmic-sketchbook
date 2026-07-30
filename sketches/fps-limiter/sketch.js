// FPS Limiter — throttle any source to a chosen frame rate. The upstream image
// keeps running at full speed, but we only *sample* it every 1/fps seconds and
// hold that frame on screen until the next sample, so smooth motion turns into
// a stepped, stop-motion / anime-"on-twos" stutter. Blend softens each step
// into a short crossfade; echo persists a little of the previous frame for a
// motion smear. A filter: it processes whatever feeds it.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  fps: { value: 8, min: 1, max: 30, step: 1, label: 'Target FPS' },
  blend: { value: 0, min: 0, max: 1, step: 0.02, label: 'Step blend' },
  echo: { value: 0, min: 0, max: 1, step: 0.02, label: 'Motion echo' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// beats can nudge the rate — a kick can drop it to a chunky stutter
rt.mapInput('audio.pulse', 'fps', 0)

const src = createSource()
const held = document.createElement('canvas') // the currently-shown sampled frame
const heldx = held.getContext('2d')
const prev = document.createElement('canvas') // the frame before it (for the blend)
const prevx = prev.getContext('2d')

let W = 0, H = 0, PR = 1
let lastCap = 0 // ms of the last sample
let interval = 125 // ms between samples

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  held.width = prev.width = W
  held.height = prev.height = H
  lastCap = 0 // force a fresh capture at the new size
}

const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x) }

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t) // keep the upstream advancing at full speed even between samples
  if (!src.ready) { requestAnimationFrame(frame); return }

  interval = 1000 / Math.max(1, params.fps)
  if (lastCap === 0) lastCap = now - interval // capture immediately on (re)start

  // sample-and-hold: only pull a new frame from the source at the target rate
  if (now - lastCap >= interval) {
    prevx.clearRect(0, 0, W, H)
    prevx.drawImage(held, 0, 0)
    if (params.echo > 0) {
      // keep a fraction of the old held frame → trailing smear on movement
      heldx.globalAlpha = Math.max(0.15, 1 - params.echo * 0.85)
      src.draw(heldx, W, H, { mirror: params.mirror })
      heldx.globalAlpha = 1
    } else {
      heldx.clearRect(0, 0, W, H)
      src.draw(heldx, W, H, { mirror: params.mirror })
    }
    // step forward without drift; snap if we've fallen far behind
    lastCap += interval
    if (now - lastCap > interval) lastCap = now
  }

  // composite the held frame; optionally crossfade in from the previous sample
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, W, H)
  if (params.blend > 0) {
    const frac = Math.min(1, (now - lastCap) / interval)
    const a = smooth(Math.min(1, frac / params.blend)) // reach full by blend·interval
    ctx.drawImage(prev, 0, 0)
    ctx.globalAlpha = a
    ctx.drawImage(held, 0, 0)
    ctx.globalAlpha = 1
  } else {
    ctx.drawImage(held, 0, 0)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
