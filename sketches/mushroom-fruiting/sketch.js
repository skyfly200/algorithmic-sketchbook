// Mushroom Fruiting — a slow walk through a Colorado forest floor, seen from low
// down. Mycelium threads through the soil; fruiting bodies are generated from
// per-fruit genomes (porcini, fly agaric, oyster, lion's mane, turkey tail,
// psilocybe, marasmius, mycena, xylaria, eyelash cups, wood ear, cordyceps ...
// plus fully "imaginary" ones). Every fruit meets an end: it rots, dries out,
// deliquesces, is eaten by slugs and deer, or gets picked. Dead aspens, cottonwoods,
// oaks, pines, spruces and firs stand as snags, fall, and crumble into the
// forest floor, hosting the wood fungi while they do. The camera drifts sideways
// through the woods, wind carries the spores, and fruits are spaced to avoid overlap.
import { createRuntime } from '../_lib/runtime.js'
import { TAU, clamp, lerp, smooth, mulberry, hsl, pickOf } from './util.js'
import { SPECIES, SPECIES_KEYS, makeGenome } from './genomes.js'
import { TREES, TREE_KEYS, STAGES, newPlan, thickAt, bakeTrunk } from './wood.js'
import { ENV, NOFX, bakeFruit } from './paint.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const speciesParams = {}
for (const k of SPECIES_KEYS) speciesParams[k] = { value: true, type: 'bool', label: SPECIES[k].label }

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Life speed' },
  flush: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fruiting density' },
  spacing: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Spacing (less overlap)' },
  size: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Mushroom size' },
  variation: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Variation' },
  scroll: { value: 0.4, min: -1, max: 1, step: 0.02, label: 'Side scroll' },
  wind: { value: 0.2, min: -1, max: 1, step: 0.02, label: 'Wind' },
  spores: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Spore release' },
  grazing: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Slugs & deer eating' },
  foraging: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Foragers picking' },
  deadwood: { value: 1, min: 0, max: 2, step: 0.05, label: 'Dead trees' },
  woodDecay: { value: 1, min: 0.2, max: 4, step: 0.05, label: 'Wood decay speed' },
  spread: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Mycelium spread' },
  damp: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Substrate damp' },
  light: { value: -0.4, min: -1, max: 1, step: 0.02, label: 'Light direction' },
  mist: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Depth mist' },
  glow: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Bioluminescence' },
  ...speciesParams,
})
rt.mapInput('audio.level', 'growth', 0.3)
rt.mapInput('beat.pulse', 'glow', 0.3)

const QS = new URLSearchParams(location.search)
const TEST = { only: QS.get('only'), spec: QS.get('specimens'), fate: QS.get('fate'), trees: QS.get('trees'), standing: QS.get('standing'), fall: QS.get('fall') }
const FROZEN = !!(TEST.spec || TEST.trees != null || TEST.fall != null)

const FATE_WORDS = { rot: 'rotting', dry: 'drying out', deliq: 'deliquescing', eaten: 'being eaten', picked: 'picked' }
const RIGID = new Set(['polypore', 'turkeytail', 'xylaria', 'auricularia', 'scutellinia'])

function pickSpecies() {
  const on = SPECIES_KEYS.filter((k) => params[k])
  const list = on.length ? on : SPECIES_KEYS
  return list[(rt.rng() * list.length) | 0]
}

// --- state ---------------------------------------------------------------------------
let W = 0, H = 0, PR = 1, ground = 0, farY = 0, unit = 1
let cam = 0, camV = 0, simT = 0
const pf = (z) => 1 - 0.35 * z // parallax factor of a depth
const WOOD_SCALE = 1.5 // trees are drawn bigger than the mushroom unit so a log dwarfs a cap
function depthOf(z) { return { y: lerp(ground - H * 0.006, farY + H * 0.004, z), s: 1 - z * 0.55 } }
const scrX = (x, z) => x - cam * pf(z)

const pool = []
function getCanvas() { return pool.pop() || document.createElement('canvas') }
let fruits = []
let woods = []
let ghosts = []
const parts = []
let label = null
let tips = []

const myc = document.createElement('canvas'), mctx = myc.getContext('2d')
const bgLayers = [0, 1, 2].map(() => { const cv = document.createElement('canvas'); return { cv, x: cv.getContext('2d') } })
const bgGround = document.createElement('canvas'), bgGroundX = bgGround.getContext('2d')
const fg = document.createElement('canvas'), fgx = fg.getContext('2d')
const glowSprite = document.createElement('canvas')
let bgKey = ''

// --- helpers -------------------------------------------------------------------------
function tileDraw(cv, offset, y = 0, alpha = 1, sy = 0) {
  if (alpha <= 0) return
  const o = Math.floor(((offset % W) + W) % W), sh = cv.height - sy
  ctx.globalAlpha = alpha
  ctx.drawImage(cv, o, sy, W - o, sh, 0, y + sy, W - o, sh)
  if (o > 0) ctx.drawImage(cv, 0, sy, o, sh, W - o, y + sy, o, sh)
  ctx.globalAlpha = 1
}

// --- mycelium (tile coordinates, wraps with the world) --------------------------------
function seedMycelium(sx, y, n) {
  const u = (((sx + cam) % W) + W) % W
  for (let i = 0; i < n; i++) tips.push({ x: u, y, a: rt.random(0, 6.28), life: rt.random(60, 200), vigor: rt.random(0.6, 1) })
}
function growMyc(dt) {
  const spd = 26 * PR * params.spread
  const next = []
  mctx.lineWidth = 1 * PR
  for (const tp of tips) {
    const px = tp.x, py = tp.y
    tp.a += (rt.rng() - 0.5) * 2.4 * dt
    tp.x += Math.cos(tp.a) * spd * dt
    tp.y += Math.sin(tp.a) * spd * dt * 0.7
    if (tp.y < ground + 6 * PR) { tp.y = ground + 6 * PR; tp.a = Math.abs(tp.a) }
    if (tp.y > H - 4 * PR) { tp.y = H - 4 * PR; tp.a = -Math.abs(tp.a) }
    let wrapped = false
    if (tp.x < 0) { tp.x += W; wrapped = true } else if (tp.x >= W) { tp.x -= W; wrapped = true }
    if (!wrapped) {
      mctx.strokeStyle = `hsla(40, 30%, 84%, ${0.15 * tp.vigor})`
      mctx.beginPath(); mctx.moveTo(px, py); mctx.lineTo(tp.x, tp.y); mctx.stroke()
    }
    tp.life -= dt * 60
    if (tp.life > 0) {
      next.push(tp)
      if (rt.rng() < 0.02 * params.spread && tips.length < 240) next.push({ x: tp.x, y: tp.y, a: tp.a + rt.random(-1, 1), life: tp.life * 0.7, vigor: tp.vigor * 0.9 })
    }
  }
  tips = next
  if (tips.length < 20 && rt.rng() < 0.5) seedMycelium(rt.random(0, W), rt.random(ground + 6 * PR, H - 8 * PR), 2)
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = 'rgba(0,0,0,0.004)'
  mctx.fillRect(0, 0, W, H)
  mctx.globalCompositeOperation = 'source-over'
}

// --- wood ----------------------------------------------------------------------------
const TREE_WEIGHTS = { aspen: 3, cottonwood: 1, oak: 1.2, lodgepole: 3, ponderosa: 1.5, spruce: 2, douglas: 1.5, fir: 1.5 }
function pickTree() {
  const tot = TREE_KEYS.reduce((a, k) => a + TREE_WEIGHTS[k], 0)
  let v = rt.rng() * tot
  for (const k of TREE_KEYS) { v -= TREE_WEIGHTS[k]; if (v <= 0) return k }
  return TREE_KEYS[0]
}
function makeWood(sp, x, z, state, stage, dir) {
  const r = mulberry((rt.rng() * 4294967296) >>> 0)
  const plan = newPlan(r, sp)
  const w = {
    type: 'wood', sp, plan, x, z, dir: dir || (rt.rng() < 0.5 ? -1 : 1), state, stage, p: 0,
    fallIn: rt.random(25, 90), alpha: 1, fadeIn: 0, dying: 0,
    standCv: null, logCv: null, stumpCv: null, bakedB: -1, bakedKw: 0, bakedSt: '', sx: 0, sxMin: 0, sxMax: 0, dust: false,
  }
  woods.push(w)
  return w
}
function woodExtent(w, sx, kw) {
  const { D, Lfull, Hs } = w.plan
  if (w.state === 'down') {
    const a = sx, b = sx + w.dir * (D / 2 + 0.3 + Lfull - Hs) * kw
    return [Math.min(a, b) - D * kw * 0.5, Math.max(a, b) + D * kw * 0.5]
  }
  return [sx - D * kw, sx + D * kw]
}
function bakeWood(w, d) {
  const kw = unit * d.s * WOOD_SCALE
  const b = Math.round(clamp(w.stage) * (STAGES - 1))
  const st = w.state === 'standing' ? 's' : 'd'
  if (b === w.bakedB && st === w.bakedSt && Math.abs(kw - w.bakedKw) / kw < 0.3) return false
  const plan = w.plan
  if (st === 's') {
    w.standCv = w.standCv || getCanvas()
    bakeTrunk(w.standCv, plan, { len: plan.Lfull, xa: 0, base: 'flare', stage: b / (STAGES - 1), K: kw })
  } else {
    w.logCv = w.logCv || getCanvas(); w.stumpCv = w.stumpCv || getCanvas()
    bakeTrunk(w.logCv, plan, { len: plan.Lfull - plan.Hs, xa: plan.Hs, base: 'jag', stage: b / (STAGES - 1), K: kw })
    bakeTrunk(w.stumpCv, plan, { len: plan.Hs, xa: 0, base: 'flare', stage: b / (STAGES - 1), K: kw })
    if (w.standCv) { pool.push(w.standCv); w.standCv = null }
  }
  w.bakedB = b; w.bakedSt = st; w.bakedKw = kw
  return true
}
function drawPiece(cv, px, py, dir, ang, kw, alpha) {
  const g = cv && cv.__geo
  if (!g) return
  const s = kw / g.K
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(px, py); ctx.scale(dir, 1); ctx.rotate(-ang)
  ctx.drawImage(cv, -g.ox * s, -g.oy * s, g.w * s, g.h * s)
  ctx.restore()
}
function drawWood(w, d, sx) {
  const kw = unit * d.s * WOOD_SCALE, plan = w.plan
  const a = w.alpha * smooth(0, 1, w.fadeIn)
  const haze = w.z * params.mist * 0.5
  if (w.state === 'standing') {
    drawPiece(w.standCv, sx + w.dir * plan.D / 2 * kw, d.y, w.dir, Math.PI / 2, kw, a)
  } else {
    const p = w.state === 'falling' ? w.p : 1
    const ease = p * p * (0.4 + 0.6 * p)
    const px = sx + w.dir * kw * (plan.D / 2 + 0.3 * ease)
    const py = d.y - plan.Hs * kw * (1 - ease)
    drawPiece(w.stumpCv, sx + w.dir * plan.D / 2 * kw, d.y, w.dir, Math.PI / 2, kw, a)
    drawPiece(w.logCv, px, py, w.dir, (Math.PI / 2) * (1 - ease), kw, a)
  }
  if (haze > 0.02) {
    // distance mist over the trunk
    const [x0, x1] = [w.sxMin, w.sxMax]
    ctx.fillStyle = `hsla(160,14%,${12 + params.damp * 4}%,${haze * a * 0.6})`
    ctx.fillRect(x0, d.y - (w.state === 'standing' ? plan.Lfull : plan.D * 1.4) * kw, x1 - x0, (w.state === 'standing' ? plan.Lfull : plan.D * 1.4) * kw)
  }
}
function dustBurst(x, y, n, kw) {
  for (let i = 0; i < n; i++) {
    parts.push({ dust: true, x: x + rt.random(-1.5, 1.5) * kw, y: y - rt.random(0, 0.5) * kw, vx: rt.random(-30, 30) * PR, vy: -rt.random(10, 60) * PR, life: 1, size: rt.random(4, 12) * PR, col: [30, 22, 38] })
  }
}

// --- fruits --------------------------------------------------------------------------
function chooseFate(key) {
  const sp = SPECIES[key]
  const wEat = sp.graze * params.grazing * 1.2
  const wPick = sp.edible * params.foraging * 1.2
  const natTot = Object.values(sp.natural).reduce((a, b) => a + b, 0)
  let v = rt.rng() * (1 + wEat + wPick)
  if (v < wEat) return { kind: 'eaten', start: rt.random(0.5, 1.5), dur: 0.4 }
  v -= wEat
  if (v < wPick) return { kind: 'picked', start: rt.random(0.7, 1.5), dur: 0.03 }
  let n = rt.rng() * natTot, kind = 'rot'
  for (const [k, wt] of Object.entries(sp.natural)) { n -= wt; if (n <= 0) { kind = k; break } }
  const fs = sp.fateStart || [1.15, 1.5]
  return { kind, start: rt.random(fs[0], fs[1]), dur: kind === 'deliq' ? 0.5 : 0.9 }
}
const fxOf = (f) => ({ kind: f.fate.kind, f: clamp((f.g - f.fate.start) / f.fate.dur) })
const endOf = (f) => f.fate.start + f.fate.dur + 0.3

function hostFor(sp, preset) {
  const need = sp.host
  if (!need) return { ok: true }
  const cands = woods.filter((w) => {
    if (w.state !== 'down' || w.dying) return false
    const hard = TREES[w.sp].hard
    if (need.kind === 'hard' && !hard) return false
    if (need.kind === 'soft' && hard) return false
    if (w.stage < need.stage[0] || w.stage > need.stage[1]) return false
    const sx = w.sx
    return sx > -W * 0.1 && sx < W * 1.1
  })
  if (preset) return preset
  if (!cands.length) return { ok: !need.optional ? false : true, none: true }
  const w = pickOf(rt.rng, cands)
  return { ok: true, wood: w }
}

function newFruit(key, x, z, g, opts = {}) {
  const sp = SPECIES[key]
  const seed = (rt.rng() * 4294967296) >>> 0
  const hostInfo = opts.hostInfo || { ok: true }
  const r = mulberry(seed ^ 0x9e37)
  const fdir = rt.rng() < 0.5 ? -1 : 1
  const gen = makeGenome(key, seed, params.variation, { hostOk: !!hostInfo.wood, dir: fdir, ring: !!opts.ring })
  let host = null
  if (hostInfo.wood) {
    const w = hostInfo.wood
    host = w.stage > 0 && rt.rng() < 0.2 && w.plan.Hs > 0.8
      ? { wood: w, kind: 'stump', h: rt.random(0.3, w.plan.Hs * 0.95), fdir }
      : { wood: w, kind: 'log', s: opts.s ?? rt.random(0.05, 0.95), u: rt.random(0.62, 1), fdir }
    z = w.z - 0.001
  }
  const f = {
    type: 'fruit', key, gen, g, rate: sp.rate * rt.random(0.8, 1.2), x, z, seed, texSeed: (r() * 4294967296) >>> 0,
    fate: opts.fate || chooseFate(key), host, canvas: null, bakedG: -1, bakedK: 0, bakedEnv: '', marks: null,
    sx: 0, y: 0, k: 1, rect: null, picked: false, phase: rt.random(0, TAU), alpha: 1, hw: (gen.box.x1 - gen.box.x0) / 2,
  }
  f.sx = host ? hostPos(f).sx : scrX(x, z)
  if (host) f.x = f.sx + cam * pf(f.z)
  fruits.push(f)
  return f
}
function hostPos(f) {
  const w = f.host.wood, d = depthOf(w.z), kw = unit * d.s * WOOD_SCALE, sx = scrX(w.x, w.z), pl = w.plan
  if (f.host.kind === 'log') {
    const logLen = pl.Lfull - pl.Hs
    const px = sx + w.dir * kw * (pl.D / 2 + 0.3)
    const T = thickAt(pl, pl.Hs + f.host.s * logLen, w.stage)
    return { sx: px + w.dir * f.host.s * logLen * kw, y: d.y - T * kw * f.host.u, d }
  }
  const T = thickAt(pl, f.host.h, w.stage)
  const px = sx + w.dir * pl.D / 2 * kw
  return { sx: px - w.dir * T * kw * 0.5 + f.host.fdir * T * kw * 0.42, y: d.y - f.host.h * kw, d }
}

// How badly a candidate fruit at screen x overlaps its neighbours.
function crowdScore(sx, z, hw, host) {
  const allow = (1 - params.spacing) * 0.5
  let pen = 0
  for (const f of fruits) {
    if (!!f.host !== !!host) continue
    if (host && f.host.wood !== host) continue
    if (!host && Math.abs(f.z - z) > 0.16) continue
    const o = (hw + f.hw * unit * depthOf(f.z).s * params.size) * (1 - allow) - Math.abs(f.sx - sx)
    if (o > 0) pen += o
  }
  if (!host) {
    for (const w of woods) {
      if (Math.abs(w.z - z) > 0.12) continue
      if (sx > w.sxMin - hw * 0.3 && sx < w.sxMax + hw * 0.3) pen += hw * 2
    }
  }
  return pen
}

function maxFruits() { return Math.round(22 * params.flush) }
function spawnFruit(opts = {}) {
  if (fruits.length >= maxFruits() && !opts.force) return null
  let key = opts.key, hostInfo = opts.hostInfo
  if (!key) {
    for (let tries = 0; tries < 16; tries++) {
      key = pickSpecies()
      hostInfo = hostFor(SPECIES[key])
      if (hostInfo.ok) break
      key = null
    }
    if (!key) return null
  }
  const sp = SPECIES[key]
  if (!hostInfo) hostInfo = hostFor(sp)
  const g0 = opts.g ?? 0
  if (hostInfo.wood) {
    // try a few spots along the host
    let best = null
    for (let i = 0; i < 6; i++) {
      const f = newFruit(key, 0, 0, g0, { hostInfo, fate: opts.fate })
      f.sx = hostPos(f).sx
      const pen = crowdScore(f.sx, f.z, f.hw * unit * 0.6, hostInfo.wood)
      fruits.pop()
      if (!best || pen < best.pen) best = { pen, s: f.host.kind === 'log' ? f.host.s : null }
      if (pen <= 0) break
    }
    if (best.pen > 0.5 * unit && !opts.force) return null
    const f = newFruit(key, 0, 0, g0, { hostInfo, fate: opts.fate, s: best.s ?? undefined })
    return f
  }
  const x0 = opts.sx
  let best = null
  const entering = Math.abs(params.scroll) > 0.04
  for (let i = 0; i < 14; i++) {
    const z = opts.z ?? rt.rng() ** 1.3 * 0.9
    const d = depthOf(z)
    const hw = 1.6 * unit * d.s * params.size
    let sx = x0
    if (sx == null) {
      sx = entering && rt.rng() < 0.55
        ? (params.scroll > 0 ? rt.random(W * 0.72, W * 0.98) : rt.random(W * 0.02, W * 0.28))
        : rt.random(W * 0.04, W * 0.96)
    } else sx += rt.random(-1, 1) * i * hw * 0.3
    const pen = crowdScore(sx, z, hw, null)
    if (!best || pen < best.pen) best = { pen, sx, z, hw }
    if (pen <= 0) break
  }
  if (!best) return null
  if (best.pen > best.hw * (1 - params.spacing) * 0.6 + 0.01 && !opts.force) return null
  const f = newFruit(key, best.sx + cam * pf(best.z), best.z, g0, { hostInfo, fate: opts.fate, ring: opts.ring })
  if (best.z < 0.5) seedMycelium(best.sx, ground + rt.random(8, 30) * PR, 2)
  return f
}
function spawnRing() {
  const key = 'marasmius'
  const z0 = rt.random(0.05, 0.5), d = depthOf(z0)
  const cx = rt.random(W * 0.25, W * 0.85)
  const n = 8 + ((rt.rng() * 4) | 0)
  const rx = rt.random(3.2, 4.5) * unit * d.s
  const a0 = rt.random(0, TAU)
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + rt.random(-0.12, 0.12)
    const z = clamp(z0 + Math.sin(a) * 0.07)
    spawnFruit({ key, sx: cx + Math.cos(a) * rx, z, g: -rt.random(0, 0.25), ring: true, force: true })
  }
}

// --- fruit sprites -------------------------------------------------------------------
function envKey() { return `${params.light.toFixed(2)}|${(params.damp * 10) | 0}|${(params.mist * 10) | 0}|${params.size.toFixed(2)}` }
function rebake(f, env) {
  const z = f.host ? f.host.wood.z : f.z
  const d = depthOf(z)
  let k = unit * d.s * params.size
  const box = f.gen.box
  const cw = (box.x1 - box.x0) * k, ch = (box.y1 - box.y0) * k
  const lim = 1000
  if (cw > lim || ch > lim) k *= lim / Math.max(cw, ch)
  if (!f.canvas) f.canvas = getCanvas()
  const fx = fxOf(f)
  if (fx.kind === 'picked' && fx.f > 0 && !f.picked && f.canvas.width > 0 && f.bakedG >= 0) {
    // lift the whole fruit away as a ghost, leaving the stub
    const gcv = getCanvas()
    gcv.width = f.canvas.width; gcv.height = f.canvas.height
    gcv.getContext('2d').drawImage(f.canvas, 0, 0)
    ghosts.push({ cv: gcv, gx: f.sx + cam * pf(f.host ? f.host.wood.z : f.z), z: f.host ? f.host.wood.z : f.z, y: f.y, k: f.bakedK, box, t: 0 })
    f.picked = true
  }
  ENV.light = params.light; ENV.damp = params.damp; ENV.detail = rt.detail
  bakeFruit(f, f.canvas, k, Math.max(f.g, 0), fx, z * params.mist * 0.75)
  f.bakedG = f.g; f.bakedK = k; f.bakedEnv = env
}

// --- background (periodic tiles that scroll at different rates) --------------------------
function bakeBackground() {
  const key = `${(params.mist * 20) | 0}|${(params.damp * 20) | 0}`
  if (key === bgKey) return
  bgKey = key
  const r = mulberry(rt.seed ^ 0x51ed)
  const mist = params.mist, damp = params.damp

  // distant trunks: aspens (pale, with dark scars) and conifers (dark, rough)
  const wrap = (x, w, fn) => { fn(x); if (x - w < 0) fn(x + W); if (x + w > W) fn(x - W) }
  bgLayers.forEach((L, layer) => {
    const x = L.x
    x.clearRect(0, 0, W, H)
    if (layer === 0) {
      const air = x.createLinearGradient(0, 0, 0, farY)
      air.addColorStop(0, '#06080b')
      air.addColorStop(1, `hsl(155, 14%, ${9 + damp * 3 + mist * 6}%)`)
      x.fillStyle = air; x.fillRect(0, 0, W, farY + 12 * PR)
    }
    x.save()
    x.filter = `blur(${(3 - layer) * 2.5 * PR}px)`
    const n = 5 + layer * 3
    for (let i = 0; i < n; i++) {
      const cx = r() * W, w = (12 + r() * 40) * PR * (0.5 + layer * 0.4)
      const base = 6 + (2 - layer) * (3 + mist * 6)
      const aspen = r() < 0.4
      const col = aspen ? `hsl(70, 8%, ${base + 7 + layer * 2}%)` : `hsl(${20 + r() * 10}, 14%, ${base - 1}%)`
      const marks = []
      if (aspen) for (let m = 0; m < 14; m++) marks.push([r(), (2 + r() * 5) * PR * (0.6 + layer * 0.3), r()])
      wrap(cx, w, (px) => {
        x.fillStyle = col; x.fillRect(px - w / 2, 0, w, farY + 10 * PR)
        if (aspen) {
          x.fillStyle = `hsl(60, 10%, ${base - 2}%)`
          for (const [mx, mh, my] of marks) x.fillRect(px - w / 2 + mx * w * 0.6, my * farY, w * 0.35, mh)
        }
      })
    }
    x.restore()
    if (layer === 0) {
      x.save(); x.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 4; i++) {
        const sx0 = r() * W, w = (60 + r() * 140) * PR, sk = (0.25 + r() * 0.2) * H
        const gr = x.createLinearGradient(0, 0, 0, farY)
        gr.addColorStop(0, `rgba(200,230,200,${0.05 + mist * 0.05})`); gr.addColorStop(1, 'rgba(200,230,200,0)')
        x.fillStyle = gr
        wrap(sx0, w + sk, (px) => { x.beginPath(); x.moveTo(px, 0); x.lineTo(px + w, 0); x.lineTo(px + w + sk, farY); x.lineTo(px + sk, farY); x.closePath(); x.fill() })
      }
      x.restore()
    }
    if (layer === 2) {
      x.strokeStyle = `hsl(150, 12%, ${6 + mist * 4}%)`; x.lineWidth = 1.5 * PR
      x.beginPath()
      for (let i = 0; i < W / (4 * PR); i++) {
        const px = r() * W, h = (8 + r() * 40) * PR, a = -Math.PI / 2 + (r() - 0.5) * 0.9
        x.moveTo(px, farY + 4 * PR); x.quadraticCurveTo(px + Math.cos(a) * h * 0.5, farY - h * 0.6, px + Math.cos(a) * h, farY + Math.sin(a) * h)
      }
      x.stroke()
    }
  })

  // the ground strip: litter receding, soil cross-section, overhanging leaves
  const g = bgGroundX
  g.clearRect(0, 0, W, H)
  g.save(); g.translate(0, -farY)
  const lit = g.createLinearGradient(0, farY, 0, ground)
  lit.addColorStop(0, `hsl(30, 18%, ${7 + mist * 4}%)`); lit.addColorStop(1, `hsl(28, 32%, ${13 + damp * 4}%)`)
  g.fillStyle = lit; g.fillRect(-4, farY, W + 8, ground - farY + 1)
  const leaf = (px, py, s) => {
    g.save(); g.translate(px, py); g.scale(1, 0.35); g.rotate(r() * TAU)
    g.beginPath(); g.moveTo(-s / 2, 0); g.quadraticCurveTo(0, -s * 0.35, s / 2, 0); g.quadraticCurveTo(0, s * 0.35, -s / 2, 0); g.fill()
    g.restore()
  }
  const nLeaves = Math.min(1600, Math.round((W * (ground - farY)) / (90 * PR * PR) * rt.detail))
  for (let i = 0; i < nLeaves; i++) {
    const t = r() ** 0.8, y = lerp(farY, ground, t), x = r() * W
    const s = unit * lerp(0.25, 0.75, t) * (0.6 + r() * 0.8)
    const hue = pickOf(r, [28, 34, 20, 42, 12, 90, 50])
    const l = (hue === 90 ? 18 : 16 + r() * 18) * lerp(0.55, 1, t) * (1 - damp * 0.15)
    g.fillStyle = `hsla(${hue}, ${30 + r() * 30}%, ${l}%, ${lerp(0.6, 1, t)})`
    leaf(x, y, s)
  }
  // soil
  const soil = g.createLinearGradient(0, ground, 0, H)
  soil.addColorStop(0, `hsl(26, 34%, ${14 + damp * 6}%)`)
  soil.addColorStop(1, `hsl(22, 40%, ${5 + damp * 3}%)`)
  g.fillStyle = soil
  g.beginPath(); g.moveTo(-4, H); g.lineTo(-4, ground)
  for (let x = -4; x <= W + 4; x += 6 * PR) g.lineTo(x, ground + (r() - 0.3) * 3 * PR)
  g.lineTo(W + 4, H); g.closePath(); g.fill()
  for (let i = 0; i < 6; i++) {
    const y = lerp(ground + 10 * PR, H, r())
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '120,90,60'},0.06)`
    g.fillRect(-4, y, W + 8, (4 + r() * 18) * PR)
  }
  for (let i = 0; i < Math.round(W / (24 * PR)); i++) {
    const x = r() * W, y = lerp(ground + 6 * PR, H, r()), rr = (1.5 + r() * 5) * PR
    g.fillStyle = `hsl(${20 + r() * 20}, ${10 + r() * 15}%, ${12 + r() * 14}%)`
    g.beginPath(); g.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, TAU); g.fill()
    g.fillStyle = 'rgba(255,240,220,0.06)'
    g.beginPath(); g.ellipse(x - rr * 0.3, y - rr * 0.3, rr * 0.4, rr * 0.25, 0, 0, TAU); g.fill()
  }
  g.strokeStyle = 'rgba(70,45,25,0.6)'
  for (let i = 0; i < 7; i++) {
    let x = r() * W, y = ground + r() * 10 * PR
    g.lineWidth = (1 + r() * 3) * PR
    g.beginPath(); g.moveTo(x, y)
    for (let k = 0; k < 14; k++) { x += (r() - 0.5) * 40 * PR; y += r() * 14 * PR; g.lineTo(x, y) }
    g.stroke()
  }
  for (let i = 0; i < W / (10 * PR); i++) {
    g.fillStyle = `hsl(${pickOf(r, [28, 34, 20, 40])}, ${35 + r() * 25}%, ${14 + r() * 14}%)`
    leaf(r() * W, ground + r() * 2 * PR, unit * (0.5 + r() * 0.5))
  }
  g.restore()
}
function bakeForeground() {
  const g = fgx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
  fgx.clearRect(0, 0, W, H)
  fgx.fillStyle = g; fgx.fillRect(0, 0, W, H)
}

// --- wind -----------------------------------------------------------------------------
function windAt(t, sx) {
  const base = params.wind
  const gust = Math.sin(t * 0.45 + sx * 0.0015) * 0.5 + Math.sin(t * 1.13 + sx * 0.004) * 0.3 + Math.sin(t * 0.17) * 0.4
  return (base + gust * (0.2 + Math.abs(base)) * 0.7) * 60 * PR
}

// --- setup ---------------------------------------------------------------------------
function populate() {
  for (const f of fruits) if (f.canvas) pool.push(f.canvas)
  for (const w of woods) { if (w.standCv) pool.push(w.standCv); if (w.logCv) pool.push(w.logCv); if (w.stumpCv) pool.push(w.stumpCv) }
  fruits = []; woods = []; ghosts = []; parts.length = 0; tips = []; label = null
  cam = 0
  mctx.clearRect(0, 0, W, H)
  for (let i = 0; i < 5; i++) seedMycelium(rt.random(0, W), rt.random(ground + 6 * PR, H - 8 * PR), 3)
  const refresh = () => {
    for (const w of woods) {
      const d = depthOf(w.z), kw = unit * d.s * WOOD_SCALE, sx = scrX(w.x, w.z)
      w.sx = sx
      ;[w.sxMin, w.sxMax] = woodExtent(w, sx, kw)
      bakeWood(w, d)
    }
  }

  if (TEST.trees != null && TEST.only) {
    const stage = parseFloat(TEST.trees) || 0.3
    makeWood(TEST.only, W * 0.12 + cam, 0.04, 'standing', stage, 1).fadeIn = 1
    makeWood(TEST.only, W * 0.3 + cam, 0.04, 'down', stage, 1).fadeIn = 1
    makeWood(TEST.only, W * 0.62 + cam * 0.9, 0.3, 'down', Math.min(1, stage + 0.4), -1).fadeIn = 1
    refresh()
    return
  }
  if (TEST.trees != null) {
    const stage = parseFloat(TEST.trees) || 0.3
    const standing = !!TEST.standing
    TREE_KEYS.forEach((k, i) => {
      const row = standing ? 0 : Math.floor(i / 3), col = standing ? i : i % 3
      const sxp = standing ? W * (0.07 + col * 0.125) : W * (0.12 + col * 0.3)
      const z = standing ? 0.02 + (i % 2) * 0.12 : [0.02, 0.28, 0.54][row]
      const w = makeWood(k, sxp + cam * pf(z), z, standing ? 'standing' : 'down', stage, standing ? (i % 2 ? -1 : 1) : (col % 2 ? -1 : 1))
      w.fadeIn = 1
    })
    refresh()
    return
  }
  if (TEST.fall != null) {
    const w = makeWood(TEST.spec ? TEST.spec : 'ponderosa', W * 0.35, 0.05, 'falling', 0.2, 1)
    w.fadeIn = 1; w.p = clamp(parseFloat(TEST.fall) || 0.5); w.dust = true
    makeWood('aspen', W * 0.75, 0.3, 'down', 0.15, -1).fadeIn = 1
    refresh()
    return
  }
  if (TEST.spec && SPECIES[TEST.spec]) {
    const key = TEST.spec
    const sp = SPECIES[key]
    const fate = TEST.fate ? { kind: TEST.fate, start: 1.2, dur: 1 } : null
    const stages = fate ? [0.05, 0.25, 0.5, 0.7, 0.88, 1].map((f) => fate.start + f * fate.dur) : [0.35, 0.7, 1.0, 1.3, 1.7, 2.1]
    if (sp.host) {
      const hard = sp.host.kind !== 'soft'
      const mid = (sp.host.stage[0] + sp.host.stage[1]) / 2
      const logs = [0, 1, 2].map((i) => {
        const w = makeWood(hard ? 'aspen' : 'lodgepole', W * (0.2 + i * 0.3) + cam, [0.02, 0.3, 0.55][i], 'down', mid, i % 2 ? -1 : 1)
        w.fadeIn = 1; return w
      })
      refresh()
      stages.forEach((g, i) => {
        const w = logs[i >> 1]
        const f = newFruit(key, 0, 0, g, { hostInfo: { ok: true, wood: w }, fate: fate || { kind: 'rot', start: 9, dur: 1 }, s: 0.25 + (i & 1) * 0.5 })
        f.rate = 0
      })
    } else {
      stages.forEach((g, i) => {
        const f = newFruit(key, W * (0.1 + i * 0.16) + cam, 0, g, { hostInfo: { ok: true }, fate: fate || { kind: 'rot', start: 9, dur: 1 } })
        f.rate = 0
      })
    }
    return
  }
  // start mid-season: a few trees and fruits already about
  const nW = Math.round(3 * params.deadwood)
  for (let i = 0; i < nW; i++) {
    const standing = rt.rng() < 0.35
    const z = rt.random(0.02, 0.55)
    const w = makeWood(pickTree(), rt.random(0.05, 0.95) * W + cam * pf(z), z, standing ? 'standing' : 'down', standing ? rt.random(0, 0.25) : rt.random(0.05, 0.9))
    w.fadeIn = 1
  }
  refresh()
  const want = Math.round(14 * params.flush)
  for (let i = 0; i < want * 4 && fruits.length < want; i++) spawnFruit({ g: rt.random(0.2, 1.7) })
  if (rt.rng() < 0.5) spawnRing()
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  ground = H * 0.77
  farY = ground - H * 0.13
  unit = Math.min(H, W * 0.9) * 0.05
  myc.width = W; myc.height = H
  for (const L of bgLayers) { L.cv.width = W; L.cv.height = farY + 12 * PR }
  bgGround.width = W; bgGround.height = H - farY
  bgGroundX.setTransform(1, 0, 0, 1, 0, 0)
  bgKey = ''
  fg.width = W; fg.height = H
  bakeForeground()
  const gs = 64
  glowSprite.width = glowSprite.height = gs
  const gx = glowSprite.getContext('2d')
  const gr = gx.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2)
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  gx.fillStyle = gr; gx.fillRect(0, 0, gs, gs)
  populate()
}

// --- input ---------------------------------------------------------------------------
function onDown(e) {
  const x = e.clientX * PR, y = e.clientY * PR
  // click a fruit or log to read its name; click the ground to inoculate a flush
  let hit = null
  for (const f of fruits) if (f.rect && x >= f.rect.x && x <= f.rect.x + f.rect.w && y >= f.rect.y && y <= f.rect.y + f.rect.h) { if (!hit || f.z < hit.z) hit = f }
  if (hit) {
    const fx = fxOf(hit)
    label = { x: hit.sx, y: hit.rect.y, t: 5, a: hit.gen.latin, b: `${hit.gen.common} · ${fx.f > 0 ? FATE_WORDS[hit.fate.kind] : hit.g < 1 ? 'growing' : 'mature'}` }
    return
  }
  for (const w of woods) {
    const d = depthOf(w.z), kw = unit * d.s * WOOD_SCALE
    if (x >= w.sxMin && x <= w.sxMax && y <= d.y && y >= d.y - (w.state === 'standing' ? w.plan.Lfull : w.plan.D * 1.4) * kw) {
      const t = TREES[w.sp]
      label = { x: (w.sxMin + w.sxMax) / 2, y: d.y - w.plan.D * kw * 1.5, t: 5, a: t.latin, b: `${t.name} · ${w.state === 'standing' ? 'dead snag' : `${(w.stage * 100) | 0}% decayed`}` }
      return
    }
  }
  const z = y >= ground ? 0 : clamp((ground - y) / (ground - farY))
  seedMycelium(x, Math.max(ground + 6 * PR, y), 5)
  for (let i = 0; i < 3; i++) spawnFruit({ sx: x + rt.random(-60, 60) * PR, z: clamp(z + rt.random(-0.15, 0.15)), force: i === 0 })
}
window.addEventListener('pointerdown', onDown)
rt.onBeat(({ energy }) => {
  const n = 1 + ((energy * 3) | 0)
  for (let i = 0; i < n; i++) spawnFruit()
})

// --- frame ---------------------------------------------------------------------------
let last = 0
let spawnT = 0, woodT = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const g = params.growth
  const sdt = FROZEN ? 0 : dt
  simT += sdt
  ENV.light = params.light; ENV.damp = params.damp; ENV.detail = rt.detail

  camV = FROZEN ? 0 : params.scroll * 40 * PR
  cam += camV * dt

  growMyc(sdt * g)

  // fruit lives
  for (const f of fruits) {
    f.g += sdt * 0.032 * g * f.rate
    f.sx = f.host ? hostPos(f).sx : scrX(f.x, f.z)
  }
  // wood lives
  for (const w of woods) {
    const d = depthOf(w.z), kw = unit * d.s * WOOD_SCALE
    w.sx = scrX(w.x, w.z)
    if (w.fadeIn < 1) w.fadeIn = Math.min(1, w.fadeIn + dt * 0.5)
    if (sdt) {
      const rate = params.woodDecay
      if (w.state === 'standing') {
        w.stage = Math.min(0.4, w.stage + sdt * 0.0025 * rate)
        w.fallIn -= sdt * rate
        if (w.fallIn <= 0) { w.state = 'falling'; w.p = 0; w.dust = false; bakeWood(w, d) }
      } else {
        w.stage = Math.min(1, w.stage + sdt * 0.0085 * rate)
        if (w.stage >= 1 && !w.dying) w.dying = 0.001
      }
      if (w.state === 'falling') w.p = Math.min(1, w.p + sdt / 3.4)
    }
    if (w.state === 'falling' && w.p > 0.93 && !w.dust) {
      w.dust = true
      dustBurst(w.sx + w.dir * (w.plan.Lfull * 0.5) * kw, d.y, 46, kw)
    }
    if (w.state === 'falling' && w.p >= 1 && !FROZEN) { w.state = 'down'; bakeWood(w, d) }
    if (w.dying) { w.dying += dt / 4; w.alpha = 1 - clamp(w.dying) }
    ;[w.sxMin, w.sxMax] = woodExtent(w, w.sx, kw)
  }

  // retire things that are over or far away
  for (let i = fruits.length - 1; i >= 0; i--) {
    const f = fruits[i]
    const over = f.g > endOf(f) || (f.host && (f.host.wood.dying > 0.5 || !woods.includes(f.host.wood))) || f.sx < -W * 2 || f.sx > W * 3
    if (over && !FROZEN) { if (f.canvas) pool.push(f.canvas); fruits.splice(i, 1) }
  }
  for (let i = woods.length - 1; i >= 0; i--) {
    const w = woods[i]
    if (FROZEN) break
    if (w.alpha <= 0 || w.sxMax < -W * 1.5 || w.sxMin > W * 2.5) {
      for (const k of ['standCv', 'logCv', 'stumpCv']) if (w[k]) pool.push(w[k])
      woods.splice(i, 1)
    }
  }

  // births
  if (!FROZEN) {
    spawnT += sdt * g
    if (spawnT > 1.2 / Math.max(0.3, params.flush)) {
      spawnT = 0
      if (fruits.length < maxFruits()) {
        if (rt.rng() < 0.05 && SPECIES.marasmius && params.marasmius) spawnRing()
        else spawnFruit()
      }
    }
    woodT += dt
    if (woodT > 0.6) {
      woodT = 0
      const target = Math.round(3.5 * params.deadwood)
      const live = woods.filter((w) => !w.dying && w.sxMax > -W * 0.3 && w.sxMin < W * 1.3).length
      if (live < target && (rt.rng() < 0.5 || Math.abs(params.scroll) > 0.04)) {
        const sp = pickTree()
        const z = rt.random(0.02, 0.5)
        const d = depthOf(z), kw = unit * d.s * WOOD_SCALE
        const state = rt.rng() < 0.4 ? 'standing' : 'down'
        const w = makeWood(sp, 0, z, state, state === 'standing' ? rt.random(0, 0.2) : rt.random(0, 0.5))
        const margin = (w.plan.Lfull + 2) * kw
        let sx
        if (Math.abs(params.scroll) > 0.04) sx = params.scroll > 0 ? W + margin : -margin
        else { sx = rt.random(0.1, 0.9) * W; w.fadeIn = 0 }
        w.x = sx + cam * pf(z)
        w.sx = sx
        ;[w.sxMin, w.sxMax] = woodExtent(w, sx, kw)
      }
    }
  }

  // re-bake the stalest few sprites this frame
  const env = envKey()
  const dirty = []
  for (const f of fruits) {
    if (!f.canvas || f.bakedEnv !== env) { dirty.push([1e9, f]); continue }
    const step = f.g < 1.3 ? 0.014 : 0.03
    const lag = Math.abs(f.g - f.bakedG)
    if (lag > step) dirty.push([lag, f])
  }
  dirty.sort((a, b) => b[0] - a[0])
  const budget = 2 + Math.round(3 * rt.detail)
  for (let i = 0; i < Math.min(budget, dirty.length); i++) rebake(dirty[i][1], env)
  let wb = 1
  for (const w of woods) {
    if (wb <= 0) break
    const d = depthOf(w.z)
    if (w.sxMax < -W * 0.2 || w.sxMin > W * 1.2) continue
    if (bakeWood(w, d)) wb--
  }

  // ---- draw ----
  bakeBackground()
  tileDraw(bgLayers[0].cv, cam * 0.1, 0)
  tileDraw(bgLayers[1].cv, cam * 0.22, 0)
  tileDraw(bgLayers[2].cv, cam * 0.4, 0)
  tileDraw(bgGround, cam, farY)

  // mycelium web in the soil
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.45 + params.damp * 0.5
  tileDraw(myc, cam, 0, ctx.globalAlpha, Math.floor(ground))
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // far to near; fruits come after the wood they grow on
  const items = []
  for (const w of woods) if (w.sxMax > -W * 0.1 && w.sxMin < W * 1.1) items.push(w)
  for (const f of fruits) if (f.sx > -W * 0.3 && f.sx < W * 1.3) items.push(f)
  items.sort((a, b) => b.z - a.z || (a.type === 'wood' ? -1 : 1))
  const pulse = rt.beat.state.pulse || 0
  for (const it of items) {
    if (it.type === 'wood') { drawWood(it, depthOf(it.z), it.sx); continue }
    const f = it
    f.rect = null
    if (!f.canvas || !f.bakedK) continue
    const hp = f.host ? hostPos(f) : null
    const d = hp ? hp.d : depthOf(f.z)
    const k = unit * d.s * params.size
    const s = k / f.bakedK
    const y = hp ? hp.y : d.y
    f.y = y; f.k = k
    const fade = 1 - smooth(endOf(f) - 0.12, endOf(f), f.g)
    const alpha = fade * (f.host ? f.host.wood.alpha : 1) * smooth(-0.3, 0.1, f.g + 0.2)
    const box = f.gen.box
    const ox = f.sx + box.x0 * k, oy = y + box.y0 * k
    const ww = f.canvas.width * s, hh = f.canvas.height * s
    const flex = RIGID.has(f.key) ? 0 : 1
    const wspd = windAt(t, f.sx) / (60 * PR)
    const sh = clamp(wspd, -1.6, 1.6) * 0.03 * flex * (0.85 + 0.15 * Math.sin(t * 2.3 + f.phase)) * smooth(0.2, 1, f.g)
    ctx.globalAlpha = alpha
    if (Math.abs(sh) > 0.0005) {
      ctx.save(); ctx.translate(f.sx, y); ctx.transform(1, 0, -sh, 1, 0, 0)
      ctx.drawImage(f.canvas, ox - f.sx, oy - y, ww, hh)
      ctx.restore()
    } else ctx.drawImage(f.canvas, ox, oy, ww, hh)
    ctx.globalAlpha = 1
    f.rect = { x: ox, y: oy, w: ww, h: hh }

    // a slug on a mushroom that is being eaten
    const fx = fxOf(f)
    if (fx.kind === 'eaten' && fx.f > 0.05 && fx.f < 0.95 && f.marks && f.marks.slug) {
      const m = f.marks.slug, sxp = f.sx + m.x * k + Math.sin(t * 0.7 + f.phase) * k * 0.05, syp = y + m.y * k
      ctx.save(); ctx.globalAlpha = alpha
      ctx.fillStyle = 'hsl(32, 45%, 28%)'
      ctx.beginPath(); ctx.ellipse(sxp, syp, k * 0.5, k * 0.15, -0.3, 0, TAU); ctx.fill()
      ctx.fillStyle = 'hsl(38, 40%, 42%)'
      ctx.beginPath(); ctx.ellipse(sxp - k * 0.08, syp - k * 0.05, k * 0.38, k * 0.07, -0.3, 0, TAU); ctx.fill()
      ctx.strokeStyle = 'hsl(32, 45%, 28%)'; ctx.lineWidth = Math.max(1, k * 0.03)
      ctx.beginPath(); ctx.moveTo(sxp + k * 0.42, syp - k * 0.08); ctx.lineTo(sxp + k * 0.55, syp - k * 0.28)
      ctx.moveTo(sxp + k * 0.38, syp - k * 0.1); ctx.lineTo(sxp + k * 0.46, syp - k * 0.3); ctx.stroke()
      ctx.restore()
    }

    // bioluminescence
    if (f.gen.glow && params.glow > 0 && f.marks) {
      const a = params.glow * f.gen.glow * (0.6 + 0.4 * pulse) * alpha * (1 - f.z * 0.4)
      if (a > 0.01) {
        ctx.globalCompositeOperation = 'lighter'
        for (const m of f.marks.glow) {
          const gx = f.sx + m.x * k, gy = y + m.y * k, gr = m.r * k
          ctx.globalAlpha = Math.min(1, a)
          ctx.drawImage(glowTint(f.gen.glowCol), gx - gr, gy - gr, gr * 2, gr * 2)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    }
    // spores drift off the gills and ride the wind; ink caps drip
    if (f.marks && sdt) {
      for (const m of f.marks.spore) {
        if (params.spores > 0 && rt.rng() < params.spores * 0.25) {
          parts.push({ x: f.sx + (m.x + rt.random(-m.w, m.w)) * k, y: y + m.y * k, vy: rt.random(5, 14) * PR, vx: rt.random(-4, 4) * PR, life: 1, col: f.gen.spore, size: 1.1 * PR * d.s, z: f.z })
        }
      }
      for (const m of f.marks.ink) {
        if (rt.rng() < 0.05) parts.push({ ink: true, x: f.sx + (m.x + rt.random(-m.w, m.w)) * k, y: y + m.y * k, vy: 0, vx: 0, life: 1, col: f.gen.spore, size: 2 * PR * d.s, floor: d.y })
      }
    }
  }

  // ghosts: picked fruit lifted away
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const gh = ghosts[i]
    gh.t += dt / 1.2
    if (gh.t >= 1) { pool.push(gh.cv); ghosts.splice(i, 1); continue }
    const d = depthOf(gh.z), k = unit * d.s * params.size, s = k / gh.k
    const sxp = scrX(gh.gx, gh.z), lift = smooth(0, 1, gh.t) * k * 3
    ctx.globalAlpha = 1 - smooth(0.4, 1, gh.t)
    ctx.drawImage(gh.cv, sxp + gh.box.x0 * k, gh.y + gh.box.y0 * k - lift, gh.cv.width * s, gh.cv.height * s)
    ctx.globalAlpha = 1
  }

  // spores, ink drops and dust
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i]
    if (s.ink) {
      s.vy += 300 * PR * dt; s.y = Math.min(s.y + s.vy * dt, s.floor); s.x -= camV * dt
      if (s.y >= s.floor) s.life -= dt * 1.5
    } else if (s.dust) {
      s.vx += (windAt(t, s.x) * 0.5 - s.vx) * Math.min(1, dt * 0.8); s.vy += 14 * PR * dt
      s.x += s.vx * dt; s.y += s.vy * dt; s.size += 6 * PR * dt; s.life -= dt * 0.5
    } else {
      const wv = windAt(t, s.x) * 0.9
      s.vx += (wv - s.vx) * Math.min(1, dt * 1.4)
      s.vy += ((6 * PR - Math.abs(wv) * 0.05) - s.vy) * Math.min(1, dt * 0.8) + Math.sin(t * 2 + s.x * 0.02) * 4 * PR * dt
      s.x += (s.vx - camV * pf(s.z || 0) * 0.5) * dt; s.y += s.vy * dt; s.life -= dt * 0.3
    }
    if (s.life <= 0 || s.y > H || s.x < -50 || s.x > W + 50) { parts.splice(i, 1); continue }
    if (s.dust) {
      ctx.fillStyle = `hsla(${s.col[0]},${s.col[1]}%,${s.col[2]}%,${s.life * 0.35})`
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, TAU); ctx.fill()
      continue
    }
    ctx.fillStyle = hsl(s.col.h, s.col.s, s.col.l, s.ink ? s.life * 0.9 : s.life * 0.55)
    ctx.beginPath()
    if (s.ink) ctx.ellipse(s.x, s.y, s.size * 0.7, s.size * 1.2, 0, 0, TAU)
    else ctx.arc(s.x, s.y, s.size, 0, TAU)
    ctx.fill()
  }
  if (parts.length > 1800) parts.splice(0, parts.length - 1800)

  ctx.drawImage(fg, 0, 0)

  if (label) {
    label.t -= dt
    if (label.t <= 0) label = null
    else {
      const a = smooth(0, 0.5, label.t)
      const fs = 13 * PR
      ctx.font = `600 ${fs}px system-ui, sans-serif`
      const w1 = ctx.measureText(label.a).width
      ctx.font = `${fs * 0.9}px system-ui, sans-serif`
      const w2 = ctx.measureText(label.b).width
      const bw = Math.max(w1, w2) + fs * 1.2, bh = fs * 2.9
      const lx = clamp(label.x - bw / 2, 8 * PR, W - bw - 8 * PR), ly = Math.max(8 * PR, label.y - bh - 10 * PR)
      ctx.globalAlpha = a
      ctx.fillStyle = 'rgba(8,10,12,0.78)'
      ctx.beginPath(); ctx.roundRect(lx, ly, bw, bh, 6 * PR); ctx.fill()
      ctx.fillStyle = '#e8efe4'; ctx.font = `italic 600 ${fs}px system-ui, sans-serif`; ctx.fillText(label.a, lx + fs * 0.6, ly + fs * 1.15)
      ctx.fillStyle = '#a9b8a4'; ctx.font = `${fs * 0.9}px system-ui, sans-serif`; ctx.fillText(label.b, lx + fs * 0.6, ly + fs * 2.25)
      ctx.globalAlpha = 1
    }
  }
  requestAnimationFrame(frame)
}

const glowCache = new Map()
function glowTint(col) {
  const key = `${col.h | 0}`
  let cv = glowCache.get(key)
  if (!cv) {
    cv = document.createElement('canvas')
    cv.width = cv.height = glowSprite.width
    const x = cv.getContext('2d')
    x.drawImage(glowSprite, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = hsl(col.h, col.s, col.l)
    x.fillRect(0, 0, cv.width, cv.height)
    glowCache.set(key, cv)
  }
  return cv
}

window.addEventListener('resize', () => { glowCache.clear(); resize() })
resize()
requestAnimationFrame(frame)
