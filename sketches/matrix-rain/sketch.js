// Matrix Rain — cascading columns of glowing glyphs, brightest at the leading
// drop and fading up the trail, with occasional glitch flips. Beats speed the
// fall and flash the whole grid.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0.2, max: 4, step: 0.05, label: 'Fall speed' },
  density: { value: 0.9, min: 0.3, max: 1, step: 0.02, label: 'Column density' },
  glyph: { value: 16, min: 8, max: 32, step: 1, label: 'Glyph size' },
  hue: { value: 130, min: 0, max: 360, step: 1, label: 'Hue' },
  trail: { value: 0.9, min: 0.7, max: 0.99, step: 0.005, label: 'Trail length' },
  glitch: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Glitch' },
})
rt.mapInput('audio.pulse', 'speed', 1.2)

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆ0123456789ABCDEFﾊﾋﾌﾍﾎ<>*+='
let W = 0, H = 0, cols = 0, size = 0
let drops = []
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  size = params.glyph * rt.pixelRatio
  cols = Math.ceil(W / size)
  drops = []
  for (let i = 0; i < cols; i++) {
    drops.push({ y: rt.random(-40, 0), speed: rt.random(0.5, 1.5), active: rt.rng() < params.density })
  }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
}
let flash = 0
rt.onBeat(({ energy }) => { flash = 0.3 + energy * 0.3 })
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  size = params.glyph * rt.pixelRatio
  if (Math.ceil(W / size) !== cols) resize()

  // fade the whole frame slightly to leave trails
  ctx.fillStyle = `rgba(0,0,0,${1 - params.trail})`
  ctx.fillRect(0, 0, W, H)
  ctx.font = `${size}px monospace`
  ctx.textBaseline = 'top'
  const hue = params.hue
  flash = Math.max(0, flash - dt * 2)

  for (let i = 0; i < cols; i++) {
    const d = drops[i]
    if (!d.active) { if (rt.rng() < 0.002) d.active = true; else continue }
    const x = i * size
    const yPix = d.y * size
    // leading glyph: bright white-green
    const g = GLYPHS[Math.floor(rt.rng() * GLYPHS.length)]
    ctx.fillStyle = `hsl(${hue}, 90%, ${88 + flash * 12}%)`
    ctx.fillText(g, x, yPix)
    // a couple of trailing glyphs, dimmer
    for (let k = 1; k <= 3; k++) {
      ctx.fillStyle = `hsla(${hue}, 95%, ${60 - k * 12}%, ${0.8 - k * 0.2})`
      ctx.fillText(GLYPHS[Math.floor(rt.rng() * GLYPHS.length)], x, yPix - k * size)
    }
    // occasional mid-trail glitch flip
    if (rt.rng() < params.glitch * 0.03) {
      ctx.fillStyle = `hsl(${(hue + 180) % 360}, 90%, 70%)`
      ctx.fillText(GLYPHS[Math.floor(rt.rng() * GLYPHS.length)], x, yPix - Math.floor(rt.random(2, 8)) * size)
    }
    d.y += d.speed * params.speed * dt * 18
    if (yPix > H && rt.rng() < 0.06) { d.y = rt.random(-20, 0); d.speed = rt.random(0.5, 1.5); d.active = rt.rng() < params.density }
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
