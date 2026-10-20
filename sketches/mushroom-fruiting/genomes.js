// Species genomes for the mushroom sketch. A genome describes one fruiting
// body (or cluster) completely: cap profile, colours, textures, gills, stem,
// plus Latin / common name. Every number is drawn around a species archetype;
// Variation scales the spread. Sizes are in "units": a typical cap radius is
// ~1.5 units; one unit is about 3 cm. Origin is where the fruit meets its
// substrate (soil or wood), y points down.
import { TAU, clamp, lerp, mulberry, C, mix, pickOf } from './util.js'

function makeJ(r, variation) {
  const V = variation * 2
  return (base, spread) => base + (r() * 2 - 1) * spread * V
}
function waves(r, j, amp, vamp = 0) {
  const w = []
  for (let i = 0; i < 3; i++) w.push({ k: 3 + ((r() * 6) | 0), amp: Math.max(0, j(amp, amp * 0.8)) * (1 - i * 0.25), vamp: Math.max(0, j(vamp, vamp * 0.8)), ph: r() * TAU, pv: r() * TAU })
  return w
}
function baseBody(over) {
  return { x: 0, y0: 0, zc: 0, delay: 0, speed: 1, scale: 1, lean: 0, side: 1, dir: 0, ...over }
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

// What each species needs and how it ends. `natural` weights the fates that
// need no outside help (rot / dry / deliq); `edible` and `graze` are how likely a
// forager picks it or something eats it. `rate` scales its life clock; `host`
// says which dead wood it fruits on (hard / soft / any) at which decay stage.
export const SPECIES = {
  flyAgaric: { label: 'Fly agaric (Amanita muscaria)', edible: 0.02, graze: 0.5, natural: { rot: 1 }, rate: 1 },
  porcini: { label: 'Porcini (Boletus edulis)', edible: 1, graze: 0.9, natural: { rot: 1 }, rate: 0.9 },
  inkcap: { label: 'Shaggy mane (Coprinus comatus)', edible: 0.35, graze: 0.2, natural: { deliq: 1 }, rate: 1.5, fateStart: [0.95, 1.2] },
  oyster: { label: 'Oyster (Pleurotus)', edible: 0.8, graze: 0.6, natural: { rot: 0.7, dry: 0.3 }, rate: 0.9, host: { kind: 'hard', stage: [0.05, 0.6] } },
  chanterelle: { label: 'Chanterelle (Cantharellus cibarius)', edible: 1, graze: 0.8, natural: { rot: 0.5, dry: 0.5 }, rate: 0.9 },
  polypore: { label: 'Conks (Fomitopsis, Laetiporus)', edible: 0.1, graze: 0.1, natural: { dry: 1 }, rate: 0.35, host: { kind: 'soft', stage: [0.05, 0.7] } },
  mycena: { label: 'Bonnets (Mycena)', edible: 0, graze: 0.3, natural: { rot: 0.5, dry: 0.5 }, rate: 1.3, host: { kind: 'any', stage: [0.25, 0.9], optional: true } },
  turkeytail: { label: 'Turkey tail (Trametes versicolor)', edible: 0.12, graze: 0.05, natural: { dry: 1 }, rate: 0.4, host: { kind: 'any', stage: [0.05, 0.85] } },
  lionsmane: { label: "Lion's mane (Hericium erinaceus)", edible: 0.8, graze: 0.5, natural: { rot: 0.6, dry: 0.4 }, rate: 0.7, host: { kind: 'hard', stage: [0.15, 0.7] } },
  psilocybe: { label: 'Psilocybe (cubensis, semilanceata)', edible: 0.5, graze: 0.6, natural: { dry: 0.5, rot: 0.5 }, rate: 1.2 },
  marasmius: { label: 'Marasmius (oreades, rotula)', edible: 0.5, graze: 0.4, natural: { dry: 1 }, rate: 1.1 },
  xylaria: { label: 'Xylaria (hypoxylon, polymorpha)', edible: 0, graze: 0, natural: { dry: 1 }, rate: 0.3, host: { kind: 'hard', stage: [0.35, 0.95] } },
  scutellinia: { label: 'Eyelash cup (Scutellinia scutellata)', edible: 0, graze: 0.05, natural: { dry: 0.6, rot: 0.4 }, rate: 0.8, host: { kind: 'any', stage: [0.45, 1] } },
  auricularia: { label: 'Wood ear (Auricularia)', edible: 0.5, graze: 0.1, natural: { dry: 1 }, rate: 0.6, host: { kind: 'hard', stage: [0.1, 0.85] } },
  cordyceps: { label: 'Cordyceps militaris', edible: 0.4, graze: 0.15, natural: { dry: 1 }, rate: 0.7 },
  wild: { label: 'Imaginary mushrooms (fully generative)', edible: 0, graze: 0.3, natural: { rot: 0.5, dry: 0.5 }, rate: 1 },
}
export const SPECIES_KEYS = Object.keys(SPECIES)

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
    return { latin: 'Amanita muscaria', common: 'Fly agaric', bodies: [body], spore: C(45, 20, 94) }
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
    return { latin: 'Boletus edulis', common: 'Porcini', bodies: [body], spore: C(45, 40, 32) }
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
    }), n, 1.6)
    return { latin: 'Coprinus comatus', common: 'Shaggy mane', bodies, spore: C(280, 15, 6), ink: true }
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
    }), n, 1.5)
    return { latin: 'Cantharellus cibarius', common: 'Chanterelle', bodies, spore: C(40, 40, 88) }
  },

  mycena(r, j, o) {
    const sp = pickOf(r, o.hostOk
      ? ['haematopus', 'galericulata', 'chlorophos', 'rosea', 'interrupta', 'epipterygia']
      : ['rosea', 'interrupta', 'epipterygia', 'pura'])
    const S = {
      haematopus: { latin: 'Mycena haematopus', common: 'Bleeding fairy helmet', cap: C(350, 32, 38), stem: C(345, 26, 46), gill: C(345, 12, 86), n: [4, 9], R: 0.5, L: 2.2, wood: true, rM: 1.0 },
      galericulata: { latin: 'Mycena galericulata', common: 'Common bonnet', cap: C(30, 18, 52), stem: C(35, 10, 72), gill: C(15, 28, 82), n: [3, 7], R: 0.62, L: 3.0, wood: true, rM: 0.9 },
      chlorophos: { latin: 'Mycena chlorophos', common: 'Green lantern bonnet', cap: C(48, 14, 80), stem: C(50, 12, 84), gill: C(60, 10, 90), n: [4, 9], R: 0.4, L: 2.6, wood: true, rM: 0.95, glow: 1 },
      rosea: { latin: 'Mycena rosea', common: 'Rosy bonnet', cap: C(338, 50, 72), stem: C(335, 28, 82), gill: C(335, 25, 90), n: [2, 5], R: 0.75, L: 2.8, rM: 1.0 },
      interrupta: { latin: 'Mycena interrupta', common: 'Pixie parasol', cap: C(215, 55, 58), stem: C(210, 45, 52), gill: C(210, 30, 80), n: [3, 8], R: 0.5, L: 2.4, rM: 0.8 },
      epipterygia: { latin: 'Mycena epipterygia', common: 'Yellowleg bonnet', cap: C(55, 10, 72), stem: C(55, 85, 62), gill: C(50, 10, 90), n: [3, 8], R: 0.42, L: 3.2, rM: 1.0 },
      pura: { latin: 'Mycena pura', common: 'Lilac bonnet', cap: C(285, 35, 65), stem: C(285, 25, 72), gill: C(285, 20, 86), n: [2, 5], R: 0.6, L: 2.6, rM: 0.9 },
    }[sp]
    const n = S.n[0] + ((r() * (S.n[1] - S.n[0] + 1)) | 0)
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.1), lean: j(0, 0.12),
      cap: {
        R: j(S.R, 0.07), rY: 1.3, rM: j(S.rM, 0.15), rO: 0.4, a: 1.3, b: 1,
        umbo: j(0.12, 0.08), dep: 0, curl: 0, upturn: 0.2, gRise: 0.42, gDrop: 0, tilt: 0.15, off: 0,
        waves: waves(r, j, 0.02), col: C(S.cap.h + j(0, 5), S.cap.s, S.cap.l + j(0, 5)), centre: { dl: -18, dh: -4, ext: 0.3 }, rim: { dl: 12, dh: 0, band: 0 },
        tex: [{ type: 'striate', n: Math.round(j(24, 4)), from: 0.25, a: 0.42 }], gloss: sp === 'epipterygia' || sp === 'interrupta' ? 0.9 : 0.5,
        gills: { type: 'gills', n: Math.round(j(18, 4)), col: S.gill, old: C(S.gill.h, S.gill.s, S.gill.l - 16) },
      },
      stem: {
        L: j(S.L, 0.7), wTop: 0.05, wBase: 0.06, bulb: 0.5, belly: 0, bend: bends(j, 0.15),
        col: S.stem, ring: null, volva: null, tex: 'smooth',
      },
    }), n, 1.3)
    return { latin: S.latin, common: S.common, needsHost: !!S.wood, bodies, spore: C(40, 10, 92), glow: S.glow ? j(1, 0.2) : 0, glowCol: C(j(105, 12), 90, 62) }
  },

  oyster(r, j, o) {
    const sp = r() < 0.7 ? 'ostreatus' : 'pulmonarius'
    const col = sp === 'ostreatus' ? pickOf(r, [C(30, 10, 52), C(215, 14, 48), C(28, 14, 40)]) : C(38, 14, 80)
    const n = 3 + ((r() * 4) | 0)
    const bodies = []
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 1.9, y0 = -r() * 0.9
      const dir = x < 0 ? -1 : 1
      bodies.push(baseBody({
        x, y0, zc: -y0, delay: r() * 0.25, scale: lerp(0.6, 1, r()) * j(1, 0.1), dir,
        lean: dir * j(0.35, 0.15),
        cap: {
          R: j(1.1, 0.25), rY: 0.6, rM: j(0.32, 0.08), rO: 0.12, a: 1.8, b: 0.9,
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
    return { latin: sp === 'ostreatus' ? 'Pleurotus ostreatus' : 'Pleurotus pulmonarius', common: sp === 'ostreatus' ? 'Oyster mushroom' : 'Phoenix oyster', needsHost: true, bodies, spore: C(300, 12, 88) }
  },

  polypore(r, j, o) {
    const kind = r() < 0.55 ? 'pinicola' : 'sulphur'
    const n = kind === 'pinicola' ? 1 + ((r() * 3) | 0) : 4 + ((r() * 5) | 0)
    const pal = kind === 'pinicola'
      ? [C(25, 8, 20), C(22, 10, 26), C(24, 14, 32), C(14, 70, 36), C(20, 85, 48)]
      : [C(24, 85, 52), C(32, 90, 56), C(42, 90, 60)]
    const dir = o.dir || (r() < 0.5 ? -1 : 1)
    const brackets = []
    for (let i = 0; i < n; i++) {
      const bands = []
      const nb = kind === 'pinicola' ? 9 : 3
      for (let k = 0; k < nb; k++) {
        const c = pal[Math.min(pal.length - 1, ((k / nb) * pal.length) | 0)]
        bands.push({ col: C(c.h + j(0, 4), c.s + j(0, 6), c.l + j(0, 5)), w: 0.5 + r() })
      }
      brackets.push({
        x: (r() - 0.5) * 0.6, y: kind === 'pinicola' ? -r() * 1.5 : -i * 0.42 + (r() - 0.5) * 0.2, dir,
        delay: r() * 0.35, w: j(kind === 'pinicola' ? 1.35 : 1.1, 0.3) * lerp(0.7, 1, r()),
        ry: kind === 'pinicola' ? j(0.5, 0.08) : j(0.4, 0.08), th: kind === 'pinicola' ? j(0.4, 0.08) : j(0.2, 0.05),
        ang: j(0, 0.12), bands, waves: waves(r, j, 0.05, 0),
        margin: kind === 'pinicola' ? C(40, 24, 90) : C(50, 90, 66), pore: kind === 'pinicola' ? C(40, 22, 84) : C(52, 85, 66),
        gloss: kind === 'pinicola' ? 1 : 0.15, velvet: false,
      })
    }
    brackets.sort((a, b) => b.y - a.y)
    return {
      latin: kind === 'pinicola' ? 'Fomitopsis pinicola' : 'Laetiporus conifericola', common: kind === 'pinicola' ? 'Red-belted conk' : 'Chicken of the woods',
      needsHost: true, bodies: [], brackets, spore: kind === 'pinicola' ? C(40, 20, 90) : C(45, 20, 92),
    }
  },

  turkeytail(r, j, o) {
    const themes = [
      [C(28, 30, 22), C(32, 25, 48), C(40, 25, 78), C(20, 35, 32)],
      [C(215, 18, 30), C(205, 12, 55), C(40, 18, 80), C(25, 25, 28)],
      [C(18, 55, 32), C(28, 55, 50), C(40, 40, 78), C(10, 40, 24)],
      [C(90, 20, 30), C(40, 22, 55), C(45, 20, 80), C(30, 25, 26)],
    ]
    const pal = pickOf(r, themes)
    const n = 9 + ((r() * 14) | 0)
    const W = j(1.8, 0.5), Hc = j(0.9, 0.3)
    const fans = []
    for (let i = 0; i < n; i++) {
      const bands = []
      const nb = Math.max(5, Math.round(j(11, 3)))
      for (let k = 0; k < nb; k++) { const c = pal[(r() * pal.length) | 0]; bands.push({ col: C(c.h + j(0, 6), c.s + j(0, 8), c.l + j(0, 7)), w: 0.5 + r() }) }
      fans.push({ x: (r() - 0.5) * W, y: -r() * Hc, R: lerp(0.3, 0.58, r()) * j(1, 0.1), rot: (r() - 0.5) * 0.9, delay: r() * 0.45, bands, waves: waves(r, j, 0.06), seed: (r() * 4294967296) >>> 0 })
    }
    fans.sort((a, b) => a.y - b.y)
    return {
      latin: 'Trametes versicolor', common: 'Turkey tail', needsHost: true, bodies: [], spore: C(45, 15, 92),
      parts: [{ type: 'rosette', fans, box: { x0: -W / 2 - 0.9, x1: W / 2 + 0.9, y0: -Hc - 1.0, y1: 0.4 } }],
    }
  },

  lionsmane(r, j) {
    const w = j(1.3, 0.3), h = j(1.0, 0.25)
    return {
      latin: 'Hericium erinaceus', common: "Lion's mane", needsHost: true, bodies: [], spore: C(45, 10, 94),
      parts: [{ type: 'tuft', w, h, len: j(0.4, 0.1), seed: (r() * 4294967296) >>> 0, delay: 0, box: { x0: -w / 2 - 0.3, x1: w / 2 + 0.3, y0: -h * 0.7 - 0.3, y1: h * 0.5 + 0.7 } }],
    }
  },

  xylaria(r, j) {
    const sp = r() < 0.6 ? 'hypoxylon' : 'polymorpha'
    const stalks = []
    const n = sp === 'hypoxylon' ? 4 + ((r() * 6) | 0) : 2 + ((r() * 4) | 0)
    const span = sp === 'hypoxylon' ? 1.5 : 1.3
    for (let i = 0; i < n; i++) {
      stalks.push({
        x: (r() - 0.5) * span, h: sp === 'hypoxylon' ? j(1.0, 0.35) : j(0.9, 0.2), w: sp === 'hypoxylon' ? 0.07 + r() * 0.03 : j(0.22, 0.05),
        bend: (r() - 0.5) * 0.5, fork: sp === 'hypoxylon' ? 1 + ((r() * 2) | 0) : 0, delay: r() * 0.3, seed: (r() * 4294967296) >>> 0,
      })
    }
    return {
      latin: sp === 'hypoxylon' ? 'Xylaria hypoxylon' : 'Xylaria polymorpha', common: sp === 'hypoxylon' ? 'Candlesnuff fungus' : "Dead man's fingers",
      needsHost: true, bodies: [], spore: C(40, 5, 70),
      parts: [{ type: 'xylaria', variant: sp, stalks, box: { x0: -span / 2 - 0.8, x1: span / 2 + 0.8, y0: -1.7, y1: 0.4 } }],
    }
  },

  scutellinia(r, j) {
    const n = 10 + ((r() * 14) | 0)
    const cups = []
    for (let i = 0; i < n; i++) cups.push({ x: (r() - 0.5) * 1.7, y: (r() - 0.5) * 0.9, r: lerp(0.1, 0.2, r()), tilt: 0.45 + r() * 0.2, delay: r() * 0.4, hue: j(8, 4) })
    cups.sort((a, b) => a.y - b.y)
    return {
      latin: 'Scutellinia scutellata', common: 'Eyelash cup', needsHost: true, bodies: [], spore: C(10, 30, 70),
      parts: [{ type: 'cups', cups, box: { x0: -1.1, x1: 1.1, y0: -0.8, y1: 0.8 } }],
    }
  },

  auricularia(r, j) {
    const n = 3 + ((r() * 6) | 0)
    const hue = j(14, 5), ears = []
    for (let i = 0; i < n; i++) ears.push({ x: (r() - 0.5) * 1.5, y: -r() * 0.6, w: lerp(0.45, 0.85, r()), rot: (r() - 0.5) * 1.2, flip: r() < 0.5 ? -1 : 1, delay: r() * 0.35, seed: (r() * 4294967296) >>> 0 })
    ears.sort((a, b) => a.y - b.y)
    return {
      latin: 'Auricularia angiosperma', common: 'Wood ear', needsHost: true, bodies: [], spore: C(30, 8, 90),
      parts: [{ type: 'ears', ears, hue, box: { x0: -1.4, x1: 1.4, y0: -1.4, y1: 0.7 } }],
    }
  },

  cordyceps(r, j) {
    const n = 1 + ((r() * 4) | 0)
    const depth = j(1.5, 0.35), clubs = []
    for (let i = 0; i < n; i++) clubs.push({ x: (i - (n - 1) / 2) * 0.28 + (r() - 0.5) * 0.15, h: j(1.7, 0.4), w: lerp(0.07, 0.1, r()), head: j(0.55, 0.12), bend: (r() - 0.5) * 0.5, delay: r() * 0.25 })
    const maxH = Math.max(...clubs.map((c) => c.h))
    return {
      latin: 'Cordyceps militaris', common: 'Scarlet caterpillar club', bodies: [], spore: C(25, 60, 70),
      parts: [{ type: 'cordy', depth, pupa: { len: j(0.95, 0.15), ang: j(0.25, 0.4), seed: (r() * 4294967296) >>> 0 }, clubs, box: { x0: -1.0, x1: 1.0, y0: -maxH - 0.5, y1: depth + 0.8 } }],
    }
  },

  psilocybe(r, j) {
    const sp = r() < 0.55 ? 'cubensis' : 'semilanceata'
    if (sp === 'cubensis') {
      const n = 1 + ((r() * 3) | 0)
      const bodies = cluster(r, j, () => baseBody({
        scale: j(1, 0.12), lean: j(0, 0.08),
        cap: {
          R: j(1.0, 0.2), rY: 1.0, rM: j(0.55, 0.1), rO: 0.15, a: 2.2, b: 0.7,
          umbo: j(0.15, 0.08), dep: 0, curl: 0.5, upturn: 0.12, gRise: 0.2, gDrop: 0, tilt: 0.16, off: 0,
          waves: waves(r, j, 0.025), col: C(j(32, 5), j(58, 10), j(52, 6)), centre: { dl: -10, dh: -4, ext: 0.35 }, rim: { dl: 12, dh: 6, band: 0 },
          tex: [{ type: 'fibrils', n: 40, a: 0.05 }, { type: 'speckles', n: 18, col: C(48, 20, 92) }, { type: 'bruise', n: 5 }], gloss: 0.5,
          gills: { type: 'gills', n: 90, col: C(280, 14, 40), old: C(285, 25, 16) },
        },
        stem: {
          L: j(2.8, 0.6), wTop: 0.17, wBase: 0.2, bulb: 0.15, belly: 0, bend: bends(j, 0.06),
          col: C(45, 10, 92), ring: { t: 0.78, len: 0.35, col: C(280, 8, 62) }, volva: null, tex: 'fibrils', bruise: true,
        },
      }), n, 1.4)
      return { latin: 'Psilocybe cubensis', common: 'Golden teacher', bodies, spore: C(280, 25, 18) }
    }
    const n = 4 + ((r() * 6) | 0)
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.15), lean: j(0, 0.1),
      cap: {
        R: j(0.32, 0.05), rY: 1.7, rM: 1.25, rO: 0.9, a: 1.15, b: 1,
        umbo: 0.3, dep: 0, curl: 0.2, upturn: 0.12, gRise: 0.3, gDrop: 0, tilt: 0.12, off: 0,
        waves: waves(r, j, 0.02), col: C(j(48, 6), j(45, 8), j(50, 6)), centre: { dl: -14, dh: -4, ext: 0.3 }, rim: { dl: 10, dh: 4, band: 0 },
        tex: [{ type: 'striate', n: 24, from: 0.35, a: 0.3 }], gloss: 0.6,
        gills: { type: 'gills', n: 24, col: C(280, 12, 42), old: C(285, 22, 18) },
      },
      stem: {
        L: j(2.7, 0.5), wTop: 0.04, wBase: 0.05, bulb: 0, belly: 0, bend: bends(j, 0.3),
        col: C(48, 18, 86), ring: null, volva: null, tex: 'smooth', bruise: true,
      },
    }), n, 2.2)
    return { latin: 'Psilocybe semilanceata', common: 'Liberty cap', bodies, spore: C(280, 20, 20) }
  },

  marasmius(r, j, o) {
    const sp = o.ring || r() < 0.65 ? 'oreades' : 'rotula'
    if (sp === 'oreades') {
      const n = o.ring ? 1 : 1 + ((r() * 3) | 0)
      const bodies = cluster(r, j, () => baseBody({
        scale: j(1, 0.12), lean: j(0, 0.1),
        cap: {
          R: j(0.7, 0.1), rY: 0.8, rM: 0.45, rO: 0.2, a: 2.2, b: 0.8,
          umbo: j(0.2, 0.05), dep: 0, curl: 0.4, upturn: 0.2, gRise: 0.2, gDrop: 0, tilt: 0.16, off: 0,
          waves: waves(r, j, 0.03), col: C(j(30, 4), j(42, 6), j(68, 4)), centre: { dl: -9, dh: 0, ext: 0.25 }, rim: { dl: 4, dh: 0, band: 0 },
          tex: [{ type: 'striate', n: 36, from: 0.55, a: 0.2 }], gloss: 0.25,
          gills: { type: 'gills', n: 36, col: C(40, 20, 88), old: C(35, 25, 72) },
        },
        stem: {
          L: j(2.4, 0.5), wTop: 0.075, wBase: 0.085, bulb: 0, belly: 0, bend: bends(j, 0.1),
          col: C(38, 25, 76), ring: null, volva: null, tex: 'fibrils',
        },
      }), n, 1.2)
      return { latin: 'Marasmius oreades', common: 'Fairy ring champignon', bodies, spore: C(40, 15, 92) }
    }
    const n = 3 + ((r() * 5) | 0)
    const bodies = cluster(r, j, () => baseBody({
      scale: j(1, 0.15), lean: j(0, 0.12),
      cap: {
        R: j(0.2, 0.03), rY: 0.8, rM: 0.55, rO: 0.3, a: 2, b: 0.8,
        umbo: 0, dep: 0.22, curl: 0.2, upturn: 0.1, gRise: 0.1, gDrop: 0, tilt: 0.2, off: 0,
        waves: waves(r, j, 0.02), col: C(45, 8, 94), centre: { dl: -8, dh: 0, ext: 0.12 }, rim: { dl: 0, dh: 0, band: 0 },
        tex: [{ type: 'striate', n: 14, from: 0.08, a: 0.55 }], gloss: 0.4,
        gills: { type: 'gills', n: 10, col: C(45, 5, 92), old: C(40, 10, 75) },
      },
      stem: {
        L: j(2.2, 0.5), wTop: 0.03, wBase: 0.03, bulb: 0, belly: 0, bend: bends(j, 0.25),
        col: C(25, 25, 10), ring: null, volva: null, tex: 'smooth',
      },
    }), n, 1.4)
    return { latin: 'Marasmius rotula', common: 'Pinwheel marasmius', bodies, spore: C(45, 5, 94) }
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
    const bodies = n === 1 ? [make()] : cluster(r, j, make, n, R * 1.5)
    const glow = r() < 0.12 ? j(0.9, 0.2) : 0
    return { latin: 'Fungus imaginarium', common: 'Imaginary mushroom', bodies, spore: pickOf(r, [C(45, 20, 92), C(340, 30, 70), C(25, 40, 30), C(280, 15, 10)]), glow, glowCol: C(lerp(90, 190, r()), 90, 60) }
  },}

function computeBox(gen) {
  let x0 = -1.5, x1 = 1.5, y0 = -1.5, y1 = 0.55
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
  for (const br of gen.brackets || []) {
    x0 = Math.min(x0, br.x - br.w * 1.3); x1 = Math.max(x1, br.x + br.w * 1.3); y0 = Math.min(y0, br.y - br.w)
  }
  for (const p of gen.parts || []) {
    x0 = Math.min(x0, p.box.x0); x1 = Math.max(x1, p.box.x1); y0 = Math.min(y0, p.box.y0); y1 = Math.max(y1, p.box.y1)
  }
  return { x0, x1, y0, y1 }
}

// o: { hostOk } a suitable dead log / stump is available; { dir } side of the
// substrate the fruit grows towards; { ring } part of a fairy ring.
export function makeGenome(key, seed, variation, o = {}) {
  const r = mulberry(seed)
  const j = makeJ(r, variation)
  const gen = GEN[key](r, j, o)
  gen.key = key
  gen.parts = gen.parts || []
  gen.brackets = gen.brackets || []
  gen.box = computeBox(gen)
  return gen
}
