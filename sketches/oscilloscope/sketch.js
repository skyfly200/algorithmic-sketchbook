// Oscilloscope — a phosphor CRT scope tracing waveforms: Lissajous XY figures
// or a scrolling time-domain trace, with glowing green persistence, a fine
// graticule, and beam intensity that swells with signal. Mic-reactive: when
// the mic is on, the live waveform drives the trace.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  mode: { value: rt.pick(['lissajous', 'waveform', 'spiral']), type: 'select', options: ['lissajous', 'waveform', 'spiral', 'wave2d'], label: 'Mode' },
  freqX: { value: 3, min: 1, max: 12, step: 1, label: 'Freq X' },
  freqY: { value: 2, min: 1, max: 12, step: 1, label: 'Freq Y' },
  phase: { value: 0.4, min: 0, max: 2, step: 0.01, label: 'Phase drift' },
  persistence: { value: 0.88, min: 0.6, max: 0.98, step: 0.005, label: 'Persistence' },
  glow: { value: 1, min: 0.2, max: 2, step: 0.05, label: 'Beam glow' },
  grid: { value: true, type: 'bool', label: 'Graticule grid' },
  hue: { value: 130, min: 0, max: 360, step: 1, label: 'Phosphor hue' },
})
rt.mapInput('audio.level', 'glow', 0.6)
rt.mapInput('audio.mid', 'phase', 0.5)

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  ctx.fillStyle = '#02120a'; ctx.fillRect(0, 0, W, H)
}
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  // persistence fade
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(2,18,10,${1 - params.persistence})`
  ctx.fillRect(0, 0, W, H)

  // graticule
  if (params.grid) {
    ctx.strokeStyle = `hsla(${params.hue}, 40%, 40%, 0.18)`
    ctx.lineWidth = 1 * rt.pixelRatio
    const div = Math.min(W, H) / 10
    ctx.beginPath()
    for (let x = W / 2 % div; x < W; x += div) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = H / 2 % div; y < H; y += div) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()
  }

  const cx = W / 2, cy = H / 2
  const R = Math.min(W, H) * 0.4
  const level = 0.6 + rt.beat.state.level * 0.8
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = `hsl(${params.hue}, 100%, ${60 + rt.beat.state.pulse * 15}%)`
  ctx.shadowColor = `hsl(${params.hue}, 100%, 55%)`
  ctx.shadowBlur = 8 * rt.pixelRatio * params.glow
  ctx.lineWidth = 2 * rt.pixelRatio
  const ph = t * params.phase

  if (params.mode === 'wave2d') {
    // a 2D wave surface: a stack of scan-lines each showing a slice of a
    // travelling wave field sin(x)·cos(row−t), offset with a little perspective
    // so the sheet ripples in pseudo-3D.
    const PR = rt.pixelRatio
    const rows = Math.max(10, Math.round(22 * rt.detail))
    const mX = W * 0.08, span = W - mX * 2
    const top = H * 0.22, bot = H * 0.82, ampl = Math.min(W, H) * 0.1 * level
    const M = Math.max(80, Math.round(160 * rt.detail))
    for (let r = 0; r < rows; r++) {
      const rf = rows > 1 ? r / (rows - 1) : 0.5
      const ry = top + rf * (bot - top)
      const persp = 0.45 + rf * 0.85
      ctx.globalAlpha = 0.4 + rf * 0.6
      ctx.beginPath()
      for (let i = 0; i <= M; i++) {
        const fx = i / M
        const wv = Math.sin(fx * Math.PI * 2 * params.freqX + ph)
          * Math.cos(rf * Math.PI * 2 * (0.5 + params.freqY * 0.15) - t * 1.6)
        const x = mX + fx * span
        const y = ry - wv * ampl * persp
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.globalCompositeOperation = 'source-over'
    requestAnimationFrame(frame)
    return
  }

  ctx.beginPath()
  const N = 900
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * Math.PI * 2
    let x, y
    if (params.mode === 'lissajous') {
      x = cx + Math.sin(u * params.freqX + ph) * R * level
      y = cy + Math.sin(u * params.freqY) * R * level
    } else if (params.mode === 'spiral') {
      const rr = R * (i / N) * level
      x = cx + Math.cos(u * params.freqX + ph) * rr
      y = cy + Math.sin(u * params.freqY + ph) * rr
    } else {
      x = (i / N) * W
      y = cy + Math.sin(u * params.freqX + ph) * R * 0.5 * level * (0.6 + 0.4 * Math.sin(u * params.freqY + t))
    }
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
