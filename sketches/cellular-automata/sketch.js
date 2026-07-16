/**
 * Cellular Automata — four classic rules on a grid, each a different flavour of
 * emergent pattern from purely local update:
 *   • Life    — Conway's Game of Life (gliders, still lifes, oscillators);
 *   • Brain   — Brian's Brain (3 states; restless travelling sparks);
 *   • Cyclic  — cyclic CA (states eat the state above them → spiral galaxies);
 *   • Rule    — a 1-D elementary automaton scrolling down (rule 0–255).
 * Cells are drawn to a tiny offscreen and scaled up crisp.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const MODES = ['cyclic', 'life', 'brain', 'rule']
const params = rt.params({
  mode: { value: 'cyclic', type: 'select', options: MODES, label: 'Rule' },
  cell: { value: 5, min: 2, max: 16, step: 1, label: 'Cell size' },
  rate: { value: 18, min: 1, max: 60, step: 1, label: 'Steps / sec' },
  states: { value: 14, min: 3, max: 24, step: 1, label: 'Cyclic states' },
  rule: { value: 90, min: 0, max: 255, step: 1, label: 'Elementary rule' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
})
// Music: beats push extra generations (a stutter/burst on the beat).
rt.mapInput('audio.pulse', 'rate', 0.6)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const grid = document.createElement('canvas')
const gctx = grid.getContext('2d')

let W, H, cols, rows, cur, next, img
let mode, ruleN, nStates

function hslRGB(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

function seed() {
  mode = params.mode
  ruleN = Math.round(params.rule)
  nStates = Math.round(params.states)
  cur = new Uint8Array(cols * rows)
  next = new Uint8Array(cols * rows)
  if (mode === 'rule') {
    cur[cols >> 1] = 1 // single seed cell, top row
  } else if (mode === 'cyclic') {
    for (let i = 0; i < cur.length; i++) cur[i] = (rt.rng() * nStates) | 0
  } else {
    for (let i = 0; i < cur.length; i++) cur[i] = rt.rng() < 0.28 ? 1 : 0
  }
}

function rebuild() {
  const cs = Math.round(params.cell) * rt.pixelRatio
  cols = Math.max(8, Math.floor(W / cs))
  rows = Math.max(8, Math.floor(H / cs))
  grid.width = cols
  grid.height = rows
  img = gctx.createImageData(cols, rows)
  seed()
}
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  rebuild()
}

const wrap = (v, n) => (v + n) % n

function step() {
  if (mode === 'rule') {
    cur.copyWithin(0, cols) // scroll rows up
    const src = (rows - 2) * cols
    const dst = (rows - 1) * cols
    for (let x = 0; x < cols; x++) {
      const l = cur[src + wrap(x - 1, cols)]
      const c = cur[src + x]
      const r = cur[src + wrap(x + 1, cols)]
      cur[dst + x] = (ruleN >> ((l << 2) | (c << 1) | r)) & 1
    }
    return
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      const s = cur[i]
      if (mode === 'life') {
        let n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            n += cur[wrap(y + dy, rows) * cols + wrap(x + dx, cols)]
          }
        next[i] = s ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0
      } else if (mode === 'brain') {
        if (s === 1) next[i] = 2 // on → dying
        else if (s === 2) next[i] = 0 // dying → off
        else {
          let n = 0
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              if (cur[wrap(y + dy, rows) * cols + wrap(x + dx, cols)] === 1) n++
            }
          next[i] = n === 2 ? 1 : 0
        }
      } else {
        const want = (s + 1) % nStates // cyclic
        let hit = false
        for (let dy = -1; dy <= 1 && !hit; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            if (cur[wrap(y + dy, rows) * cols + wrap(x + dx, cols)] === want) { hit = true; break }
          }
        next[i] = hit ? want : s
      }
    }
  }
  const t = cur
  cur = next
  next = t
}

function render() {
  const d = img.data
  const [hr, hg, hb] = hslRGB(params.hue, 0.7, 0.62)
  for (let i = 0; i < cols * rows; i++) {
    const s = cur[i]
    let r, g, b
    if (mode === 'cyclic') {
      const c = hslRGB((params.hue + s / nStates) % 1, 0.75, 0.55)
      r = c[0]; g = c[1]; b = c[2]
    } else if (mode === 'brain') {
      if (s === 1) { r = hr; g = hg; b = hb }
      else if (s === 2) { r = hr * 0.4; g = hg * 0.4; b = hb * 0.4 }
      else { r = 6; g = 7; b = 12 }
    } else {
      if (s) { r = hr; g = hg; b = hb } else { r = 6; g = 7; b = 12 }
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255
  }
  gctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(grid, 0, 0, W, H)
}

let acc = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (params.mode !== mode || Math.round(params.rule) !== ruleN || (params.mode === 'cyclic' && Math.round(params.states) !== nStates)) seed()

  acc += dt * params.rate
  let n = Math.min(8, Math.floor(acc))
  acc -= n
  while (n-- > 0) step()
  render()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', () => seed()) // click to reseed
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
