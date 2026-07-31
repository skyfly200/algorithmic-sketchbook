/**
 * Reishi Spore Cloud — lacquered reishi (lingzhi) growths quietly letting go
 * fine cocoa-brown spores. Grow them as the classic lacquered shelf cantilevering
 * out from the side of a woody trunk, as the branching "antler" (deer-horn) form,
 * or both, and place one to four of them at randomised spots along the ground. The spores stream off the
 * pore surface (or the antler tips) as a fine, laminar flow that shears and
 * curls on slow turbulence, backlit so the dense parts glow golden-brown.
 *
 * Emission, turbulence, rise, wind, iridescence, spore tint and glow are live;
 * the growths can be hidden, and each beat sends up a fresh puff.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  emission: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Emission' },
  turbulence: { value: 0.5, min: 0, max: 1.2, step: 0.02, label: 'Turbulence' },
  rise: { value: 0.5, min: -0.4, max: 1, step: 0.02, label: 'Rise / settle' },
  wind: { value: -0.2, min: -1, max: 1, step: 0.02, label: 'Wind' },
  conks: { value: 1, min: 1, max: 4, step: 1, label: 'Conks' },
  form: { value: 'Trunk', type: 'select', options: ['Trunk', 'Antler', 'Both'], label: 'Growth form' },
  iridescence: { value: 0.2, min: 0, max: 1, step: 0.02, label: 'Iridescent glimmer' },
  hue: { value: 32, min: 12, max: 48, step: 1, label: 'Spore tint' },
  glow: { value: 1, min: 0.4, max: 1.8, step: 0.05, label: 'Glow' },
  mushroom: { value: true, type: 'bool', label: 'Show growths' },
})
rt.mapInput('audio.level', 'emission', 0.5)

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1

// Fine spore sprite — a tight soft dot; many overlap into a laminar veil.
const sprite = document.createElement('canvas')
let lastHue = -1
function buildSprite() {
  const h = params.hue
  const s = 48; sprite.width = s; sprite.height = s
  const g = sprite.getContext('2d')
  g.clearRect(0, 0, s, s)
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  rg.addColorStop(0, `hsla(${h},30%,90%,0.5)`)
  rg.addColorStop(0.5, `hsla(${h},26%,82%,0.12)`)
  rg.addColorStop(1, `hsla(${h},22%,74%,0)`)
  g.fillStyle = rg; g.fillRect(0, 0, s, s)
  lastHue = h
}
buildSprite()

// --- growth definitions (stable across resizes; regenerated on param change) -
let conkDefs = []
let conks = []
let defSig = ''
function chooseForm(i) {
  const f = params.form
  if (f === 'Both') return (i % 2 === 0) ? 'Trunk' : 'Antler'
  return f
}
// A branching antler in normalised coords (base at 0,0, growing up = -y).
function growAntler(x, y, ang, len, w, depth, segs, tips) {
  const x1 = x + Math.sin(ang) * len, y1 = y - Math.cos(ang) * len
  segs.push({ x0: x, y0: y, x1, y1, w0: w, w1: w * 0.72 })
  if (depth <= 0 || len < 0.05) { tips.push({ x: x1, y: y1 }); return }
  const n = rt.rng() < 0.35 ? 3 : 2
  for (let b = 0; b < n; b++) {
    const spread = (b - (n - 1) / 2) * 0.5 + rt.random(-0.18, 0.18)
    growAntler(x1, y1, ang + spread, len * rt.random(0.62, 0.82), w * 0.72, depth - 1, segs, tips)
  }
}
function buildConkDefs() {
  const n = Math.round(params.conks)
  defSig = n + params.form
  conkDefs = []
  for (let i = 0; i < n; i++) {
    const form = chooseForm(i)
    const fx = (0.16 + 0.68 * (i + 0.5) / n) + rt.random(-0.05, 0.05)
    const hf = rt.random(0.12, 0.19)
    const def = { fx, hf, phase: rt.random(0, TAU), form, trunkH: rt.random(0, 1), dir: rt.rng() < 0.5 ? -1 : 1 }
    if (form === 'Antler') {
      def.segs = []; def.tips = []
      const trunks = 1 + (rt.rng() < 0.5 ? 1 : 0)
      for (let k = 0; k < trunks; k++) {
        growAntler(rt.random(-0.08, 0.08) + (k - (trunks - 1) / 2) * 0.18, 0,
          rt.random(-0.18, 0.18), rt.random(0.38, 0.5), 0.11, 4, def.segs, def.tips)
      }
    }
    conkDefs.push(def)
  }
  layoutConks()
}
function layoutConks() {
  const baseY = H * 0.99
  conks = conkDefs.map((d) => {
    const half = Math.min(W, H) * d.hf, thick = half * 0.5
    // the shelf sits partway up a vertical trunk (raised off the ground)
    const raise = d.form === 'Antler' ? 0 : half * (0.9 + (d.trunkH ?? 0) * 0.8)
    const dir = d.dir ?? 1
    const cx = W * d.fx, cy = baseY - thick * 1.2 - raise
    // the trunk stands to one side; the shelf cantilevers out from it
    const trunkX = cx - dir * half * 0.82
    const c = { cx, cy, half, thick, baseY, phase: d.phase, form: d.form, dir, trunkX }
    if (d.form === 'Antler') {
      const S = Math.min(W, H) * 0.62
      c.segs = d.segs.map((s) => ({ x0: cx + s.x0 * S, y0: baseY + s.y0 * S, x1: cx + s.x1 * S, y1: baseY + s.y1 * S, w0: s.w0 * S, w1: s.w1 * S }))
      c.tips = d.tips.map((p) => ({ x: cx + p.x * S, y: baseY + p.y * S }))
    }
    return c
  })
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  if (!conkDefs.length) buildConkDefs()
  else layoutConks()
}

// --- particles: fine spores in a laminar flow -------------------------------
const MAX = 12000
const P = []
let emitAcc = 0
function spawn(n, burst) {
  if (!conks.length) return
  for (let i = 0; i < n; i++) {
    const c = conks[(Math.random() * conks.length) | 0]
    let fx, fy
    if (c.form === 'Antler' && c.tips.length) {
      const tp = c.tips[(Math.random() * c.tips.length) | 0]
      fx = tp.x + rt.random(-1, 1) * c.half * 0.06
      fy = tp.y + rt.random(-1, 1) * c.half * 0.06
    } else {
      fx = c.cx + rt.random(-1, 1) * c.half * 0.85
      fy = c.cy + c.thick * rt.random(0.1, 0.4)
    }
    const p = P.length < MAX ? {} : P[(Math.random() * P.length) | 0]
    p.x = fx; p.y = fy
    // laminar launch: little horizontal spread, a coherent gentle rise
    p.vx = rt.random(-1, 1) * 7 * PR
    p.vy = (burst ? rt.random(-70, -34) : rt.random(-30, -12)) * PR
    p.life = p.max = rt.random(3, 6.5)
    p.sz = rt.random(0.5, 1.7)
    p.irid = rt.rng() < 0.4
    p.ho = rt.random(0, 360)
    if (P.length < MAX) P.push(p)
  }
}
rt.onBeat(({ energy }) => spawn(50 + (energy * 110 | 0), true))

// --- lacquered reishi shelf conk --------------------------------------------
function capPath(g, sc, c) {
  const HW = c.half * sc, HT = c.thick * sc, UD = c.thick * 0.42 * sc
  const n = 56
  g.beginPath()
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI
    const wob = 1 + 0.05 * Math.sin(th * 6 + c.phase) + 0.022 * Math.sin(th * 13 + c.phase * 1.7)
    g.lineTo(c.cx + Math.cos(th) * HW, c.cy - Math.sin(th) * HT * wob)
  }
  for (let i = 1; i <= n; i++) {
    const u = i / n
    g.lineTo(c.cx - HW + 2 * HW * u, c.cy + Math.sin(u * Math.PI) * UD)
  }
  g.closePath()
}
function drawConk(c) {
  const g = ctx
  // the woody trunk the shelf grows from — a vertical log standing to ONE SIDE;
  // the cap cantilevers out from it like a real shelf fungus
  const tw = c.half * 0.16 // trunk half-width
  const tx = c.trunkX
  const trunkTopY = c.cy - c.half * 0.5
  const tg = g.createLinearGradient(tx - tw, 0, tx + tw, 0)
  tg.addColorStop(0, '#100a06'); tg.addColorStop(0.45, '#3a2418'); tg.addColorStop(1, '#0d0704')
  g.fillStyle = tg
  g.beginPath()
  g.moveTo(tx - tw, trunkTopY)
  g.quadraticCurveTo(tx, trunkTopY - tw * 0.8, tx + tw, trunkTopY)
  g.quadraticCurveTo(tx + tw * 1.4, c.baseY, tx + tw * 1.7, c.baseY)
  g.lineTo(tx - tw * 1.7, c.baseY)
  g.quadraticCurveTo(tx - tw * 1.4, c.baseY, tx - tw, trunkTopY)
  g.closePath(); g.fill()

  // tilt the whole cap so its free (outer) end droops away from the trunk
  g.save()
  g.translate(tx, c.cy)
  g.rotate(c.dir * 0.13)
  g.translate(-tx, -c.cy)

  const K = 24
  for (let k = K; k >= 1; k--) {
    const sc = k / K, e2 = Math.pow(sc, 3.0)
    const hue = 10 + e2 * 16, sat = 88 - e2 * 30
    const lig = 24 + Math.pow(sc, 1.5) * 10 + e2 * 55
    g.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`
    capPath(g, sc, c); g.fill()
  }
  g.save(); capPath(g, 0.995, c); g.clip()
  g.fillStyle = 'hsla(44,42%,80%,0.5)'
  g.fillRect(0, c.cy + c.thick * 0.16, W, c.thick * 0.55)
  const lgx = c.cx - c.half * 0.42, lgy = c.cy - c.thick * 0.6
  const dome = g.createRadialGradient(lgx, lgy, 0, lgx, lgy, c.half * 1.5)
  dome.addColorStop(0, 'rgba(255,238,214,0.45)'); dome.addColorStop(0.45, 'rgba(255,225,195,0.08)'); dome.addColorStop(1, 'rgba(255,225,195,0)')
  g.fillStyle = dome; g.fillRect(0, 0, W, H)
  const shx = c.cx + c.half * 0.5, shy = c.cy + c.thick * 0.6
  const shade = g.createRadialGradient(shx, shy, 0, shx, shy, c.half * 1.4)
  shade.addColorStop(0, 'rgba(18,7,3,0.5)'); shade.addColorStop(0.6, 'rgba(18,7,3,0.12)'); shade.addColorStop(1, 'rgba(18,7,3,0)')
  g.fillStyle = shade; g.fillRect(0, 0, W, H)
  g.fillStyle = 'rgba(255,250,236,0.6)'
  g.beginPath(); g.ellipse(lgx + c.half * 0.16, lgy + c.thick * 0.05, c.half * 0.16, c.thick * 0.12, -0.5, 0, TAU); g.fill()
  for (let r = 0.26; r < 0.99; r += 0.085) {
    g.save(); g.translate(0, PR * 1.3); g.strokeStyle = 'rgba(26,10,5,0.3)'; g.lineWidth = Math.max(1, PR * 1.4); capPath(g, r, c); g.stroke(); g.restore()
    g.save(); g.translate(0, -PR * 1.0); g.strokeStyle = 'rgba(255,224,186,0.16)'; g.lineWidth = Math.max(1, PR); capPath(g, r, c); g.stroke(); g.restore()
  }
  g.restore()
  g.strokeStyle = 'hsla(40,35%,95%,0.98)'; g.lineWidth = Math.max(2.5, PR * 4)
  capPath(g, 1, c); g.stroke()
  g.strokeStyle = 'hsla(42,45%,88%,0.6)'; g.lineWidth = Math.max(1.5, PR * 2)
  capPath(g, 0.95, c); g.stroke()
  g.restore()
}

// --- antler (deer-horn) form: branching red lacquered fingers ---------------
function drawAntler(c) {
  const g = ctx
  g.lineCap = 'round'; g.lineJoin = 'round'
  // two passes: dark base then lacquered top so branches read rounded
  for (const seg of c.segs) {
    // vertical gradient: mahogany base → red-orange, with a white growing tip
    const up = 1 - Math.min(1, (c.baseY - seg.y1) / (Math.min(W, H) * 0.55)) // 0 top … 1 base
    const grd = g.createLinearGradient(seg.x0, seg.y0, seg.x1, seg.y1)
    grd.addColorStop(0, `hsl(${8 + up * 4}, 80%, ${16 + (1 - up) * 8}%)`)
    grd.addColorStop(1, `hsl(${14 + (1 - up) * 22}, 88%, ${28 + (1 - up) * 26}%)`)
    g.strokeStyle = grd
    g.lineWidth = Math.max(1.5, seg.w0)
    g.beginPath(); g.moveTo(seg.x0, seg.y0); g.lineTo(seg.x1, seg.y1); g.stroke()
    // specular sheen line offset up-left
    g.strokeStyle = 'rgba(255,220,180,0.18)'
    g.lineWidth = Math.max(1, seg.w0 * 0.3)
    g.beginPath(); g.moveTo(seg.x0 - seg.w0 * 0.18, seg.y0 - seg.w0 * 0.1); g.lineTo(seg.x1 - seg.w1 * 0.18, seg.y1 - seg.w1 * 0.1); g.stroke()
  }
  // pale waxy growing tips
  for (const tp of c.tips) {
    g.fillStyle = 'hsla(40,45%,92%,0.95)'
    g.beginPath(); g.arc(tp.x, tp.y, Math.max(2, c.half * 0.05), 0, TAU); g.fill()
    g.fillStyle = 'hsla(30,70%,60%,0.4)'
    g.beginPath(); g.arc(tp.x, tp.y + c.half * 0.03, Math.max(2.5, c.half * 0.07), 0, TAU); g.fill()
  }
}

function drawGrowths() {
  // paint back-to-front (higher on screen = further, drawn first)
  const order = [...conks].sort((a, b) => a.baseY - b.baseY)
  for (const c of order) c.form === 'Antler' ? drawAntler(c) : drawConk(c)
}

let last = 0
function frame(now) {
  rt.tick(now)
  if (params.hue !== lastHue) buildSprite()
  const sig = Math.round(params.conks) + params.form
  if (sig !== defSig) buildConkDefs()
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now

  emitAcc += params.emission * 55 * dt
  const em = emitAcc | 0; emitAcc -= em
  if (em > 0) spawn(em, false)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#070503'; ctx.fillRect(0, 0, W, H)
  for (const c of conks) {
    const beam = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, Math.min(W, H) * 0.55)
    beam.addColorStop(0, 'rgba(50,34,20,0.22)'); beam.addColorStop(1, 'rgba(10,7,4,0)')
    ctx.fillStyle = beam; ctx.fillRect(0, 0, W, H)
  }

  if (params.mushroom) drawGrowths()

  // spore cloud: fine spores drifting on a laminar flow field + turbulence
  ctx.globalCompositeOperation = 'lighter'
  const turb = params.turbulence, wind = params.wind * 22 * PR, rise = params.rise
  const glow = params.glow, irid = params.iridescence
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]
    // laminar base: a slow, height-layered horizontal shear (coherent sheets)
    const lam = Math.sin(p.y * 0.006 + t * 0.4) * 6 * PR
    // finer turbulent curl on top
    const tnx = Math.sin(p.y * 0.02 + p.x * 0.014 + t * 0.9)
    const tny = Math.cos(p.x * 0.02 - t * 0.7)
    p.vx += (lam + tnx * turb * 30 * PR + wind) * dt
    p.vy += (-rise * 44 * PR + tny * turb * 18 * PR) * dt
    p.vx *= 0.972; p.vy *= 0.972
    p.x += p.vx * dt; p.y += p.vy * dt
    p.life -= dt
    if (p.life <= 0 || p.y < -H * 0.1) { P.splice(i, 1); continue }
    const a = p.life / p.max
    const fade = a * (1 - a) * 4
    const sz = p.sz * (1 + (1 - a) * 1.8) * Math.min(W, H) * 0.014
    ctx.globalAlpha = Math.min(1, fade * 0.14 * glow)
    ctx.drawImage(sprite, p.x - sz, p.y - sz, sz * 2, sz * 2)
    if (irid > 0 && p.irid && a > 0.2) {
      ctx.globalAlpha = Math.min(1, fade * irid * 0.9)
      ctx.fillStyle = `hsl(${(t * 80 + p.ho) % 360}, 90%, 72%)`
      ctx.beginPath(); ctx.arc(p.x, p.y, PR * (0.7 + p.sz), 0, TAU); ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
