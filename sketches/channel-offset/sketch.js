/**
 * Channel Offset: split a live source (camera / dropped photo or video / demo /
 * the Mixer layers below) into its red, green and blue channels and push them
 * apart — chromatic aberration, anaglyph ghosting, glitch fringing. Each
 * channel is isolated on its own canvas (multiply against a pure-colour fill)
 * and the three are re-added with independent offsets; a wobble animates them
 * in slow circles and a glitch mode slices horizontal bands sideways.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  amount: { value: 12, min: 0, max: 80, step: 1, label: 'Offset (px)' },
  angle: { value: 0, min: 0, max: 360, step: 1, label: 'Angle' },
  spread: { value: 120, min: 0, max: 180, step: 1, label: 'Channel spread' },
  wobble: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Wobble' },
  glitch: { value: 0, min: 0, max: 1, step: 0.02, label: 'Band glitch' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats kick the channels apart; loudness shears the glitch bands.
rt.mapInput('audio.pulse', 'amount', 0.4)
rt.mapInput('audio.high', 'glitch', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const src = createSource()

// One offscreen canvas per channel: fill pure colour, multiply the source in.
const chans = ['#f00', '#0f0', '#00f'].map(() => {
  const c = document.createElement('canvas')
  return { c, x: c.getContext('2d') }
})
const FILLS = ['#f00', '#0f0', '#00f']

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  for (const ch of chans) {
    ch.c.width = W
    ch.c.height = H
  }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) {
    requestAnimationFrame(frame)
    return
  }

  // Isolate each channel: pure colour fill × source (multiply keeps only that
  // channel's values in that channel).
  for (let i = 0; i < 3; i++) {
    const ch = chans[i]
    ch.x.globalCompositeOperation = 'source-over'
    ch.x.fillStyle = FILLS[i]
    ch.x.fillRect(0, 0, W, H)
    ch.x.globalCompositeOperation = 'multiply'
    src.draw(ch.x, W, H, { mirror: params.mirror })
  }

  const amt = params.amount * rt.pixelRatio
  const base = (params.angle * Math.PI) / 180
  const spread = (params.spread * Math.PI) / 180
  const wob = params.wobble

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'

  for (let i = 0; i < 3; i++) {
    // Channels fan out around the base angle; wobble swings each in its own
    // slow circle so the fringes breathe.
    const a = base + (i - 1) * spread + wob * Math.sin(t * (0.7 + i * 0.31) + i * 2.1) * 0.9
    const d = amt * (i === 1 ? 0.35 : 1) // green stays closest to true
    const dx = Math.cos(a) * d
    const dy = Math.sin(a) * d

    if (params.glitch > 0.01) {
      // Slice into horizontal bands, each sheared by its own random amount.
      const bands = 14
      const bh = Math.ceil(H / bands)
      for (let b = 0; b < bands; b++) {
        // Deterministic per-band pseudo-random, re-rolled a few times a second.
        const seed = Math.sin(b * 37.7 + Math.floor(t * 7) * 13.1 + i * 5) * 43758.5453
        const rnd = seed - Math.floor(seed)
        const shear = (rnd - 0.5) * params.glitch * 90 * rt.pixelRatio
        ctx.drawImage(chans[i].c, 0, b * bh, W, bh, dx + shear, b * bh + dy, W, bh)
      }
    } else {
      ctx.drawImage(chans[i].c, dx, dy)
    }
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
