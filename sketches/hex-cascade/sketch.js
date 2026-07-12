/**
 * Hex Cascade — a hash-seeded generative piece run through p5.js (global mode).
 * Faithful port of a token-art script: palette, hex count, stroke depth, and
 * rarities are all derived deterministically from the token hash. Cursor
 * distance from center blooms the concentric hex strokes; beats add a pulse.
 */
import p5 from 'p5'
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
rt.onBeat(() => {}) // mounts the mic toggle so the piece can react to sound

// The original piece is hash-seeded; here the "token hash" is generated from
// the runtime's seeded RNG, so every load (and the viewer's 🎲) is a fresh
// deterministic token, while a given ?seed= always reproduces the same one.
const hash =
  '0x' + Array.from({ length: 64 }, () => Math.floor(rt.rng() * 16).toString(16)).join('')
const tokenData = { hash, tokenId: String(Math.floor(rt.rng() * 1e7)) }

let seed = parseInt(tokenData.hash.slice(0, 16), 16)
const initialSeed = seed

const hashPairs = []
for (let j = 0; j < 32; j++) hashPairs.push(tokenData.hash.slice(2 + j * 2, 4 + j * 2))
const rvs = hashPairs.map((x) => parseInt(x, 16))

const palette_choices = [
  ['#FF0000', '#00A08A', '#F2AD00', '#F98400', '#5BBCD6'],
  ['#E6A0C4', '#C6CDF7', '#D8A499', '#7294D4'],
  ['#B0305C', '#EB564B', '#73275C'],
  ['#363636', '#E8175D'],
  ['#EEEEEE', '#CC0E74'],
  ['#FFFFEB', '#C2C2D1'],
  ['#5d54a4', '#d789d7', '#9d65c9'],
  ['#000003', '#FF0033'],
]

const DEFAULT_SIZE = 500
const PI = Math.PI

// --- deterministic RNG (xorshift on the hash-derived seed) ---
function rnd_dec() {
  seed ^= seed << 13
  seed ^= seed >> 17
  seed ^= seed << 5
  return ((seed < 0 ? ~seed + 1 : seed) % 1000) / 1000
}
function rnd_between(a, b) {
  return a + (b - a) * rnd_dec()
}
function rnd_choice(choices) {
  return choices[Math.floor(rnd_between(0, choices.length * 0.99))]
}
function rnd_outcome(input, values, outcome, fallback) {
  const zip = (a, b) => a.map((x, i) => [x, b[i]])
  for (const [a, b] of zip(values, outcome)) if (input >= a) return b
  return fallback
}

// --- hash-driven configuration (resolution independent) ---
const cp_r = Math.floor(rt.rng() * palette_choices.length) // random palette per seed
const bg_r = rt.rng() > 0.5 ? 1 : 0
const pal = palette_choices[cp_r]
let bg = pal[bg_r ? pal.length - 1 : 0]
let fg = bg_r ? pal.slice(0, pal.length - 1) : pal.slice(1)

const hex_count = rnd_outcome(rvs[2], [19, 18, 17, 16, 14, 12], [4, 5, 6, 8, 14, 12], 10)
let stk_color = rnd_outcome(rvs[3], [10], ['#EEEEEE'], '#000003')
const hex_number = rnd_outcome(rvs[4], [19, 18, 17, 16, 14, 12], [7, 6, 5, 4, 3, 2], 1)

const rare1 = rvs[5] === 19 && rvs[6] === 19
const rare2 = rvs[5] === 18 && rvs[6] === 18
if (rare1) {
  bg = '#303a52'
  fg = ['#283149', '#1b2232']
  stk_color = '#a7ff83'
} else if (rare2) {
  bg = '#1eafed'
  fg = ['#eef2f5', '#FFFFFF']
  stk_color = '#000000'
}

// --- resolution-dependent layout (recomputed on resize) ---
let DIM, M, C, hex_space, stk_weight, spacing, size
let objects = []

function computeLayout() {
  DIM = Math.min(window.innerWidth, window.innerHeight)
  M = DIM / DEFAULT_SIZE
  C = (M * 10) / hex_count
  hex_space = 11 * C
  stk_weight = C / 2
  spacing = DIM / hex_count
  size = spacing - hex_space
}

function buildObjects() {
  // Reset the RNG so color choices stay identical across rebuilds/resizes.
  seed = initialSeed
  objects = []
  for (let x = spacing; x + spacing / 2 < DIM; x += spacing) {
    for (let y = spacing; y + spacing / 2 < DIM; y += spacing) {
      objects.push({
        hex: { color: rnd_choice(fg), x, y, size },
        stroke: { color: stk_color, weight: stk_weight, x, y, size: size - 10 * C },
      })
    }
  }
}

// --- p5 drawing (global mode: these bare calls resolve to p5's window globals) ---
function hexagon(x, y, radius) {
  const angle = TWO_PI / 6
  beginShape()
  for (let a = 0; a < TWO_PI; a += angle) vertex(x + cos(a) * radius, y + sin(a) * radius)
  endShape(CLOSE)
}
function hex(color, x, y, sz) {
  noStroke()
  fill(color)
  hexagon(x, y, sz / 2)
}
function stk(color, weight, x, y, sz) {
  strokeWeight(weight)
  stroke(color)
  noFill()
  hexagon(x, y, sz / 2)
}

function setup() {
  pixelDensity(rt.pixelRatio)
  computeLayout()
  createCanvas(DIM, DIM)
  buildObjects()
  document.body.style.background = bg
}

function windowResized() {
  computeLayout()
  resizeCanvas(DIM, DIM)
  buildObjects()
}

function draw() {
  rt.tick(performance.now())
  background(bg)

  const a = Math.abs(DIM / 2 - mouseX)
  const b = Math.abs(DIM / 2 - mouseY)
  const t = Math.sqrt((DIM / 2) ** 2 + (DIM / 2) ** 2)
  let pct = Math.sqrt(a ** 2 + b ** 2) / t
  // Beats bloom the cascade like a burst of cursor motion.
  pct = Math.min(1, Math.max(0, pct + rt.beat.state.pulse * 0.6))

  for (let i = 0; i < objects.length; i++) {
    const h = objects[i].hex
    hex(h.color, h.x, h.y, h.size)
    for (let j = 0; j <= hex_number; j++) {
      const s = objects[i].stroke
      let grow = s.size / hex_number / (hex_number * pct)
      grow = grow >= s.size ? s.size : grow
      stk(s.color, s.weight, s.x, s.y, s.size - j * grow)
    }
  }
}

window.setup = setup
window.draw = draw
window.windowResized = windowResized
new p5()
