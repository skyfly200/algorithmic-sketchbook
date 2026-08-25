/**
 * Egg Speckle — the speckled surface of a wild bird's egg, and the spray-marbled
 * covers it inspired (the flecked endpapers on old notebooks). A tinted shell
 * base is continually misted with pigment: fine specks, soft airbrush blooms,
 * larger blotches and the odd squiggle, building on a persistent buffer that
 * slowly renews so the pattern keeps breathing. Presets range from real clutches
 * (robin, quail, guillemot, dunnock) to a multi-colour notebook spray.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  species: { value: 'Quail', type: 'select', options: ['Robin', 'Quail', 'Guillemot', 'Dunnock', 'Notebook spray'], label: 'Clutch' },
  density: { value: 1, min: 0.1, max: 4, step: 0.05, label: 'Speckle density' },
  fineness: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Fineness' },
  blotches: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Blotches' },
  squiggles: { value: 0.2, min: 0, max: 1, step: 0.02, label: 'Squiggles' },
  spray: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Airbrush mist' },
  turnover: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Renew rate' },
  hue: { value: 0, min: -60, max: 60, step: 1, label: 'Tint shift' },
})
// Music: beats fling a burst of speckles, loudness drives the density.
rt.mapInput('audio.volume', 'density', 1.2)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
// A persistent pigment buffer we spray onto and let renew, so the surface is
// alive without redrawing thousands of specks from scratch each frame. Soft
// marks (airbrush mist, blotches, squiggles) live here and may overlap.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')
// The hard specks (the discrete dots) live on their own transparent layer over
// the buffer, kept strictly non-overlapping: a new speck that lands on an
// existing one erases it and takes its place ("replace instead of overlap").
const dot = document.createElement('canvas')
const dctx = dot.getContext('2d')
// Spatial hash of placed marks for fast neighbour lookup. A mark is registered
// in every cell its bounding box covers, so a big blotch is still found by a
// tiny speck landing anywhere beneath it (marks vary hugely in size, so a fixed
// 3×3 scan wouldn't reach across a large one).
let cell = 12
let grid = new Map()
const cellKey = (cx, cy) => cx + ',' + cy
function gridReset() { grid = new Map(); dctx.clearRect(0, 0, W, H) }
function eachCell(x, y, r, fn) {
  const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell)
  const y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell)
  for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) fn(cellKey(gx, gy))
}
function register(x, y, r) {
  const m = { x, y, r, keys: [] }
  eachCell(x, y, r, (k) => { m.keys.push(k); const arr = grid.get(k); if (arr) arr.push(m); else grid.set(k, [m]) })
}
function forget(m) {
  for (const k of m.keys) { const arr = grid.get(k); if (!arr) continue; const i = arr.indexOf(m); if (i >= 0) arr.splice(i, 1) }
}
// Erase (and forget) every placed mark whose footprint the incoming one of
// radius r at (x,y) would touch — the "replace" half of no-overlap.
function clearOverlaps(x, y, r) {
  const gap = rt.pixelRatio * 0.6, hit = new Set()
  eachCell(x, y, r, (k) => {
    const arr = grid.get(k); if (!arr) return
    for (const m of arr) {
      if (hit.has(m)) continue
      const dx = m.x - x, dy = m.y - y, reach = r + m.r + gap
      if (dx * dx + dy * dy < reach * reach) hit.add(m)
    }
  })
  for (const m of hit) {
    dctx.save(); dctx.globalCompositeOperation = 'destination-out'
    dctx.beginPath(); dctx.arc(m.x, m.y, m.r + 1, 0, Math.PI * 2); dctx.fill(); dctx.restore()
    forget(m)
  }
}
// Drop a round speck, replacing any mark it would overlap.
function placeDot(x, y, r, color, alpha) {
  clearOverlaps(x, y, r)
  dctx.globalAlpha = alpha
  dctx.fillStyle = color
  dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill()
  dctx.globalAlpha = 1
  register(x, y, r)
}

// Clutch presets: shell colour(s) + pigment palette + which marks dominate.
const CLUTCH = {
  Robin: { shell: ['#63b8c4', '#7fc9cf'], pig: ['#5a3418', '#7a4a22', '#3a2410'], mult: 1, blotch: 0.7, big: 0.6 },
  Quail: { shell: ['#d8c79a', '#e6dcb4'], pig: ['#4c3a1e', '#2c2110', '#6b5228'], mult: 1.5, blotch: 1, big: 0.5 },
  Guillemot: { shell: ['#5c86a8', '#9fb7a0', '#c8c19a'], pig: ['#20160c', '#2c2414', '#402a12'], mult: 0.8, blotch: 0.5, big: 1.1 },
  Dunnock: { shell: ['#3f7fb0', '#5aa0c4'], pig: null, mult: 0, blotch: 0, big: 0 }, // unmarked blue
  'Notebook spray': { shell: ['#1c1c22', '#26222c'], pig: ['#e0483c', '#f2b400', '#3aa6d6', '#7ad07a', '#e88ac4', '#ffffff'], mult: 1.4, blotch: 0.3, big: 0.4 },
}

let W = 0, H = 0, minDim = 0
function paintShell() {
  const cfg = CLUTCH[params.species] ?? CLUTCH.Quail
  const cols = cfg.shell
  const g = bctx.createLinearGradient(0, 0, W * 0.3, H)
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1 || 1), tint(c)))
  bctx.fillStyle = g
  bctx.fillRect(0, 0, W, H)
  // faint low-frequency mottle so the shell isn't a flat wash
  bctx.save()
  bctx.globalAlpha = 0.06
  for (let i = 0; i < 40; i++) {
    const x = rt.random(0, W), y = rt.random(0, H), r = rt.random(0.1, 0.35) * minDim
    const rg = bctx.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, rt.rng() < 0.5 ? '#ffffff' : '#000000')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    bctx.fillStyle = rg
    bctx.beginPath(); bctx.arc(x, y, r, 0, Math.PI * 2); bctx.fill()
  }
  bctx.restore()
}
// Shift a hex colour's hue by the tint param (kept simple via HSL round-trip).
function tint(hex) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (!params.hue) return `rgb(${r},${g},${b})`
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2
  let h = 0, s = 0
  const dd = max - min
  if (dd) {
    s = dd / (1 - Math.abs(2 * l - 1))
    const rr = r / 255, gg = g / 255, bb = b / 255
    h = max === rr ? ((gg - bb) / dd) % 6 : max === gg ? (bb - rr) / dd + 2 : (rr - gg) / dd + 4
    h *= 60; if (h < 0) h += 360
  }
  h = (h + params.hue + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]
  return `rgb(${Math.round((seg[0] + m) * 255)},${Math.round((seg[1] + m) * 255)},${Math.round((seg[2] + m) * 255)})`
}

function resize() {
  W = buf.width = dot.width = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = buf.height = dot.height = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  minDim = Math.min(W, H)
  cell = Math.max(8, Math.round(6 * rt.pixelRatio)) // bucket size (perf only)
  gridReset() // setting dot.width already cleared the layer; reset the hash too
  paintShell()
}

function pig(cfg) { return cfg.pig ? tint(rt.pick(cfg.pig)) : '#000' }

// A fine speck — a hard little fleck. Placed on the non-overlapping dot layer,
// so if it lands on an existing fleck it replaces it rather than piling up.
function speck(cfg) {
  const x = rt.random(0, W), y = rt.random(0, H)
  const r = (0.4 + rt.random(0, 1.6) * (1.2 - params.fineness)) * rt.pixelRatio
  placeDot(x, y, r, pig(cfg), rt.random(0.4, 0.95))
}
// A soft airbrush bloom — a cluster of low-alpha micro-dots, the spray look.
function mist(cfg) {
  const cx = rt.random(0, W), cy = rt.random(0, H)
  const spread = (0.03 + params.spray * 0.09) * minDim
  const col = pig(cfg)
  const n = 12 + (params.spray * 40) | 0
  bctx.fillStyle = col
  for (let i = 0; i < n; i++) {
    const a = rt.random(0, Math.PI * 2), d = Math.pow(rt.rng(), 0.5) * spread
    bctx.globalAlpha = rt.random(0.03, 0.14)
    const r = rt.random(0.4, 1.4) * rt.pixelRatio
    bctx.beginPath(); bctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2); bctx.fill()
  }
}
// A larger irregular blotch — lobes clustered into one mark. It goes on the
// dot layer as a single non-overlapping unit (extent ≈ 2·base), so blotches
// clear and replace whatever they land on rather than piling into clumps; the
// lobes still overlap *within* the blotch to give it a ragged, dense-cored edge.
function blotch(cfg) {
  const cx = rt.random(0, W), cy = rt.random(0, H)
  const base = (0.01 + cfg.big * 0.03 + rt.random(0, 0.02)) * minDim
  clearOverlaps(cx, cy, base * 2)
  dctx.fillStyle = pig(cfg)
  dctx.globalAlpha = rt.random(0.3, 0.7)
  const lobes = 3 + (rt.rng() * 4) | 0
  for (let i = 0; i < lobes; i++) {
    const a = rt.random(0, Math.PI * 2), d = rt.random(0, base)
    dctx.beginPath(); dctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, base * rt.random(0.5, 1), 0, Math.PI * 2); dctx.fill()
  }
  dctx.globalAlpha = 1
  register(cx, cy, base * 2)
}
// A squiggle — a short wandering stroke, the ink-scrawl markings on some eggs.
function squiggle(cfg) {
  let x = rt.random(0, W), y = rt.random(0, H), a = rt.random(0, Math.PI * 2)
  bctx.globalAlpha = rt.random(0.4, 0.8)
  bctx.strokeStyle = pig(cfg)
  bctx.lineWidth = rt.random(0.8, 2.2) * rt.pixelRatio
  bctx.lineCap = 'round'
  bctx.beginPath(); bctx.moveTo(x, y)
  const steps = 5 + (rt.rng() * 10) | 0
  for (let i = 0; i < steps; i++) {
    a += rt.random(-0.9, 0.9)
    x += Math.cos(a) * rt.random(3, 10) * rt.pixelRatio
    y += Math.sin(a) * rt.random(3, 10) * rt.pixelRatio
    bctx.lineTo(x, y)
  }
  bctx.stroke()
}

function spray(count) {
  const cfg = CLUTCH[params.species] ?? CLUTCH.Quail
  if (cfg.mult <= 0) return // unmarked clutch (Dunnock)
  for (let i = 0; i < count; i++) {
    const r = rt.rng()
    if (r < params.blotches * cfg.blotch * 0.12) blotch(cfg)
    else if (r < params.blotches * cfg.blotch * 0.12 + params.squiggles * 0.1) squiggle(cfg)
    else if (r < 0.35 && params.spray > 0.05) mist(cfg)
    else speck(cfg)
  }
  bctx.globalAlpha = 1
}

let lastSpecies = null
let acc = 0, lastNow = 0
rt.onBeat(() => { spray(60) }) // a burst of speckling on the beat

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (params.species !== lastSpecies) { lastSpecies = params.species; paintShell(); gridReset() }

  // Slow renewal: veil the buffer with a faint wash of the shell so old marks
  // fade and the surface keeps turning over. Cheap and keeps it "alive".
  if (params.turnover > 0.001) {
    const cfg = CLUTCH[params.species] ?? CLUTCH.Quail
    bctx.globalAlpha = params.turnover * 0.02
    bctx.fillStyle = tint(cfg.shell[0])
    bctx.fillRect(0, 0, W, H)
    bctx.globalAlpha = 1
  }
  acc += dt * params.density * 220 * (0.5 + rt.beat.state.pulse)
  const n = acc | 0
  acc -= n
  spray(n)

  ctx.drawImage(buf, 0, 0)  // shell + soft marks
  ctx.drawImage(dot, 0, 0)  // non-overlapping specks on top
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', (e) => {
  // a directed puff where you tap
  const cfg = CLUTCH[params.species] ?? CLUTCH.Quail
  if (cfg.mult <= 0) return
  const cx = e.clientX * rt.pixelRatio, cy = e.clientY * rt.pixelRatio
  for (let i = 0; i < 40; i++) {
    const a = rt.random(0, Math.PI * 2), d = Math.pow(rt.rng(), 0.5) * minDim * 0.06
    placeDot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rt.random(0.5, 2) * rt.pixelRatio, pig(cfg), rt.random(0.3, 0.85))
  }
})

window.addEventListener('resize', resize)
resize()
spray(600) // seed the shell with an initial speckle field
requestAnimationFrame(frame)
