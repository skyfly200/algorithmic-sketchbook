// Honeycomb & Bees — a frame of waxen hexagonal comb (some cells capped, some
// brimming with glossy amber honey) with worker bees crawling over it: wings
// shivering, ambling between cells and pausing to tend them. The pointer draws
// the bees over to investigate; beats set the colony bustling.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  cellSize: { value: 1, min: 0.6, max: 1.8, step: 0.05, label: 'Comb scale' },
  honey: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Honey fill' },
  bees: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Bee count' },
  speed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Bee speed' },
  wing: { value: 1, min: 0, max: 2, step: 0.05, label: 'Wing flutter' },
  warmth: { value: 1, min: 0.5, max: 1.5, step: 0.02, label: 'Warmth' },
})
rt.mapInput('audio.level', 'speed', 0.5)

let W = 0, H = 0, PR = 1
let hexR = 40 // center → vertex
const comb = document.createElement('canvas')
const cctx = comb.getContext('2d')
let cells = []

// Flat-top hexagon path centred at (0,0), radius r.
function hexPath(c, r) {
  c.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    const x = Math.cos(a) * r, y = Math.sin(a) * r
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y)
  }
  c.closePath()
}
function buildComb() {
  hexR = 40 * params.cellSize * PR
  comb.width = W; comb.height = H
  cells = []
  const r = hexR
  const hx = r * 1.5           // horizontal spacing (flat-top)
  const hy = r * Math.sqrt(3)  // vertical spacing
  cctx.fillStyle = '#1c1408'
  cctx.fillRect(0, 0, W, H)
  const warm = params.warmth
  let col = 0
  for (let cx = -r; cx < W + r; cx += hx, col++) {
    const yoff = (col % 2) * hy / 2
    for (let cy = -r; cy < H + r; cy += hy) {
      const x = cx, y = cy + yoff
      const kind = rt.rng()
      const filled = rt.rng() < params.honey
      cells.push({ x, y, filled, kind })
      cctx.save()
      cctx.translate(x, y)
      // wax cell wall
      hexPath(cctx, r * 0.97)
      const wax = cctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r)
      wax.addColorStop(0, `hsl(42, ${Math.round(55 * warm)}%, ${Math.round(38 * warm)}%)`)
      wax.addColorStop(1, `hsl(38, ${Math.round(60 * warm)}%, ${Math.round(20 * warm)}%)`)
      cctx.fillStyle = wax
      cctx.fill()
      // inner cell
      hexPath(cctx, r * 0.8)
      if (filled && kind < 0.55) {
        // glossy honey
        const hg = cctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.85)
        hg.addColorStop(0, 'hsl(45, 95%, 72%)')
        hg.addColorStop(0.5, 'hsl(38, 92%, 55%)')
        hg.addColorStop(1, 'hsl(32, 90%, 38%)')
        cctx.fillStyle = hg
        cctx.fill()
        // specular glint
        cctx.beginPath(); cctx.ellipse(-r * 0.25, -r * 0.3, r * 0.16, r * 0.09, -0.5, 0, 6.28)
        cctx.fillStyle = 'rgba(255,255,240,0.55)'; cctx.fill()
      } else if (filled) {
        // capped cell (opaque wax lid)
        cctx.fillStyle = 'hsl(40, 45%, 42%)'
        cctx.fill()
      } else {
        // empty cell — dark recessed
        cctx.fillStyle = 'hsl(36, 50%, 12%)'
        cctx.fill()
        hexPath(cctx, r * 0.8)
        cctx.strokeStyle = 'rgba(0,0,0,0.4)'; cctx.lineWidth = 2 * PR; cctx.stroke()
      }
      cctx.restore()
    }
  }
}

let beeList = []
function wantBees() { return Math.max(1, Math.round(10 * params.bees)) }
function makeBee() {
  return {
    x: rt.random(0, W), y: rt.random(0, H),
    a: rt.random(0, 6.28), // heading
    size: rt.random(9, 14) * PR,
    wob: rt.random(0, 6.28),
    pause: 0, // remaining pause time at a cell
    turn: 0,
    dance: null, // set to a waggle-dance state object while dancing
  }
}
// Start a rare waggle dance: the bee runs a straight "waggle run" in a chosen
// direction, then loops back in a semicircle, alternating sides each circuit —
// the honeybee figure-eight that communicates a direction to nestmates.
function startDance(b) {
  b.dance = { dir: rt.random(0, 6.28), phase: 0, side: rt.rng() < 0.5 ? 1 : -1, circuits: 0, max: 3 + (rt.rng() * 5 | 0), cx: b.x, cy: b.y }
}
function updateDance(b, dt) {
  const d = b.dance
  d.phase += dt / (1.9 / Math.max(0.4, params.speed))
  if (d.phase >= 1) { d.phase -= 1; d.side *= -1; d.circuits++; if (d.circuits >= d.max) { b.dance = null; b.pause = rt.random(0.3, 1); return } }
  const U0 = Math.cos(d.dir), U1 = Math.sin(d.dir)
  const runLen = hexR * 3.2, runFrac = 0.5
  if (d.phase < runFrac) {
    const pr = d.phase / runFrac
    const along = pr * runLen
    const wag = Math.sin(pr * Math.PI * 2 * 5) * hexR * 0.3 // side-to-side waggle
    b.x = d.cx + U0 * along - U1 * d.side * wag
    b.y = d.cy + U1 * along + U0 * d.side * wag
    b.a = d.dir + Math.sin(pr * Math.PI * 2 * 5) * 0.6
  } else {
    const ar = (d.phase - runFrac) / (1 - runFrac)
    const mx = d.cx + U0 * runLen * 0.5, my = d.cy + U1 * runLen * 0.5
    const rad = runLen * 0.5, start = Math.atan2(U1, U0)
    const ang = start + d.side * Math.PI * ar
    b.x = mx + Math.cos(ang) * rad
    b.y = my + Math.sin(ang) * rad
    b.a = ang + d.side * Math.PI / 2
  }
}
function buildBees() { beeList = Array.from({ length: wantBees() }, makeBee) }

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  buildComb()
  buildBees()
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })

let bustle = 0
rt.onBeat(({ energy }) => { bustle = 0.6 + energy * 0.5 })

function drawBee(b, t) {
  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.rotate(b.a)
  const s = b.size
  // shadow on the comb
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath(); ctx.ellipse(2 * PR, 2 * PR, s * 1.05, s * 0.62, 0, 0, 6.28); ctx.fill()
  // fluttering wings (two translucent ellipses)
  const flutter = 0.6 + 0.4 * Math.sin(t * 28 + b.wob) * params.wing
  ctx.fillStyle = 'rgba(230,240,255,0.4)'
  for (const sgn of [-1, 1]) {
    ctx.save()
    ctx.translate(-s * 0.1, sgn * s * 0.35)
    ctx.scale(1, flutter)
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.8, s * 0.42, sgn * 0.3, 0, 6.28); ctx.fill()
    ctx.restore()
  }
  // body: amber & black bands
  for (let i = 2; i >= -2; i--) {
    ctx.fillStyle = (i % 2 === 0) ? '#1a1206' : 'hsl(42, 95%, 55%)'
    ctx.beginPath()
    ctx.ellipse(i * s * 0.28, 0, s * 0.34, s * 0.62 * (1 - Math.abs(i) * 0.12), 0, 0, 6.28)
    ctx.fill()
  }
  // head
  ctx.fillStyle = '#0d0a04'
  ctx.beginPath(); ctx.ellipse(s * 0.85, 0, s * 0.34, s * 0.42, 0, 0, 6.28); ctx.fill()
  // antennae
  ctx.strokeStyle = '#0d0a04'; ctx.lineWidth = 1.2 * PR
  for (const sgn of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 1.05, sgn * s * 0.1)
    ctx.quadraticCurveTo(s * 1.5, sgn * s * 0.35, s * 1.6, sgn * s * 0.5); ctx.stroke()
  }
  ctx.restore()
}

let last = 0
let lastCell = 1
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  bustle = Math.max(0, bustle - dt)
  if (params.cellSize !== lastCell) { lastCell = params.cellSize; buildComb() }
  if (beeList.length !== wantBees()) buildBees()

  ctx.drawImage(comb, 0, 0)

  const near = performance.now() - ptr.t < 1500
  const dancers = beeList.filter((b) => b.dance)
  for (const b of beeList) {
    if (b.dance) {
      updateDance(b, dt)
      drawBee(b, t)
      continue
    }
    if (b.pause > 0) {
      b.pause -= dt
      // shiver in place
      b.a += Math.sin(t * 10 + b.wob) * 0.02
    } else {
      // wander: gently steer the heading; head toward pointer if it's near
      b.turn += (rt.rng() - 0.5) * 2.5 * dt
      b.turn *= 0.9
      b.a += b.turn
      if (near) {
        const desired = Math.atan2(ptr.y - b.y, ptr.x - b.x)
        let d = desired - b.a
        d = Math.atan2(Math.sin(d), Math.cos(d))
        b.a += d * 0.04
      }
      // nestmates gather around a dancer to read the waggle, and slow down
      let watch = 1
      if (dancers.length) {
        let nd = 1e9, near2 = null
        for (const dz of dancers) { const dd = Math.hypot(dz.x - b.x, dz.y - b.y); if (dd < nd) { nd = dd; near2 = dz } }
        if (near2 && nd < 140 * PR) {
          const desired = Math.atan2(near2.y - b.y, near2.x - b.x)
          let d = desired - b.a; d = Math.atan2(Math.sin(d), Math.cos(d)); b.a += d * 0.05
          watch = nd < 55 * PR ? 0.25 : 0.7
        }
      }
      const v = (18 + bustle * 40) * params.speed * PR * watch
      b.x += Math.cos(b.a) * v * dt
      b.y += Math.sin(b.a) * v * dt
      // occasionally pause at a cell, and rarely break into a waggle dance
      if (rt.rng() < 0.004) b.pause = rt.random(0.4, 1.6)
      else if (dancers.length < 2 && rt.rng() < 0.0006) startDance(b)
      // wrap
      if (b.x < -20) b.x = W + 20; else if (b.x > W + 20) b.x = -20
      if (b.y < -20) b.y = H + 20; else if (b.y > H + 20) b.y = -20
    }
    drawBee(b, t)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
