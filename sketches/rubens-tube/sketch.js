// Rubens Tube — a standing-wave flame organ. Gas jets along a pipe (Tube) or
// across a plate (Table) rise with the pressure antinodes of a standing sound
// wave, drawing the waveform in fire. Drive it from the frequency/harmonic
// controls, or click the mic so the live spectrum sculpts the flames.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  mode: { value: 'Tube', type: 'select', options: ['Tube', 'Table'], label: 'Mode' },
  frequency: { value: 4, min: 1, max: 14, step: 0.1, label: 'Frequency (modes)' },
  harmonic: { value: 0.4, min: 0, max: 1, step: 0.02, label: '2nd harmonic' },
  gas: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Gas / flame height' },
  flicker: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Flicker' },
  drift: { value: 0.3, min: 0, max: 1.5, step: 0.02, label: 'Wave drift' },
  audioDrive: { value: true, type: 'bool', label: 'Audio drives flames (mic)' },
  hue: { value: 20, min: -10, max: 45, step: 1, label: 'Hue' },
})
rt.mapInput('audio.level', 'gas', 0.3)
rt.onBeat(() => {}) // mount mic toggle for the audio-drive option

let W = 0, H = 0, PR = 1
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
}

// Standing-wave envelope at normalized position u∈[0,1] (|antinode| shape).
function waveAmp(u, phase) {
  const n = params.frequency
  const a = Math.abs(Math.sin(u * Math.PI * n + phase * 0.0))
  const b = Math.abs(Math.sin(u * Math.PI * n * 2 + phase))
  return a * (1 - params.harmonic) + b * params.harmonic
}

// A single upward flame tongue, base at (x, y0), of width w and height h.
function drawFlame(x, y0, w, h, heat) {
  if (h < 1) return
  const hue = params.hue
  const g = ctx.createLinearGradient(0, y0, 0, y0 - h)
  g.addColorStop(0, `hsla(${hue + 30}, 100%, 72%, 0.95)`)
  g.addColorStop(0.35, `hsla(${hue + 12}, 100%, 58%, 0.8)`)
  g.addColorStop(0.75, `hsla(${hue}, 100%, 45%, 0.4)`)
  g.addColorStop(1, `hsla(${hue - 6}, 100%, 40%, 0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x - w * 0.5, y0)
  ctx.quadraticCurveTo(x - w * 0.55, y0 - h * 0.55, x, y0 - h)
  ctx.quadraticCurveTo(x + w * 0.55, y0 - h * 0.55, x + w * 0.5, y0)
  ctx.closePath()
  ctx.fill()
  // hot blue base
  ctx.fillStyle = `hsla(210, 90%, 65%, ${0.25 * heat})`
  ctx.beginPath(); ctx.ellipse(x, y0, w * 0.4, h * 0.06 + 2 * PR, 0, 0, Math.PI * 2); ctx.fill()
}

function spectrumAmp(u) {
  const bins = rt.beat.getSpectrum()
  if (!bins || !rt.beat.state.active) return null
  const nb = bins.length
  const b = Math.min(nb - 1, Math.floor(Math.pow(nb, u))) // log-ish
  return Math.min(1, (bins[b] / 255) * 1.6)
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const phase = t * params.drift * 3

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#06070c'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'

  const useAudio = params.audioDrive && rt.beat.state.active

  if (params.mode === 'Tube') {
    const n = 72
    const y0 = H * 0.82
    const spacing = W / n
    // the pipe
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#15181f'
    ctx.fillRect(0, y0, W, H * 0.06)
    ctx.fillStyle = '#0c0e13'
    ctx.fillRect(0, y0 + H * 0.06, W, H)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1)
      let a = useAudio ? (spectrumAmp(u) ?? waveAmp(u, phase)) : waveAmp(u, phase)
      const fl = 1 - params.flicker * 0.4 * rt.rng()
      const h = a * H * 0.5 * params.gas * fl + 4 * PR
      drawFlame(i * spacing + spacing / 2, y0, spacing * 1.3, h, a)
    }
  } else {
    // Table: a plan-view grid of jets; brightness/size = 2D standing amplitude
    const cols = 40, rows = 24
    const cw = W / cols, ch = H / rows
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#0a0b10'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    const hue = params.hue
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1), v = j / (rows - 1)
        let ax = useAudio ? (spectrumAmp(u) ?? waveAmp(u, phase)) : waveAmp(u, phase)
        let ay = waveAmp(v, phase * 0.7)
        let a = ax * ay
        const fl = 1 - params.flicker * 0.4 * rt.rng()
        a = Math.max(0, a * params.gas * fl)
        if (a < 0.04) continue
        const x = i * cw + cw / 2, y = j * ch + ch / 2
        const r = Math.min(cw, ch) * (0.4 + a * 0.9)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, `hsla(${hue + 30}, 100%, ${55 + a * 30}%, ${Math.min(1, a)})`)
        g.addColorStop(0.5, `hsla(${hue + 8}, 100%, 50%, ${a * 0.5})`)
        g.addColorStop(1, `hsla(${hue}, 100%, 45%, 0)`)
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over'

  if (params.audioDrive && !rt.beat.state.active) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = `${13 * PR}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('click 🎤 to drive the flames with sound', W / 2, 26 * PR)
    ctx.textAlign = 'left'
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
