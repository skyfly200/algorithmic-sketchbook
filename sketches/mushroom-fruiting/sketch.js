// Mushroom Fruiting — a colony seen from the side. Mycelium spreads as a
// branching web of fine hyphae through the substrate; where the web thickens,
// pins emerge and fruit: the stem elongates, the cap swells from a button to a
// domed then flattened cap, gills darken, and mature caps drop drifting spores.
// Caps then age — flattening, darkening, curling — and wither back into the
// litter. Click to inoculate a fresh flush; beats trigger a colony-wide flush.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  flush: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fruiting density' },
  size: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Mushroom size' },
  species: { value: 'Mixed', type: 'select', options: ['Mixed', 'Toadstool', 'Porcini', 'Inkcap', 'Oyster'], label: 'Species' },
  spores: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Spore release' },
  spread: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Mycelium spread' },
  damp: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Substrate damp' },
})
rt.mapInput('audio.level', 'growth', 0.3)

let W = 0, H = 0, PR = 1, ground = 0
// persistent mycelium layer (threads accumulate here, faintly fading)
const myc = document.createElement('canvas')
const mctx = myc.getContext('2d')

const SPECIES = {
  Toadstool: { cap: [4, 82, 52], spots: true, stem: [40, 20, 88], domed: 1, tall: 1, deliq: 0 },
  Porcini: { cap: [26, 45, 40], spots: false, stem: [34, 28, 78], domed: 1.1, tall: 0.8, deliq: 0 },
  Inkcap: { cap: [40, 12, 78], spots: false, stem: [44, 10, 90], domed: 0.35, tall: 1.7, deliq: 1 },
  Oyster: { cap: [34, 18, 70], spots: false, stem: [40, 12, 82], domed: 0.5, tall: 0.5, deliq: 0, fan: 1 },
}
const SPKEYS = ['Toadstool', 'Porcini', 'Inkcap', 'Oyster']
function pickSpecies() {
  if (params.species !== 'Mixed') return params.species
  return SPKEYS[(rt.rng() * SPKEYS.length) | 0]
}

let tips = []       // growing mycelium hyphae tips
let shrooms = []    // fruiting bodies
const spores = []   // drifting spore particles

function seedMycelium(x, y, n) {
  for (let i = 0; i < n; i++) tips.push({ x, y, a: rt.random(0, 6.28), life: rt.random(60, 200), vigor: rt.random(0.6, 1) })
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  ground = H * 0.72 // substrate surface line
  myc.width = W; myc.height = H
  mctx.clearRect(0, 0, W, H)
  tips = []; shrooms = []; spores.length = 0
  // inoculate a few starting points along the substrate
  for (let i = 0; i < 5; i++) seedMycelium(rt.random(W * 0.1, W * 0.9), rt.random(ground + 6 * PR, H - 8 * PR), 3)
}

// grow the mycelium web: wander within the substrate band, branch, deposit thread
function growMyc(dt) {
  const spd = 26 * PR * params.spread
  const next = []
  for (const tp of tips) {
    const px = tp.x, py = tp.y
    tp.a += (rt.rng() - 0.5) * 2.4 * dt + Math.sin(tp.y * 0.05 + tp.x * 0.01) * 0.02
    tp.x += Math.cos(tp.a) * spd * dt
    tp.y += Math.sin(tp.a) * spd * dt * 0.7
    // keep hyphae inside the substrate band
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
  // keep the colony alive: reseed from a random point when it thins out
  if (tips.length < 20 && rt.rng() < 0.5) seedMycelium(rt.random(W * 0.1, W * 0.9), rt.random(ground + 6 * PR, H - 8 * PR), 2)
  // slowly fade the oldest threads so the web breathes rather than saturating
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = 'rgba(0,0,0,0.006)'
  mctx.fillRect(0, 0, W, H)
  mctx.globalCompositeOperation = 'source-over'
}

function spawnShroom(x, spBoost = 1) {
  const key = pickSpecies()
  const sp = SPECIES[key]
  if (shrooms.length > 26 * params.flush) return
  shrooms.push({
    x, key, sp,
    g: 0,                                  // 0..1 growth, then ages past 1
    h: rt.random(60, 120) * PR * params.size * sp.tall,
    cw: rt.random(34, 62) * PR * params.size,
    lean: rt.random(-0.12, 0.12),
    hue: sp.cap[0] + rt.random(-6, 6),
    rate: rt.random(0.7, 1.2) * spBoost,
    spored: 0,
  })
}

const ptr = { x: 0, y: 0, down: false }
function onDown(e) {
  const x = e.clientX * PR, y = e.clientY * PR
  seedMycelium(x, Math.max(ground + 6 * PR, y), 5)
  for (let i = 0; i < 3; i++) spawnShroom(x + rt.random(-40, 40) * PR, 1.4)
}
window.addEventListener('pointerdown', onDown)
rt.onBeat(({ energy }) => { // beat → a flush across the colony
  const n = 2 + (energy * 4 | 0)
  for (let i = 0; i < n; i++) spawnShroom(rt.random(W * 0.08, W * 0.92), 1.3)
})

// --- drawing ---------------------------------------------------------------
function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})` }

function drawShroom(m, t) {
  const sp = m.sp
  const gx = m.x
  // growth envelope: 0→1 rise, plateau, then age (cap flattens & darkens)
  const grow = Math.min(1, m.g)
  const age = Math.max(0, m.g - 1) // 0..~1 aging
  const decay = Math.max(0, m.g - 1.9)
  if (decay > 0.6) return
  const ease = grow * grow * (3 - 2 * grow)
  const stemH = m.h * ease * (1 - decay * 0.5)
  const topY = ground - stemH
  const lean = m.lean * stemH
  const wilt = age * 0.5

  // gills / underside shadow first (behind cap)
  const capW = m.cw * (0.35 + ease * 0.65) * (1 + age * 0.15)
  const dome = sp.domed * (1 - age * 0.7) // cap flattens with age

  // stem — tapered, slightly leaning, gently curved
  ctx.save()
  const sw = Math.max(2 * PR, capW * 0.16)
  ctx.beginPath()
  ctx.moveTo(gx - sw * 0.6, ground)
  ctx.quadraticCurveTo(gx - sw * 0.4 + lean * 0.5, topY + stemH * 0.4, gx - sw * 0.35 + lean, topY)
  ctx.lineTo(gx + sw * 0.35 + lean, topY)
  ctx.quadraticCurveTo(gx + sw * 0.4 + lean * 0.5, topY + stemH * 0.4, gx + sw * 0.6, ground)
  ctx.closePath()
  const sg = ctx.createLinearGradient(gx - sw, 0, gx + sw, 0)
  sg.addColorStop(0, hsl(sp.stem[0], sp.stem[1], sp.stem[2] * 0.7 - age * 20))
  sg.addColorStop(0.5, hsl(sp.stem[0], sp.stem[1], sp.stem[2] - age * 22))
  sg.addColorStop(1, hsl(sp.stem[0], sp.stem[1], sp.stem[2] * 0.6 - age * 20))
  ctx.fillStyle = sg
  ctx.fill()
  ctx.restore()

  const cx = gx + lean
  const cy = topY + wilt * capW * 0.2
  if (capW < 1) return

  // Ink caps deliquesce: the aging bell dissolves into black drips
  const capH = capW * (0.5 + dome * 0.7)

  // gills band under the cap
  ctx.save()
  ctx.beginPath(); ctx.ellipse(cx, cy, capW, capH * 0.5, 0, 0, Math.PI); ctx.clip()
  ctx.fillStyle = hsl(sp.cap[0], 25, 20 - age * 8, 0.9)
  ctx.fillRect(cx - capW, cy - 2, capW * 2, capH)
  // radial gill lines
  ctx.strokeStyle = hsl(sp.cap[0], 20, 12, 0.5)
  ctx.lineWidth = 1 * PR
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + i * capW * 0.16, cy + capH * 0.6); ctx.stroke()
  }
  ctx.restore()

  // the cap — a dome that flattens (and for inkcaps, a tall bell) with age
  ctx.save()
  ctx.beginPath()
  if (sp.fan) {
    // oyster: an offset fan/shelf rather than a symmetric cap
    ctx.ellipse(cx, cy, capW, capH * 0.7, -0.2, Math.PI * 0.9, Math.PI * 2.15)
  } else {
    ctx.moveTo(cx - capW, cy)
    ctx.quadraticCurveTo(cx - capW * 0.5, cy - capH * (1 + dome), cx, cy - capH * (0.9 + dome))
    ctx.quadraticCurveTo(cx + capW * 0.5, cy - capH * (1 + dome), cx + capW, cy)
    // rim curls up as it ages
    ctx.quadraticCurveTo(cx, cy + wilt * capH * 0.5, cx - capW, cy)
  }
  ctx.closePath()
  const light = sp.cap[2] - age * 30 - decay * 30
  const cg = ctx.createRadialGradient(cx - capW * 0.3, cy - capH, capW * 0.1, cx, cy - capH * 0.3, capW * 1.3)
  cg.addColorStop(0, hsl(m.hue, sp.cap[1], Math.min(90, light + 22)))
  cg.addColorStop(0.6, hsl(m.hue, sp.cap[1], Math.max(6, light)))
  cg.addColorStop(1, hsl(m.hue, sp.cap[1] * 0.8, Math.max(4, light - 16)))
  ctx.fillStyle = cg
  ctx.fill()
  // toadstool white warts
  if (sp.spots && age < 0.6) {
    ctx.fillStyle = `hsla(45,30%,92%,${0.9 - age})`
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + (i / 6) * Math.PI
      const rr = capW * (0.2 + (i % 2) * 0.45)
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr, cy - capH * 0.6 + Math.sin(a) * capH * 0.3, capW * 0.07, capW * 0.05, 0, 0, 6.28); ctx.fill()
    }
  }
  // specular sheen on a fresh damp cap
  if (age < 0.3) {
    ctx.fillStyle = `hsla(45,40%,96%,${0.18 * (1 - age / 0.3) * params.damp})`
    ctx.beginPath(); ctx.ellipse(cx - capW * 0.3, cy - capH * 0.9, capW * 0.28, capH * 0.2, -0.4, 0, 6.28); ctx.fill()
  }
  ctx.restore()

  // inkcap deliquescence: black drips off the rim as it dissolves
  if (sp.deliq && age > 0.3) {
    ctx.fillStyle = `hsla(280,20%,8%,${Math.min(0.85, age)})`
    for (let i = -2; i <= 2; i++) {
      const dx = cx + i * capW * 0.4
      ctx.beginPath(); ctx.ellipse(dx, cy + age * capH * 0.6, capW * 0.06, capH * 0.4 * age, 0, 0, 6.28); ctx.fill()
    }
  }

  // release spores from a mature cap
  if (m.g > 0.95 && m.g < 1.7 && params.spores > 0 && rt.rng() < params.spores * 0.4) {
    spores.push({ x: cx + rt.random(-capW * 0.7, capW * 0.7), y: cy + capH * 0.3, vy: rt.random(6, 16) * PR, vx: rt.random(-4, 4) * PR, life: 1, hue: m.hue })
  }
}

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const g = params.growth

  growMyc(dt * g)

  // occasionally fruit where the mycelium is established
  if (rt.rng() < 0.02 * params.flush * g && shrooms.length < 26 * params.flush) {
    spawnShroom(rt.random(W * 0.05, W * 0.95))
  }
  for (let i = shrooms.length - 1; i >= 0; i--) {
    const m = shrooms[i]
    m.g += dt * 0.06 * g * m.rate
    if (m.g > 2.5) shrooms.splice(i, 1)
  }

  // --- render ---
  // sky/air gradient above the substrate
  const air = ctx.createLinearGradient(0, 0, 0, ground)
  air.addColorStop(0, '#0a0d10')
  air.addColorStop(1, `hsl(150, 12%, ${9 + params.damp * 4}%)`)
  ctx.fillStyle = air
  ctx.fillRect(0, 0, W, ground)
  // substrate soil
  const soil = ctx.createLinearGradient(0, ground, 0, H)
  soil.addColorStop(0, `hsl(28, 34%, ${16 + params.damp * 6}%)`)
  soil.addColorStop(1, `hsl(24, 40%, ${6 + params.damp * 3}%)`)
  ctx.fillStyle = soil
  ctx.fillRect(0, ground, W, H - ground)

  // mycelium web (glows within the damp substrate)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.5 + params.damp * 0.5
  ctx.drawImage(myc, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // a soft leaf-litter line at the surface
  ctx.fillStyle = 'rgba(20,14,6,0.5)'
  ctx.fillRect(0, ground - 2 * PR, W, 4 * PR)

  // mushrooms, back (higher x variance) to front — draw sorted so nearer ones overlap
  shrooms.sort((a, b) => a.h - b.h)
  for (const m of shrooms) drawShroom(m, t)

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
