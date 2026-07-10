/**
 * Motion extraction: draw the current frame, then draw an inverted copy of
 * the frame from N frames ago on top at ~50% opacity. Anything static sums
 * to flat gray; anything that moved shows up as a bright ghost. (The trick
 * popularized by Posy's "Motion Extraction" video.)
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  delay: { value: 6, min: 1, max: 30, step: 1, label: 'Frame delay' },
  blend: { value: 0.5, min: 0.2, max: 0.8, step: 0.01, label: 'Inverted blend' },
  glow: { value: false, type: 'bool', label: 'Glow mode (motion on black)' },
  mirror: { value: true, type: 'bool', label: 'Mirror (selfie)' },
  freeze: { value: false, type: 'bool', label: 'Freeze reference frame' },
  showOriginal: { value: false, type: 'bool', label: 'Show original' },
})

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const chooser = document.getElementById('chooser')

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

// Cover-fit the source onto the canvas (optionally mirrored). The delay-line
// snapshots also go through here, so mirroring stays consistent frame to frame.
function drawSource(target) {
  const scale = Math.max(canvas.width / sourceW, canvas.height / sourceH)
  const w = sourceW * scale
  const h = sourceH * scale
  const x = (canvas.width - w) / 2
  const y = (canvas.height - h) / 2
  if (params.mirror) {
    target.save()
    target.translate(canvas.width, 0)
    target.scale(-1, 1)
    target.drawImage(source, x, y, w, h)
    target.restore()
  } else {
    target.drawImage(source, x, y, w, h)
  }
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

  if (source) {
    demoTick?.()

    // Current frame.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    drawSource(ctx)

    if (!params.showOriginal) {
      // Pick the reference: a frozen snapshot, or the frame from `delay` ago.
      const delay = Math.round(params.delay)
      if (params.freeze) {
        if (!wasFrozen || !frozen) {
          frozen = ring[(head - 1 + MAX_DELAY) % MAX_DELAY]
        }
      } else {
        frozen = null
      }
      wasFrozen = params.freeze
      const reference = frozen ?? ring[(head - delay + MAX_DELAY) % MAX_DELAY]

      if (params.glow) {
        // 'difference' of current vs delayed: static → black, motion → bright.
        // A punchy, projection-friendly look on a dark stage.
        ctx.globalCompositeOperation = 'difference'
        ctx.drawImage(reference, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      } else {
        // Inverted, delayed copy on top — the classic extraction: static → gray.
        ctx.filter = 'invert(1)'
        ctx.globalAlpha = params.blend
        ctx.drawImage(reference, 0, 0)
        ctx.filter = 'none'
        ctx.globalAlpha = 1
      }
    }

    // Record the clean current frame into the delay line (skip while frozen
    // so unfreezing doesn't compare against extracted output).
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
