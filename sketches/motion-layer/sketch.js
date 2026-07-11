/**
 * Motion Layer — a consumer of the motion bus. It subscribes to the motion
 * mask that Motion Extraction broadcasts and uses it as a mask/layer: a
 * flowing color field is revealed only where motion was detected. This shows
 * how the extracted motion becomes an input to other effects.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createMotionSubscriber } from '../_lib/motion-bus.js'

const rt = createRuntime()
const params = rt.params({
  flow: { value: 1, min: 0, max: 3, step: 0.05, label: 'Flow speed' },
  scale: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Field scale' },
})

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')

const feed = createMotionSubscriber()

let width, height
function resize() {
  width = canvas.width = window.innerWidth * rt.pixelRatio
  height = canvas.height = window.innerHeight * rt.pixelRatio
}

// A drifting multi-stop color field — this is the effect the motion masks.
function paintField(t) {
  const g = ctx.createLinearGradient(0, 0, width, height)
  for (let i = 0; i <= 6; i++) {
    const hue = (t * 40 * params.flow + i * 60) % 360
    g.addColorStop(i / 6, `hsl(${hue}, 85%, 55%)`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const live = feed.hasData && now - feed.lastAt < 1500

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, width, height)

  if (live) {
    hint.style.opacity = 0
    paintField(t)
    // Multiply the incoming motion mask (scaled to fill) through the field:
    // bright where motion, black where static.
    const s = params.scale
    const dw = width * s
    const dh = height * s
    ctx.globalCompositeOperation = 'multiply'
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(feed.canvas, (width - dw) / 2, (height - dh) / 2, dw, dh)
    ctx.globalCompositeOperation = 'source-over'
  } else {
    // No feed yet — idle shimmer so the page isn't blank.
    hint.style.opacity = 1
    ctx.globalAlpha = 0.12
    paintField(t)
    ctx.globalAlpha = 1
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
