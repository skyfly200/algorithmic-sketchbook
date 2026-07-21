// Strobe — a strobe light over a live source: hard flashes locked to a rate
// or the beat, holding a frozen frame between flashes so motion breaks into
// stop-motion pops. Modes: white flash, black flash, invert, and freeze.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  rate: { value: 6, min: 0.5, max: 24, step: 0.5, label: 'Flashes / sec' },
  onBeat: { value: true, type: 'bool', label: 'Flash on beat' },
  duty: { value: 0.5, min: 0.05, max: 0.95, step: 0.01, label: 'Flash width' },
  mode: { value: rt.pick(['white', 'black', 'invert', 'freeze']), type: 'select', options: ['white', 'black', 'invert', 'freeze'], label: 'Mode' },
  trails: { value: 0.3, min: 0, max: 0.95, step: 0.01, label: 'Freeze trails' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'rate', 4)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()
const frozen = document.createElement('canvas')
const fctx = frozen.getContext('2d')

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  frozen.width = W
  frozen.height = H
}

let phase = 0
let last = 0
let flashHold = 0
rt.onBeat(() => { if (params.onBeat) flashHold = 1 })

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  phase += dt * params.rate
  const on = params.onBeat ? flashHold > 0.5 : (phase % 1) < params.duty
  flashHold = Math.max(0, flashHold - dt * params.rate)

  if (on) {
    // capture the live frame at the flash instant
    src.draw(fctx, W, H, { mirror: params.mirror })
    if (params.mode === 'white') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H) }
    else if (params.mode === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H) }
    else if (params.mode === 'invert') {
      ctx.drawImage(frozen, 0, 0)
      ctx.globalCompositeOperation = 'difference'
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.drawImage(frozen, 0, 0)
    }
  } else {
    // between flashes: darkness, or a decaying freeze of the last flash
    if (params.trails > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${1 - params.trails})`
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = params.trails
      ctx.drawImage(frozen, 0, 0)
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
    }
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
