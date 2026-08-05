/**
 * Liquid Light Show — the psychedelic "wet show" projected by 1960s light
 * artists: coloured oils and inks trapped in water between clock-glasses on an
 * overhead projector, heated so they bloom, wobble, split and swirl in big
 * backlit blobs of saturated colour. Translucent cells of oil drift and pulse,
 * their organic rims wobbling, overlapping into new hues where they cross the
 * way projected light mixes; iridescent thin-film edges and little air bubbles
 * ride inside. Additive (backlit) or ink (dye-on-light) mixing. Heat, viscosity,
 * flow, glow and blob count are live; on the beat the whole dish blooms.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PALS = {
  Psychedelic: [320, 18, 48, 185, 275],
  Lava: [8, 26, 42, 350, 15],
  Ocean: [190, 210, 165, 230, 200],
  Acid: [95, 140, 62, 300, 110],
  Sunset: [10, 32, 340, 285, 22],
  Mono: [275, 285, 265, 275, 290],
}
const params = rt.params({
  palette: { value: 'Psychedelic', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  mix: { value: 'Backlit', type: 'select', options: ['Backlit', 'Ink'], label: 'Mixing' },
  blobs: { value: 14, min: 5, max: 26, step: 1, label: 'Blob count' },
  heat: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Heat' },
  viscosity: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Wobble' },
  flow: { value: 1, min: 0.1, max: 2.5, step: 0.05, label: 'Flow' },
  glow: { value: 1, min: 0.3, max: 1.8, step: 0.05, label: 'Saturation' },
  edge: { value: 0.35, min: 0, max: 1.5, step: 0.05, label: 'Edge / rim' },
})
rt.mapInput('audio.level', 'heat', 0.5)
rt.mapInput('audio.pulse', 'glow', 0.35)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1, minS = 0

let cells = []
function rebuild() {
  const n = Math.round(params.blobs)
  cells = []
  for (let i = 0; i < n; i++) {
    cells.push({
      hx: rt.random(0.12, 0.88), hy: rt.random(0.12, 0.88),
      ax: rt.random(0.05, 0.22), ay: rt.random(0.05, 0.22),
      sx: rt.random(0.05, 0.22), sy: rt.random(0.05, 0.22),
      px: rt.random(0, TAU), py: rt.random(0, TAU),
      baseR: rt.random(0.12, 0.32), breath: rt.random(0.2, 0.6), bph: rt.random(0, TAU),
      hueJ: rt.random(-10, 10), hueDrift: rt.random(-4, 4), pick: i,
      // wobble harmonics
      h: [
        { k: 2 + (rt.rng() * 2 | 0), a: rt.random(0.06, 0.16), w: rt.random(-0.5, 0.5), p: rt.random(0, TAU) },
        { k: 3 + (rt.rng() * 3 | 0), a: rt.random(0.04, 0.12), w: rt.random(-0.6, 0.6), p: rt.random(0, TAU) },
        { k: 5 + (rt.rng() * 3 | 0), a: rt.random(0.02, 0.07), w: rt.random(-0.8, 0.8), p: rt.random(0, TAU) },
      ],
      // interior air bubbles
      bub: Array.from({ length: 2 + (rt.rng() * 3 | 0) }, () => ({ r: rt.random(0.1, 0.5), a: rt.random(0, TAU), s: rt.random(0.3, 0.9), sz: rt.random(0.02, 0.06) })),
    })
  }
}

let randHues = PALS.Psychedelic
function hues() { return params.palette === 'Random' ? randHues : (PALS[params.palette] ?? PALS.Psychedelic) }

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  minS = Math.min(W, H)
}

let lastN = 0, bloom = 0
rt.onBeat(({ energy }) => { bloom = Math.min(1.6, bloom + 0.5 + energy) })

function drawCell(c, t, H_, backlit) {
  const heat = params.heat * (1 + bloom * 0.5)
  const cx = (c.hx + c.ax * Math.sin(t * c.sx * params.flow + c.px)) * W
  const cy = (c.hy + c.ay * Math.cos(t * c.sy * params.flow + c.py)) * H
  const r = c.baseR * minS * (0.75 + 0.35 * Math.sin(t * c.breath * heat + c.bph)) * (1 + bloom * 0.25)
  const hue = (H_[c.pick % H_.length] + c.hueJ + t * c.hueDrift) % 360
  const g = params.glow

  ctx.save(); ctx.translate(cx, cy)
  // wobbly organic outline
  const N = 64, visc = 0.35 + params.viscosity
  ctx.beginPath()
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU
    let rr = 1
    for (const hh of c.h) rr += visc * hh.a * Math.sin(hh.k * th + hh.w * t * heat + hh.p)
    const x = Math.cos(th) * r * rr, y = Math.sin(th) * r * rr
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()

  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.15)
  if (backlit) {
    grad.addColorStop(0, `hsla(${hue},95%,62%,${0.55 * g})`)
    grad.addColorStop(0.5, `hsla(${hue + 8},92%,50%,${0.3 * g})`)
    grad.addColorStop(1, `hsla(${hue + 14},90%,45%,0)`)
  } else {
    grad.addColorStop(0, `hsla(${hue},85%,52%,${0.5 * g})`)
    grad.addColorStop(0.55, `hsla(${hue + 6},80%,45%,${0.4 * g})`)
    grad.addColorStop(1, `hsla(${hue + 12},80%,42%,0)`)
  }
  ctx.fillStyle = grad
  ctx.fill()
  // iridescent thin-film rim — softer by default so blobs read as backlit
  // fluid, not outlined shapes; the Edge param dials it back up.
  if (params.edge > 0.001) {
    ctx.strokeStyle = `hsla(${(hue + 165) % 360},95%,65%,${(backlit ? 0.16 : 0.12) * g * params.edge})`
    ctx.lineWidth = Math.max(0.75, minS * 0.006) * (0.6 + params.edge * 0.6)
    ctx.stroke()
  }

  // interior air bubbles
  for (const b of c.bub) {
    const ba = b.a + t * b.s * params.flow
    const bx = Math.cos(ba) * r * b.r * 0.7, by = Math.sin(ba) * r * b.r * 0.7
    const bs = b.sz * r
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, bs)
    bg.addColorStop(0, `hsla(${hue},100%,88%,${0.5 * g})`)
    bg.addColorStop(0.7, `hsla(${hue},100%,70%,0)`)
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.arc(bx, by, bs, 0, TAU); ctx.fill()
  }
  ctx.restore()
}

let prevPalette = ''
function tickPalette() {
  if (params.palette === 'Random' && prevPalette !== 'Random') {
    const base = rt.random(0, 360)
    randHues = [base, base + 40, base + 150, base + 200, base + 300].map((h) => ((h % 360) + 360) % 360)
  }
  prevPalette = params.palette
}

function frame(now) {
  rt.tick(now)
  tickPalette()
  const t = now * 0.001
  if (Math.round(params.blobs) !== lastN) { rebuild(); lastN = Math.round(params.blobs) }
  bloom *= 0.94

  const backlit = params.mix === 'Backlit'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  if (backlit) {
    ctx.fillStyle = '#05030a'; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
  } else {
    ctx.fillStyle = '#f3eee4'; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'multiply'
  }

  const H_ = hues()
  // big cells behind, small in front
  const order = cells.map((c, i) => i).sort((a, b) => cells[b].baseR - cells[a].baseR)
  for (const i of order) drawCell(cells[i], t, H_, backlit)

  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
rebuild(); lastN = Math.round(params.blobs)
requestAnimationFrame(frame)
