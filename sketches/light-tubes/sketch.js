// Glowing Light Tubes — a rack of neon / fluorescent tubes glowing in the dark.
// Each tube is a capsule of light: a soft coloured halo built from stacked
// additive strokes, a bright white core, and a hot pulse that travels along it.
// The tubes flicker like real gas tubes and surge on the beat. Lay them out as a
// grid, a radial burst, concentric rings, or a scatter of angled rods.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  layout: { value: 'Grid', type: 'select', options: ['Grid', 'Radial', 'Rings', 'Scatter'], label: 'Layout' },
  count: { value: 14, min: 3, max: 40, step: 1, label: 'Tubes' },
  thickness: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Thickness' },
  glow: { value: 1, min: 0.2, max: 2.2, step: 0.05, label: 'Glow' },
  hue: { value: 190, min: 0, max: 360, step: 1, label: 'Base hue' },
  spread: { value: 60, min: 0, max: 180, step: 1, label: 'Hue spread' },
  flicker: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Flicker' },
  pulse: { value: 0.6, min: 0, max: 2, step: 0.05, label: 'Pulse travel' },
})
rt.mapInput('audio.level', 'glow', 0.5)

let W = 0, H = 0, PR = 1
let tubes = []
let sig = ''
let surge = 0
rt.onBeat(({ energy }) => { surge = Math.min(1.4, surge + 0.5 + energy * 0.5) })

function build() {
  const n = Math.round(params.count)
  sig = n + params.layout + rt.seed
  tubes = []
  const cx = W / 2, cy = H / 2
  const R = Math.min(W, H) * 0.42
  for (let i = 0; i < n; i++) {
    const hue = params.hue + (rt.rng() - 0.5) * params.spread
    const t = { hue, phase: rt.random(0, 100), flick: rt.random(0.6, 1.4), len: 0, x1: 0, y1: 0, x2: 0, y2: 0 }
    if (params.layout === 'Grid') {
      const cols = Math.ceil(Math.sqrt(n))
      const gx = i % cols, gy = (i / cols) | 0
      const rows = Math.ceil(n / cols)
      const px = (gx + 0.5) / cols * W, py = (gy + 0.5) / rows * H
      const vert = rt.rng() < 0.5
      const half = (vert ? H / rows : W / cols) * 0.38
      t.x1 = px - (vert ? 0 : half); t.y1 = py - (vert ? half : 0)
      t.x2 = px + (vert ? 0 : half); t.y2 = py + (vert ? half : 0)
    } else if (params.layout === 'Radial') {
      const a = (i / n) * Math.PI * 2 + rt.random(-0.05, 0.05)
      const r0 = R * 0.18, r1 = R * rt.random(0.75, 1.0)
      t.x1 = cx + Math.cos(a) * r0; t.y1 = cy + Math.sin(a) * r0
      t.x2 = cx + Math.cos(a) * r1; t.y2 = cy + Math.sin(a) * r1
    } else if (params.layout === 'Rings') {
      const ring = 1 + (i % 4), r = R * (ring / 5)
      const a0 = rt.random(0, Math.PI * 2), a1 = a0 + rt.random(0.7, 1.6)
      const seg = 22
      t.arc = { r, a0, a1, cx, cy, seg }
      t.x1 = cx + Math.cos(a0) * r; t.y1 = cy + Math.sin(a0) * r
      t.x2 = cx + Math.cos(a1) * r; t.y2 = cy + Math.sin(a1) * r
    } else { // Scatter
      const px = rt.random(0.1, 0.9) * W, py = rt.random(0.1, 0.9) * H
      const a = rt.random(0, Math.PI * 2), half = R * rt.random(0.12, 0.3)
      t.x1 = px - Math.cos(a) * half; t.y1 = py - Math.sin(a) * half
      t.x2 = px + Math.cos(a) * half; t.y2 = py + Math.sin(a) * half
    }
    t.len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
    tubes.push(t)
  }
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

// draw a capsule of light along an arbitrary path (line or arc)
function strokePath(t, width) {
  ctx.beginPath()
  if (t.arc) {
    ctx.arc(t.arc.cx, t.arc.cy, t.arc.r, t.arc.a0, t.arc.a1)
  } else {
    ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2)
  }
  ctx.lineWidth = width
  ctx.stroke()
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  if (Math.round(params.count) + params.layout + rt.seed !== sig) build()
  surge *= 0.9

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)

  ctx.lineCap = 'round'
  ctx.globalCompositeOperation = 'lighter'
  const glow = params.glow * (1 + surge)
  const base = 6 * PR * params.thickness
  for (const tb of tubes) {
    // flicker: mostly steady with occasional dips, per-tube timing
    let fl = 0.82 + 0.18 * Math.sin(t * 7 * tb.flick + tb.phase)
    if (params.flicker > 0) {
      const n = Math.sin(t * 31 * tb.flick + tb.phase * 3.3) * Math.sin(t * 17 + tb.phase)
      fl *= 1 - params.flicker * 0.5 * Math.max(0, n)
    }
    const g = glow * fl
    // stacked halo: wide + faint to narrow + bright
    for (let s = 4; s >= 1; s--) {
      const a = (0.05 + 0.05 * (4 - s)) * g
      ctx.strokeStyle = `hsla(${tb.hue}, 90%, 60%, ${Math.min(0.6, a)})`
      strokePath(tb, base * (s * 1.6 + 1))
    }
    // bright near-white core
    ctx.strokeStyle = `hsla(${tb.hue}, 80%, ${Math.min(96, 78 + g * 8)}%, ${Math.min(1, 0.6 * g)})`
    strokePath(tb, base * 0.6)
    // travelling hot pulse
    if (params.pulse > 0.01 && !tb.arc) {
      const u = (t * params.pulse * 0.4 + tb.phase * 0.13) % 1
      const px = tb.x1 + (tb.x2 - tb.x1) * u, py = tb.y1 + (tb.y2 - tb.y1) * u
      const pr = base * 2.4
      const rg = ctx.createRadialGradient(px, py, 0, px, py, pr)
      rg.addColorStop(0, `hsla(${tb.hue}, 60%, 96%, ${Math.min(1, 0.9 * g)})`)
      rg.addColorStop(1, `hsla(${tb.hue}, 90%, 60%, 0)`)
      ctx.fillStyle = rg
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
