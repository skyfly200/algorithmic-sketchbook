// Mushroom Fruiting — a colony seen from the side. Mycelium spreads as a
// branching web of fine hyphae through the substrate; where the web thickens,
// pins emerge and fruit into recognisable species — fly agaric, porcini, shaggy
// ink cap, oyster clusters, chanterelles, and bracket polypores tiered on buried
// wood. Each grows, matures, drops drifting spores, then ages and withers while
// new flushes keep coming. Tick the species you want; click to inoculate a
// flush; beats trigger a colony-wide flush.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  flush: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fruiting density' },
  size: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Mushroom size' },
  spores: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Spore release' },
  spread: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Mycelium spread' },
  damp: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Substrate damp' },
  // which species are allowed to fruit
  flyAgaric: { value: true, type: 'bool', label: 'Fly agaric' },
  porcini: { value: true, type: 'bool', label: 'Porcini' },
  inkcap: { value: true, type: 'bool', label: 'Shaggy ink cap' },
  oyster: { value: true, type: 'bool', label: 'Oyster cluster' },
  chanterelle: { value: true, type: 'bool', label: 'Chanterelle' },
  polypore: { value: true, type: 'bool', label: 'Bracket polypore' },
})
rt.mapInput('audio.level', 'growth', 0.3)

const SPECIES = ['flyAgaric', 'porcini', 'inkcap', 'oyster', 'chanterelle', 'polypore']
function enabledSpecies() {
  const on = SPECIES.filter((k) => params[k])
  return on.length ? on : SPECIES
}
function pickSpecies() {
  const on = enabledSpecies()
  return on[(rt.rng() * on.length) | 0]
}

let W = 0, H = 0, PR = 1, ground = 0
const myc = document.createElement('canvas')
const mctx = myc.getContext('2d')

let tips = []
let shrooms = []
const spores = []

function seedMycelium(x, y, n) {
  for (let i = 0; i < n; i++) tips.push({ x, y, a: rt.random(0, 6.28), life: rt.random(60, 200), vigor: rt.random(0.6, 1) })
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  ground = H * 0.72
  myc.width = W; myc.height = H
  mctx.clearRect(0, 0, W, H)
  tips = []; shrooms = []; spores.length = 0
  for (let i = 0; i < 5; i++) seedMycelium(rt.random(W * 0.1, W * 0.9), rt.random(ground + 6 * PR, H - 8 * PR), 3)
}

function growMyc(dt) {
  const spd = 26 * PR * params.spread
  const next = []
  for (const tp of tips) {
    const px = tp.x, py = tp.y
    tp.a += (rt.rng() - 0.5) * 2.4 * dt
    tp.x += Math.cos(tp.a) * spd * dt
    tp.y += Math.sin(tp.a) * spd * dt * 0.7
    if (tp.y < ground + 4 * PR) { tp.y = ground + 4 * PR; tp.a = Math.abs(tp.a) }
    if (tp.y > H - 4 * PR) { tp.y = H - 4 * PR; tp.a = -Math.abs(tp.a) }
    if (tp.x < 0 || tp.x > W) { tp.a = Math.PI - tp.a; tp.x = Math.max(0, Math.min(W, tp.x)) }
    mctx.strokeStyle = `hsla(40, 30%, 82%, ${0.16 * tp.vigor})`
    mctx.lineWidth = 1 * PR
    mctx.beginPath(); mctx.moveTo(px, py); mctx.lineTo(tp.x, tp.y); mctx.stroke()
    tp.life -= dt * 60
    if (tp.life > 0) {
      next.push(tp)
      if (rt.rng() < 0.02 * params.spread && tips.length < 240) next.push({ x: tp.x, y: tp.y, a: tp.a + rt.random(-1, 1), life: tp.life * 0.7, vigor: tp.vigor * 0.9 })
    }
  }
  tips = next
  if (tips.length < 20 && rt.rng() < 0.5) seedMycelium(rt.random(W * 0.1, W * 0.9), rt.random(ground + 6 * PR, H - 8 * PR), 2)
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = 'rgba(0,0,0,0.006)'
  mctx.fillRect(0, 0, W, H)
  mctx.globalCompositeOperation = 'source-over'
}

function spawnShroom(x, key = null) {
  if (shrooms.length > 26 * params.flush) return
  key = key || pickSpecies()
  shrooms.push({
    x, key,
    g: 0,
    h: rt.random(70, 120) * PR * params.size,
    cw: rt.random(38, 60) * PR * params.size,
    lean: rt.random(-0.1, 0.1),
    tint: rt.random(-7, 7),
    rate: rt.random(0.7, 1.2),
    tier: 2 + (rt.rng() * 3 | 0),
    side: rt.rng() < 0.5 ? 1 : -1,
    clump: 2 + (rt.rng() * 2 | 0),
  })
}

function onDown(e) {
  const x = e.clientX * PR, y = e.clientY * PR
  seedMycelium(x, Math.max(ground + 6 * PR, y), 5)
  for (let i = 0; i < 3; i++) spawnShroom(x + rt.random(-40, 40) * PR)
}
window.addEventListener('pointerdown', onDown)
rt.onBeat(({ energy }) => {
  const n = 2 + (energy * 4 | 0)
  for (let i = 0; i < n; i++) spawnShroom(rt.random(W * 0.08, W * 0.92))
})

// --- drawing helpers -------------------------------------------------------
function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})` }
function env(m) {
  const grow = Math.min(1, m.g)
  const age = Math.max(0, m.g - 1)
  const decay = Math.max(0, m.g - 1.9)
  return { grow, age, decay, ease: grow * grow * (3 - 2 * grow) }
}
function emitSpore(m, cx, cy, cw, hue) {
  if (m.g > 0.95 && m.g < 1.7 && params.spores > 0 && rt.rng() < params.spores * 0.4) {
    spores.push({ x: cx + rt.random(-cw * 0.6, cw * 0.6), y: cy, vy: rt.random(6, 16) * PR, vx: rt.random(-4, 4) * PR, life: 1, hue })
  }
}
function stemPath(gx, ground, topY, sw, lean, bulge) {
  ctx.beginPath()
  ctx.moveTo(gx - sw * bulge, ground)
  ctx.quadraticCurveTo(gx - sw * bulge * 1.2, (ground + topY) / 2, gx - sw + lean, topY)
  ctx.lineTo(gx + sw + lean, topY)
  ctx.quadraticCurveTo(gx + sw * bulge * 1.2, (ground + topY) / 2, gx + sw * bulge, ground)
  ctx.closePath()
}

// --- species ----------------------------------------------------------------
function drawFlyAgaric(m) {
  const { ease, age, decay } = env(m)
  if (decay > 0.6) return
  const gx = m.x, stemH = m.h * ease * (1 - decay * 0.5)
  const topY = ground - stemH, lean = m.lean * stemH
  const sw = m.cw * 0.14
  // white stem with a bulbous volva at the base
  stemPath(gx, ground, topY, sw, lean, 1.7)
  ctx.fillStyle = hsl(45, 22, 90 - age * 20)
  ctx.fill()
  // ring (annulus)
  ctx.fillStyle = hsl(45, 20, 82 - age * 20)
  ctx.beginPath(); ctx.ellipse(gx + lean, topY + stemH * 0.22, sw * 2, sw * 0.5, 0, 0, 6.28); ctx.fill()
  const cx = gx + lean, cy = topY
  const capW = m.cw * (0.4 + ease * 0.6), dome = (1 - age * 0.7)
  const capH = capW * (0.55 + dome * 0.5)
  // red cap, flattening with age
  ctx.beginPath()
  ctx.moveTo(cx - capW, cy)
  ctx.quadraticCurveTo(cx - capW * 0.5, cy - capH * (1 + dome), cx, cy - capH * (0.9 + dome))
  ctx.quadraticCurveTo(cx + capW * 0.5, cy - capH * (1 + dome), cx + capW, cy)
  ctx.quadraticCurveTo(cx, cy + age * capH * 0.5, cx - capW, cy)
  ctx.closePath()
  const g = ctx.createRadialGradient(cx - capW * 0.3, cy - capH, capW * 0.1, cx, cy - capH * 0.3, capW * 1.3)
  g.addColorStop(0, hsl(6 + m.tint, 85, 62 - age * 24))
  g.addColorStop(0.6, hsl(2 + m.tint, 82, 48 - age * 26))
  g.addColorStop(1, hsl(0, 70, 34 - age * 20))
  ctx.fillStyle = g; ctx.fill()
  // white warts
  if (age < 0.7) {
    ctx.fillStyle = hsl(45, 30, 94, 0.92 - age)
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI + (i / 8) * Math.PI
      const rr = capW * (0.15 + (i % 3) * 0.3)
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr, cy - capH * 0.55 + Math.sin(a) * capH * 0.35, capW * 0.07, capW * 0.05, 0, 0, 6.28); ctx.fill()
    }
  }
  emitSpore(m, cx, cy + capH * 0.3, capW, 0)
}

function drawPorcini(m) {
  const { ease, age, decay } = env(m)
  if (decay > 0.6) return
  const gx = m.x, stemH = m.h * 0.7 * ease
  const topY = ground - stemH, lean = m.lean * stemH * 0.5
  const sw = m.cw * 0.28 // fat pot-bellied stem
  stemPath(gx, ground, topY + stemH * 0.15, sw, lean, 1.35)
  const sg = ctx.createLinearGradient(gx - sw, 0, gx + sw, 0)
  sg.addColorStop(0, hsl(34, 26, 58 - age * 16))
  sg.addColorStop(0.5, hsl(36, 30, 74 - age * 16))
  sg.addColorStop(1, hsl(34, 26, 54 - age * 16))
  ctx.fillStyle = sg; ctx.fill()
  const cx = gx + lean, cy = topY + stemH * 0.15
  const capW = m.cw * (0.5 + ease * 0.7)
  const capH = capW * 0.62
  // pale spongy pore layer just under the cap
  ctx.fillStyle = hsl(46, 40, 74 - age * 18)
  ctx.beginPath(); ctx.ellipse(cx, cy - capH * 0.1, capW, capH * 0.4, 0, 0, Math.PI); ctx.fill()
  // brown bulbous cap (bun)
  ctx.beginPath()
  ctx.moveTo(cx - capW, cy - capH * 0.1)
  ctx.bezierCurveTo(cx - capW, cy - capH * 1.3, cx + capW, cy - capH * 1.3, cx + capW, cy - capH * 0.1)
  ctx.closePath()
  const g = ctx.createRadialGradient(cx - capW * 0.3, cy - capH, capW * 0.1, cx, cy - capH * 0.5, capW * 1.2)
  g.addColorStop(0, hsl(28 + m.tint, 42, 46 - age * 18))
  g.addColorStop(0.7, hsl(24 + m.tint, 46, 34 - age * 16))
  g.addColorStop(1, hsl(20, 44, 24 - age * 12))
  ctx.fillStyle = g; ctx.fill()
  // glossy sheen
  if (age < 0.4) { ctx.fillStyle = hsl(40, 40, 80, 0.14 * params.damp); ctx.beginPath(); ctx.ellipse(cx - capW * 0.3, cy - capH * 0.9, capW * 0.3, capH * 0.18, -0.4, 0, 6.28); ctx.fill() }
  emitSpore(m, cx, cy, capW, 26)
}

function drawInkcap(m) {
  const { ease, age, decay } = env(m)
  if (decay > 0.7) return
  const gx = m.x, stemH = m.h * 1.5 * ease
  const topY = ground - stemH, lean = m.lean * stemH
  const sw = m.cw * 0.1
  stemPath(gx, ground, topY, sw, lean, 1.2)
  ctx.fillStyle = hsl(44, 10, 90 - age * 24); ctx.fill()
  const cx = gx + lean, cy = topY
  const capW = m.cw * (0.34 + ease * 0.18)
  const capH = capW * (2.2 - age * 0.8) // tall shaggy bell that shrinks with age
  // white bell
  ctx.beginPath()
  ctx.moveTo(cx - capW, cy)
  ctx.quadraticCurveTo(cx - capW, cy - capH, cx, cy - capH)
  ctx.quadraticCurveTo(cx + capW, cy - capH, cx + capW, cy)
  ctx.closePath()
  ctx.fillStyle = hsl(44, 12, 88 - age * 30); ctx.fill()
  // shaggy scales
  ctx.fillStyle = hsl(36, 18, 70 - age * 26)
  for (let i = 0; i < 14; i++) {
    const yy = cy - capH * (0.15 + (i % 7) / 7 * 0.8)
    const xx = cx + (i % 2 ? 1 : -1) * capW * (0.2 + (i % 4) * 0.18)
    ctx.beginPath(); ctx.ellipse(xx, yy, capW * 0.14, capH * 0.05, 0.2, 0, 6.28); ctx.fill()
  }
  // deliquescence: the rim liquefies into black ink and drips
  if (age > 0.3) {
    ctx.fillStyle = hsl(280, 25, 8, Math.min(0.9, age))
    ctx.beginPath(); ctx.ellipse(cx, cy, capW, capH * 0.14, 0, 0, Math.PI); ctx.fill()
    for (let i = -2; i <= 2; i++) {
      const dx = cx + i * capW * 0.45
      ctx.beginPath(); ctx.ellipse(dx, cy + age * capH * 0.4, capW * 0.06, capH * 0.3 * age, 0, 0, 6.28); ctx.fill()
    }
  }
  emitSpore(m, cx, cy, capW, 280)
}

function drawOyster(m) {
  const { ease, age, decay } = env(m)
  if (decay > 0.6) return
  const cx = m.x, baseY = ground - m.h * 0.28 * ease
  // a clustered stack of offset fan shelves sharing a low origin
  for (let k = 0; k < m.clump; k++) {
    const off = (k - (m.clump - 1) / 2)
    const fx = cx + off * m.cw * 0.5 * m.side
    const fy = baseY - k * m.cw * 0.42 * ease
    const fw = m.cw * (0.7 + ease * 0.5) * (1 - k * 0.12)
    const fh = fw * 0.72
    ctx.beginPath()
    ctx.ellipse(fx, fy, fw, fh, 0.15 * m.side, Math.PI * 0.95, Math.PI * 2.2)
    ctx.closePath()
    const g = ctx.createLinearGradient(fx, fy - fh, fx, fy + fh)
    g.addColorStop(0, hsl(34 + m.tint, 16, 74 - age * 26))
    g.addColorStop(1, hsl(32 + m.tint, 14, 46 - age * 22))
    ctx.fillStyle = g; ctx.fill()
    // fine radiating gills on the underside
    ctx.strokeStyle = hsl(34, 12, 40 - age * 16, 0.5)
    ctx.lineWidth = 1 * PR
    for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(fx - fw * 0.9 * m.side, fy + fh * 0.3); ctx.lineTo(fx + i * fw * 0.18, fy + fh * 0.7); ctx.stroke() }
  }
  emitSpore(m, cx, baseY, m.cw, 40)
}

function drawChanterelle(m) {
  const { ease, age, decay } = env(m)
  if (decay > 0.6) return
  const gx = m.x, stemH = m.h * 0.7 * ease
  const topY = ground - stemH, lean = m.lean * stemH
  const capW = m.cw * (0.4 + ease * 0.5)
  // golden trumpet: stem flows up into a wavy funnel cap with false-gill ridges
  ctx.beginPath()
  ctx.moveTo(gx - m.cw * 0.1, ground)
  ctx.quadraticCurveTo(gx - m.cw * 0.14 + lean, topY + stemH * 0.4, gx - capW + lean, topY)
  // wavy cap edge
  const n = 6
  for (let i = 0; i <= n; i++) {
    const px = gx - capW + lean + (i / n) * capW * 2
    const py = topY + Math.sin(i * 1.7 + m.tint) * capW * 0.12 - capW * 0.12
    ctx.lineTo(px, py)
  }
  ctx.quadraticCurveTo(gx + m.cw * 0.14 + lean, topY + stemH * 0.4, gx + m.cw * 0.1, ground)
  ctx.closePath()
  const g = ctx.createLinearGradient(gx - capW, topY, gx + capW, ground)
  g.addColorStop(0, hsl(42 + m.tint, 88, 62 - age * 22))
  g.addColorStop(0.6, hsl(38 + m.tint, 90, 52 - age * 22))
  g.addColorStop(1, hsl(34, 80, 40 - age * 18))
  ctx.fillStyle = g; ctx.fill()
  // false gills running down the funnel
  ctx.strokeStyle = hsl(36, 70, 44 - age * 16, 0.5)
  ctx.lineWidth = 1 * PR
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(gx + lean + i * capW * 0.22, topY); ctx.lineTo(gx + i * m.cw * 0.05, ground); ctx.stroke() }
  emitSpore(m, gx + lean, topY, capW, 42)
}

function drawPolypore(m) {
  const { ease, age } = env(m)
  // tiered brackets fanning out from a low point on buried wood — no real stem
  const bx = m.x, tiers = m.tier
  for (let k = 0; k < tiers; k++) {
    const fy = ground - 6 * PR - k * m.cw * 0.5 * ease
    const fw = m.cw * (0.9 + ease * 0.7) * (1 - k * 0.14)
    const fh = fw * 0.5
    const dir = m.side
    // half-fan bracket
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(bx, fy)
    ctx.quadraticCurveTo(bx + dir * fw * 0.6, fy - fh, bx + dir * fw, fy - fh * 0.2)
    ctx.quadraticCurveTo(bx + dir * fw, fy + fh * 0.3, bx + dir * fw * 0.7, fy + fh * 0.35)
    ctx.quadraticCurveTo(bx + dir * fw * 0.4, fy + fh * 0.2, bx, fy + fh * 0.1)
    ctx.closePath()
    ctx.clip()
    // concentric colour zones (turkey-tail banding)
    const bands = 6
    for (let b = bands; b >= 0; b--) {
      const rr = fw * (b / bands)
      const hue = 28 + (b % 2) * 8 + m.tint
      const lig = 30 + (b % 2) * 22 + (1 - b / bands) * 14 - age * 12
      ctx.fillStyle = hsl(hue, 30 - (b % 2) * 14, lig)
      ctx.beginPath(); ctx.ellipse(bx, fy, rr, rr * 0.7, 0, 0, 6.28); ctx.fill()
    }
    // cream growing edge
    ctx.strokeStyle = hsl(45, 30, 82 - age * 20)
    ctx.lineWidth = 2 * PR
    ctx.beginPath(); ctx.ellipse(bx, fy, fw, fh, 0, dir > 0 ? -1.1 : 2.0, dir > 0 ? 1.1 : 4.28); ctx.stroke()
    ctx.restore()
  }
  emitSpore(m, bx + m.side * m.cw * 0.5, ground - 6 * PR, m.cw, 34)
}

const DRAW = {
  flyAgaric: drawFlyAgaric, porcini: drawPorcini, inkcap: drawInkcap,
  oyster: drawOyster, chanterelle: drawChanterelle, polypore: drawPolypore,
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const g = params.growth

  growMyc(dt * g)

  if (rt.rng() < 0.02 * params.flush * g && shrooms.length < 26 * params.flush) spawnShroom(rt.random(W * 0.05, W * 0.95))
  for (let i = shrooms.length - 1; i >= 0; i--) {
    const m = shrooms[i]
    m.g += dt * 0.06 * g * m.rate
    if (m.g > 2.5) shrooms.splice(i, 1)
  }

  // air + substrate
  const air = ctx.createLinearGradient(0, 0, 0, ground)
  air.addColorStop(0, '#0a0d10')
  air.addColorStop(1, `hsl(150, 12%, ${9 + params.damp * 4}%)`)
  ctx.fillStyle = air; ctx.fillRect(0, 0, W, ground)
  const soil = ctx.createLinearGradient(0, ground, 0, H)
  soil.addColorStop(0, `hsl(28, 34%, ${16 + params.damp * 6}%)`)
  soil.addColorStop(1, `hsl(24, 40%, ${6 + params.damp * 3}%)`)
  ctx.fillStyle = soil; ctx.fillRect(0, ground, W, H - ground)

  // mycelium web
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.5 + params.damp * 0.5
  ctx.drawImage(myc, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  ctx.fillStyle = 'rgba(20,14,6,0.5)'
  ctx.fillRect(0, ground - 2 * PR, W, 4 * PR)

  // draw shorter fruiting bodies behind taller ones
  shrooms.sort((a, b) => a.h - b.h)
  for (const m of shrooms) DRAW[m.key](m)

  // drifting spores
  ctx.globalCompositeOperation = 'lighter'
  for (let i = spores.length - 1; i >= 0; i--) {
    const s = spores[i]
    s.x += s.vx * dt; s.y += s.vy * dt; s.vx += Math.sin(t + s.y * 0.01) * 2 * PR * dt; s.life -= dt * 0.35
    if (s.life <= 0 || s.y > H) { spores.splice(i, 1); continue }
    ctx.fillStyle = hsl(s.hue, 30, 70, s.life * 0.5)
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.3 * PR, 0, 6.28); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
