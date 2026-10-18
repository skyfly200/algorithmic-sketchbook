// Mushroom Fruiting — a forest-floor colony seen from low down. Mycelium
// spreads through the soil as a web of fine hyphae; pins break through the
// leaf litter and fruit. Every fruiting body is generated from its own genome:
// cap profile, rim waviness, colour, warts / scales / zones / striations, gill
// count and colour, stem curve, bulb, ring and volva are all drawn from a
// per-fruit seed around a species archetype (or, for "wild" fruits, at random),
// so no two are alike. Each fruit is drawn in pseudo-3D as a surface of
// revolution seen from slightly below (so the gills show under the rim), baked
// to its own sprite and re-baked a few at a time as it grows, opens, ages and
// collapses. Click to inoculate a flush; beats trigger a colony-wide flush.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  flush: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fruiting density' },
  size: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Mushroom size' },
  variation: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Variation' },
  spores: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Spore release' },
  spread: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Mycelium spread' },
  damp: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Substrate damp' },
  light: { value: -0.4, min: -1, max: 1, step: 0.02, label: 'Light direction' },
  mist: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Depth mist' },
  glow: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Bioluminescence' },
  // which species are allowed to fruit
  flyAgaric: { value: true, type: 'bool', label: 'Fly agaric' },
  porcini: { value: true, type: 'bool', label: 'Porcini' },
  inkcap: { value: true, type: 'bool', label: 'Shaggy ink cap' },
  oyster: { value: true, type: 'bool', label: 'Oyster cluster' },
  chanterelle: { value: true, type: 'bool', label: 'Chanterelle' },
  polypore: { value: true, type: 'bool', label: 'Bracket polypore' },
  mycena: { value: true, type: 'bool', label: 'Bonnet cluster' },
  wild: { value: true, type: 'bool', label: 'Wild (fully generative)' },
})
rt.mapInput('audio.level', 'growth', 0.3)
rt.mapInput('beat.pulse', 'glow', 0.3)

const SPECIES = ['flyAgaric', 'porcini', 'inkcap', 'oyster', 'chanterelle', 'polypore', 'mycena', 'wild']
function pickSpecies() {
  const on = SPECIES.filter((k) => params[k])
  const list = on.length ? on : SPECIES
  return list[(rt.rng() * list.length) | 0]
}

// --- small maths -------------------------------------------------------------
const TAU = Math.PI * 2
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const C = (h, s, l) => ({ h, s, l })
function hsl(h, s, l, a = 1) { return `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a})` }
function mix(a, b, t) { return C(lerp(a.h, b.h, t), lerp(a.s, b.s, t), lerp(a.l, b.l, t)) }

// --- genomes -----------------------------------------------------------------
// A genome is { bodies: [body], wood, spore, glow }. Sizes are in "units": a
// typical cap radius is ~1.5 units, a unit is ~2.8% of the viewport height.
// Every number is drawn around a species archetype; Variation scales the spread.
function makeJ(r) {
  const V = params.variation * 2
  return (base, spread) => base + (r() * 2 - 1) * spread * V
}
const pickOf = (r, a) => a[(r() * a.length) | 0]
function waves(r, j, amp, vamp = 0) {
  const w = []
  for (let i = 0; i < 3; i++) w.push({ k: 3 + ((r() * 6) | 0), amp: Math.max(0, j(amp, amp * 0.8)) * (1 - i * 0.25), vamp: Math.max(0, j(vamp, vamp * 0.8)), ph: r() * TAU, pv: r() * TAU })
  return w
}
function baseBody(over) {
  return {
    x: 0, y0: 0, zc: 0, delay: 0, speed: 1, scale: 1, lean: 0, side: 1, dir: 0,
    ...over,
  }
}
function cluster(r, j, make, n, spreadX) {
  const bodies = []
  for (let i = 0; i < n; i++) {
    const b = make(i)
    const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
    b.x = off * spreadX + j(0, spreadX * 0.3)
    b.zc = r()
    b.delay = i === 0 ? 0 : r() * 0.3
    b.scale *= i === 0 ? 1 : lerp(0.55, 0.95, r())
    b.lean += off * 0.22 + j(0, 0.08)
    b.side = off < 0 ? -1 : 1
    bodies.push(b)
  }
  bodies.sort((a, b) => b.zc - a.zc)
  return bodies
}
function bends(j, amt) { return [j(0, amt), j(0, amt * 1.4), j(0, amt * 1.6)] }

const GEN = {
  flyAgaric(r, j) {
    const hue = j(4, 7)
    const body = baseBody({
      scale: j(1, 0.15), lean: j(0, 0.1),
      cap: {
        R: j(1.75, 0.3), rY: 1.05, rM: j(0.52, 0.12), rO: j(0.16, 0.1), a: j(2.2, 0.4), b: 0.75,
        umbo: 0, dep: 0, curl: j(0.5, 0.3), upturn: j(0.35, 0.25), gRise: 0.32, gDrop: 0, tilt: 0.17, off: 0,
        waves: waves(r, j, 0.025), col: C(hue, j(84, 8), j(45, 5)), centre: { dl: -7, dh: -4, ext: 0.45 }, rim: { dl: 8, dh: 16, band: 0 },
        tex: [{ type: 'warts', n: Math.round(j(90, 40)), size: j(0.11, 0.035), col: C(j(48, 6), j(30, 20), 92) }, { type: 'striate', n: 70, from: 0.82, a: 0.18 }],
        gloss: 0.7, gills: { type: 'gills', n: Math.round(j(120, 25)), col: C(50, 22, 91), old: C(44, 30, 78) },
      },
      stem: {
        L: j(3.7, 0.9), wTop: j(0.27, 0.05), wBase: j(0.36, 0.06), bulb: j(1.0, 0.3), belly: 0, bend: bends(j, 0.08),
        col: C(48, 18, 90), ring: { t: j(0.83, 0.05), len: j(0.5, 0.12), col: C(48, 20, 92) }, volva: 'rings', tex: 'snakeskin',
      },
    })
    return { bodies: [body], spore: C(45, 20, 94) }
  },

  porcini(r, j) {
    const body = baseBody({
      scale: j(1, 0.15), lean: j(0, 0.07),
      cap: {
        R: j(1.9, 0.3), rY: 1.15, rM: j(0.62, 0.1), rO: j(0.36, 0.1), a: j(2.6, 0.4), b: 0.7,
        umbo: 0, dep: 0, curl: j(0.6, 0.3), upturn: j(0.08, 0.06), gRise: 0.38, gDrop: 0, tilt: 0.15, off: 0,
        waves: waves(r, j, 0.02), col: C(j(25, 7), j(46, 10), j(33, 6)), centre: { dl: -5, dh: -3, ext: 0.4 }, rim: { dl: 14, dh: 9, band: j(0.07, 0.04) },
        tex: [{ type: 'mottle', n: 30 }, { type: 'fibrils', n: 50, a: 0.05 }],
        gloss: 0.9, gills: { type: 'pores', n: 600, col: C(48, 18, 90), old: C(62, 48, 52) },
      },
      stem: {
        L: j(2.4, 0.5), wTop: j(0.45, 0.08), wBase: j(0.72, 0.12), bulb: 0.15, belly: j(0.4, 0.15), bend: bends(j, 0.05),
        col: C(38, 26, 74), ring: null, volva: null, tex: 'net',
      },
    })
    return { bodies: [body], spore: C(45, 40, 32) }
  },

  inkcap(r, j) {
    const n = 1 + ((r() * 3) | 0)
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.12), lean: j(0, 0.06),
      cap: {
        R: j(0.95, 0.12), rY: 3.2, rM: j(2.3, 0.35), rO: 0.55, a: j(3.0, 0.5), b: 0.55,
        umbo: 0, dep: 0, curl: 0.3, upturn: 0.5, gRise: 0.82, gDrop: 0, tilt: 0.12, off: 0, deliq: true,
        waves: waves(r, j, 0.02), col: C(42, 12, 90), centre: { dl: -30, dh: -10, ext: 0.16 }, rim: { dl: 0, dh: 0, band: 0 },
        tex: [{ type: 'scales', rows: Math.round(j(10, 2)), per: Math.round(j(11, 2)), col: C(34, j(26, 8), 70) }],
        gloss: 0.2, gills: { type: 'gills', n: 90, col: C(20, 10, 86), old: C(280, 18, 8) },
      },
      stem: {
        L: j(4.2, 1.2), wTop: j(0.15, 0.03), wBase: j(0.21, 0.04), bulb: j(0.45, 0.2), belly: 0, bend: bends(j, 0.05),
        col: C(45, 8, 93), ring: { t: j(0.22, 0.06), len: 0.12, col: C(45, 8, 92) }, volva: null, tex: 'fibrils',
      },
    }), n, 0.9)
    return { bodies, spore: C(280, 15, 6), ink: true }
  },

  chanterelle(r, j) {
    const n = 1 + ((r() * 3) | 0)
    const col = C(j(41, 6), j(86, 8), j(57, 7))
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.15), lean: j(0, 0.12),
      cap: {
        R: j(1.35, 0.25), rY: 0.55, rM: j(0.16, 0.08), rO: 0.04, a: 1.6, b: 1,
        umbo: 0, dep: j(0.3, 0.12), curl: 0.6, upturn: j(0.25, 0.15), gRise: 0, gDrop: -j(0.95, 0.2), tilt: 0.2, off: 0,
        waves: waves(r, j, 0.07, 0.07), col, centre: { dl: 0, dh: 0, ext: 0.3 }, rim: { dl: 4, dh: 2, band: 0 },
        tex: [{ type: 'mottle', n: 14 }], gloss: 0.15,
        gills: { type: 'ridges', n: Math.round(j(34, 8)), col: C(col.h - 2, col.s - 6, col.l + 5), old: C(col.h - 6, col.s - 20, col.l - 8) },
      },
      stem: {
        L: j(1.6, 0.4), wTop: j(0.3, 0.06), wBase: j(0.2, 0.04), bulb: 0, belly: 0, bend: bends(j, 0.1),
        col: C(col.h, col.s - 10, col.l + 4), ring: null, volva: null, tex: 'smooth',
      },
    }), n, 0.9)
    return { bodies, spore: C(40, 40, 88) }
  },

  mycena(r, j) {
    const n = 3 + ((r() * 5) | 0)
    const col = pickOf(r, [C(30, 22, 52), C(25, 30, 40), C(210, 12, 58), C(340, 25, 60), C(45, 30, 62)])
    const glow = r() < 0.55 ? j(1, 0.25) : 0
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.1), lean: j(0, 0.12),
      cap: {
        R: j(0.42, 0.08), rY: 1.3, rM: j(0.85, 0.15), rO: 0.4, a: 1.3, b: 1,
        umbo: j(0.12, 0.08), dep: 0, curl: 0, upturn: 0.2, gRise: 0.42, gDrop: 0, tilt: 0.15, off: 0,
        waves: waves(r, j, 0.02), col: C(col.h + j(0, 6), col.s, col.l + j(0, 6)), centre: { dl: -22, dh: -4, ext: 0.3 }, rim: { dl: 14, dh: 0, band: 0 },
        tex: [{ type: 'striate', n: Math.round(j(22, 4)), from: 0.3, a: 0.4 }], gloss: 0.5,
        gills: { type: 'gills', n: Math.round(j(18, 4)), col: C(30, 8, 88), old: C(30, 12, 70) },
      },
      stem: {
        L: j(3.1, 0.8), wTop: 0.05, wBase: 0.06, bulb: 0.5, belly: 0, bend: bends(j, 0.15),
        col: C(col.h, col.s * 0.8, col.l + 12), ring: null, volva: null, tex: 'smooth',
      },
    }), n, 0.8)
    return { bodies, spore: C(40, 10, 92), glow, glowCol: C(j(105, 15), 90, 62) }
  },

  oyster(r, j) {
    const col = pickOf(r, [C(30, 10, 60), C(215, 14, 52), C(345, 55, 68), C(48, 80, 62), C(38, 10, 82)])
    const wood = makeWood(r, j)
    const n = 3 + ((r() * 4) | 0)
    const bodies = []
    for (let i = 0; i < n; i++) {
      const p = woodPoint(wood, r)
      const dir = p.x < 0 ? -1 : 1
      bodies.push(baseBody({
        x: p.x, y0: p.y, zc: -p.y, delay: r() * 0.25, scale: lerp(0.6, 1, r()) * j(1, 0.1), dir,
        lean: dir * j(0.35, 0.15),
        cap: {
          R: j(1.25, 0.25), rY: 0.6, rM: j(0.32, 0.08), rO: 0.12, a: 1.8, b: 0.9,
          umbo: 0, dep: j(0.12, 0.08), curl: 0.6, upturn: 0.3, gRise: 0.05, gDrop: 0, tilt: 0.42, off: dir * 0.6,
          waves: waves(r, j, 0.07, 0.04), col: C(col.h + j(0, 5), col.s, col.l + j(0, 6)), centre: { dl: -10, dh: 0, ext: 0.35 }, rim: { dl: 8, dh: 0, band: 0 },
          tex: [{ type: 'fibrils', n: 40, a: 0.06 }, { type: 'mottle', n: 12 }], gloss: 0.35,
          gills: { type: 'gills', n: Math.round(j(70, 15)), col: C(col.h, col.s * 0.4, 86), old: C(40, 20, 72) },
        },
        stem: {
          L: 0.22, wTop: 0.13, wBase: 0.17, bulb: 0, belly: 0, bend: [dir * 0.3, dir * 0.6, dir * 0.8], up: 0.4,
          col: C(col.h, col.s * 0.4, 72), ring: null, volva: null, tex: 'smooth',
        },
      }))
    }
    bodies.sort((a, b) => a.y0 - b.y0)
    return { bodies, wood, spore: C(300, 12, 88) }
  },

  polypore(r, j) {
    const kind = pickOf(r, ['turkey', 'turkey', 'conk', 'sulphur'])
    const wood = makeWood(r, j)
    const n = kind === 'conk' ? 1 + ((r() * 3) | 0) : 4 + ((r() * 5) | 0)
    const pal = {
      turkey: pickOf(r, [
        [C(28, 30, 22), C(32, 25, 48), C(40, 25, 78), C(20, 35, 32)],
        [C(215, 18, 30), C(205, 12, 55), C(40, 18, 80), C(25, 25, 28)],
        [C(18, 55, 32), C(28, 55, 50), C(40, 40, 78), C(10, 40, 24)],
        [C(90, 20, 30), C(40, 22, 55), C(45, 20, 80), C(30, 25, 26)],
      ]),
      conk: [C(8, 55, 22), C(14, 60, 30), C(20, 50, 18), C(25, 45, 26)],
      sulphur: [C(24, 85, 52), C(32, 90, 56), C(42, 90, 60)],
    }[kind]
    const brackets = []
    for (let i = 0; i < n; i++) {
      const p = woodPoint(wood, r)
      const bands = []
      const nb = kind === 'turkey' ? Math.round(j(13, 4)) : kind === 'conk' ? 7 : 3
      for (let k = 0; k < nb; k++) {
        const c = kind === 'turkey' ? pal[(r() * pal.length) | 0] : pal[Math.min(pal.length - 1, ((k / nb) * pal.length) | 0)]
        bands.push({ col: C(c.h + j(0, 6), c.s + j(0, 8), c.l + j(0, 7)), w: 0.5 + r() })
      }
      brackets.push({
        x: p.x, y: p.y, delay: r() * 0.35, w: j(kind === 'conk' ? 1.5 : 1.15, 0.3) * lerp(0.65, 1, r()),
        ry: kind === 'conk' ? j(0.5, 0.08) : j(0.42, 0.08), th: kind === 'conk' ? j(0.38, 0.08) : kind === 'sulphur' ? j(0.2, 0.05) : j(0.06, 0.02),
        ang: j(0, 0.15), bands, waves: waves(r, j, kind === 'turkey' ? 0.07 : 0.05, 0),
        margin: kind === 'conk' ? C(40, 20, 90) : kind === 'sulphur' ? C(50, 90, 66) : C(42, 30, 86),
        pore: kind === 'sulphur' ? C(52, 85, 66) : C(40, 22, 84), gloss: kind === 'conk' ? 1 : 0.15, velvet: kind === 'turkey',
      })
    }
    brackets.sort((a, b) => b.y - a.y)
    return { bodies: [], brackets, wood, spore: kind === 'conk' ? C(20, 50, 30) : C(45, 20, 92) }
  },

  wild(r, j) {
    const arch = pickOf(r, ['conical', 'bell', 'convex', 'convex', 'umbonate', 'flat', 'funnel'])
    const sh = {
      conical: { a: 1.15, b: 1, rM: 1.1, umbo: 0, dep: 0 },
      bell: { a: 1.6, b: 0.7, rM: 0.8, umbo: 0, dep: 0 },
      convex: { a: 2.2, b: 0.7, rM: 0.5, umbo: 0, dep: 0 },
      umbonate: { a: 2, b: 0.6, rM: 0.32, umbo: 0.35, dep: 0 },
      flat: { a: 3, b: 0.5, rM: 0.16, umbo: 0.05, dep: 0 },
      funnel: { a: 1.6, b: 1, rM: 0.12, umbo: 0, dep: 0.3 },
    }[arch]
    const base = pickOf(r, [
      [200, 55, 42], [218, 45, 35], [275, 40, 45], [290, 30, 60], [160, 40, 40], [175, 45, 50], [330, 50, 62], [350, 60, 50],
      [50, 85, 55], [38, 80, 50], [20, 75, 45], [8, 70, 40], [30, 12, 88], [0, 0, 92], [25, 35, 24], [35, 30, 40], [90, 35, 40], [260, 20, 30],
    ])
    const col = C(base[0] + (r() * 2 - 1) * 14, clamp(base[1] + (r() * 2 - 1) * 12, 0, 100), clamp(base[2] + (r() * 2 - 1) * 9, 10, 94))
    const contrast = C(col.h + 140 + r() * 80, clamp(col.s + 10, 0, 90), clamp(100 - col.l, 30, 90))
    const texPool = ['warts', 'scales', 'speckles', 'zones', 'striate', 'fibrils', 'mottle', 'smooth']
    const tex = []
    const nt = 1 + (r() < 0.5 ? 1 : 0)
    for (let i = 0; i < nt; i++) {
      const t = pickOf(r, texPool)
      if (t === 'warts') tex.push({ type: t, n: Math.round(30 + r() * 80), size: 0.05 + r() * 0.06, col: r() < 0.6 ? C(45, 20, 92) : contrast })
      else if (t === 'scales') tex.push({ type: t, rows: 6 + ((r() * 6) | 0), per: 8 + ((r() * 6) | 0), col: C(col.h + j(0, 20), col.s, col.l - 18) })
      else if (t === 'speckles') tex.push({ type: t, n: 80 + ((r() * 120) | 0), col: r() < 0.5 ? contrast : C(col.h, col.s, col.l - 25) })
      else if (t === 'zones') tex.push({ type: t, n: 4 + ((r() * 6) | 0), col: C(col.h + j(0, 15), col.s, col.l + (r() < 0.5 ? -14 : 14)) })
      else if (t === 'striate') tex.push({ type: t, n: 30 + ((r() * 40) | 0), from: 0.3 + r() * 0.5, a: 0.25 })
      else if (t === 'fibrils') tex.push({ type: t, n: 60, a: 0.1 })
      else if (t === 'mottle') tex.push({ type: t, n: 25 })
    }
    const gcol = pickOf(r, [C(45, 20, 92), C(40, 30, 82), C(350, 35, 78), C(280, 25, 60), C(28, 30, 40), C(col.h, col.s * 0.7, Math.min(88, col.l + 20))])
    const stemCol = r() < 0.4 ? C(col.h, col.s * 0.6, Math.min(92, col.l + 18)) : r() < 0.7 ? C(45, 12, 90) : contrast
    const gtype = r() < 0.15 ? 'pores' : r() < 0.08 ? 'ridges' : 'gills'
    const R = j(1.2, 0.5)
    const n = r() < 0.35 ? 2 + ((r() * 4) | 0) : 1
    const make = () => baseBody({
      scale: j(1, 0.15), lean: j(0, 0.12),
      cap: {
        R, rY: Math.max(sh.rM, 0.9) + 0.3, rM: j(sh.rM, 0.12), rO: sh.rM * 0.3, a: j(sh.a, 0.3), b: sh.b,
        umbo: sh.umbo, dep: sh.dep, curl: r() * 0.8, upturn: r() * 0.5, gRise: arch === 'funnel' ? 0 : 0.35, gDrop: arch === 'funnel' ? -0.8 : 0,
        tilt: 0.15, off: 0, waves: waves(r, j, arch === 'funnel' ? 0.06 : 0.025, arch === 'funnel' ? 0.05 : 0.01), col,
        centre: { dl: (r() - 0.6) * 30, dh: (r() - 0.5) * 20, ext: 0.3 + r() * 0.3 }, rim: { dl: (r() - 0.3) * 20, dh: (r() - 0.5) * 20, band: r() < 0.2 ? 0.06 : 0 },
        tex, gloss: r(), gills: { type: gtype === 'ridges' && arch !== 'funnel' ? 'gills' : gtype, n: Math.round(30 + r() * 90), col: gcol, old: mix(gcol, C(25, 30, 30), 0.5) },
      },
      stem: {
        L: j(lerp(1.4, 5, r()), 0.4), wTop: R * j(0.15, 0.04), wBase: R * j(0.2, 0.06), bulb: r() < 0.3 ? r() : 0, belly: r() < 0.25 ? r() * 0.5 : 0, bend: bends(j, 0.12),
        col: stemCol, ring: r() < 0.35 ? { t: 0.7 + r() * 0.2, len: 0.2 + r() * 0.35, col: mix(stemCol, C(45, 10, 92), 0.6) } : null,
        volva: r() < 0.2 ? 'cup' : null, tex: pickOf(r, ['smooth', 'fibrils', 'fibrils', 'snakeskin']),
      },
    })
    const bodies = n === 1 ? [make()] : cluster(r, j, make, n, R * 0.8)
    const glow = r() < 0.12 ? j(0.9, 0.2) : 0
    return { bodies, spore: pickOf(r, [C(45, 20, 92), C(340, 30, 70), C(25, 40, 30), C(280, 15, 10)]), glow, glowCol: C(lerp(90, 190, r()), 90, 60) }
  },
}

function makeWood(r, j) {
  if (r() < 0.55) return { type: 'stump', w: j(2.6, 0.6), h: j(2.3, 0.7), seed: (r() * 4294967296) >>> 0, cut: r() < 0.5 }
  return { type: 'log', w: j(5.2, 1.2), h: j(0.85, 0.15), seed: (r() * 4294967296) >>> 0, end: r() < 0.5 ? -1 : 1 }
}
function woodPoint(w, r) {
  if (w.type === 'stump') return { x: (r() * 2 - 1) * w.w * 0.42, y: -w.h * lerp(0.2, 0.95, r()) }
  return { x: (r() * 2 - 1) * w.w * 0.4, y: -w.h * lerp(0.35, 1.0, r()) }
}

// --- growth state ----------------------------------------------------------------
function bodyState(b, g, gDelay = b.delay) {
  const gb = Math.max(0, g - gDelay)
  const grow = clamp(gb)
  return {
    gb, grow,
    sz: b.scale * (0.16 + 0.84 * smooth(0, 1, grow)),
    open: smooth(0.3, 1.15, gb),
    age: clamp((gb - 1.15) / 1.0),
    decay: clamp((g - 1.95) / 0.5),
  }
}
function capShape(cap, s) {
  const R = cap.R * s.sz * lerp(0.42, 1, s.open)
  let ratio = lerp(cap.rY, cap.rM, s.open)
  ratio = lerp(ratio, cap.rO, s.age)
  const H = Math.max(0.03, ratio) * R
  const umbo = cap.umbo * s.open * H
  const dep = cap.dep * s.open * R
  const curl = cap.curl * (1 - s.open * 0.75) * R
  const up = (cap.upturn * s.age + (cap.deliq ? s.age * 0.5 : 0)) * R
  const a = cap.a, bb = cap.b
  const h = (u) => H * Math.pow(Math.max(0, 1 - Math.pow(u, a)), bb) + umbo * Math.exp(-((u / 0.22) ** 2)) -
    dep * (1 - u * u) ** 2 + curl * 0.32 * Math.sin(Math.PI * clamp((u - 0.5) / 0.5)) + up * 0.35 * smooth(0.5, 1, u)
  return { R, H, h, h1: h(1), gRise: cap.gRise * H + cap.gDrop * R, tilt: cap.tilt, off: cap.off * R }
}

// --- sprites -----------------------------------------------------------------------
const pool = []
function getCanvas() { return pool.pop() || document.createElement('canvas') }
function bounds(gen) {
  let x0 = -2, x1 = 2, y0 = -2
  for (const b of gen.bodies) {
    const cap = b.cap, st = b.stem
    const R = cap.R * b.scale * 1.15
    const H = Math.max(cap.rY, cap.rM, cap.rO) * R + cap.umbo * R + R * 0.3
    const L = st.L * b.scale
    const bendX = Math.max(...st.bend.map(Math.abs)) * L
    const mx = R * 1.35 + Math.abs(cap.off) * R + bendX + H * 0.6 + 0.4
    x0 = Math.min(x0, b.x - mx); x1 = Math.max(x1, b.x + mx)
    y0 = Math.min(y0, b.y0 - (L * (st.up ?? 1) + H + Math.abs(cap.gDrop) * R + 0.6))
  }
  if (gen.wood) {
    const w = gen.wood
    x0 = Math.min(x0, -w.w / 2 - 0.6); x1 = Math.max(x1, w.w / 2 + 0.6); y0 = Math.min(y0, -w.h - w.w * 0.25 - 0.6)
  }
  for (const br of gen.brackets || []) {
    x0 = Math.min(x0, br.x - br.w * 1.3); x1 = Math.max(x1, br.x + br.w * 1.3); y0 = Math.min(y0, br.y - br.w)
  }
  return { x0, x1, y0, y1: 0.55 }
}

// --- world -------------------------------------------------------------------------
let W = 0, H = 0, PR = 1, ground = 0, farY = 0, unit = 1
const myc = document.createElement('canvas')
const mctx = myc.getContext('2d')
const bg = document.createElement('canvas')
const bgx = bg.getContext('2d')
const fg = document.createElement('canvas')
const fgx = fg.getContext('2d')
const glowSprite = document.createElement('canvas')
let bgKey = ''

let tips = []
let fruits = []
const spores = []

function seedMycelium(x, y, n) {
  for (let i = 0; i < n; i++) tips.push({ x, y, a: rt.random(0, 6.28), life: rt.random(60, 200), vigor: rt.random(0.6, 1) })
}
function depthOf(z) { return { y: lerp(ground - H * 0.006, farY + H * 0.004, z), s: 1 - z * 0.55 } }

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  ground = H * 0.77
  farY = ground - H * 0.13
  unit = Math.min(H, W * 0.9) * 0.05
  myc.width = W; myc.height = H
  mctx.clearRect(0, 0, W, H)
  bg.width = W; bg.height = H; bgKey = ''
  fg.width = W; fg.height = H
  bakeForeground()
  const gs = 64
  glowSprite.width = glowSprite.height = gs
  const gx = glowSprite.getContext('2d')
  const gr = gx.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2)
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  gx.fillStyle = gr; gx.fillRect(0, 0, gs, gs)
  tips = []; spores.length = 0
  for (const f of fruits) if (f.canvas) pool.push(f.canvas)
  fruits = []
  for (let i = 0; i < 5; i++) seedMycelium(rt.random(W * 0.1, W * 0.9), rt.random(ground + 6 * PR, H - 8 * PR), 3)
  // ?specimens=porcini lays out one species at fixed growth stages (frozen), for tuning the look
  const spec = new URLSearchParams(location.search).get('specimens')
  if (spec && GEN[spec]) {
    const stages = [0.35, 0.7, 1.0, 1.3, 1.7, 2.1]
    stages.forEach((g, i) => { spawnFruit(W * (0.1 + i * 0.16), 0, spec, g); fruits[fruits.length - 1].rate = 0 })
    return
  }
  // start mid-season so the floor isn't bare
  for (let i = 0; i < Math.round(9 * params.flush); i++) spawnFruit(rt.random(W * 0.06, W * 0.94), rt.rng(), null, rt.random(0.2, 1.7))
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
    if (tp.x < 0 || tp.x > W) { tp.a = Math.PI - tp.a; tp.x = Math.max(0, Math.min(W, tp.x)) }
    mctx.strokeStyle = `hsla(40, 30%, 84%, ${0.15 * tp.vigor})`
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

function maxFruits() { return Math.round(16 * params.flush) }
function spawnFruit(x, z = rt.rng() ** 1.3, key = null, g = 0) {
  if (fruits.length >= maxFruits()) return
  key = key || pickSpecies()
  const seed = (rt.rng() * 4294967296) >>> 0
  const r = mulberry(seed)
  const gen = GEN[key](r, makeJ(r))
  gen.brackets = gen.brackets || null
  fruits.push({
    x, z, key, gen, g, rate: rt.random(0.75, 1.2), seed, texSeed: (r() * 4294967296) >>> 0,
    box: bounds(gen), canvas: null, bakedG: -1, bakedK: 0, bakedEnv: '', marks: null,
  })
  const d = depthOf(z)
  if (z < 0.5) seedMycelium(x, ground + rt.random(8, 30) * PR, 2)
  return d
}

function onDown(e) {
  const x = e.clientX * PR, y = e.clientY * PR
  const z = y >= ground ? 0 : clamp((ground - y) / (ground - farY))
  seedMycelium(x, Math.max(ground + 6 * PR, y), 5)
  spawnFruit(x, z)
  for (let i = 0; i < 2; i++) spawnFruit(x + rt.random(-60, 60) * PR, clamp(z + rt.random(-0.15, 0.15)))
}
window.addEventListener('pointerdown', onDown)
rt.onBeat(({ energy }) => {
  const n = 1 + ((energy * 3) | 0)
  for (let i = 0; i < n; i++) spawnFruit(rt.random(W * 0.06, W * 0.94))
})

// --- baking a fruit ---------------------------------------------------------------
// c is a sprite context scaled to units (1 unit = K px), origin at the fruit's base.
let c = null, K = 1, AGE = 0, LX = -0.4, DAMP = 0.6
function aged(col, dl = 0, ds = 0, dh = 0) {
  return [lerp(col.h + dh, 30, AGE * 0.25), (col.s + ds) * (1 - 0.45 * AGE), (col.l + dl) * (1 - 0.32 * AGE) * (1 - DAMP * 0.06)]
}
function ah(col, dl = 0, a = 1, ds = 0, dh = 0) { const [h, s, l] = aged(col, dl, ds, dh); return hsl(h, s, l, a) }

function bakeFruit(f) {
  const env = envKey()
  const box = f.box
  let k = unit * f.dscale * params.size
  const cw = (box.x1 - box.x0) * k, ch = (box.y1 - box.y0) * k
  const lim = 1400
  if (cw > lim || ch > lim) k *= lim / Math.max(cw, ch)
  if (!f.canvas) f.canvas = getCanvas()
  const cv = f.canvas
  const pw = Math.ceil((box.x1 - box.x0) * k), ph = Math.ceil((box.y1 - box.y0) * k)
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
  c = cv.getContext('2d')
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, pw, ph)
  c.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k)
  K = k
  LX = params.light; DAMP = params.damp
  const r = mulberry(f.texSeed)
  const gen = f.gen
  const decay = clamp((f.g - 1.95) / 0.5)
  f.marks = { spore: [], glow: [], ink: [] }

  // contact shadow
  const shW = gen.wood ? gen.wood.w * 0.7 : 1.6
  const sg = c.createRadialGradient(0, 0.05, 0, 0, 0.05, shW)
  sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
  c.save(); c.scale(1, 0.22); c.fillStyle = sg; c.beginPath(); c.arc(0, 0.2, shW, 0, TAU); c.fill(); c.restore()

  if (gen.wood) drawWood(gen.wood)
  for (const b of gen.bodies) {
    const s = bodyState(b, f.g)
    AGE = s.age
    if (s.gb <= 0) continue
    drawBody(b, s, decay, r, gen, f)
  }
  if (gen.brackets) {
    for (const br of gen.brackets) {
      const s = bodyState({ scale: 1 }, f.g, br.delay)
      AGE = s.age
      if (s.gb > 0) drawBracket(br, s, r)
    }
  }
  AGE = 0
  drawLitter(r, gen)

  // weathering, collapse and distance haze, applied to everything baked so far
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'source-atop'
  if (decay > 0) { c.fillStyle = `rgba(28,20,14,${decay * 0.5})`; c.fillRect(0, 0, pw, ph) }
  const haze = f.z * params.mist * 0.75
  if (haze > 0.01) { c.fillStyle = `hsla(160, 14%, ${12 + params.damp * 4}%, ${haze})`; c.fillRect(0, 0, pw, ph) }
  c.globalCompositeOperation = 'source-over'

  f.bakedG = f.g; f.bakedK = k; f.bakedEnv = env
}
function envKey() { return `${params.light.toFixed(2)}|${(params.damp * 10) | 0}|${(params.mist * 10) | 0}|${params.size.toFixed(2)}` }

// --- one cap + stem ---------------------------------------------------------------
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]
}
function drawBody(b, s, decay, r, gen, f) {
  const cap = b.cap, st = b.stem
  const sh = capShape(cap, s)
  // stem spine
  const L = st.L * s.sz * lerp(0.2, 1, smooth(0.04, 0.95, s.gb)) * (1 - decay * 0.25)
  const droop = (b.lean >= 0 ? 1 : -1) * decay * 0.8
  const up = st.up ?? 1
  const P0 = [b.x, b.y0]
  const P1 = [b.x + st.bend[0] * L + b.lean * L * 0.2, b.y0 - L * up / 3]
  const P2 = [b.x + st.bend[1] * L + b.lean * L * 0.5, b.y0 - L * up * 2 / 3]
  const P3 = [b.x + st.bend[2] * L + b.lean * L * 0.8 + droop * L * 0.45, b.y0 - L * up * (1 - decay * 0.15)]
  const N = 18
  const spine = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const p = bezier(P0, P1, P2, P3, t)
    const q = bezier(P0, P1, P2, P3, Math.min(1, t + 0.01)), o = bezier(P0, P1, P2, P3, Math.max(0, t - 0.01))
    let tx = q[0] - o[0], ty = q[1] - o[1]
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
    const w = (lerp(st.wBase, st.wTop, Math.pow(t, 0.7)) + st.bulb * st.wBase * Math.exp(-(((t * Math.max(1, L)) / 0.35) ** 2)) +
      st.belly * st.wBase * Math.exp(-(((t - 0.3) / 0.22) ** 2))) * s.sz * lerp(0.65, 1, s.grow)
    spine.push({ x: p[0], y: p[1], nx: -ty, ny: tx, w, t })
  }
  const top = spine[N]
  // the cap follows the stem's top tangent (damped), then droops as it collapses
  const tAng = Math.atan2(top.x - spine[N - 2].x, -(top.y - spine[N - 2].y))
  const ang = (b.dir ? b.dir * 0.12 : clamp(tAng * 0.75, -1.2, 1.2) + b.lean * 0.3) + droop * 0.9

  // gills / underside, in the cap frame
  c.save(); c.translate(top.x, top.y); c.rotate(ang)
  drawUnderside(cap, sh, s, r, top.w)
  c.restore()

  drawStem(st, spine, s, r, L)

  c.save(); c.translate(top.x, top.y); c.rotate(ang)
  drawDome(cap, sh, s, r)
  c.restore()

  // marks for spores / glow (approximate: ignores the cap rotation)
  const cx = top.x + sh.off * Math.cos(ang), cy = top.y + sh.gRise - sh.h1
  if (s.gb > 0.9 && s.gb < 1.9 && !gen.ink) f.marks.spore.push({ x: cx, y: cy + sh.R * sh.tilt * 0.5, w: sh.R * 0.7 })
  if (gen.ink && s.age > 0.2) f.marks.ink.push({ x: cx, y: cy, w: sh.R * 0.9 })
  if (gen.glow) f.marks.glow.push({ x: cx, y: cy - sh.H * 0.4, r: sh.R * 2.4 + 0.4 })
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
  const deliq = cap.deliq ? smooth(0.0, 0.6, s.age) : 0
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
    const n = Math.round(g.n * rt.detail)
    for (let i = 0; i < n; i++) {
      const th = r() * TAU, u = Math.sqrt(r())
      const p = rimPt(cap, sh, th)
      const x = lerp(0, p[0], u), y = lerp(0, p[1], u)
      const d = 0.018 + r() * 0.012
      c.rect(x, y, d, d * 0.7)
    }
    c.fill()
  } else if (g.type === 'ridges') {
    const n = Math.round(g.n * Math.max(0.6, rt.detail))
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
    const n = Math.round(g.n * Math.max(0.5, rt.detail))
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

  // ink-cap autodigestion: black creeping up from the rim
  if (cap.deliq && s.age > 0) {
    const d = smooth(0, 0.8, s.age)
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
    const n = Math.round(t.n * Math.max(0.5, rt.detail))
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
    const n = Math.round(t.n * Math.max(0.5, rt.detail))
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
    const n = Math.round(t.n * Math.max(0.5, rt.detail))
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

// --- wood and brackets ------------------------------------------------------------------
function drawWood(w) {
  const r = mulberry(w.seed)
  const bark = C(25, 18, 20), inner = C(32, 32, 46)
  const lw = 1 / K
  if (w.type === 'stump') {
    const hw = w.w / 2, top = -w.h, ry = hw * 0.28
    const path = new Path2D()
    path.moveTo(-hw * 1.25, 0.05)
    path.quadraticCurveTo(-hw * 0.95, -w.h * 0.12, -hw, -w.h * 0.3)
    for (let i = 1; i <= 6; i++) path.lineTo(-hw + (r() - 0.5) * 0.08, lerp(-w.h * 0.3, top, i / 6))
    path.ellipse(0, top, hw, ry, 0, Math.PI, 0, false)
    for (let i = 1; i <= 6; i++) path.lineTo(hw + (r() - 0.5) * 0.08, lerp(top, -w.h * 0.3, i / 6))
    path.quadraticCurveTo(hw * 0.95, -w.h * 0.12, hw * 1.25, 0.05)
    path.closePath()
    const g = c.createLinearGradient(-hw, 0, hw, 0)
    g.addColorStop(0, ah(bark, -10)); g.addColorStop(clamp(0.45 + LX * 0.2), ah(bark, 8)); g.addColorStop(1, ah(bark, -14))
    c.fillStyle = g; c.fill(path)
    c.save(); c.clip(path)
    const cr = new Path2D(), hl = new Path2D()
    for (let i = 0; i < 26; i++) {
      const x0 = (r() * 2 - 1) * hw * 1.1
      let x = x0
      const y0 = -r() * 0.4, y1 = top - 0.2
      const pth = r() < 0.7 ? cr : hl
      pth.moveTo(x, y0)
      for (let y = y0; y > y1; y -= 0.25) { x += (r() - 0.5) * 0.12; pth.lineTo(x, y) }
    }
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = Math.max(lw, 0.035); c.stroke(cr)
    c.strokeStyle = 'rgba(200,180,150,0.12)'; c.lineWidth = Math.max(lw, 0.025); c.stroke(hl)
    c.restore()
    if (w.cut) {
      c.beginPath(); c.ellipse(0, top, hw * 0.94, ry * 0.9, 0, 0, TAU)
      const tg = c.createRadialGradient(0, top, 0, 0, top, hw)
      tg.addColorStop(0, ah(inner, -12)); tg.addColorStop(0.7, ah(inner, 4)); tg.addColorStop(1, ah(inner, -6))
      c.fillStyle = tg; c.fill()
      c.strokeStyle = 'rgba(60,35,15,0.35)'; c.lineWidth = Math.max(lw, 0.012)
      for (let k = 1; k < 9; k++) { c.beginPath(); c.ellipse(0, top, hw * 0.92 * k / 9 * (0.95 + r() * 0.1), ry * 0.9 * k / 9, 0, 0, TAU); c.stroke() }
      c.beginPath()
      for (let k = 0; k < 4; k++) { const a = r() * TAU; c.moveTo(0, top); c.lineTo(Math.cos(a) * hw * 0.8, top + Math.sin(a) * ry * 0.8) }
      c.strokeStyle = 'rgba(30,15,5,0.5)'; c.stroke()
    } else {
      // broken, rotten top
      c.beginPath(); c.moveTo(-hw, top)
      for (let i = 1; i <= 8; i++) c.lineTo(-hw + (i / 8) * hw * 2, top - r() * w.h * 0.25)
      c.lineTo(hw, top); c.ellipse(0, top, hw, ry, 0, 0, Math.PI, false); c.closePath()
      c.fillStyle = ah(bark, -4); c.fill()
    }
    moss(r, -hw * 1.2, hw * 1.2, -0.05, 0.25, 70)
    moss(r, -hw, hw, top - ry * 0.3, ry * 0.8, 30)
  } else {
    const hl = w.w / 2, rr = w.h, top = -rr * 1.05
    const path = new Path2D()
    path.moveTo(-hl, 0.05); path.lineTo(-hl, top * 0.6)
    path.quadraticCurveTo(-hl, top, -hl + rr * 0.4, top)
    for (let i = 1; i <= 10; i++) path.lineTo(-hl + rr * 0.4 + (i / 10) * (w.w - rr * 0.8), top + (r() - 0.5) * 0.06)
    path.quadraticCurveTo(hl, top, hl, top * 0.6); path.lineTo(hl, 0.05); path.closePath()
    const g = c.createLinearGradient(0, top, 0, 0)
    g.addColorStop(0, ah(bark, 10)); g.addColorStop(0.35, ah(bark, 2)); g.addColorStop(1, ah(bark, -12))
    c.fillStyle = g; c.fill(path)
    c.save(); c.clip(path)
    const cr = new Path2D()
    for (let i = 0; i < 22; i++) {
      let y = lerp(top, 0, r()), x = -hl + r() * w.w * 0.3
      cr.moveTo(x, y)
      const end = x + w.w * (0.3 + r() * 0.6)
      while (x < end) { x += 0.2; y += (r() - 0.5) * 0.05; cr.lineTo(x, y) }
    }
    c.strokeStyle = 'rgba(0,0,0,0.42)'; c.lineWidth = Math.max(lw, 0.03); c.stroke(cr)
    c.restore()
    // cut end
    const ex = w.end * hl
    c.beginPath(); c.ellipse(ex, top * 0.5, rr * 0.32, -top * 0.52, 0, 0, TAU)
    c.fillStyle = ah(inner, -6); c.fill()
    c.strokeStyle = 'rgba(60,35,15,0.35)'; c.lineWidth = Math.max(lw, 0.012)
    for (let k = 1; k < 6; k++) { c.beginPath(); c.ellipse(ex, top * 0.5, rr * 0.32 * k / 6, -top * 0.52 * k / 6, 0, 0, TAU); c.stroke() }
    moss(r, -hl, hl, top - 0.02, 0.18, 80)
    moss(r, -hl * 1.1, hl * 1.1, -0.05, 0.2, 40)
  }
}
function moss(r, x0, x1, y, h, n) {
  const p = new Path2D(), q = new Path2D()
  for (let i = 0; i < n * Math.max(0.5, rt.detail); i++) {
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
  c.save(); c.translate(br.x, br.y); c.rotate(br.ang)
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
    for (let i = 0; i < 160 * Math.max(0.5, rt.detail); i++) {
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
  const spread = gen.wood ? gen.wood.w * 0.6 : 1.1
  const n = 3 + ((r() * 4) | 0)
  for (let i = 0; i < n; i++) leaf(r, (r() * 2 - 1) * spread, 0.05 + r() * 0.2, 0.5 + r() * 0.5)
  moss(r, -spread * 0.8, spread * 0.8, 0.0, 0.18, 30)
  // a few needles and a twig
  c.strokeStyle = ah(C(30, 30, 26)); c.lineWidth = Math.max(1 / K, 0.02)
  c.beginPath()
  for (let i = 0; i < 6; i++) { const x = (r() * 2 - 1) * spread, y = 0.05 + r() * 0.25, a = (r() - 0.5) * 0.8; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.08) }
  c.stroke()
}

// --- background / foreground ------------------------------------------------------------
function bakeBackground() {
  const key = `${(params.mist * 20) | 0}|${(params.damp * 20) | 0}`
  if (key === bgKey) return
  bgKey = key
  const b = bgx, r = mulberry(rt.seed ^ 0x51ed)
  const mist = params.mist, damp = params.damp
  const air = b.createLinearGradient(0, 0, 0, farY)
  air.addColorStop(0, '#06080b')
  air.addColorStop(1, `hsl(155, 14%, ${9 + damp * 3 + mist * 6}%)`)
  b.fillStyle = air; b.fillRect(0, 0, W, farY + 2)
  // distant trunks, blurred by distance
  for (let layer = 0; layer < 3; layer++) {
    b.save()
    b.filter = `blur(${(3 - layer) * 3 * PR}px)`
    const n = 5 + layer * 3
    for (let i = 0; i < n; i++) {
      const x = r() * W, w = (12 + r() * 40) * PR * (0.5 + layer * 0.4)
      const l = 6 + (2 - layer) * (3 + mist * 6)
      b.fillStyle = `hsl(150, 10%, ${l}%)`
      b.fillRect(x - w / 2, 0, w, farY + 10 * PR)
    }
    b.restore()
  }
  // light shafts
  b.save(); b.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 4; i++) {
    const x = r() * W, w = (60 + r() * 140) * PR, sk = (0.25 + r() * 0.2) * H
    const g = b.createLinearGradient(0, 0, 0, farY)
    g.addColorStop(0, `rgba(200,230,200,${0.05 + mist * 0.05})`); g.addColorStop(1, 'rgba(200,230,200,0)')
    b.fillStyle = g
    b.beginPath(); b.moveTo(x, 0); b.lineTo(x + w, 0); b.lineTo(x + w + sk, farY); b.lineTo(x + sk, farY); b.closePath(); b.fill()
  }
  b.restore()
  // undergrowth silhouettes along the horizon
  b.strokeStyle = `hsl(150, 12%, ${6 + mist * 4}%)`; b.lineWidth = 1.5 * PR
  b.beginPath()
  for (let i = 0; i < W / (4 * PR); i++) {
    const x = r() * W, h = (8 + r() * 40) * PR, a = -Math.PI / 2 + (r() - 0.5) * 0.9
    b.moveTo(x, farY + 4 * PR); b.quadraticCurveTo(x + Math.cos(a) * h * 0.5, farY - h * 0.6, x + Math.cos(a) * h, farY + Math.sin(a) * h)
  }
  b.stroke()
  // the litter surface, receding
  const lit = b.createLinearGradient(0, farY, 0, ground)
  lit.addColorStop(0, `hsl(30, 18%, ${7 + mist * 4}%)`); lit.addColorStop(1, `hsl(28, 32%, ${13 + damp * 4}%)`)
  b.fillStyle = lit; b.fillRect(0, farY, W, ground - farY + 1)
  const nLeaves = Math.min(1600, Math.round((W * (ground - farY)) / (90 * PR * PR) * rt.detail))
  for (let i = 0; i < nLeaves; i++) {
    const t = r() ** 0.8, y = lerp(farY, ground, t), x = r() * W
    const s = unit * lerp(0.25, 0.75, t) * (0.6 + r() * 0.8)
    const hue = pickOf(r, [28, 34, 20, 42, 12, 90])
    const l = (hue === 90 ? 18 : 16 + r() * 18) * lerp(0.55, 1, t) * (1 - damp * 0.15)
    b.save(); b.translate(x, y); b.scale(1, 0.35); b.rotate(r() * TAU)
    b.fillStyle = `hsla(${hue}, ${30 + r() * 30}%, ${l}%, ${lerp(0.6, 1, t)})`
    b.beginPath(); b.moveTo(-s / 2, 0); b.quadraticCurveTo(0, -s * 0.35, s / 2, 0); b.quadraticCurveTo(0, s * 0.35, -s / 2, 0); b.fill()
    b.restore()
  }
  // soil cross-section
  const soilTop = ground
  const soil = b.createLinearGradient(0, soilTop, 0, H)
  soil.addColorStop(0, `hsl(26, 34%, ${14 + damp * 6}%)`)
  soil.addColorStop(1, `hsl(22, 40%, ${5 + damp * 3}%)`)
  b.fillStyle = soil
  b.beginPath(); b.moveTo(0, H); b.lineTo(0, soilTop)
  for (let x = 0; x <= W; x += 6 * PR) b.lineTo(x, soilTop + (r() - 0.3) * 3 * PR)
  b.lineTo(W, H); b.closePath(); b.fill()
  for (let i = 0; i < 6; i++) {
    const y = lerp(soilTop + 10 * PR, H, r())
    b.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '120,90,60'},0.06)`
    b.fillRect(0, y, W, (4 + r() * 18) * PR)
  }
  for (let i = 0; i < Math.round(W / (24 * PR)); i++) {
    const x = r() * W, y = lerp(soilTop + 6 * PR, H, r()), rr = (1.5 + r() * 5) * PR
    b.fillStyle = `hsl(${20 + r() * 20}, ${10 + r() * 15}%, ${12 + r() * 14}%)`
    b.beginPath(); b.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, TAU); b.fill()
    b.fillStyle = 'rgba(255,240,220,0.06)'
    b.beginPath(); b.ellipse(x - rr * 0.3, y - rr * 0.3, rr * 0.4, rr * 0.25, 0, 0, TAU); b.fill()
  }
  b.strokeStyle = 'rgba(70,45,25,0.6)'
  for (let i = 0; i < 7; i++) {
    let x = r() * W, y = soilTop + r() * 10 * PR
    b.lineWidth = (1 + r() * 3) * PR
    b.beginPath(); b.moveTo(x, y)
    for (let k = 0; k < 14; k++) { x += (r() - 0.5) * 40 * PR; y += r() * 14 * PR; b.lineTo(x, y) }
    b.stroke()
  }
  // overhanging leaves along the cut edge
  for (let i = 0; i < W / (10 * PR); i++) {
    const x = r() * W, s = unit * (0.5 + r() * 0.5)
    b.save(); b.translate(x, ground + r() * 2 * PR); b.scale(1, 0.35); b.rotate(r() * TAU)
    b.fillStyle = `hsl(${pickOf(r, [28, 34, 20, 40])}, ${35 + r() * 25}%, ${14 + r() * 14}%)`
    b.beginPath(); b.moveTo(-s / 2, 0); b.quadraticCurveTo(0, -s * 0.35, s / 2, 0); b.quadraticCurveTo(0, s * 0.35, -s / 2, 0); b.fill()
    b.restore()
  }
}
function bakeForeground() {
  const g = fgx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
  fgx.clearRect(0, 0, W, H)
  fgx.fillStyle = g; fgx.fillRect(0, 0, W, H)
}

// --- frame loop ----------------------------------------------------------------------
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const g = params.growth

  growMyc(dt * g)

  if (rt.rng() < 0.012 * params.flush * g && !fruits.some((f) => f.rate === 0)) spawnFruit(rt.random(W * 0.05, W * 0.95))
  for (let i = fruits.length - 1; i >= 0; i--) {
    const f = fruits[i]
    f.g += dt * 0.06 * g * f.rate
    if (f.g > 2.5) { if (f.canvas) pool.push(f.canvas); fruits.splice(i, 1) }
  }

  // re-bake the stalest few sprites this frame
  const env = envKey()
  const dirty = []
  for (const f of fruits) {
    const d = depthOf(f.z)
    f.dscale = d.s
    if (!f.canvas || f.bakedEnv !== env) { dirty.push([1e9, f]); continue }
    const step = f.g < 1.3 ? 0.012 : 0.035
    const lag = Math.abs(f.g - f.bakedG)
    if (lag > step) dirty.push([lag, f])
  }
  dirty.sort((a, b) => b[0] - a[0])
  const budget = 2 + Math.round(3 * rt.detail)
  for (let i = 0; i < Math.min(budget, dirty.length); i++) bakeFruit(dirty[i][1])

  bakeBackground()
  ctx.drawImage(bg, 0, 0)

  // mycelium web in the soil
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.45 + params.damp * 0.5
  ctx.drawImage(myc, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // far to near
  fruits.sort((a, b) => b.z - a.z || a.x - b.x)
  const pulse = rt.beat.state.pulse || 0
  for (const f of fruits) {
    if (!f.canvas || !f.bakedK) continue
    const d = depthOf(f.z)
    const k = unit * d.s * params.size
    const s = k / f.bakedK
    const fade = 1 - smooth(2.3, 2.5, f.g)
    ctx.globalAlpha = fade
    const ox = f.x + f.box.x0 * k, oy = d.y + f.box.y0 * k
    ctx.drawImage(f.canvas, ox, oy, f.canvas.width * s, f.canvas.height * s)
    ctx.globalAlpha = 1
    // bioluminescence
    if (f.gen.glow && params.glow > 0 && f.marks) {
      const a = params.glow * f.gen.glow * (0.6 + 0.4 * pulse) * fade * (1 - f.z * 0.4)
      if (a > 0.01) {
        ctx.globalCompositeOperation = 'lighter'
        for (const m of f.marks.glow) {
          const gx = f.x + m.x * k, gy = d.y + m.y * k, gr = m.r * k
          ctx.globalAlpha = Math.min(1, a)
          ctx.drawImage(glowTint(f.gen.glowCol), gx - gr, gy - gr, gr * 2, gr * 2)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    }
    // spores drift down from the gills; ink caps drip
    if (f.marks) {
      for (const m of f.marks.spore) {
        if (params.spores > 0 && rt.rng() < params.spores * 0.25) {
          spores.push({ x: f.x + (m.x + rt.random(-m.w, m.w)) * k, y: d.y + m.y * k, vy: rt.random(5, 14) * PR, vx: rt.random(-4, 4) * PR, life: 1, col: f.gen.spore, ink: false, size: 1.1 * PR * d.s, floor: d.y })
        }
      }
      for (const m of f.marks.ink) {
        if (rt.rng() < 0.05) spores.push({ x: f.x + (m.x + rt.random(-m.w, m.w)) * k, y: d.y + m.y * k, vy: 0, vx: 0, life: 1, col: f.gen.spore, ink: true, size: 2 * PR * d.s, floor: d.y })
      }
    }
  }

  // drifting spores and ink drops
  for (let i = spores.length - 1; i >= 0; i--) {
    const s = spores[i]
    if (s.ink) { s.vy += 300 * PR * dt; s.y = Math.min(s.y + s.vy * dt, s.floor); if (s.y >= s.floor) s.life -= dt * 1.5 }
    else { s.x += s.vx * dt; s.y += s.vy * dt; s.vx += Math.sin(t + s.y * 0.01) * 2 * PR * dt; s.life -= dt * 0.3 }
    if (s.life <= 0 || s.y > H) { spores.splice(i, 1); continue }
    ctx.fillStyle = hsl(s.col.h, s.col.s, s.col.l, s.ink ? s.life * 0.9 : s.life * 0.55)
    ctx.beginPath()
    if (s.ink) ctx.ellipse(s.x, s.y, s.size * 0.7, s.size * 1.2, 0, 0, TAU)
    else ctx.arc(s.x, s.y, s.size, 0, TAU)
    ctx.fill()
  }
  if (spores.length > 1500) spores.splice(0, spores.length - 1500)

  ctx.drawImage(fg, 0, 0)
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
