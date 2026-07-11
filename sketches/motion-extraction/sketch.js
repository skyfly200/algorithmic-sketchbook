/**
 * Motion extraction: draw the current frame, then draw an inverted copy of
 * the frame from N frames ago on top at ~50% opacity. Anything static sums
 * to flat gray; anything that moved shows up as a bright ghost. (The trick
 * popularized by Posy's "Motion Extraction" video.)
 *
 * Extras: music reactivity (gain/flash mapped from audio), an option to sync
 * the frame delay to the detected tempo, output modes (glow / mask / reveal),
 * and broadcasting the motion mask on the motion bus so other sketches can use
 * it as a mask or layer.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createMotionPublisher } from '../_lib/motion-bus.js'

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
rt.mapInput('beat.volume', 'gain', 1.0)
rt.mapInput('beat.pulse', 'flash', 0.45)

// Publish the extracted motion so other sketches can consume it as a mask/layer.
const bus = createMotionPublisher()

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const chooser = document.getElementById('chooser')

// Small offscreen canvas that always holds the current motion mask (motion
// bright, static black) — used for the bus broadcast to other sketches.
const maskCanvas = document.createElement('canvas')
maskCanvas.width = 320
maskCanvas.height = 180
const maskCtx = maskCanvas.getContext('2d')

// Smoothed frame time, so beat-synced delay can convert tempo (ms) to frames.
let lastNow = 0
let frameDt = 16.7

let source = null // <video> or demo <canvas>
let sourceW = 0
let sourceH = 0
let demoTick = null

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

// Cover-fit the source onto a target of size (tw, th), optionally mirrored.
// The delay-line snapshots and the mask canvas also go through here, so
// mirroring stays consistent frame to frame.
function drawSource(target, tw = canvas.width, th = canvas.height, img = source) {
  const scale = Math.max(tw / sourceW, th / sourceH)
  const w = sourceW * scale
  const h = sourceH * scale
  const x = (tw - w) / 2
  const y = (th - h) / 2
  if (params.mirror) {
    target.save()
    target.translate(tw, 0)
    target.scale(-1, 1)
    target.drawImage(img, x, y, w, h)
    target.restore()
  } else {
    target.drawImage(img, x, y, w, h)
  }
}

// Cover-fit an already-rasterized full-frame ring canvas onto a target.
function drawFrame(target, frame, tw, th) {
  target.drawImage(frame, 0, 0, canvas.width, canvas.height, 0, 0, tw, th)
}

async function useCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
  })
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  source = video
  sourceW = video.videoWidth
  sourceH = video.videoHeight
}

// Synthetic scene (drifting shapes over a static backdrop) so the sketch
// works without camera permission — and shows the effect clearly: the
// backdrop cancels to gray, only the movers glow.
function useDemo() {
  const c = document.createElement('canvas')
  c.width = 960
  c.height = 540
  const dctx = c.getContext('2d')
  const movers = Array.from({ length: 5 }, (_, i) => ({
    x: Math.random() * 960,
    y: Math.random() * 540,
    vx: (Math.random() - 0.5) * 4,
    vy: (Math.random() - 0.5) * 4,
    r: 25 + i * 12,
    hue: i * 70,
  }))
  demoTick = () => {
    // Static busy backdrop — should vanish in the extraction.
    dctx.fillStyle = '#20242e'
    dctx.fillRect(0, 0, 960, 540)
    dctx.fillStyle = '#39404f'
    for (let i = 0; i < 12; i++) dctx.fillRect(i * 80, (i % 3) * 180, 40, 180)
    dctx.fillStyle = '#556'
    dctx.font = 'bold 90px system-ui'
    dctx.fillText('STATIC', 330, 300)

    for (const m of movers) {
      m.x += m.vx
      m.y += m.vy
      if (m.x < 0 || m.x > 960) m.vx *= -1
      if (m.y < 0 || m.y > 540) m.vy *= -1
      dctx.beginPath()
      dctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
      dctx.fillStyle = `hsl(${m.hue}, 45%, 45%)`
      dctx.fill()
    }
  }
  source = c
  sourceW = 960
  sourceH = 540
}

// Load an uploaded video (looped) or image as the motion-extraction source.
function loadFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    demoTick = null
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => {
        source = img
        sourceW = img.naturalWidth
        sourceH = img.naturalHeight
        resolve()
      }
      img.onerror = reject
      img.src = url
    } else {
      const video = document.createElement('video')
      video.src = url
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.onloadeddata = async () => {
        try {
          await video.play()
        } catch {
          /* autoplay may need the user gesture we already have; ignore */
        }
        source = video
        sourceW = video.videoWidth
        sourceH = video.videoHeight
        resolve()
      }
      video.onerror = () => reject(new Error('Could not decode that file'))
    }
  })
}

const fileInput = document.getElementById('file-input')
document.getElementById('use-upload').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  try {
    await loadFile(file)
    chooser.style.display = 'none'
  } catch {
    chooser.querySelector('p').textContent = 'Could not load that file — try another video or image.'
  }
})

for (const [id, fn] of [
  ['use-camera', useCamera],
  ['use-demo', useDemo],
]) {
  document.getElementById(id).addEventListener('click', async () => {
    try {
      await fn()
      chooser.style.display = 'none'
    } catch {
      chooser.querySelector('p').textContent =
        'Camera unavailable or permission denied — try the demo source instead.'
    }
  })
}

function frame(now) {
  rt.tick(now)

  // Smoothed frame time, so beat-synced delay can turn tempo (ms) into frames.
  if (lastNow) {
    const dt = now - lastNow
    if (dt > 0 && dt < 100) frameDt = frameDt * 0.9 + dt * 0.1
  }
  lastNow = now

  if (source) {
    demoTick?.()

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
        const t = now * 0.001
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
