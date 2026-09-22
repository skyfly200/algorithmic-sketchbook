/**
 * Kusama Dots — a breathing field of polka dots in the spirit of Yayoi Kusama's
 * dot paintings and Infinity rooms: a grid of circles whose sizes ripple from a
 * slow noise field and pulse outward in waves, on her signature high-contrast
 * palettes (red/white, yellow/black, and friends). It's a generative homage, not
 * a copy of any one work — the pattern is procedural and endless. A "Nets" mode
 * inverts the idea into her infinity-net look, where the dots become the gaps in
 * a painted mesh. Beats send a pulse rolling through the field.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const PALETTES = ['Red / White', 'Yellow / Black', 'Pink / Red', 'Black / White', 'Multi']
const MODES = ['Dots', 'Nets']
const params = rt.params({
  mode: { value: 'Dots', type: 'select', options: MODES, label: 'Mode' },
  palette: { value: 'Red / White', type: 'select', options: PALETTES, label: 'Palette' },
  density: { value: 22, min: 6, max: 48, step: 1, label: 'Density' },
  dotScale: { value: 0.72, min: 0.2, max: 1.1, step: 0.02, label: 'Dot size' },
  variation: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Size variation' },
  waves: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Wave depth' },
  waveSpeed: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Wave speed' },
  jitter: { value: 0.15, min: 0, max: 0.6, step: 0.01, label: 'Jitter' },
  spin: { value: 0.05, min: -0.5, max: 0.5, step: 0.01, label: 'Rotation' },
  breathe: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Breathe' },
})
// Beats push a pulse through the field (adds to the wave depth momentarily).
rt.mapInput('audio.pulse', 'waves', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
let W = 0, H = 0

function hash(n) { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s) }

// Palette → { bg, dot } CSS colours (Multi returns null dot → per-dot hue).
function palette(name, i, j) {
  switch (name) {
    case 'Yellow / Black': return { bg: '#f5c518', dot: '#0a0a0a' }
    case 'Pink / Red': return { bg: '#ff5aa7', dot: '#b30021' }
    case 'Black / White': return { bg: '#0a0a0a', dot: '#f4f4f4' }
    case 'Multi': return { bg: '#0a0a0a', dot: `hsl(${(hash(i * 12.9 + j * 7.7) * 360) | 0} 85% 60%)` }
    default: return { bg: '#e8e2d0', dot: '#c1121f' } // Red / White (warm paper ground)
  }
}

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const P0 = palette(params.palette, 0, 0)

  // ground
  ctx.fillStyle = P0.bg
  ctx.fillRect(0, 0, W, H)

  const nets = params.mode === 'Nets'
  // grid spacing from density (dots across the shorter side), scaled by detail
  const across = Math.max(4, Math.round(params.density * (0.7 + rt.detail * 0.3)))
  const cell = Math.min(W, H) / across
  const cols = Math.ceil(W / cell) + 2
  const rows = Math.ceil(H / cell) + 2
  const cx = W / 2, cy = H / 2
  const breathe = 1 + Math.sin(t * 0.6) * 0.06 * params.breathe + rt.beat.state.pulse * 0.04
  const rot = t * params.spin
  const cosR = Math.cos(rot), sinR = Math.sin(rot)

  // For "Nets", paint the mesh colour over the whole field, then punch dots as
  // the ground colour so the gaps read as the classic infinity-net cells.
  if (nets) { ctx.fillStyle = P0.dot; ctx.fillRect(0, 0, W, H) }

  for (let j = -1; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      // base grid position, centred so rotation/breath pivot on the middle
      let gx = (i + 0.5) * cell - cx
      let gy = (j + 0.5) * cell - cy
      // rotate + breathe the lattice
      let x = (gx * cosR - gy * sinR) * breathe + cx
      let y = (gx * sinR + gy * cosR) * breathe + cy
      // organic jitter so it never looks mechanical
      x += (hash(i * 3.1 + j * 9.7) - 0.5) * cell * params.jitter
      y += (hash(i * 7.9 + j * 2.3) - 0.5) * cell * params.jitter

      // size: noise-driven variation + radial wave rolling out from centre
      const nv = hash(i * 1.7 + j * 5.3)
      const dist = Math.hypot(x - cx, y - cy) / Math.max(W, H)
      const wave = Math.sin(dist * 22 - t * params.waveSpeed * 3)
      let s = params.dotScale * (1 - params.variation * 0.6 + nv * params.variation * 0.9)
      s *= 1 + wave * 0.35 * params.waves
      let r = s * cell * 0.5
      if (r <= 0.4) continue

      if (nets) {
        ctx.fillStyle = P0.bg
      } else {
        ctx.fillStyle = params.palette === 'Multi' ? palette('Multi', i, j).dot : P0.dot
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
