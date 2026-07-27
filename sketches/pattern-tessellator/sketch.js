/**
 * Pattern Tessellator — a generator of repeating geometric patterns built from
 * little dashes, in the spirit of the dotted "coated-canvas" weaves you see on
 * luggage and endpapers. Pick a tiling — an interlocking chevron weave on a
 * triangular lattice, a herringbone, a diamond trellis or a basket weave — set
 * the scale, dash density and palette, and it fills the frame with a seamless,
 * static motif (a soft emboss highlight and a faint canvas texture sell the
 * woven feel). The whole field can be rotated live. No animation — it's a
 * pattern, not a movie.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const PALS = {
  'Coated canvas': { bg: '#b3a07c', ink: '#2b271f', hl: '#efe7d2' },
  'Ink black': { bg: '#23241f', ink: '#000000', hl: '#d9d2bf' },
  'Mono': { bg: '#f3f1ea', ink: '#151510', hl: '#ffffff' },
  'Noir': { bg: '#0e0e11', ink: '#e9e7e0', hl: '#5f5f68' },
  'Indigo': { bg: '#e9e3d3', ink: '#233355', hl: '#fbfaf4' },
  'Forest': { bg: '#dde1cd', ink: '#26402a', hl: '#fbfbf0' },
  'Oxblood': { bg: '#e7dccb', ink: '#5a1f22', hl: '#fffaf0' },
}
const params = rt.params({
  pattern: { value: 'Goyard chevron', type: 'select', options: ['Goyard chevron', 'Chevron weave', 'Herringbone', 'Diamond trellis', 'Basket weave'], label: 'Tiling' },
  palette: { value: 'Coated canvas', type: 'select', options: [...Object.keys(PALS), 'Random'], label: 'Palette' },
  scale: { value: 46, min: 18, max: 140, step: 1, label: 'Scale' },
  density: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Dash density' },
  dash: { value: 0.55, min: 0.15, max: 1, step: 0.02, label: 'Dash length' },
  dotSize: { value: 1.4, min: 0.5, max: 3.5, step: 0.1, label: 'Dash weight' },
  angle: { value: 0, min: 0, max: 180, step: 1, label: 'Rotation' },
  emboss: { value: true, type: 'bool', label: 'Emboss highlight' },
  texture: { value: true, type: 'bool', label: 'Canvas texture' },
})

const TAU = Math.PI * 2
// offscreen buffer, sized to the screen diagonal so any rotation still covers it
const buf = document.createElement('canvas')
const bx = buf.getContext('2d')
let W = 0, H = 0, D = 0, PR = 1
let randPal = { bg: '#b3a07c', ink: '#2b271f', hl: '#efe7d2' }
let lastKey = ''

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  D = Math.ceil(Math.hypot(W, H))
  buf.width = D; buf.height = D
  lastKey = '' // force a re-render at the new size
}

function pal() {
  if (params.palette === 'Random') return randPal
  return PALS[params.palette] ?? PALS['Coated canvas']
}

// one dash: a rounded capsule (elongated dot) oriented along the stroke
function dash(g, x, y, ang, len, thick, col) {
  g.save(); g.translate(x, y); g.rotate(ang)
  g.fillStyle = col
  g.beginPath(); g.ellipse(0, 0, len, thick, 0, 0, TAU); g.fill()
  g.restore()
}
// a capsule (elongated dot) between two points
function capsuleAB(g, ax, ay, bx, by, thick, col) {
  const dx = bx - ax, dy = by - ay
  dash(g, (ax + bx) / 2, (ay + by) / 2, Math.atan2(dy, dx), Math.hypot(dx, dy) / 2, thick, col)
}
// one chevron ">" whose apex is at (x,y) and points along +ang
function chevron(g, x, y, ang, arm, beta, thick, col) {
  const b = ang + Math.PI
  capsuleAB(g, x, y, x + Math.cos(b + beta) * arm, y + Math.sin(b + beta) * arm, thick, col)
  capsuleAB(g, x, y, x + Math.cos(b - beta) * arm, y + Math.sin(b - beta) * arm, thick, col)
}
// a dotted/dashed line from (x1,y1) to (x2,y2)
function dline(g, x1, y1, x2, y2, gap, len, thick, ink, hl, emb, o) {
  const dx = x2 - x1, dy = y2 - y1
  const L = Math.hypot(dx, dy)
  const ang = Math.atan2(dy, dx)
  const n = Math.max(1, Math.round(L / gap))
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const x = x1 + dx * t, y = y1 + dy * t
    if (emb) dash(g, x + o, y + o, ang, len, thick, hl)
    dash(g, x, y, ang, len, thick, ink)
  }
}

function renderPattern() {
  const p = pal()
  const g = bx
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.fillStyle = p.bg
  g.fillRect(0, 0, D, D)

  const S = params.scale * PR
  const perEdge = Math.round(2 + params.density * 12)
  const gap = S / perEdge
  const len = gap * 0.34 * (params.dash / 0.55)
  const thick = params.dotSize * PR
  const o = params.emboss ? thick * 0.95 : 0
  const emb = params.emboss
  const ink = p.ink, hl = p.hl
  const line = (x1, y1, x2, y2) => dline(g, x1, y1, x2, y2, gap, len, thick, ink, hl, emb, o)
  const m = S * 2 // margin so edges are covered

  if (params.pattern === 'Goyard chevron') {
    // The luggage-canvas "Y" weave: three families of dashed chevron arrows on a
    // triangular lattice. Each lattice edge is a band of little ">" marks that
    // all point the same way along their axis; where six bands cross at a node
    // they read as the signature 6-pointed star, and the dashes alternate cream
    // and ink like the hand-painted original.
    const dyv = S * Math.sin(Math.PI / 3)
    const arm = gap * 0.62 * (params.dash / 0.55)
    const beta = 0.6
    const cband = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx)
      const n = Math.max(1, Math.round(L / gap))
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = x1 + dx * t, y = y1 + dy * t
        const cream = (i % 2) === 0
        if (emb) chevron(g, x + o, y + o, ang, arm, beta, thick, 'rgba(0,0,0,0.22)')
        chevron(g, x, y, ang, arm, beta, thick, cream ? hl : ink)
      }
    }
    let j = 0
    for (let y = -m; y < D + m; y += dyv, j++) {
      const off = (j % 2) * S * 0.5
      for (let x = -m; x < D + m; x += S) {
        const px = x + off
        cband(px, y, px + S, y)            // east
        cband(px, y, px + S * 0.5, y - dyv) // up-right
        cband(px, y, px - S * 0.5, y - dyv) // up-left
      }
    }
  } else if (params.pattern === 'Chevron weave') {
    // triangular lattice: three dashed-line directions interlock into chevrons
    const dy = S * Math.sin(Math.PI / 3)
    let j = 0
    for (let y = -m; y < D + m; y += dy, j++) {
      const off = (j % 2) * S * 0.5
      for (let x = -m; x < D + m; x += S) {
        const px = x + off
        line(px, y, px + S, y)              // horizontal
        line(px, y, px + S * 0.5, y - dy)   // up-right
        line(px, y, px - S * 0.5, y - dy)   // up-left
      }
    }
  } else if (params.pattern === 'Herringbone') {
    // bricks of parallel dashes, alternating ±45° like laid parquet
    const c = Math.SQRT1_2
    let j = 0
    for (let y = -m; y < D + m; y += S, j++) {
      let k = j
      for (let x = -m; x < D + m; x += S, k++) {
        const dir = (k % 2) ? 1 : -1
        const x1 = x, y1 = dir > 0 ? y : y + S
        line(x1, y1, x1 + S * c * 1.41, y1 + dir * S * c * 1.41)
      }
    }
  } else if (params.pattern === 'Diamond trellis') {
    // two crossing dashed diagonal families → an argyle lattice of diamonds
    for (let d = -D - m; d < 2 * D + m; d += S) {
      line(d, -m, d + (D + 2 * m), D + m)   // ╲
      line(d, D + m, d + (D + 2 * m), -m)   // ╱
    }
    // a bright pip at each lattice crossing
    for (let y = -m; y < D + m; y += S) for (let x = -m; x < D + m; x += S) {
      const px = ((Math.round((x) / S)) * S)
      dash(g, px, y, 0, thick * 1.3, thick * 1.3, emb ? hl : ink)
      dash(g, px, y, 0, thick * 0.9, thick * 0.9, ink)
    }
  } else {
    // Basket weave: cells alternate a bundle of horizontal vs vertical dashes
    const cell = S
    const strands = 3
    let j = 0
    for (let y = -m; y < D + m; y += cell, j++) {
      let k = j
      for (let x = -m; x < D + m; x += cell, k++) {
        const horiz = (k % 2) === 0
        for (let s = 0; s < strands; s++) {
          const f = (s + 0.5) / strands
          if (horiz) line(x + cell * 0.08, y + cell * f, x + cell * 0.92, y + cell * f)
          else line(x + cell * f, y + cell * 0.08, x + cell * f, y + cell * 0.92)
        }
      }
    }
  }

  if (params.texture) drawTexture(g, p)
}

// a faint woven-canvas texture: fine crosshatch of low-alpha lines
function drawTexture(g, p) {
  g.save()
  g.globalAlpha = 0.05
  g.strokeStyle = p.ink
  g.lineWidth = 1 * PR
  const step = 3 * PR
  g.beginPath()
  for (let x = 0; x < D; x += step) { g.moveTo(x, 0); g.lineTo(x, D) }
  g.stroke()
  g.globalAlpha = 0.04
  g.strokeStyle = p.hl
  g.beginPath()
  for (let y = 0; y < D; y += step) { g.moveTo(0, y); g.lineTo(D, y) }
  g.stroke()
  g.restore()
}

function key() {
  return [params.pattern, params.palette, params.scale, params.density, params.dash, params.dotSize, params.emboss, params.texture, W, H, PR].join('|')
}

let prevPalette = ''
function frame(now) {
  rt.tick(now)
  // re-roll random colours only when the palette first switches to Random
  if (params.palette === 'Random' && prevPalette !== 'Random') {
    randPal = { bg: `hsl(${rt.random(0, 360) | 0},${(25 + rt.random(0, 25)) | 0}%,${(58 + rt.random(0, 22)) | 0}%)`, ink: `hsl(${rt.random(0, 360) | 0},40%,17%)`, hl: '#fdf8ee' }
    lastKey = ''
  }
  prevPalette = params.palette
  const k = key()
  if (k !== lastKey) {
    renderPattern()
    lastKey = k
  }
  // blit the static pattern, rotated about the centre (live, no re-render)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal().bg
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((params.angle * Math.PI) / 180)
  ctx.drawImage(buf, -D / 2, -D / 2)
  ctx.restore()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
