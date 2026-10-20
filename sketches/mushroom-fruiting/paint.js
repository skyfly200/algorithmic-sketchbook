// Painting a fruiting body into a sprite: capped mushrooms drawn in pseudo-3D from
// slightly below, plus the shapes that are not caps (rosettes, tufts, antlers,
// cups, jelly ears, caterpillar clubs). Everything is drawn in units (1 unit =
// K px) with the origin where the fruit meets its substrate. How it ends (rot,
// dry, deliquesce, eaten) is baked in; picking and fading happen when drawn.
import { TAU, clamp, lerp, smooth, mulberry, C, hsl, mix, pickOf } from './util.js'

export const ENV = { detail: 1, light: -0.4, damp: 0.6 }
export const NOFX = { kind: null, f: 0 }

// --- growth state ----------------------------------------------------------------
export function bodyState(b, g, gDelay = b.delay, fx = NOFX) {
  const gb = Math.max(0, g - gDelay)
  const grow = clamp(gb)
  const f = fx.f
  const s = {
    gb, grow,
    sz: b.scale * (0.16 + 0.84 * smooth(0, 1, grow)),
    open: smooth(0.3, 1.15, gb),
    age: clamp((gb - 1.15) / 1.0),
    dq: 0, capR: 1, capH: 1, stemL: 1, stemW: 1, fate: fx.kind, f,
  }
  if (f > 0) {
    if (fx.kind === 'rot') { s.capR = 1 - 0.2 * f; s.capH = 1 - 0.45 * f; s.stemL = 1 - 0.4 * f; s.stemW = 1 + 0.1 * f }
    else if (fx.kind === 'dry') { s.capR = 1 - 0.38 * f; s.capH = 1 - 0.4 * f; s.stemL = 1 - 0.12 * f; s.stemW = 1 - 0.4 * f }
    else if (fx.kind === 'deliq') { s.dq = f; s.capH = 1 - 0.35 * f; s.capR = 1 - 0.15 * f; s.stemL = 1 - 0.12 * f }
    else if (fx.kind === 'picked') { s.noCap = true; s.stemL = 0.12; s.stemW = 0.9 }
  }
  return s
}
function capShape(cap, s) {
  const R = cap.R * s.sz * lerp(0.42, 1, s.open) * s.capR
  let ratio = lerp(cap.rY, cap.rM, s.open)
  ratio = lerp(ratio, cap.rO, s.age)
  const H = Math.max(0.03, ratio) * R * s.capH
  const umbo = cap.umbo * s.open * H
  const dep = cap.dep * s.open * R
  const curl = cap.curl * (1 - s.open * 0.75) * R
  const up = (cap.upturn * s.age + (cap.deliq ? s.dq * 0.5 : 0)) * R
  const a = cap.a, bb = cap.b
  const h = (u) => H * Math.pow(Math.max(0, 1 - Math.pow(u, a)), bb) + umbo * Math.exp(-((u / 0.22) ** 2)) -
    dep * (1 - u * u) ** 2 + curl * 0.32 * Math.sin(Math.PI * clamp((u - 0.5) / 0.5)) + up * 0.35 * smooth(0.5, 1, u)
  return { R, H, h, h1: h(1), gRise: cap.gRise * H + cap.gDrop * R, tilt: cap.tilt, off: cap.off * R }
}

// --- baking a fruit ---------------------------------------------------------------
// c is a sprite context scaled to units (1 unit = K px), origin at the fruit's base.
let c = null, K = 1, AGE = 0, LX = -0.4, DAMP = 0.6, FX = NOFX
let SPR = { w: 0, h: 0, k: 1, tx: 0, ty: 0 }
const scratch = document.createElement('canvas')
function aged(col, dl = 0, ds = 0, dh = 0) {
  let h = lerp(col.h + dh, 30, AGE * 0.25)
  let s = (col.s + ds) * (1 - 0.45 * AGE)
  let l = (col.l + dl) * (1 - 0.32 * AGE) * (1 - DAMP * 0.06)
  const f = FX.f
  if (f > 0) {
    if (FX.kind === 'rot') { h = lerp(h, 38, f * 0.7); s *= 1 - 0.35 * f; l *= 1 - 0.55 * f }
    else if (FX.kind === 'dry') { h = lerp(h, 36, f * 0.6); s *= 1 - 0.5 * f; l = lerp(l, 52, f * 0.45) }
  }
  return [h, s, l]
}
function ah(col, dl = 0, a = 1, ds = 0, dh = 0) { const [h, s, l] = aged(col, dl, ds, dh); return hsl(h, s, l, a) }

function beginScratch() {
  if (scratch.width !== SPR.w || scratch.height !== SPR.h) { scratch.width = SPR.w; scratch.height = SPR.h }
  const s = scratch.getContext('2d')
  s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, SPR.w, SPR.h)
  s.setTransform(SPR.k, 0, 0, SPR.k, SPR.tx, SPR.ty)
  c = s
}
function endScratch(real) {
  c = real
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(scratch, 0, 0); c.restore()
}
// a bite: a rim of pale flesh, then the hole
function bite(x, y, rx, ry = rx) {
  c.globalCompositeOperation = 'source-atop'
  c.fillStyle = hsl(46, 25, 90, 0.95); c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill()
  c.globalCompositeOperation = 'destination-out'
  c.beginPath(); c.ellipse(x, y, rx * 0.8, ry * 0.8, 0, 0, TAU); c.fill()
  c.globalCompositeOperation = 'source-over'
}

// Bakes fruit f at decay state g into cv. fx = { kind, f } how it is ending;
// haze (0..1) is distance mist. Returns the marks the main loop uses for spores,
// drips and glow.
export function bakeFruit(f, cv, k, g, fx, haze) {
  const gen = f.gen, box = gen.box
  const pw = Math.ceil((box.x1 - box.x0) * k), ph = Math.ceil((box.y1 - box.y0) * k)
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
  c = cv.getContext('2d')
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, pw, ph)
  const tx = -box.x0 * k, ty = -box.y0 * k
  c.setTransform(k, 0, 0, k, tx, ty)
  K = k; SPR = { w: pw, h: ph, k, tx, ty }
  LX = ENV.light; DAMP = ENV.damp; FX = fx
  const r = mulberry(f.texSeed)
  const marks = { spore: [], glow: [], ink: [], slug: null }
  f.marks = marks

  if (!f.host) {
    const shW = Math.min(1.8, (box.x1 - box.x0) * 0.35)
    const sg = c.createRadialGradient(0, 0.05, 0, 0, 0.05, shW)
    sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
    c.save(); c.scale(1, 0.22); c.fillStyle = sg; c.beginPath(); c.arc(0, 0.2, shW, 0, TAU); c.fill(); c.restore()
    if (fx.kind === 'deliq' && fx.f > 0.05) {
      // ink pools where the cap liquefied
      c.fillStyle = hsl(280, 20, 6, 0.9 * smooth(0.05, 0.6, fx.f))
      c.beginPath(); c.ellipse(0.1, 0.08, 0.5 + fx.f * 1.3, 0.1 + fx.f * 0.14, 0, 0, TAU); c.fill()
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.ellipse(-0.2, 0.04, 0.35 + fx.f * 0.4, 0.03, 0, 0, TAU); c.fill()
    }
  }

  gen.bodies.forEach((b, bi) => {
    const s = bodyState(b, g, b.delay, fx)
    AGE = s.age
    if (s.gb <= 0) return
    drawBody(b, s, r, gen, f, bi)
  })
  const lifted = fx.kind === 'picked' && fx.f > 0
  for (const br of lifted ? [] : gen.brackets) {
    const s = bodyState({ scale: 1 }, g, br.delay, fx)
    AGE = s.age
    if (s.gb > 0) drawBracket(br, s, r)
  }
  if (gen.parts.length && !lifted) {
    const eat = fx.kind === 'eaten' && fx.f > 0.01
    const real = c
    if (eat) beginScratch()
    for (const p of gen.parts) drawPart(p, g, fx, r)
    if (eat) {
      const rb = mulberry(f.texSeed ^ 0x2f6e2b1)
      const bx = gen.parts[0].box, w = bx.x1 - bx.x0
      for (let i = 0; i < 14; i++) {
        const t0 = (i / 14) * 0.8, cx = lerp(bx.x0 + w * 0.1, bx.x1 - w * 0.1, rb()), cy = lerp(bx.y0 + (bx.y1 - bx.y0) * 0.15, 0, rb())
        if (fx.f < t0) continue
        bite(cx, cy, w * (0.05 + 0.2 * smooth(t0, 1, fx.f)) * (0.8 + 0.4 * rb()))
      }
      endScratch(real)
    }
  }
  AGE = 0; FX = NOFX
  if (!f.host) drawLitter(r, gen)

  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'source-atop'
  if (haze > 0.01) { c.fillStyle = `hsla(160, 14%, ${12 + ENV.damp * 4}%, ${haze})`; c.fillRect(0, 0, pw, ph) }
  c.globalCompositeOperation = 'source-over'
  return marks
}

// --- one cap + stem ---------------------------------------------------------------
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]
}
function drawBody(b, s, r, gen, f, bi) {
  const cap = b.cap, st = b.stem
  const eat = s.fate === 'eaten' && s.f > 0.01
  const real = c
  if (eat) beginScratch()
  const sh = capShape(cap, s)
  // stem spine
  const L = st.L * s.sz * lerp(0.2, 1, smooth(0.04, 0.95, s.gb)) * s.stemL
  const up = st.up ?? 1
  const P0 = [b.x, b.y0]
  const P1 = [b.x + st.bend[0] * L + b.lean * L * 0.2, b.y0 - L * up / 3]
  const P2 = [b.x + st.bend[1] * L + b.lean * L * 0.5, b.y0 - L * up * 2 / 3]
  const P3 = [b.x + st.bend[2] * L + b.lean * L * 0.8, b.y0 - L * up]
  const N = 18
  const spine = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const p = bezier(P0, P1, P2, P3, t)
    const q = bezier(P0, P1, P2, P3, Math.min(1, t + 0.01)), o = bezier(P0, P1, P2, P3, Math.max(0, t - 0.01))
    let tx = q[0] - o[0], ty = q[1] - o[1]
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
    const w = (lerp(st.wBase, st.wTop, Math.pow(t, 0.7)) + st.bulb * st.wBase * Math.exp(-(((t * Math.max(1, L)) / 0.35) ** 2)) +
      st.belly * st.wBase * Math.exp(-(((t - 0.3) / 0.22) ** 2))) * s.sz * lerp(0.65, 1, s.grow) * s.stemW
    spine.push({ x: p[0], y: p[1], nx: -ty, ny: tx, w, t })
  }
  const top = spine[N]
  // the cap follows the stem's top tangent (damped); it never tips over
  const tAng = Math.atan2(top.x - spine[N - 2].x, -(top.y - spine[N - 2].y))
  const ang = b.dir ? b.dir * 0.12 : clamp(tAng * 0.75, -1.2, 1.2) + b.lean * 0.3

  // gills / underside, in the cap frame
  if (!s.noCap) {
    c.save(); c.translate(top.x, top.y); c.rotate(ang)
    drawUnderside(cap, sh, s, r, top.w)
    c.restore()
  }

  drawStem(st, spine, s, r, L)

  if (!s.noCap) {
    c.save(); c.translate(top.x, top.y); c.rotate(ang)
    drawDome(cap, sh, s, r)
    c.restore()
  }

  // marks for spores / glow (approximate: ignores the cap rotation)
  const cx = top.x + sh.off * Math.cos(ang), cy = top.y + sh.gRise - sh.h1
  if (s.gb > 0.9 && (!s.fate || s.f < 0.3) && s.fate !== 'picked' && !gen.ink) f.marks.spore.push({ x: cx, y: cy + sh.R * sh.tilt * 0.5, w: sh.R * 0.7 })
  if (gen.ink && s.dq > 0.15) f.marks.ink.push({ x: cx, y: cy, w: sh.R * 0.9 })
  if (gen.glow) f.marks.glow.push({ x: cx, y: cy - sh.H * 0.4, r: sh.R * 2.4 + 0.4 })
  if (eat && bi === 0) { const p = spine[Math.round(N * 0.4)]; f.marks.slug = { x: p.x, y: p.y, w: p.w } }

  if (eat) {
    // bites nibble the cap rim first, then work inwards; later ones gnaw the stem
    const rb = mulberry(f.texSeed ^ (0x5bd1e995 + bi * 977))
    const fr = s.f, NB = 14
    c.save(); c.translate(top.x, top.y); c.rotate(ang)
    for (let i = 0; i < NB; i++) {
      const t0 = (i / NB) * 0.8
      const u = (i / (NB - 1)) * 2 - 1 + (rb() - 0.5) * 0.2, jr = rb()
      if (fr < t0) continue
      const rad = sh.R * (0.12 + 0.5 * smooth(t0, 1, fr)) * (0.8 + 0.4 * jr)
      bite(sh.off + u * sh.R * 0.95, -(-sh.gRise + sh.h(Math.min(1, Math.abs(u)))), rad, rad * (0.8 + 0.3 * rb()))
    }
    c.restore()
    if (fr > 0.45) {
      const nb = 1 + Math.round(4 * (fr - 0.45) / 0.55)
      for (let i = 0; i < nb; i++) {
        const p = spine[Math.round((0.55 + rb() * 0.45) * N)]
        bite(p.x, p.y, Math.max(0.05, p.w * (1.1 + rb() * 0.8) * (0.5 + fr - 0.45)))
      }
    }
    endScratch(real)
  }
}


// --- shapes that are not caps -----------------------------------------------------
function curvePts(x, y, ang, len, n, r, wiggle) {
  const pts = [[x, y]]
  let px = x, py = y, a = ang
  for (let i = 1; i <= n; i++) { a += (r() - 0.5) * wiggle; px += Math.cos(a) * len / n; py += Math.sin(a) * len / n; pts.push([px, py]) }
  return pts
}
// a tapered tube along pts with full widths ws, ending in a rounded tip
function tube(pts, ws) {
  const Lf = [], Rt = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
    let tx = b[0] - a[0], ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
    Lf.push([pts[i][0] - ty * ws[i] / 2, pts[i][1] + tx * ws[i] / 2])
    Rt.push([pts[i][0] + ty * ws[i] / 2, pts[i][1] - tx * ws[i] / 2])
  }
  const p = new Path2D()
  p.moveTo(Lf[0][0], Lf[0][1])
  for (let i = 1; i < Lf.length; i++) p.lineTo(Lf[i][0], Lf[i][1])
  const e = pts[pts.length - 1], d = pts[pts.length - 2]
  let ex = e[0] - d[0], ey = e[1] - d[1]; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el
  const lw = ws[ws.length - 1]
  p.quadraticCurveTo(e[0] + ex * lw * 0.9, e[1] + ey * lw * 0.9, Rt[Rt.length - 1][0], Rt[Rt.length - 1][1])
  for (let i = Rt.length - 2; i >= 0; i--) p.lineTo(Rt[i][0], Rt[i][1])
  p.closePath()
  return p
}
function polyline(pts, from = 0) {
  const p = new Path2D()
  for (let i = from; i < pts.length; i++) i === from ? p.moveTo(pts[i][0], pts[i][1]) : p.lineTo(pts[i][0], pts[i][1])
  return p
}

function drawPart(p, g, fx, r) {
  FX = fx
  if (p.type === 'rosette') drawRosette(p, g, fx)
  else if (p.type === 'tuft') drawTuft(p, g, fx)
  else if (p.type === 'xylaria') drawXylaria(p, g, fx)
  else if (p.type === 'cups') drawCups(p, g, fx)
  else if (p.type === 'ears') drawEars(p, g, fx)
  else if (p.type === 'cordy') drawCordy(p, g, fx)
}

// Turkey tail: shingled, banded fans lying on the wood
function drawRosette(p, g, fx) {
  const lw = 1 / K
  for (const fan of p.fans) {
    const s = bodyState({ scale: 1 }, g, fan.delay, fx)
    if (s.gb <= 0) continue
    AGE = s.age
    const R = fan.R * s.sz * s.capR
    if (R < 0.02) continue
    c.save(); c.translate(fan.x, fan.y); c.rotate(fan.rot)
    const NA = 26, span = 1.3
    const edge = (rad) => {
      const q = new Path2D()
      q.moveTo(-R * 0.1, 0)
      for (let i = 0; i <= NA; i++) {
        const a = -span + (i / NA) * span * 2
        const rr = rad * (1 + rimV2(fan.waves, a * 3))
        q.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr * 0.92)
      }
      q.lineTo(R * 0.1, 0); q.closePath()
      return q
    }
    const outline = edge(R)
    c.save(); c.translate(R * 0.03, R * 0.08); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill(outline); c.restore()
    c.save(); c.clip(outline)
    let total = 0
    for (const b of fan.bands) total += b.w
    let acc = total
    for (let k = fan.bands.length - 1; k >= 0; k--) {
      c.fillStyle = ah(fan.bands[k].col); c.fill(edge(R * (acc / total)))
      acc -= fan.bands[k].w
    }
    const v = new Path2D(), rb = mulberry(fan.seed)
    for (let i = 0; i < 18 * Math.max(0.5, ENV.detail); i++) {
      const a = -span + rb() * span * 2, f0 = 0.1 + rb() * 0.8
      v.moveTo(Math.sin(a) * R * f0, -Math.cos(a) * R * f0 * 0.92); v.lineTo(Math.sin(a) * R * (f0 + 0.12), -Math.cos(a) * R * (f0 + 0.12) * 0.92)
    }
    c.strokeStyle = 'rgba(255,245,230,0.14)'; c.lineWidth = Math.max(lw, R * 0.02); c.stroke(v)
    const ag = c.createRadialGradient(0, 0, 0, 0, 0, R)
    ag.addColorStop(0, 'rgba(0,0,0,0.5)'); ag.addColorStop(0.45, 'rgba(0,0,0,0.08)'); ag.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = ag; c.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 1.4)
    c.restore()
    c.beginPath()
    for (let i = 0; i <= NA; i++) {
      const a = -span + (i / NA) * span * 2
      const rr = R * (1 + rimV2(fan.waves, a * 3)) * 0.985
      const px = Math.sin(a) * rr, py = -Math.cos(a) * rr * 0.92
      i ? c.lineTo(px, py) : c.moveTo(px, py)
    }
    c.strokeStyle = ah(C(42, 25, 90), 0, 0.9); c.lineWidth = Math.max(lw, R * 0.045); c.stroke()
    c.restore()
  }
}
function rimV2(waves, th) { let v = 0; for (const w of waves) v += w.amp * Math.sin(w.k * th + w.ph); return v }

// Lion's mane: a cushion hung with long white teeth
function drawTuft(p, g, fx) {
  const s = bodyState({ scale: 1 }, g, p.delay, fx)
  if (s.gb <= 0) return
  AGE = s.age
  const k = s.sz * s.capR
  const w = p.w * k, h = p.h * k, len = p.len * k * (1 + 0.3 * s.open)
  const rb = mulberry(p.seed)
  const lw = 1 / K
  const yel = AGE * 26
  const mg = c.createRadialGradient(-w * 0.1, -h * 0.25, 0, 0, 0, w * 0.6)
  mg.addColorStop(0, ah(C(48, 14, 97), 0, 1, yel)); mg.addColorStop(1, ah(C(46, 22, 80), 0, 1, yel))
  c.fillStyle = mg; c.beginPath(); c.ellipse(0, 0, w / 2, h * 0.45, 0, 0, TAU); c.fill()
  const light = new Path2D(), dark = new Path2D()
  const n = Math.round(560 * Math.max(0.5, ENV.detail) * (w / 1.3) * 1.1)
  const items = []
  for (let i = 0; i < n; i++) {
    const th = rb() * Math.PI * 1.05 - 0.02, u = 0.35 + 0.65 * Math.sqrt(rb())
    items.push([th, u, rb(), rb()])
  }
  items.sort((a, b) => a[1] - b[1])
  for (const [th, u, ra, rc] of items) {
    const x0 = Math.cos(th) * w * 0.5 * u, y0 = Math.sin(th) * h * 0.45 * u
    const l = len * (0.25 + 0.75 * Math.sin(th) * (0.6 + 0.6 * ra)) * (0.5 + 0.5 * u)
    const sway = Math.cos(th) * 0.1 * len
    const path = rc < 0.35 ? dark : light
    path.moveTo(x0, y0); path.quadraticCurveTo(x0 + sway * 0.5, y0 + l * 0.5, x0 + sway, y0 + l)
  }
  c.lineCap = 'round'
  c.lineWidth = Math.max(lw * 0.8, 0.022)
  c.strokeStyle = ah(C(46, 18, 76), 0, 0.8, yel); c.stroke(dark)
  c.strokeStyle = ah(C(48, 12, 98), 0, 0.95, yel); c.stroke(light)
  const tg = c.createLinearGradient(0, -h * 0.5, 0, h * 0.4)
  tg.addColorStop(0, 'rgba(255,250,235,0.18)'); tg.addColorStop(1, 'rgba(0,0,0,0.12)')
  c.fillStyle = tg; c.beginPath(); c.ellipse(0, 0, w / 2, h * 0.45, 0, 0, TAU); c.fill()
}

// Xylaria: black antlers dusted white at the tips, or thick club "fingers"
function drawXylaria(p, g, fx) {
  const lw = 1 / K
  for (const st of p.stalks) {
    const s = bodyState({ scale: 1 }, g, st.delay, fx)
    if (s.gb <= 0) continue
    AGE = s.age
    const rb = mulberry(st.seed)
    const h = st.h * s.sz, w = Math.max(st.w * (0.6 + 0.4 * s.grow), lw * 0.9)
    if (p.variant === 'hypoxylon') antler(st.x, 0, -Math.PI / 2 + st.bend, h, w, st.fork, rb, s)
    else {
      const pts = curvePts(st.x, 0, -Math.PI / 2 + st.bend, h, 10, rb, 0.2)
      const ws = pts.map((_, i) => w * (0.55 + 0.45 * Math.sin(Math.min(1, i / 6) * Math.PI / 2)) * (i === pts.length - 1 ? 0.85 : 1))
      const path = tube(pts, ws)
      c.fillStyle = ah(C(30, 8, 10)); c.fill(path)
      c.save(); c.clip(path)
      const bloom = new Path2D(); bloom.addPath(tube(pts.slice(5), ws.slice(5)))
      c.fillStyle = hsl(42, 5, 60, 0.55 * (1 - AGE)); c.fill(bloom)
      const wr = new Path2D()
      for (let i = 1; i < pts.length; i++) { const q = pts[i]; wr.moveTo(q[0] - ws[i] / 2, q[1]); wr.lineTo(q[0] + ws[i] / 2, q[1] + (rb() - 0.5) * 0.05) }
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = Math.max(lw, w * 0.06); c.stroke(wr)
      c.restore()
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = Math.max(lw, w * 0.08)
      c.translate(-w * 0.18, 0); c.stroke(polyline(pts, 1)); c.translate(w * 0.18, 0)
    }
  }
}
function antler(x, y, ang, len, w, fork, rb, s) {
  const n = 8
  const pts = curvePts(x, y, ang, len, n, rb, 0.45)
  const ws = pts.map((_, i) => w * (1 - 0.55 * i / n))
  const path = tube(pts, ws)
  c.fillStyle = ah(C(30, 10, 9)); c.fill(path)
  const t0 = Math.round(n * 0.6)
  c.fillStyle = hsl(40, 8, 90, 0.9 * (1 - AGE * 0.8)); c.fill(tube(pts.slice(t0), ws.slice(t0).map((v) => v * 0.85)))
  c.strokeStyle = 'rgba(255,245,225,0.18)'; c.lineWidth = Math.max(1 / K, w * 0.15); c.stroke(polyline(pts, 1))
  if (fork > 0) {
    const m = pts[Math.round(n * 0.5)]
    for (const sgn of [-1, 1]) antler(m[0], m[1], ang + sgn * (0.4 + rb() * 0.3), len * 0.55, w * 0.7, fork - 1, rb, s)
  }
}

// Eyelash cups: red discs with a fringe of black hairs
function drawCups(p, g, fx) {
  const lw = 1 / K
  for (const cup of p.cups) {
    const s = bodyState({ scale: 1 }, g, cup.delay, fx)
    if (s.gb <= 0) continue
    AGE = s.age
    const rr = cup.r * s.sz * (fx.kind === 'dry' ? 1 - 0.45 * fx.f : 1), ry = rr * cup.tilt
    c.fillStyle = ah(C(cup.hue + 6, 60, 30)); c.beginPath(); c.ellipse(cup.x, cup.y + rr * 0.3, rr * 0.98, ry * 1.05, 0, 0, TAU); c.fill()
    const gr = c.createRadialGradient(cup.x - rr * 0.2, cup.y - ry * 0.2, 0, cup.x, cup.y, rr)
    gr.addColorStop(0, ah(C(cup.hue + 3, 92, 62))); gr.addColorStop(1, ah(C(cup.hue - 3, 85, 44)))
    c.fillStyle = gr; c.beginPath(); c.ellipse(cup.x, cup.y, rr, ry, 0, 0, TAU); c.fill()
    c.strokeStyle = hsl(15, 25, 8, 0.9); c.lineWidth = Math.max(lw * 0.8, rr * 0.07)
    c.beginPath()
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU, len = rr * (0.25 + 0.15 * Math.sin(i * 3.1))
      c.moveTo(cup.x + Math.cos(a) * rr, cup.y + Math.sin(a) * ry)
      c.lineTo(cup.x + Math.cos(a) * (rr + len), cup.y + Math.sin(a) * (ry + len * cup.tilt))
    }
    c.stroke()
    c.fillStyle = 'rgba(255,230,210,0.3)'; c.beginPath(); c.ellipse(cup.x - rr * 0.3, cup.y - ry * 0.35, rr * 0.25, ry * 0.18, 0, 0, TAU); c.fill()
  }
}

// Jelly ears: translucent, veined, dark red-brown lobes
function drawEars(p, g, fx) {
  const lw = 1 / K
  for (const ear of p.ears) {
    const s = bodyState({ scale: 1 }, g, ear.delay, fx)
    if (s.gb <= 0) continue
    AGE = s.age
    const dry = fx.kind === 'dry' ? fx.f : 0
    const w = ear.w * s.sz * (1 - 0.55 * dry)
    const rb = mulberry(ear.seed)
    c.save(); c.translate(ear.x, ear.y); c.rotate(ear.rot); c.scale(ear.flip, 1)
    const shape = new Path2D()
    shape.moveTo(0, 0)
    shape.bezierCurveTo(-w * 0.9, -w * 0.1, -w * 0.95, -w * 0.9, -w * 0.2, -w * 1.0)
    shape.bezierCurveTo(w * 0.5, -w * 1.1, w * 0.95, -w * 0.6, w * 0.7, -w * 0.2)
    shape.bezierCurveTo(w * 0.55, w * 0.1, w * 0.2, 0.05, 0, 0)
    c.save(); c.translate(w * 0.04, w * 0.06); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill(shape); c.restore()
    const hue = p.hue
    const gr = c.createRadialGradient(0, 0, 0, -w * 0.1, -w * 0.5, w * 1.0)
    gr.addColorStop(0, ah(C(hue, 45, 20))); gr.addColorStop(0.6, ah(C(hue + 2, 48, 30))); gr.addColorStop(1, ah(C(hue + 6, 40, 38)))
    c.fillStyle = gr; c.fill(shape)
    c.save(); c.clip(shape)
    const vn = new Path2D()
    for (let i = 0; i < 9; i++) {
      const a = -2.9 + (i / 8) * 2.4 + (rb() - 0.5) * 0.2, rr = w * (0.7 + rb() * 0.3)
      vn.moveTo(0, 0); vn.quadraticCurveTo(Math.cos(a) * rr * 0.5 + (rb() - 0.5) * 0.1, -Math.abs(Math.sin(a)) * rr * 0.5, Math.cos(a) * rr * 0.9, -Math.abs(Math.sin(a)) * rr * 0.95)
    }
    c.strokeStyle = ah(C(hue + 10, 40, 52), 0, 0.28); c.lineWidth = Math.max(lw, w * 0.018); c.stroke(vn)
    if (dry > 0.15) {
      const wr = new Path2D()
      for (let i = 0; i < 14; i++) { const x = (rb() - 0.7) * w, y = -rb() * w; wr.moveTo(x, y); wr.lineTo(x + (rb() - 0.5) * 0.15 * w, y - 0.15 * w * rb()) }
      c.strokeStyle = `rgba(10,5,2,${0.5 * dry})`; c.lineWidth = Math.max(lw, w * 0.02); c.stroke(wr)
    }
    c.restore()
    c.strokeStyle = ah(C(28, 14, 56), 0, 0.5); c.lineWidth = Math.max(lw, w * 0.03); c.stroke(shape)
    const gl = (0.3 + DAMP) * (1 - dry) * (1 - AGE * 0.6)
    c.save(); c.translate(-w * 0.2, -w * 0.62); c.scale(1, 0.45)
    const hg = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.3)
    hg.addColorStop(0, `rgba(255,235,225,${0.4 * gl})`); hg.addColorStop(1, 'rgba(255,235,225,0)')
    c.fillStyle = hg; c.beginPath(); c.arc(0, 0, w * 0.3, 0, TAU); c.fill(); c.restore()
    c.restore()
  }
}

// Cordyceps militaris, in cross-section: the buried pupa and the orange clubs
// that grow up out of it through the soil
function drawCordy(p, g, fx) {
  const lw = 1 / K
  const first = bodyState({ scale: 1 }, g, 0, fx)
  AGE = first.age
  const pu = p.pupa, rb = mulberry(pu.seed)
  const px = 0, py = p.depth
  c.save(); c.translate(px, py); c.rotate(pu.ang)
  const L = pu.len, W = L * 0.34
  const body = new Path2D()
  body.moveTo(-L * 0.5, 0)
  body.bezierCurveTo(-L * 0.45, -W, L * 0.2, -W * 1.05, L * 0.5, -W * 0.2)
  body.bezierCurveTo(L * 0.55, 0, L * 0.55, W * 0.1, L * 0.5, W * 0.2)
  body.bezierCurveTo(L * 0.2, W * 1.05, -L * 0.45, W, -L * 0.5, 0)
  const pg = c.createLinearGradient(0, -W, 0, W)
  pg.addColorStop(0, ah(C(28, 40, 34))); pg.addColorStop(0.5, ah(C(26, 45, 24))); pg.addColorStop(1, ah(C(24, 40, 14)))
  c.fillStyle = pg; c.fill(body)
  c.save(); c.clip(body)
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(lw, 0.02)
  c.beginPath()
  for (let i = 0; i < 9; i++) { const x = -L * 0.35 + i * L * 0.1; c.moveTo(x, -W); c.quadraticCurveTo(x + 0.04, 0, x, W) }
  c.stroke()
  c.fillStyle = 'rgba(255,235,200,0.18)'; c.beginPath(); c.ellipse(-L * 0.05, -W * 0.45, L * 0.3, W * 0.2, 0, 0, TAU); c.fill()
  c.restore()
  c.restore()
  for (const cl of p.clubs) {
    const s = bodyState({ scale: 1 }, g, cl.delay, fx)
    if (s.gb <= 0) continue
    AGE = s.age
    const ext = (0.1 + 0.9 * smooth(0, 1, s.grow)) * (cl.h + p.depth)
    const x1 = cl.x + cl.bend * 0.5, n = 14
    const pts = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push([lerp(px + Math.cos(pu.ang) * pu.len * 0.4, x1, t) + Math.sin(t * Math.PI) * cl.bend * 0.35, lerp(py - 0.05, py - ext, t)])
    }
    const up = pts.filter((q) => q[1] <= 0.05)
    const w = cl.w * (0.6 + 0.4 * s.grow)
    const ws = pts.map((q, i) => {
      const above = -q[1]
      const headStart = ext - p.depth - cl.head * s.grow
      return above > headStart && headStart > -p.depth ? w * (1.5 + 0.7 * Math.sin(Math.min(1, (above - headStart) / Math.max(0.1, cl.head * s.grow)) * Math.PI * 0.85)) : w * 0.85
    })
    // pale mycelial cord underground, orange club above
    c.strokeStyle = ah(C(32, 40, 80), 0, 0.9); c.lineCap = 'round'; c.lineWidth = Math.max(lw, w * 0.7)
    const under = pts.filter((q) => q[1] >= -0.02)
    if (under.length > 1) c.stroke(polyline(under))
    if (up.length > 1) {
      const idx = pts.findIndex((q) => q[1] <= 0)
      const a = Math.max(0, idx - 1)
      const tb = tube(pts.slice(a), ws.slice(a))
      const og = c.createLinearGradient(x1 - w * 2, 0, x1 + w * 2, 0)
      og.addColorStop(0, ah(C(18, 92, 42))); og.addColorStop(0.45, ah(C(24, 96, 60))); og.addColorStop(1, ah(C(16, 90, 38)))
      c.fillStyle = og; c.fill(tb)
      c.save(); c.clip(tb)
      const dots = new Path2D()
      const top = pts[pts.length - 1]
      const hl = cl.head * s.grow
      for (let i = 0; i < 46 * Math.max(0.5, ENV.detail); i++) {
        const yy = top[1] + rb() * hl, xx = x1 + (rb() - 0.5) * w * 2.4
        dots.moveTo(xx + 0.012, yy); dots.arc(xx, yy, 0.012, 0, TAU)
      }
      c.fillStyle = ah(C(36, 96, 70), 0, 0.8); c.fill(dots)
      c.restore()
      c.strokeStyle = 'rgba(255,230,190,0.25)'; c.lineWidth = Math.max(lw, w * 0.12)
      c.beginPath(); for (let i = a; i < pts.length; i++) i === a ? c.moveTo(pts[i][0] - w * 0.3, pts[i][1]) : c.lineTo(pts[i][0] - w * 0.3, pts[i][1]); c.stroke()
    }
  }
  const mg = c.createRadialGradient(0, 0, 0, 0, 0, 0.5)
  mg.addColorStop(0, 'rgba(25,14,6,0.7)'); mg.addColorStop(1, 'rgba(25,14,6,0)')
  c.save(); c.scale(1, 0.3); c.fillStyle = mg; c.beginPath(); c.arc(0, 0, 0.5, 0, TAU); c.fill(); c.restore()
}

// rot / drying marks on a cap
function drawFateTexture(cap, sh, s) {
  const f = s.f
  if (!s.fate || f <= 0.05) return
  const rb = mulberry(0x2545f491)
  const R = sh.R
  if (s.fate === 'rot') {
    const n = Math.round(22 * f * Math.max(0.5, ENV.detail))
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(rb()), phi = (rb() * 2 - 1) * Math.PI * 0.5
      const p = surfPt(sh, u, phi), d = R * (0.05 + rb() * 0.14) * (0.5 + f)
      c.fillStyle = `rgba(20,12,4,${0.25 + 0.3 * f})`
      c.beginPath(); c.ellipse(p[0], p[1], d, d * 0.6, rb() * 3, 0, TAU); c.fill()
    }
    if (f > 0.4) {
      const m = smooth(0.4, 1, f)
      for (let i = 0; i < 9; i++) {
        const u = Math.sqrt(rb()), phi = (rb() * 2 - 1) * Math.PI * 0.5
        const p = surfPt(sh, u, phi), d = R * (0.12 + rb() * 0.18)
        const gr = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], d)
        gr.addColorStop(0, `rgba(205,215,190,${0.55 * m})`); gr.addColorStop(1, 'rgba(205,215,190,0)')
        c.fillStyle = gr; c.beginPath(); c.arc(p[0], p[1], d, 0, TAU); c.fill()
      }
    }
  } else if (s.fate === 'dry') {
    const cr = new Path2D()
    for (let i = 0; i < 28; i++) {
      const phi = (((i + rb()) / 28) * 2 - 1) * Math.PI * 0.5
      let started = false
      for (let k = 0; k <= 7; k++) {
        const u = lerp(0.08 + rb() * 0.15, 1, k / 7)
        if (facing(sh, u, phi) < 0) { started = false; continue }
        const p = surfPt(sh, u, phi + (rb() - 0.5) * 0.04)
        if (started) cr.lineTo(p[0], p[1]); else { cr.moveTo(p[0], p[1]); started = true }
      }
    }
    c.strokeStyle = `rgba(30,18,8,${0.45 * f})`; c.lineWidth = Math.max(1 / K, R * 0.016); c.stroke(cr)
  }
}


function rimW(waves, th) { let v = 1; for (const w of waves) v += w.amp * Math.sin(w.k * th + w.ph); return v }
function rimV(waves, th) { let v = 0; for (const w of waves) v += w.vamp * Math.sin(w.k * th + w.pv); return v }
// cap frame: the stem apex is the origin; heights are measured up from the cap's base plane
function rimPt(cap, sh, th, lip = 0) {
  const R = sh.R * rimW(cap.waves, th)
  const base = -sh.gRise
  return [sh.off + R * Math.sin(th), -(base + sh.h1 + R * Math.cos(th) * sh.tilt + rimV(cap.waves, th) * sh.R) + lip * Math.max(0, Math.cos(th))]
}
function surfPt(sh, u, phi) {
  const rho = u * sh.R
  return [sh.off + rho * Math.sin(phi), -(-sh.gRise + sh.h(u) + rho * Math.cos(phi) * sh.tilt)]
}
// how squarely a surface point faces the (slightly low) camera; < 0 means hidden
function facing(sh, u, phi) {
  const du = 0.01
  const hp = (sh.h(Math.min(1, u + du)) - sh.h(Math.max(0, u - du))) / (2 * du * sh.R)
  const n = Math.sqrt(1 + hp * hp)
  return (-hp / n) * Math.cos(phi) - (1 / n) * sh.tilt
}

function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], hi = []
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}

function drawUnderside(cap, sh, s, r, stemW) {
  const g = cap.gills
  const NR = 56
  const rim = []
  for (let i = 0; i < NR; i++) rim.push(rimPt(cap, sh, (i / NR) * TAU))
  const apexRing = []
  for (let i = 0; i < 8; i++) { const th = (i / 8) * TAU; apexRing.push([stemW * Math.sin(th), -stemW * Math.cos(th) * sh.tilt]) }
  const hp = hull(rim.concat(apexRing))
  c.save()
  c.beginPath(); hp.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath()
  c.clip()
  const deliq = cap.deliq ? smooth(0.0, 0.6, s.dq) : 0
  let gc = mix(g.col, g.old, s.age)
  if (deliq) gc = mix(gc, C(280, 15, 6), deliq)
  const [gh, gs, gl] = aged(gc)
  const ext = sh.R * 1.3
  c.fillStyle = hsl(gh, gs, gl * 0.82)
  c.fillRect(sh.off - ext, -ext * 2, ext * 2, ext * 3)
  const lw = 1 / K
  if (g.type === 'pores') {
    c.fillStyle = hsl(gh, gs, gl * 0.55, 0.8)
    c.beginPath()
    const n = Math.round(g.n * ENV.detail)
    for (let i = 0; i < n; i++) {
      const th = r() * TAU, u = Math.sqrt(r())
      const p = rimPt(cap, sh, th)
      const x = lerp(0, p[0], u), y = lerp(0, p[1], u)
      const d = 0.018 + r() * 0.012
      c.rect(x, y, d, d * 0.7)
    }
    c.fill()
  } else if (g.type === 'ridges') {
    const n = Math.round(g.n * Math.max(0.6, ENV.detail))
    const pts = []
    for (let i = 0; i < n; i++) pts.push((i + r() * 0.4) / n * TAU)
    const dark = new Path2D(), light = new Path2D()
    for (let i = 0; i < n; i++) {
      const p = rimPt(cap, sh, pts[i])
      const f = 0.35 + r() * 0.3
      const q = rimPt(cap, sh, (pts[i] + pts[(i + 1) % n] + (i === n - 1 ? TAU : 0)) / 2)
      const fx = lerp(p[0], 0, f), fy = lerp(p[1], 0, f)
      const mx = lerp(q[0], 0, f + 0.12), my = lerp(q[1], 0, f + 0.12)
      for (const [path, dx] of [[dark, 0.02], [light, -0.012]]) {
        path.moveTo(p[0] + dx, p[1]); path.lineTo(fx + dx, fy)
        if (i % 2) path.lineTo(mx + dx, my); else path.lineTo(dx, 0)
      }
    }
    c.lineCap = 'round'
    c.strokeStyle = hsl(gh, gs, gl * 0.62, 0.7); c.lineWidth = Math.max(lw, sh.R * 0.035); c.stroke(dark)
    c.strokeStyle = hsl(gh, gs * 0.9, Math.min(95, gl * 1.15), 0.7); c.lineWidth = Math.max(lw, sh.R * 0.018); c.stroke(light)
  } else {
    const n = Math.round(g.n * Math.max(0.5, ENV.detail))
    const dark = new Path2D(), light = new Path2D()
    for (let i = 0; i < n; i++) {
      const th = (i + (r() - 0.5) * 0.5) / n * TAU
      const p = rimPt(cap, sh, th)
      const from = i % 2 ? lerp(0.35, 0.75, r()) : 0 // lamellulae start part way out
      const sx = lerp(stemW * Math.sin(th), p[0], from), sy = lerp(0, p[1], from)
      dark.moveTo(sx, sy); dark.lineTo(p[0], p[1])
      light.moveTo(sx + 0.01, sy - 0.006); light.lineTo(p[0] + 0.01, p[1] - 0.006)
    }
    c.strokeStyle = hsl(gh, gs, gl * 0.5, 0.75); c.lineWidth = Math.max(lw, sh.R * 0.012); c.stroke(dark)
    c.strokeStyle = hsl(gh, gs * 0.8, Math.min(97, gl * 1.12), 0.55); c.lineWidth = Math.max(lw * 0.7, sh.R * 0.007); c.stroke(light)
  }
  // depth: darker towards the stem, side shading
  const ag = c.createRadialGradient(0, 0, 0, 0, 0, sh.R * 1.1)
  ag.addColorStop(0, 'rgba(0,0,0,0.6)'); ag.addColorStop(0.5, 'rgba(0,0,0,0.25)'); ag.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = ag; c.fillRect(sh.off - ext, -ext * 2, ext * 2, ext * 3)
  sideShade(sh.off, sh.R, 0.4)
  c.restore()
  // gill edges catch light along the back rim
  c.beginPath()
  for (let i = 0; i <= 24; i++) { const p = rimPt(cap, sh, Math.PI / 2 + (i / 24) * Math.PI); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]) }
  c.strokeStyle = hsl(gh, gs * 0.6, Math.min(96, gl * 1.1), 0.5); c.lineWidth = Math.max(lw, sh.R * 0.015); c.stroke()
}

function sideShade(cx, R, amt) {
  const lx = LX || 0.001
  const sg = c.createLinearGradient(cx + lx * R, 0, cx - lx * R, 0)
  sg.addColorStop(0, `rgba(255,248,230,${0.12 * Math.abs(lx)})`)
  sg.addColorStop(0.45, 'rgba(0,0,0,0)')
  sg.addColorStop(1, `rgba(0,0,0,${amt * (0.4 + 0.6 * Math.abs(lx))})`)
  c.fillStyle = sg; c.fillRect(cx - R * 2, -R * 6, R * 4, R * 8)
}

function drawDome(cap, sh, s, r) {
  const NS = 40
  const R = sh.R
  const wl = rimW(cap.waves, -Math.PI / 2), wr = rimW(cap.waves, Math.PI / 2)
  const vl = rimV(cap.waves, -Math.PI / 2) * R, vr = rimV(cap.waves, Math.PI / 2) * R
  const path = new Path2D()
  let topY = 0
  for (let i = 0; i <= NS; i++) {
    const x = -1 + (2 * i) / NS, ax = Math.abs(x)
    let best = -1e9
    for (let k = 0; k <= 10; k++) {
      const u = ax + ((1 - ax) * k) / 10
      const v = sh.h(u) + Math.sqrt(Math.max(0, u * u - ax * ax)) * R * sh.tilt
      if (v > best) best = v
    }
    best += (x < 0 ? vl : vr) * smooth(0.6, 1, ax)
    const px = sh.off + x * R * (x < 0 ? wl : wr), py = -(-sh.gRise + best)
    if (py < topY) topY = py
    i ? path.lineTo(px, py) : path.moveTo(px, py)
  }
  const lip = Math.max(0.02, R * 0.05)
  for (let i = 0; i <= 30; i++) { const p = rimPt(cap, sh, Math.PI / 2 - (i / 30) * Math.PI, lip); path.lineTo(p[0], p[1]) }
  path.closePath()
  const rimY = -(-sh.gRise + sh.h1) - R * sh.tilt

  c.save()
  c.clip(path)
  const ext = R * 1.6
  // colour: centre (top) to rim (bottom)
  const vg = c.createLinearGradient(0, topY, 0, rimY + lip)
  const ce = cap.centre, rm = cap.rim
  vg.addColorStop(0, ah(cap.col, ce.dl, 1, 0, ce.dh))
  vg.addColorStop(clamp(ce.ext), ah(cap.col))
  vg.addColorStop(rm.band ? clamp(1 - rm.band * 3) : 0.85, ah(cap.col, rm.dl * 0.5, 1, 0, rm.dh * 0.5))
  vg.addColorStop(1, ah(cap.col, rm.dl, 1, rm.band ? -20 : 0, rm.dh))
  c.fillStyle = vg; c.fillRect(sh.off - ext, topY - 1, ext * 2, rimY - topY + 2 + R)

  for (const t of cap.tex) drawCapTexture(t, cap, sh, s, r)
  drawFateTexture(cap, sh, s)

  // ink-cap autodigestion: black creeping up from the rim
  if (cap.deliq && s.dq > 0) {
    const d = smooth(0, 0.8, s.dq)
    const ig = c.createLinearGradient(0, rimY + lip, 0, lerp(rimY, topY, d * 0.85))
    ig.addColorStop(0, 'rgba(14,8,16,0.95)'); ig.addColorStop(0.7, `rgba(30,20,30,${0.6 * d})`); ig.addColorStop(1, 'rgba(30,20,30,0)')
    c.fillStyle = ig; c.fillRect(sh.off - ext, topY - 1, ext * 2, rimY - topY + R)
  }

  // light: soft key highlight, side falloff, occlusion under the margin
  const hx = sh.off + LX * R * 0.45, hy = lerp(topY, rimY, 0.3)
  const hg = c.createRadialGradient(hx, hy, 0, hx, hy, R * 1.2)
  hg.addColorStop(0, 'rgba(255,250,235,0.26)'); hg.addColorStop(1, 'rgba(255,250,235,0)')
  c.fillStyle = hg; c.fillRect(sh.off - ext, topY - 1, ext * 2, rimY - topY + R)
  sideShade(sh.off, R, 0.5)
  const og = c.createLinearGradient(0, lerp(topY, rimY, 0.65), 0, rimY + lip + R * sh.tilt)
  og.addColorStop(0, 'rgba(0,0,0,0)'); og.addColorStop(1, 'rgba(0,0,0,0.32)')
  c.fillStyle = og; c.fillRect(sh.off - ext, topY - 1, ext * 2, rimY - topY + R)
  // wet gloss
  const gloss = cap.gloss * (0.3 + DAMP * 0.9) * (1 - AGE * 0.7)
  if (gloss > 0.05) {
    c.save()
    c.translate(sh.off + LX * R * 0.35, lerp(topY, rimY, 0.25)); c.scale(1, 0.4)
    const gg = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.45)
    gg.addColorStop(0, `rgba(255,255,255,${0.42 * gloss})`); gg.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = gg; c.beginPath(); c.arc(0, 0, R * 0.45, 0, TAU); c.fill()
    c.restore()
  }
  c.restore()
  // rim light on the silhouette, lit side only
  c.save(); c.clip(path)
  c.strokeStyle = `rgba(255,245,225,${0.18 + 0.2 * Math.abs(LX)})`
  c.lineWidth = Math.max(1.5 / K, R * 0.04)
  c.translate(LX * R * 0.02, R * 0.02); c.stroke(path)
  c.restore()
}

function drawCapTexture(t, cap, sh, s, r) {
  const R = sh.R
  const lw = 1 / K
  if (t.type === 'warts') {
    const fade = 1 - smooth(0.2, 1, s.age) * 0.8
    const n = Math.round(t.n * Math.max(0.5, ENV.detail))
    const [wh, ws, wl] = aged(t.col)
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(r()) * 0.97, phi = (r() * 2 - 1) * Math.PI * 0.5
      const keep = r() > u * 0.45
      const size = t.size * R * (1.15 - 0.6 * u) * (0.6 + 0.8 * r()) * lerp(1.6, 1, s.open)
      const verts = 5 + ((r() * 3) | 0), jit = []
      for (let v = 0; v < verts; v++) jit.push(0.7 + r() * 0.5)
      const rot = r() * TAU
      if (!keep) continue
      const f = facing(sh, u, phi)
      if (f < 0.02) continue
      const [x, y] = surfPt(sh, u, phi)
      const rx = size * (0.3 + 0.7 * Math.abs(Math.cos(phi))), ry = size * clamp(0.25 + f, 0.25, 1)
      const shape = (dx, dy, sc) => {
        c.beginPath()
        for (let v = 0; v < verts; v++) {
          const a = rot + (v / verts) * TAU
          const px = x + dx + Math.cos(a) * rx * jit[v] * sc, py = y + dy + Math.sin(a) * ry * jit[v] * sc
          v ? c.lineTo(px, py) : c.moveTo(px, py)
        }
        c.closePath()
      }
      shape(size * 0.12, size * 0.18, 1); c.fillStyle = `rgba(40,0,0,${0.3 * fade})`; c.fill()
      shape(0, 0, 1); c.fillStyle = hsl(wh, ws, wl * (0.86 + 0.14 * f), 0.95 * fade); c.fill()
      shape(-size * 0.15 * -LX, -size * 0.12, 0.5); c.fillStyle = `rgba(255,255,250,${0.35 * fade})`; c.fill()
    }
  } else if (t.type === 'scales') {
    const [sh_, ss, sl] = aged(t.col)
    const rows = t.rows, per = t.per
    for (let rI = 0; rI < rows; rI++) {
      const u = 0.18 + (rI / rows) * 0.8, du = 0.85 / rows
      for (let k = 0; k < per; k++) {
        const phi = (((k + (rI % 2) * 0.5 + (r() - 0.5) * 0.4) / per) * 2 - 1) * Math.PI * 0.5
        const dphi = (Math.PI / per) * 0.9
        if (facing(sh, u, phi) < 0) continue
        const a = surfPt(sh, u, phi - dphi * 0.5), b = surfPt(sh, u, phi + dphi * 0.5)
        const tip = surfPt(sh, Math.min(1, u + du * (1.1 + r() * 0.5)), phi + (r() - 0.5) * dphi * 0.4)
        const lift = R * 0.05 * (0.5 + r())
        c.beginPath(); c.moveTo(a[0], a[1])
        c.quadraticCurveTo((a[0] + tip[0]) / 2 - lift * 0.3, (a[1] + tip[1]) / 2, tip[0], tip[1] + lift * 0.2)
        c.quadraticCurveTo((b[0] + tip[0]) / 2 + lift * 0.3, (b[1] + tip[1]) / 2, b[0], b[1])
        c.closePath()
        c.fillStyle = `rgba(0,0,0,0.18)`; c.save(); c.translate(lift * 0.3, lift * 0.5); c.fill(); c.restore()
        c.fillStyle = hsl(cap.col.h, cap.col.s, Math.min(96, cap.col.l * (1 - AGE * 0.3) + 4), 0.95); c.fill()
        c.strokeStyle = hsl(sh_, ss, sl, 0.85); c.lineWidth = Math.max(lw, R * 0.03)
        c.beginPath(); c.moveTo(lerp(a[0], tip[0], 0.7), lerp(a[1], tip[1], 0.7)); c.lineTo(tip[0], tip[1] + lift * 0.2); c.stroke()
      }
    }
  } else if (t.type === 'striate' || t.type === 'fibrils') {
    const n = Math.round(t.n * Math.max(0.5, ENV.detail))
    const dark = new Path2D(), light = new Path2D()
    const from = t.type === 'striate' ? t.from : 0.05
    for (let i = 0; i < n; i++) {
      const phi = (((i + r()) / n) * 2 - 1) * Math.PI * 0.5
      const path = r() < 0.65 ? dark : light
      let started = false
      const u0 = from + r() * 0.1
      for (let k = 0; k <= 8; k++) {
        const u = lerp(u0, 1, k / 8)
        if (facing(sh, u, phi) < 0) { started = false; continue }
        const p = surfPt(sh, u, phi)
        if (started) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); started = true }
      }
    }
    c.lineWidth = Math.max(lw, R * (t.type === 'striate' ? 0.014 : 0.008))
    c.strokeStyle = `rgba(20,10,5,${t.a})`; c.stroke(dark)
    c.strokeStyle = `rgba(255,250,235,${t.a * 0.6})`; c.stroke(light)
  } else if (t.type === 'zones') {
    const n = t.n
    for (let k = n; k >= 1; k--) {
      if (k % 2) continue
      const u0 = (k - 0.5) / (n + 1), u1 = (k + 0.5) / (n + 1)
      c.beginPath()
      for (let i = 0; i <= 20; i++) { const p = surfPt(sh, u0, (i / 20 - 0.5) * Math.PI); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]) }
      for (let i = 20; i >= 0; i--) { const p = surfPt(sh, u1, (i / 20 - 0.5) * Math.PI); c.lineTo(p[0], p[1]) }
      c.closePath()
      c.fillStyle = ah(t.col, 0, 0.55); c.fill()
    }
  } else if (t.type === 'speckles') {
    const n = Math.round(t.n * Math.max(0.5, ENV.detail))
    c.fillStyle = ah(t.col, 0, 0.8)
    c.beginPath()
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(r()), phi = (r() * 2 - 1) * Math.PI * 0.5
      const d = R * (0.01 + r() * 0.025)
      if (facing(sh, u, phi) < 0.05) continue
      const p = surfPt(sh, u, phi)
      c.moveTo(p[0] + d, p[1]); c.arc(p[0], p[1], d, 0, TAU)
    }
    c.fill()
  } else if (t.type === 'bruise') {
    const a = 0.3 + 0.7 * AGE
    const rb = mulberry(0x3c6ef372)
    for (let i = 0; i < (t.n || 5); i++) {
      const phi = (rb() * 2 - 1) * Math.PI * 0.45, u0 = 0.78 + rb() * 0.2
      const p = surfPt(sh, u0, phi), d = R * (0.05 + rb() * 0.08)
      c.fillStyle = hsl(205, 55, 34, 0.4 * a)
      c.beginPath(); c.ellipse(p[0], p[1], d * 1.6, d, 0, 0, TAU); c.fill()
    }
  } else if (t.type === 'mottle') {
    for (let i = 0; i < t.n; i++) {
      const u = Math.sqrt(r()), phi = (r() * 2 - 1) * Math.PI * 0.5
      const d = R * (0.08 + r() * 0.2)
      const p = surfPt(sh, u, phi)
      c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,240,220,0.05)'
      c.beginPath(); c.ellipse(p[0], p[1], d, d * 0.6, r() * 3, 0, TAU); c.fill()
    }
  }
}

function drawStem(st, sp, s, r, L) {
  const N = sp.length - 1
  const path = new Path2D()
  for (let i = 0; i <= N; i++) { const p = sp[i]; const x = p.x - p.nx * p.w, y = p.y - p.ny * p.w; i ? path.lineTo(x, y) : path.moveTo(x, y) }
  for (let i = N; i >= 0; i--) { const p = sp[i]; path.lineTo(p.x + p.nx * p.w, p.y + p.ny * p.w) }
  const b0 = sp[0]
  path.quadraticCurveTo(b0.x, b0.y + b0.w * 0.25, b0.x - b0.nx * b0.w, b0.y - b0.ny * b0.w)
  path.closePath()
  let minX = 1e9, maxX = -1e9, wMax = 0
  for (const p of sp) { minX = Math.min(minX, p.x - p.w); maxX = Math.max(maxX, p.x + p.w); wMax = Math.max(wMax, p.w) }
  const midX = (minX + maxX) / 2, half = (maxX - minX) / 2 + 0.001
  // cylinder shading across the stem
  const g = c.createLinearGradient(midX - half, 0, midX + half, 0)
  const lit = clamp(0.5 + LX * 0.25, 0.15, 0.85)
  g.addColorStop(0, ah(st.col, -24)); g.addColorStop(lit * 0.7, ah(st.col, 2)); g.addColorStop(lit, ah(st.col, 6))
  g.addColorStop(Math.min(0.95, lit + 0.25), ah(st.col, -4)); g.addColorStop(1, ah(st.col, -30))
  c.fillStyle = g; c.fill(path)

  c.save(); c.clip(path)
  const lw = 1 / K
  const along = (o, t0, t1, pth) => {
    const i0 = Math.round(t0 * N), i1 = Math.round(t1 * N)
    for (let i = i0; i <= i1; i++) { const p = sp[i]; const x = p.x + p.nx * p.w * o, y = p.y + p.ny * p.w * o; i === i0 ? pth.moveTo(x, y) : pth.lineTo(x, y) }
  }
  if (st.tex === 'fibrils' || st.tex === 'snakeskin' || st.tex === 'net') {
    const fib = new Path2D()
    for (let i = 0; i < 16; i++) along(r() * 1.8 - 0.9, r() * 0.3, 0.7 + r() * 0.3, fib)
    c.strokeStyle = 'rgba(60,40,20,0.12)'; c.lineWidth = Math.max(lw, wMax * 0.04); c.stroke(fib)
  }
  if (st.tex === 'snakeskin') {
    const top = st.ring ? st.ring.t : 0.9
    const zz = new Path2D()
    for (let t = 0.12; t < top - 0.04; t += 0.045 + r() * 0.03) {
      const i = Math.round(t * N), p = sp[i]
      for (let k = 0; k <= 8; k++) {
        const o = k / 8 * 2 - 1
        const x = p.x + p.nx * p.w * o, y = p.y + p.ny * p.w * o + ((k % 2) ? -1 : 1) * p.w * (0.05 + r() * 0.1) + Math.abs(o) * -p.w * 0.15
        k ? zz.lineTo(x, y) : zz.moveTo(x, y)
      }
    }
    c.strokeStyle = 'rgba(120,95,60,0.14)'; c.lineWidth = Math.max(lw, wMax * 0.05); c.stroke(zz)
  }
  if (st.tex === 'net') {
    c.lineWidth = Math.max(lw, wMax * 0.022)
    const net = new Path2D()
    let row = 0
    for (let t = 0.45; t < 0.98; t += 0.032, row++) {
      const i = Math.round(t * N), p = sp[i]
      const cols = 9
      for (let k = 0; k < cols; k++) {
        const o = ((k + (row % 2) * 0.5 + (r() - 0.5) * 0.3) / cols) * 2 - 1
        if (Math.abs(o) > 0.95) continue
        const x = p.x + p.nx * p.w * o, y = p.y + (r() - 0.5) * p.w * 0.03
        const rx = (p.w / cols) * (0.7 + r() * 0.4) * Math.sqrt(1 - o * o), ry = p.w * (0.05 + r() * 0.03)
        net.moveTo(x + rx, y); net.ellipse(x, y, rx, ry, (r() - 0.5) * 0.4, 0, TAU)
      }
    }
    const fadeNet = c.createLinearGradient(0, sp[Math.round(0.45 * N)].y, 0, sp[N].y)
    fadeNet.addColorStop(0, 'rgba(255,250,236,0)'); fadeNet.addColorStop(0.4, 'rgba(255,250,236,0.4)'); fadeNet.addColorStop(1, 'rgba(255,250,236,0.55)')
    c.strokeStyle = fadeNet
    c.stroke(net)
  }
  if (st.bruise) {
    const rb = mulberry(0x1b873593)
    c.fillStyle = hsl(205, 55, 36, 0.28 + 0.4 * AGE)
    for (let i = 0; i < 6; i++) {
      const p = sp[Math.round((0.05 + rb() * 0.35) * N)], o = (rb() * 2 - 1) * 0.6
      c.beginPath(); c.ellipse(p.x + p.nx * p.w * o, p.y + p.ny * p.w * o, p.w * 0.35, p.w * (0.8 + rb()), 0, 0, TAU); c.fill()
    }
  }
  if (s.fate === 'dry' && s.f > 0.1) {
    const rb = mulberry(0x68e31da4), wr = new Path2D()
    for (let i = 0; i < 22; i++) {
      const p = sp[1 + Math.floor(rb() * (N - 1))]
      wr.moveTo(p.x - p.w, p.y); wr.lineTo(p.x + p.w, p.y + (rb() - 0.5) * p.w * 0.4)
    }
    c.strokeStyle = `rgba(40,25,10,${0.4 * s.f})`; c.lineWidth = Math.max(lw, wMax * 0.05); c.stroke(wr)
  }
  // soil stain at the base, occlusion under the cap
  const by = sp[0].y, ty = sp[N].y
  const dg = c.createLinearGradient(0, by, 0, lerp(by, ty, 0.3))
  dg.addColorStop(0, 'rgba(40,26,12,0.55)'); dg.addColorStop(1, 'rgba(40,26,12,0)')
  c.fillStyle = dg; c.fillRect(minX - 1, ty - 1, maxX - minX + 2, by - ty + 2)
  const og = c.createLinearGradient(0, ty, 0, lerp(ty, by, 0.25))
  og.addColorStop(0, 'rgba(0,0,0,0.45)'); og.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = og; c.fillRect(minX - 1, ty - 1, maxX - minX + 2, by - ty + 2)
  if (st.ring) {
    const p = sp[Math.round(st.ring.t * N)]
    const sg = c.createLinearGradient(0, p.y, 0, p.y + st.ring.len * s.sz * 1.8)
    sg.addColorStop(0, 'rgba(0,0,0,0.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = sg; c.fillRect(minX - 1, p.y, maxX - minX + 2, st.ring.len * s.sz * 2)
  }
  c.restore()

  if (st.volva === 'rings') {
    const p = sp[0], bw = sp[1].w
    c.lineCap = 'round'
    for (let k = 0; k < 3; k++) {
      const y = p.y - bw * (0.3 + k * 0.3)
      const w = bw * (1.1 - k * 0.12)
      for (const [col, dy, lwf] of [['rgba(60,40,20,0.25)', bw * 0.05, 0.09], [ah(C(48, 22, 93), 0, 0.8), 0, 0.07]]) {
        c.strokeStyle = col; c.lineWidth = Math.max(lw, bw * lwf)
        c.beginPath()
        for (let i = 0; i <= 14; i++) {
          const o = i / 14 * 2 - 1
          const x = p.x + o * w, yy = y + dy + (1 - o * o) * bw * 0.16 + (r() - 0.5) * bw * 0.06
          i ? c.lineTo(x, yy) : c.moveTo(x, yy)
        }
        c.stroke()
      }
    }
  } else if (st.volva === 'cup') {
    const p = sp[0], bw = sp[0].w * 1.35, vh = bw * 1.3
    c.beginPath(); c.moveTo(p.x - bw, p.y)
    c.quadraticCurveTo(p.x - bw * 1.25, p.y - vh * 0.6, p.x - bw * 1.05, p.y - vh)
    for (let i = 1; i <= 6; i++) c.lineTo(p.x - bw * 1.05 + (i / 6) * bw * 2.1, p.y - vh + (i % 2 ? vh * 0.25 : 0))
    c.quadraticCurveTo(p.x + bw * 1.25, p.y - vh * 0.6, p.x + bw, p.y)
    c.closePath()
    const vg = c.createLinearGradient(p.x - bw, 0, p.x + bw, 0)
    vg.addColorStop(0, ah(C(40, 15, 70))); vg.addColorStop(0.4, ah(C(42, 15, 86))); vg.addColorStop(1, ah(C(38, 15, 60)))
    c.fillStyle = vg; c.fill()
  }
  if (st.ring && s.open > 0.25) {
    const i = Math.round(st.ring.t * N), p = sp[i]
    const len = st.ring.len * s.sz * smooth(0.25, 0.8, s.open)
    const w = p.w, fl = w * (1.4 + st.ring.len)
    const hem = []
    for (let k = 0; k <= 12; k++) {
      const o = k / 12 * 2 - 1
      hem.push([p.x + o * fl, p.y + len * (0.75 + 0.25 * Math.cos(o * 1.5)) + Math.sin(k * 2.3) * len * 0.07])
    }
    c.beginPath(); c.moveTo(p.x - w, p.y - w * 0.15)
    c.quadraticCurveTo(p.x - fl * 0.9, p.y + len * 0.2, hem[0][0], hem[0][1])
    for (const h of hem) c.lineTo(h[0], h[1])
    c.quadraticCurveTo(p.x + fl * 0.9, p.y + len * 0.2, p.x + w, p.y - w * 0.15)
    c.closePath()
    const rg = c.createLinearGradient(p.x - fl, 0, p.x + fl, 0)
    rg.addColorStop(0, ah(st.ring.col, -26)); rg.addColorStop(lit, ah(st.ring.col, 4)); rg.addColorStop(1, ah(st.ring.col, -30))
    c.fillStyle = rg; c.fill()
    c.save(); c.clip()
    c.strokeStyle = 'rgba(80,60,40,0.22)'; c.lineWidth = Math.max(lw, w * 0.06)
    c.beginPath()
    for (let k = 1; k < 12; k++) { const h = hem[k]; c.moveTo(lerp(p.x, h[0], 0.3), p.y); c.lineTo(h[0], h[1]) }
    c.stroke()
    c.restore()
  }
}
function moss(r, x0, x1, y, h, n) {
  const p = new Path2D(), q = new Path2D()
  for (let i = 0; i < n * Math.max(0.5, ENV.detail); i++) {
    const x = lerp(x0, x1, r()), yy = y + r() * h
    const pth = r() < 0.5 ? p : q
    for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (r() - 0.5) * 1.6, l = 0.04 + r() * 0.08; pth.moveTo(x, yy); pth.lineTo(x + Math.cos(a) * l, yy + Math.sin(a) * l) }
  }
  c.lineCap = 'round'
  c.lineWidth = Math.max(1 / K, 0.025)
  c.strokeStyle = ah(C(95, 45, 24)); c.stroke(p)
  c.strokeStyle = ah(C(80, 50, 36)); c.stroke(q)
}

function drawBracket(br, s, r) {
  const sz = s.sz * lerp(0.55, 1, s.open)
  const rx = br.w * sz, ry = rx * br.ry, th = br.th * sz
  const lw = 1 / K
  c.save(); c.translate(br.x, br.y); c.scale(br.dir || 1, 1); c.rotate(br.ang)
  const edge = (f, a) => { const w = rimW(br.waves, a * 2) * f; return [Math.cos(a) * rx * w, Math.sin(a) * ry * w] }
  // underside and thickness
  c.beginPath()
  for (let i = 0; i <= 30; i++) { const p = edge(1, (i / 30) * Math.PI); i ? c.lineTo(p[0], p[1] + th) : c.moveTo(p[0], p[1] + th) }
  for (let i = 30; i >= 0; i--) { const p = edge(1, (i / 30) * Math.PI); c.lineTo(p[0], p[1]) }
  c.closePath()
  c.fillStyle = ah(br.pore, -18); c.fill()
  c.beginPath(); c.moveTo(-rx, 0)
  for (let i = 0; i <= 30; i++) { const p = edge(1, Math.PI - (i / 30) * Math.PI); c.lineTo(p[0], p[1] + th * 0.5) }
  c.strokeStyle = ah(br.pore, -4, 0.6); c.lineWidth = Math.max(lw, th * 0.5); c.stroke()
  // banded upper surface, painted outermost first
  const top = new Path2D()
  top.moveTo(0, -ry * 0.12)
  for (let i = 0; i <= 40; i++) { const p = edge(1, Math.PI - (i / 40) * Math.PI); top.lineTo(p[0], p[1]) }
  top.closePath()
  c.save(); c.clip(top)
  let total = 0
  for (const b of br.bands) total += b.w
  let acc = total
  for (let k = br.bands.length - 1; k >= 0; k--) {
    const f = acc / total
    acc -= br.bands[k].w
    c.beginPath(); c.moveTo(0, 0)
    for (let i = 0; i <= 30; i++) {
      const a = Math.PI - (i / 30) * Math.PI
      const p = edge(f * (1 + (r() - 0.5) * 0.03), a)
      c.lineTo(p[0], p[1])
    }
    c.closePath()
    c.fillStyle = ah(br.bands[k].col); c.fill()
  }
  if (br.velvet) {
    const v = new Path2D()
    for (let i = 0; i < 160 * Math.max(0.5, ENV.detail); i++) {
      const a = r() * Math.PI, f0 = r() * 0.9
      const p0 = edge(f0, a), p1 = edge(f0 + 0.06 + r() * 0.08, a)
      v.moveTo(p0[0], p0[1]); v.lineTo(p1[0], p1[1])
    }
    c.strokeStyle = 'rgba(255,245,230,0.1)'; c.lineWidth = Math.max(lw, 0.012); c.stroke(v)
  }
  // shading: dark at the attachment, light on the near edge
  const ag = c.createRadialGradient(0, 0, 0, 0, 0, rx)
  ag.addColorStop(0, 'rgba(0,0,0,0.55)'); ag.addColorStop(0.35, 'rgba(0,0,0,0.12)'); ag.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = ag; c.fillRect(-rx * 1.2, -ry, rx * 2.4, ry * 2.4)
  sideShade(0, rx, 0.35)
  if (br.gloss > 0.5) {
    c.save(); c.translate(LX * rx * 0.3, ry * 0.45); c.scale(1, 0.35)
    const gg = c.createRadialGradient(0, 0, 0, 0, 0, rx * 0.5)
    gg.addColorStop(0, `rgba(255,240,220,${0.35 * (0.4 + DAMP)})`); gg.addColorStop(1, 'rgba(255,240,220,0)')
    c.fillStyle = gg; c.beginPath(); c.arc(0, 0, rx * 0.5, 0, TAU); c.fill(); c.restore()
  }
  c.restore()
  // pale growing margin
  c.beginPath()
  for (let i = 0; i <= 40; i++) { const p = edge(0.985, Math.PI - (i / 40) * Math.PI); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]) }
  c.strokeStyle = ah(br.margin, 0, 0.9); c.lineWidth = Math.max(lw, Math.max(th * 0.45, rx * 0.025)); c.stroke()
  c.restore()
}

// --- litter around each fruit's base ---------------------------------------------------
function leaf(r, x, y, len) {
  const col = pickOf(r, [C(28, 55, 28), C(38, 50, 34), C(18, 45, 24), C(45, 35, 30), C(10, 40, 20)])
  const a = (r() - 0.5) * 1.2, wid = len * (0.25 + r() * 0.2)
  c.save(); c.translate(x, y); c.scale(1, 0.4); c.rotate(a)
  c.beginPath(); c.moveTo(-len / 2, 0)
  c.quadraticCurveTo(0, -wid * 1.4, len / 2, 0); c.quadraticCurveTo(0, wid * 1.4, -len / 2, 0)
  c.fillStyle = ah(col, (r() - 0.5) * 8); c.fill()
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(1 / K, len * 0.03)
  c.beginPath(); c.moveTo(-len / 2, 0); c.lineTo(len / 2, 0); c.stroke()
  c.restore()
}
function drawLitter(r, gen) {
  const spread = 1.1
  const n = 3 + ((r() * 4) | 0)
  for (let i = 0; i < n; i++) leaf(r, (r() * 2 - 1) * spread, 0.05 + r() * 0.2, 0.5 + r() * 0.5)
  moss(r, -spread * 0.8, spread * 0.8, 0.0, 0.18, 30)
  // a few needles and a twig
  c.strokeStyle = ah(C(30, 30, 26)); c.lineWidth = Math.max(1 / K, 0.02)
  c.beginPath()
  for (let i = 0; i < 6; i++) { const x = (r() * 2 - 1) * spread, y = 0.05 + r() * 0.25, a = (r() - 0.5) * 0.8; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.08) }
  c.stroke()
}
