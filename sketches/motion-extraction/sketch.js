/**
 * Motion extraction: draw the current frame, then draw an inverted copy of
 * the frame from N frames ago on top at ~50% opacity. Anything static sums
 * to flat gray; anything that moved shows up as a bright ghost. (The trick
 * popularized by Posy's "Motion Extraction" video.)
 *
 * Extras: music reactivity (gain/flash mapped from audio), an option to sync
 * the frame delay to the detected tempo, output modes (glow / mask / reveal),
 * and broadcasting the motion mask on the motion bus so other sketches can use
 * it as a mask or layer. The source (camera / upload / demo / Mixer feed) comes
 * from the shared _lib/source.js pipeline.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createMotionPublisher } from '../_lib/motion-bus.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  delay: { value: 6, min: 1, max: 30, step: 1, label: 'Frame delay' },
  blend: { value: 0.5, min: 0.2, max: 0.8, step: 0.01, label: 'Inverted blend' },
  gain: { value: 1, min: 0.5, max: 4, step: 0.05, label: 'Motion gain' },
  flash: { value: 0, min: 0, max: 0.6, step: 0.01, label: 'Beat flash' },
  beatSync: { value: false, type: 'bool', label: 'Sync delay to beat' },
  glow: { value: false, type: 'bool', label: 'Glow (motion on black)' },
  maskOut: { value: false, type: 'bool', label: 'Output motion mask' },
  reveal: { value: false, type: 'bool', label: 'Reveal effect through motion' },
  mirror: { value: true, type: 'bool', label: 'Mirror (selfie)' },
  freeze: { value: false, type: 'bool', label: 'Freeze reference frame' },
  showOriginal: { value: false, type: 'bool', label: 'Show original' },
})
// Music reactivity by default: loudness punches up the motion, beats flash it.
rt.mapInput('audio.volume', 'gain', 1.0)
rt.mapInput('audio.pulse', 'flash', 0.45)

// Publish the extracted motion so other sketches can consume it as a mask/layer.
const bus = createMotionPublisher()

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

// Synthetic demo scene (drifting shapes over a static backdrop) so the sketch
// works without camera permission — and shows the effect clearly: the backdrop
// cancels to gray, only the movers glow.
const movers = Array.from({ length: 5 }, (_, i) => ({
  x: Math.random() * 960,
  y: Math.random() * 540,
  vx: (Math.random() - 0.5) * 4,
  vy: (Math.random() - 0.5) * 4,
  r: 25 + i * 12,
  hue: i * 70,
}))
function motionDemo(d, _t, W, H) {
  d.fillStyle = '#20242e'
  d.fillRect(0, 0, W, H)
  d.fillStyle = '#39404f'
  for (let i = 0; i < 12; i++) d.fillRect(i * 80, (i % 3) * 180, 40, 180)
  d.fillStyle = '#556'
  d.font = 'bold 90px system-ui'
  d.fillText('STATIC', 330, 300)
  for (const m of movers) {
    m.x += m.vx
    m.y += m.vy
    if (m.x < 0 || m.x > W) m.vx *= -1
    if (m.y < 0 || m.y > H) m.vy *= -1
    d.beginPath()
    d.arc(m.x, m.y, m.r, 0, Math.PI * 2)
    d.fillStyle = `hsl(${m.hue}, 45%, 45%)`
    d.fill()
  }
}

const src = createSource({ demo: motionDemo })

// Small offscreen canvas that always holds the current motion mask (motion
// bright, static black) — used for the bus broadcast to other sketches.
const maskCanvas = document.createElement('canvas')
maskCanvas.width = 320
maskCanvas.height = 180
const maskCtx = maskCanvas.getContext('2d')

// Smoothed frame time, so beat-synced delay can convert tempo (ms) to frames.
let lastNow = 0
let frameDt = 16.7

// Ring buffer of past frames for the delay line.
const MAX_DELAY = 30
let ring = []
let head = 0
let frozen = null
let wasFrozen = false

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  ring = Array.from({ length: MAX_DELAY }, () => {
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    return c
  })
  head = 0
  frozen = null
}

// Cover-fit the live source (mirrored per the param) — the shared pipeline
// never flips the Mixer feed, so it stays registered with the layers below.
function drawSource(target, tw = canvas.width, th = canvas.height) {
  src.draw(target, tw, th, { mirror: params.mirror })
}

// Cover-fit an already-rasterized full-frame ring canvas onto a target.
function drawFrame(target, frame, tw, th) {
  target.drawImage(frame, 0, 0, canvas.width, canvas.height, 0, 0, tw, th)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001

  // Smoothed frame time, so beat-synced delay can turn tempo (ms) into frames.
  if (lastNow) {
    const dt = now - lastNow
    if (dt > 0 && dt < 100) frameDt = frameDt * 0.9 + dt * 0.1
  }
  lastNow = now

  src.update(t)
  if (src.ready) {
    const gain = params.gain

    // Reference frame: a frozen snapshot, or the frame from `activeDelay` ago.
    // With beat-sync, the delay is the detected beat interval in frames, so the
    // inverted echo lands one beat behind the live image.
    let activeDelay = Math.round(params.delay)
    if (params.beatSync && rt.beat.state.interval > 0) {
      activeDelay = Math.round(rt.beat.state.interval / frameDt)
    }
    activeDelay = Math.min(MAX_DELAY - 1, Math.max(1, activeDelay))

    if (params.freeze) {
      if (!wasFrozen || !frozen) frozen = ring[(head - 1 + MAX_DELAY) % MAX_DELAY]
    } else {
      frozen = null
    }
    wasFrozen = params.freeze
    const reference = frozen ?? ring[(head - activeDelay + MAX_DELAY) % MAX_DELAY]

    // Maintain the small motion mask for the bus (motion bright, static black).
    // Scaling both frames by `gain` scales their difference by gain too.
    maskCtx.filter = gain !== 1 ? `brightness(${gain})` : 'none'
    maskCtx.globalCompositeOperation = 'source-over'
    drawSource(maskCtx, maskCanvas.width, maskCanvas.height)
    maskCtx.globalCompositeOperation = 'difference'
    drawFrame(maskCtx, reference, maskCanvas.width, maskCanvas.height)
    maskCtx.globalCompositeOperation = 'source-over'
    maskCtx.filter = 'none'
    bus.publish(maskCanvas)

    // --- display ---
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'

    const useDiff = params.glow || params.maskOut || params.reveal

    if (params.showOriginal) {
      drawSource(ctx)
    } else if (useDiff) {
      // Difference base: static → black, motion → bright (scaled by gain).
      ctx.filter = gain !== 1 ? `brightness(${gain})` : 'none'
      drawSource(ctx)
      ctx.globalCompositeOperation = 'difference'
      ctx.drawImage(reference, 0, 0)
      ctx.filter = 'none'
      ctx.globalCompositeOperation = 'source-over'

      if (params.reveal) {
        // Multiply a drifting hue field through the motion: movement "paints"
        // the effect, static stays black — the mask used as an effect layer.
        const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
        for (let i = 0; i <= 6; i++) {
          g.addColorStop(i / 6, `hsl(${(t * 40 + i * 60) % 360}, 90%, 60%)`)
        }
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = g
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.globalCompositeOperation = 'source-over'
      } else if (params.maskOut) {
        // Desaturate to a clean grayscale motion mask.
        ctx.globalCompositeOperation = 'saturation'
        ctx.fillStyle = 'hsl(0, 0%, 50%)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.globalCompositeOperation = 'source-over'
      }
    } else {
      // Classic extraction: current + inverted delayed copy at `blend`.
      drawSource(ctx)
      ctx.filter = 'invert(1)'
      ctx.globalAlpha = params.blend
      ctx.drawImage(reference, 0, 0)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
    }

    // Beat flash: an additive bloom on beats — music reactivity in any mode.
    if (params.flash > 0.001) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = `rgba(255, 255, 255, ${params.flash})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'source-over'
    }

    // Record the clean current frame into the delay line (skip while frozen).
    if (!frozen) {
      const slot = ring[head].getContext('2d')
      slot.clearRect(0, 0, canvas.width, canvas.height)
      drawSource(slot)
      head = (head + 1) % MAX_DELAY
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
