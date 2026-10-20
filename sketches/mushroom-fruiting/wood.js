// Colorado conifers and hardwoods that die, fall and rot, drawn as bark sprites.
// A trunk is baked as a horizontal sprite (base at x = 0, ground at y = 0, units
// of ~3 cm) for one decay stage at a time: bark that peels, wood that silvers and
// cracks into red cubes (brown rot in conifers) or bleaches and frays (white rot
// in hardwoods), moss, seedlings, and finally a crumbled mound.
import { TAU, clamp, lerp, smooth, mulberry, C, hsl, mix, pickOf } from './util.js'

export const TREES = {
  aspen: { name: 'Quaking aspen', latin: 'Populus tremuloides', hard: true, L: [7, 10], D: [0.8, 1.05], taper: 0.35, hs: [1.2, 2.2], style: 'aspen', bark: C(65, 12, 80), dark: C(40, 15, 16), wood: C(42, 30, 76), heart: C(45, 30, 84), rotc: C(40, 20, 58) },
  cottonwood: { name: 'Narrowleaf cottonwood', latin: 'Populus angustifolia', hard: true, L: [7, 10], D: [0.9, 1.2], taper: 0.3, hs: [1.2, 2.4], style: 'furrow', bark: C(35, 10, 50), dark: C(30, 15, 10), wood: C(38, 35, 70), heart: C(40, 40, 78), rotc: C(38, 18, 56) },
  oak: { name: 'Gambel oak', latin: 'Quercus gambelii', hard: true, L: [4.5, 6.5], D: [0.65, 0.9], taper: 0.3, hs: [1, 1.8], style: 'furrow', bark: C(30, 12, 34), dark: C(25, 20, 8), wood: C(30, 40, 56), heart: C(28, 48, 62), rotc: C(30, 18, 48) },
  lodgepole: { name: 'Lodgepole pine', latin: 'Pinus contorta', hard: false, L: [8, 11], D: [0.55, 0.75], taper: 0.25, hs: [1.2, 2.2], style: 'scale', bark: C(22, 28, 30), dark: C(20, 35, 9), wood: C(40, 50, 70), heart: C(40, 60, 74), rotc: C(16, 40, 28) },
  ponderosa: { name: 'Ponderosa pine', latin: 'Pinus ponderosa', hard: false, L: [8, 11], D: [0.95, 1.3], taper: 0.3, hs: [1.4, 2.4], style: 'plate', bark: C(22, 60, 42), dark: C(15, 40, 9), wood: C(30, 60, 64), heart: C(30, 70, 66), rotc: C(14, 45, 30) },
  spruce: { name: 'Engelmann spruce', latin: 'Picea engelmannii', hard: false, L: [8, 11], D: [0.8, 1.1], taper: 0.3, hs: [1.2, 2.2], style: 'flake', bark: C(14, 28, 27), dark: C(10, 30, 9), wood: C(45, 32, 76), heart: C(46, 40, 82), rotc: C(16, 40, 30) },
  douglas: { name: 'Douglas-fir', latin: 'Pseudotsuga menziesii', hard: false, L: [8, 11], D: [0.95, 1.3], taper: 0.3, hs: [1.4, 2.4], style: 'ridge', bark: C(18, 38, 21), dark: C(15, 40, 7), wood: C(25, 58, 60), heart: C(24, 70, 62), rotc: C(12, 45, 28) },
  fir: { name: 'Subalpine fir', latin: 'Abies lasiocarpa', hard: false, L: [7, 10], D: [0.6, 0.85], taper: 0.3, hs: [1.1, 2], style: 'smoothfir', bark: C(30, 8, 56), dark: C(30, 12, 20), wood: C(45, 25, 78), heart: C(48, 35, 84), rotc: C(20, 32, 34) },
}
export const TREE_KEYS = Object.keys(TREES)
export const STAGES = 16

export function newPlan(r, key) {
  const sp = TREES[key]
  const rr = (a) => lerp(a[0], a[1], r())
  const Lfull = rr(sp.L)
  return { sp: key, Lfull, D: rr(sp.D), taper: sp.taper, Hs: Math.min(rr(sp.hs), Lfull * 0.3), seed: (r() * 4294967296) >>> 0 }
}

// Thickness of the trunk (units) at distance xa from its base, at decay `stage`.
export function thickAt(plan, xa, stage) {
  const sag = 1 - 0.3 * smooth(0.55, 1, stage)
  const crumble = 1 - 0.55 * smooth(0.8, 1, stage)
  return plan.D * (1 - plan.taper * clamp(xa / plan.Lfull)) * sag * crumble
}

const bk = document.createElement('canvas')

function jagEdge(r, T, x, out, tips) {
  // points from the top (y = -T) to the ground (y = 0) along a splintered break
  const pts = [[x, -T]]
  for (let i = 1; i <= tips; i++) {
    const y = -T * (1 - i / (tips + 1))
    pts.push([x + out * (0.04 + (i % 2 ? 0.1 + r() * 0.34 : r() * 0.08)), y])
  }
  pts.push([x, 0])
  return pts
}

// Bakes one trunk piece into cv. o: { len, xa (distance of its base from the
// tree's base), base: 'flare' | 'jag', stage (0..1), K (px per unit) }.
export function bakeTrunk(cv, plan, o) {
  const sp = TREES[plan.sp]
  const L = o.len, xa = o.xa || 0, stage = o.stage
  const baseEnd = o.base || 'flare'
  const r = mulberry(plan.seed ^ ((xa * 1000) | 0) ^ (L * 777) | 0)
  const pad = 0.7, topPad = 1.1
  const Dm = plan.D * 1.35
  const wU = L + pad * 2, hU = Dm + topPad + 0.5
  let K = o.K
  if (Math.max(wU, hU) * K > 1600) K = 1600 / Math.max(wU, hU)
  const pw = Math.ceil(wU * K), ph = Math.ceil(hU * K)
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
  const c = cv.getContext('2d')
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, pw, ph)
  const ox = pad * K, oy = (Dm + topPad) * K
  const T0 = thickAt(plan, xa, stage)
  const T = (x) => {
    let t = thickAt(plan, xa + x, stage)
    if (baseEnd === 'flare' && xa === 0) t *= 1 + 0.3 * Math.max(0, 1 - x / 0.5) ** 2
    return t
  }
  const ph1 = r() * 6, ph2 = r() * 6
  const rough = 0.025 + 0.1 * stage * stage
  const wob = (x) => 1 + rough * (Math.sin(x * 2.7 + ph1) * 0.6 + Math.sin(x * 7.3 + ph2) * 0.4)
  const topY = (x) => -T(x) * wob(x)

  // silhouette
  const sil = new Path2D()
  const tips = stage > 0.6 ? 3 : 6
  const farT = T(L)
  const farEdge = jagEdge(r, farT * wob(L), L, 1, tips)
  sil.moveTo(0.4, 0)
  if (baseEnd === 'flare') {
    sil.lineTo(0.1, 0.1); sil.lineTo(-0.15, 0.13); sil.lineTo(-0.12, -0.05)
    sil.lineTo(-0.04, -T0 * 0.4); sil.lineTo(0, -T(0) * wob(0))
  } else {
    const be = jagEdge(r, T0 * wob(0), 0, -1, tips)
    for (let i = be.length - 1; i >= 0; i--) sil.lineTo(be[i][0], be[i][1])
  }
  for (let x = 0.08; x <= L - 0.05; x += 0.08) sil.lineTo(x, topY(x))
  for (const p of farEdge) sil.lineTo(p[0], p[1])
  for (let x = L - 0.08; x > 0.4; x -= 0.12) sil.lineTo(x, 0.03 * Math.sin(x * 3 + ph2))
  sil.closePath()

  const wood = mix(mix(sp.wood, C(35, 8, 62), smooth(0.05, 0.4, stage)), sp.rotc, smooth(0.3, 0.85, stage))
  const heart = mix(sp.heart, wood, smooth(0.1, 0.6, stage))
  const barkCol = mix(sp.bark, C(sp.bark.h, sp.bark.s * 0.7, sp.bark.l * 0.72), smooth(0.1, 0.7, stage))
  const lit = (col, dl = 0, a = 1) => hsl(col.h, col.s, col.l + dl, a)

  c.setTransform(K, 0, 0, K, ox, oy)

  // branch stubs behind the trunk
  const nst = Math.round(L * (sp.hard ? 0.6 : 1.4))
  for (let i = 0; i < nst; i++) {
    const x = 0.7 + r() * (L - 1.0), up = r() < 0.65
    const len = (0.1 + r() * (sp.hard ? 0.45 : 0.3)) * (up ? 1 : 0.3), w = 0.04 + r() * 0.05
    const y = up ? topY(x) + 0.05 : -0.05
    const sgn = up ? -1 : 1
    c.fillStyle = lit(mix(barkCol, wood, smooth(0.2, 0.6, stage)), -8)
    c.beginPath(); c.moveTo(x - w, y); c.lineTo(x - w * 0.7, y + sgn * len); c.lineTo(x + w * 0.5, y + sgn * len * (0.8 + r() * 0.3)); c.lineTo(x + w, y); c.closePath(); c.fill()
  }

  c.save()
  c.clip(sil)
  // wood
  const wg = c.createLinearGradient(0, -Dm, 0, 0)
  wg.addColorStop(0, lit(wood, 8)); wg.addColorStop(0.5, lit(wood)); wg.addColorStop(1, lit(wood, -24))
  c.fillStyle = wg; c.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
  // grain, checks and cubical cracks
  const grain = new Path2D(), pale = new Path2D()
  const ng = Math.round(L * plan.D * 14)
  for (let i = 0; i < ng; i++) {
    const x0 = r() * L, y = -r() * T(x0), len = 0.5 + r() * 2.2
    const p = r() < 0.6 ? grain : pale
    p.moveTo(x0, y)
    for (let x = x0; x < x0 + len; x += 0.15) p.lineTo(x, y + (r() - 0.5) * (sp.hard && stage > 0.4 ? 0.07 : 0.025))
  }
  c.lineWidth = 0.025
  c.strokeStyle = 'rgba(40,25,12,0.32)'; c.stroke(grain)
  c.strokeStyle = 'rgba(255,245,225,0.2)'; c.stroke(pale)
  const cubes = smooth(0.4, 0.8, stage)
  if (cubes > 0.01 && !sp.hard) {
    const cr = new Path2D()
    for (let x = 0.2 + r() * 0.2; x < L; x += 0.22 + r() * 0.3) {
      const y1 = -T(x) * (0.2 + r() * 0.8)
      cr.moveTo(x, -T(x) * wob(x)); cr.lineTo(x + (r() - 0.5) * 0.05, y1)
      if (r() < 0.6) { cr.moveTo(x - 0.25, y1); cr.lineTo(x + 0.25, y1 + (r() - 0.5) * 0.04) }
    }
    c.lineWidth = 0.03; c.strokeStyle = `rgba(30,12,6,${0.6 * cubes})`; c.stroke(cr)
  }
  if (sp.hard && stage > 0.5) {
    const fib = new Path2D()
    for (let i = 0; i < ng; i++) { const x0 = r() * L, y = -r() * T(x0); fib.moveTo(x0, y); fib.bezierCurveTo(x0 + 0.3, y - 0.05, x0 + 0.6, y + 0.05, x0 + 0.9, y) }
    c.lineWidth = 0.03; c.strokeStyle = `rgba(255,250,235,${0.3 * smooth(0.5, 0.9, stage)})`; c.stroke(fib)
  }

  // bark on its own layer, eroded by random patches
  if (bk.width !== pw || bk.height !== ph) { bk.width = pw; bk.height = ph }
  const b = bk.getContext('2d')
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, pw, ph)
  b.setTransform(K, 0, 0, K, ox, oy)
  b.save(); b.clip(sil)
  paintBark(b, sp, barkCol, L, Dm, T, stage, r, plan.D)
  b.restore()
  const rm = smooth(0.2, 0.95, stage)
  if (rm > 0.01) {
    b.globalCompositeOperation = 'destination-out'
    const np = Math.round(L * (0.3 + rm * 3) * rm * 0.8)
    for (let i = 0; i < np; i++) {
      const cx = r() * L, cy = -r() * T(cx), sx = (0.4 + r() * 1.3) * (0.5 + rm), sy = sx * (0.5 + r() * 0.5)
      b.beginPath()
      const nv = 9
      for (let v = 0; v < nv; v++) { const a = (v / nv) * TAU, rr = 0.75 + r() * 0.5; v ? b.lineTo(cx + Math.cos(a) * sx * rr, cy + Math.sin(a) * sy * rr) : b.moveTo(cx + Math.cos(a) * sx * rr, cy + Math.sin(a) * sy * rr) }
      b.closePath(); b.fill()
    }
    b.globalCompositeOperation = 'source-over'
  }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.drawImage(bk, 0, 0)
  c.setTransform(K, 0, 0, K, ox, oy)

  // fresh splintered ends
  for (const [x0, dir] of [[0, 1], [L, -1]]) {
    if (x0 === 0 && baseEnd === 'flare') continue
    const eg = c.createLinearGradient(x0, 0, x0 + dir * 0.7, 0)
    eg.addColorStop(0, lit(heart, 0, 0.9)); eg.addColorStop(1, lit(heart, 0, 0))
    c.fillStyle = eg; c.fillRect(Math.min(x0, x0 + dir * 0.7) - 0.4, -Dm, 1.4, Dm + 0.2)
    c.strokeStyle = 'rgba(60,35,15,0.35)'; c.lineWidth = 0.02
    c.beginPath()
    for (let i = 0; i < 8; i++) { const y = -r() * T(x0), l = 0.15 + r() * 0.5; c.moveTo(x0 + dir * 0.02, y); c.lineTo(x0 + dir * l, y + (r() - 0.5) * 0.03) }
    c.stroke()
  }

  // moss, lichen and seedlings
  const mo = smooth(0.18, 0.85, stage)
  if (mo > 0.01) {
    const nm = Math.round(L * 7 * mo)
    for (let i = 0; i < nm; i++) {
      const x = r() * L, top = r() < 0.7
      const y = top ? topY(x) + r() * 0.3 : -r() * 0.25
      const rad = (0.1 + r() * 0.25) * (0.5 + mo)
      const g = c.createRadialGradient(x, y, 0, x, y, rad)
      const h = 85 + r() * 35, l = 12 + r() * 12
      g.addColorStop(0, hsl(h, 45, l + 6, 0.95)); g.addColorStop(1, hsl(h, 40, l, 0))
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill()
    }
  }
  c.restore()

  // blades of moss over the top edge, seedlings, sloughed bark on the ground
  if (mo > 0.01) {
    const bl = new Path2D(), bl2 = new Path2D()
    const nb = Math.round(L * 26 * mo)
    for (let i = 0; i < nb; i++) {
      const x = r() * L, y = topY(x) + 0.04, len = 0.05 + r() * 0.13 * (0.5 + mo), a = -Math.PI / 2 + (r() - 0.5) * 1.5
      const p = r() < 0.5 ? bl : bl2
      p.moveTo(x, y); p.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    }
    c.lineCap = 'round'; c.lineWidth = 0.035
    c.strokeStyle = hsl(95, 48, 26); c.stroke(bl)
    c.strokeStyle = hsl(82, 52, 34); c.stroke(bl2)
  }
  if (stage > 0.62) {
    const ns = 1 + ((r() * 3) | 0)
    for (let i = 0; i < ns; i++) {
      const x = 0.8 + r() * (L - 1.6), y = topY(x) + 0.05, h = 0.25 + r() * 0.4
      c.strokeStyle = hsl(30, 25, 22); c.lineWidth = 0.035
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke()
      c.strokeStyle = hsl(118, 42, 24); c.lineWidth = 0.03
      c.beginPath()
      for (let k = 1; k <= 5; k++) { const yy = y - h * (k / 6), w = 0.14 * (1 - k / 7); c.moveTo(x, yy); c.lineTo(x - w, yy + 0.06); c.moveTo(x, yy); c.lineTo(x + w, yy + 0.06) }
      c.stroke()
    }
  }
  const nsl = Math.round(L * 0.7 * smooth(0.1, 0.6, stage) * (1 - smooth(0.8, 1, stage)))
  for (let i = 0; i < nsl; i++) {
    const x = -0.3 + r() * (L + 0.3), w = 0.25 + r() * 0.5, h = 0.04 + r() * 0.06
    c.fillStyle = lit(barkCol, -10 + r() * 8)
    c.beginPath(); c.moveTo(x, 0.04); c.quadraticCurveTo(x + w / 2, 0.04 - h * 2, x + w, 0.04); c.lineTo(x + w * 0.9, 0.08); c.lineTo(x + w * 0.1, 0.08); c.closePath(); c.fill()
  }
  if (stage > 0.6) {
    c.fillStyle = lit(sp.rotc, -22)
    for (let i = 0; i < L * 8 * smooth(0.6, 1, stage); i++) { const x = r() * L, w = 0.04 + r() * 0.08; c.fillRect(x, 0.02 + r() * 0.08, w, w * 0.7) }
  }

  // light and the dark crease where the trunk meets the ground
  c.save(); c.clip(sil)
  const sg = c.createLinearGradient(0, -Dm, 0, 0)
  sg.addColorStop(0, 'rgba(255,248,230,0.14)'); sg.addColorStop(0.35, 'rgba(255,248,230,0)'); sg.addColorStop(0.72, 'rgba(0,0,0,0.12)'); sg.addColorStop(1, 'rgba(0,0,0,0.58)')
  c.fillStyle = sg; c.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
  c.restore()

  const geo = { K, ox, oy, w: pw, h: ph }
  cv.__geo = geo
  return geo
}

function paintBark(b, sp, col, L, Dm, T, stage, r, D) {
  const A = L * D
  const lit = (cc, dl = 0, a = 1) => hsl(cc.h, cc.s, cc.l + dl, a)
  const dark = sp.dark
  const g = b.createLinearGradient(0, -Dm, 0, 0)
  g.addColorStop(0, lit(col, 6)); g.addColorStop(1, lit(col, -10))
  b.fillStyle = g; b.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
  const st = sp.style
  if (st === 'aspen') {
    b.lineWidth = 0.02; b.strokeStyle = 'rgba(70,70,60,0.16)'
    const s = new Path2D()
    for (let i = 0; i < A * 40; i++) { const x = r() * L, y = -r() * T(x); s.moveTo(x, y); s.lineTo(x + 0.1 + r() * 0.4, y + (r() - 0.5) * 0.02) }
    b.stroke(s)
    b.fillStyle = lit(dark, 0, 0.8)
    for (let i = 0; i < L * 4; i++) {
      const x = r() * L, y = -r() * T(x), rx = 0.07 + r() * 0.08, ry = 0.025 + r() * 0.03
      b.beginPath(); b.ellipse(x, y, rx, ry, 0, 0, Math.PI); b.fill()
      b.strokeStyle = 'rgba(30,30,25,0.35)'; b.lineWidth = 0.02; b.beginPath(); b.ellipse(x, y - 0.03, rx * 1.2, ry * 1.3, 0, Math.PI, TAU); b.stroke()
    }
    b.fillStyle = lit(dark, 0, 0.9)
    for (let i = 0; i < 14; i++) { const x = r() * Math.min(L, 1.4), y = -r() * T(x); b.beginPath(); b.ellipse(x, y, 0.1 + r() * 0.2, 0.05 + r() * 0.12, 0, 0, TAU); b.fill() }
    b.fillStyle = 'rgba(30,30,25,0.4)'
    for (let i = 0; i < A * 8; i++) { const x = r() * L, y = -r() * T(x); b.fillRect(x, y, 0.07 + r() * 0.1, 0.012) }
  } else if (st === 'furrow') {
    const gap = new Path2D(), rid = new Path2D()
    for (let i = 0; i < D * 22; i++) {
      const x0 = -0.4 + r() * L, y = -r() * (T(Math.max(0, x0)) + 0.05), len = 0.8 + r() * 2.2
      for (const p of [gap, rid]) {
        p.moveTo(x0, p === rid ? y - 0.045 : y)
        for (let x = x0; x < x0 + len; x += 0.15) p.lineTo(x, (p === rid ? y - 0.045 : y) + Math.sin(x * 5 + i) * 0.015)
      }
    }
    b.lineCap = 'round'
    b.lineWidth = 0.065; b.strokeStyle = lit(dark, 0, 0.7); b.stroke(gap)
    b.lineWidth = 0.05; b.strokeStyle = lit(col, 12, 0.35); b.stroke(rid)
  } else if (st === 'plate') {
    b.fillStyle = lit(dark); b.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
    for (let y = 0.1; y > -Dm - 0.2; y -= 0.15) {
      let x = -0.3 - r() * 0.4
      while (x < L + 0.3) {
        const w = 0.45 + r() * 0.7, h = 0.15 + r() * 0.12
        const hue = 14 + r() * 14, s = 38 + r() * 22, l = 26 + r() * 16 - stage * 12
        b.fillStyle = hsl(hue, s, l)
        const yj = y + (r() - 0.5) * 0.05
        b.beginPath(); b.moveTo(x, yj)
        b.quadraticCurveTo(x + w * 0.45, yj - h * (1.1 + r() * 0.3), x + w, yj - h * 0.15)
        b.quadraticCurveTo(x + w * 0.55, yj + h * 0.3, x, yj)
        b.closePath(); b.fill()
        b.strokeStyle = hsl(hue + 4, s - 10, l + 12, 0.45); b.lineWidth = 0.02
        b.beginPath(); b.moveTo(x + w * 0.12, yj - h * 0.12); b.quadraticCurveTo(x + w * 0.45, yj - h * 0.95, x + w * 0.85, yj - h * 0.3); b.stroke()
        x += w + 0.03 + r() * 0.06
      }
    }
  } else if (st === 'scale') {
    b.fillStyle = lit(dark); b.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
    for (let i = 0; i < A * 70; i++) {
      const x = r() * L, y = -r() * T(x), rx = 0.05 + r() * 0.08, ry = rx * (0.5 + r() * 0.3)
      b.fillStyle = hsl(18 + r() * 12, 20 + r() * 20, 24 + r() * 14 - stage * 8)
      b.beginPath(); b.ellipse(x, y, rx, ry, (r() - 0.5) * 0.6, 0, TAU); b.fill()
      b.strokeStyle = 'rgba(255,235,210,0.14)'; b.lineWidth = 0.015; b.beginPath(); b.ellipse(x, y - 0.01, rx * 0.9, ry * 0.9, 0, Math.PI * 1.1, Math.PI * 1.9); b.stroke()
    }
  } else if (st === 'flake') {
    b.fillStyle = lit(dark); b.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
    for (let i = 0; i < A * 30; i++) {
      const x = r() * L, y = -r() * T(x), w = 0.2 + r() * 0.2, h = 0.11 + r() * 0.1, a = (r() - 0.5) * 0.4
      b.save(); b.translate(x, y); b.rotate(a)
      b.fillStyle = 'rgba(0,0,0,0.35)'; b.beginPath(); b.ellipse(0.02, 0.03, w / 2, h / 2, 0, 0, TAU); b.fill()
      b.fillStyle = hsl(10 + r() * 14, 22 + r() * 14, 24 + r() * 12 - stage * 8); b.beginPath(); b.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); b.fill()
      b.strokeStyle = 'rgba(255,225,205,0.2)'; b.lineWidth = 0.015; b.beginPath(); b.ellipse(0, -0.01, w / 2 * 0.9, h / 2 * 0.85, 0, Math.PI * 1.05, Math.PI * 1.95); b.stroke()
      b.restore()
    }
  } else if (st === 'ridge') {
    b.fillStyle = lit(dark); b.fillRect(-0.4, -Dm - 0.2, L + 0.8, Dm + 0.4)
    b.lineCap = 'round'
    for (let i = 0; i < D * 11; i++) {
      const x0 = -0.5 + r() * L, y = -r() * (T(Math.max(0, x0)) + 0.05), len = 1.2 + r() * 2.8, w = 0.12 + r() * 0.1
      const hue = 14 + r() * 10, l = 20 + r() * 10 - stage * 6
      const p = new Path2D(), p2 = new Path2D()
      p.moveTo(x0, y); p2.moveTo(x0, y - w * 0.3)
      for (let x = x0; x < x0 + len; x += 0.15) { const yy = y + Math.sin(x * 4 + i) * 0.02; p.lineTo(x, yy); p2.lineTo(x, yy - w * 0.3) }
      b.lineWidth = w; b.strokeStyle = hsl(hue, 38 + r() * 12, l); b.stroke(p)
      b.lineWidth = w * 0.25; b.strokeStyle = hsl(hue + 4, 40, l + 12, 0.45); b.stroke(p2)
    }
  } else {
    b.fillStyle = 'rgba(0,0,0,0.05)'
    for (let i = 0; i < A * 16; i++) {
      const x = r() * L, y = -r() * T(x), rr = 0.02 + r() * 0.03
      b.fillStyle = 'rgba(255,245,215,0.6)'; b.beginPath(); b.arc(x, y, rr, 0, TAU); b.fill()
      b.strokeStyle = 'rgba(50,40,30,0.5)'; b.lineWidth = 0.012; b.stroke()
    }
    b.fillStyle = 'rgba(40,40,35,0.25)'
    for (let i = 0; i < A * 10; i++) { const x = r() * L, y = -r() * T(x); b.fillRect(x, y, 0.08 + r() * 0.12, 0.012) }
    for (let i = 0; i < 40; i++) { const x = r() * Math.min(L, 1.6), y = -r() * T(x); b.fillStyle = hsl(25, 14, 30, 0.7); b.beginPath(); b.ellipse(x, y, 0.06 + r() * 0.08, 0.03 + r() * 0.04, 0, 0, TAU); b.fill() }
  }
  // lichen
  const nl = Math.round(A * (2 + stage * 4))
  for (let i = 0; i < nl; i++) {
    const x = r() * L, y = -r() * T(x), rr = 0.05 + r() * 0.12
    b.fillStyle = r() < 0.6 ? hsl(95, 30, 62, 0.35) : hsl(48, 70, 55, 0.35)
    b.beginPath(); b.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, TAU); b.fill()
  }
}
