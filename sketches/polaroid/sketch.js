// Polaroid — put a live source through an old printed-photo run: faded/sepia
// grade with lifted blacks and a vignette, an optional white instant-film border
// with the fat bottom lip, and a layer of physical damage — hair-thin scratches,
// dust specks, greasy smudges and blooming water stains. The damage is generated
// once from the sketch seed (so every instance is scuffed differently) and sits
// static over the moving image, like a real print you keep re-filming.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const TONES = {
  Faded: { lift: 26, gamma: 1.05, sat: 0.72, tint: [1.03, 1.0, 0.92], fade: 0.14 },
  Sepia: { lift: 22, gamma: 1.1, sat: 0.25, tint: [1.12, 0.98, 0.78], fade: 0.1 },
  Instant: { lift: 18, gamma: 0.95, sat: 0.9, tint: [1.05, 1.0, 1.04], fade: 0.08 },
  Cold: { lift: 20, gamma: 1.0, sat: 0.6, tint: [0.94, 0.99, 1.1], fade: 0.12 },
}
const params = rt.params({
  tone: { value: 'Faded', type: 'select', options: Object.keys(TONES), label: 'Film tone' },
  age: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Age' },
  vignette: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  scratches: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Scratches' },
  dust: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Dust & specks' },
  smudges: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Smudges' },
  water: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Water damage' },
  border: { value: true, type: 'bool', label: 'Instant border' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})

const src = createSource()
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d', { willReadFrequently: true })
// damage lives on its own static layer, rebuilt only when a wear param changes
const dmg = document.createElement('canvas')
const dctx = dmg.getContext('2d')
let W = 0, H = 0, bw = 0, bh = 0
let dmgKey = ''

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  const cap = 1000, s = Math.min(1, cap / Math.max(W, H))
  bw = buf.width = Math.max(2, Math.round(W * s))
  bh = buf.height = Math.max(2, Math.round(H * s))
  dmgKey = '' // force damage rebuild at new size
}

// content rect inside the white border
function contentRect() {
  if (!params.border) return { x: 0, y: 0, w: W, h: H }
  const m = Math.round(Math.min(W, H) * 0.055)
  const bottom = Math.round(Math.min(W, H) * 0.16)
  return { x: m, y: m, w: W - m * 2, h: H - m - bottom }
}

// local seeded PRNG so the wear pattern is stable while sliders move
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function buildDamage() {
  dmg.width = W; dmg.height = H
  dctx.clearRect(0, 0, W, H)
  const R = mulberry32((rt.seed | 0) ^ 0x9e3779b9) // stable seeded 0..1
  const S = Math.min(W, H)
  const age = params.age

  // water stains — irregular blooms with a darker tide-line ring
  const nWater = Math.round(params.water * 5)
  for (let i = 0; i < nWater; i++) {
    const cx = R() * W, cy = R() * H, rad = S * (0.08 + R() * 0.18)
    dctx.save()
    dctx.translate(cx, cy); dctx.scale(1, 0.6 + R() * 0.7)
    // blotch body: slightly darker, desaturating
    const g = dctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad)
    g.addColorStop(0, `rgba(70,60,45,${0.05 + 0.08 * params.water})`)
    g.addColorStop(0.75, `rgba(60,50,35,${0.03 + 0.05 * params.water})`)
    g.addColorStop(0.9, `rgba(40,30,20,${0.10 + 0.14 * params.water})`) // tide line
    g.addColorStop(1, 'rgba(0,0,0,0)')
    dctx.fillStyle = g
    dctx.beginPath()
    const segs = 22
    for (let a = 0; a <= segs; a++) {
      const th = (a / segs) * Math.PI * 2
      const rr = rad * (0.8 + R() * 0.35)
      const px = Math.cos(th) * rr, py = Math.sin(th) * rr
      a ? dctx.lineTo(px, py) : dctx.moveTo(px, py)
    }
    dctx.closePath(); dctx.fill()
    dctx.restore()
  }

  // smudges — soft greasy dark/light blotches
  const nSm = Math.round(params.smudges * 14)
  for (let i = 0; i < nSm; i++) {
    const cx = R() * W, cy = R() * H, rad = S * (0.04 + R() * 0.12)
    const dark = R() < 0.6
    const g = dctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    const a = (0.04 + R() * 0.07) * params.smudges
    g.addColorStop(0, dark ? `rgba(20,18,14,${a})` : `rgba(240,235,225,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    dctx.fillStyle = g
    dctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }

  // scratches — long thin bright hairlines and a few dark gouges
  const nSc = Math.round(params.scratches * 26)
  dctx.lineCap = 'round'
  for (let i = 0; i < nSc; i++) {
    const vertical = R() < 0.7
    const bright = R() < 0.75
    let x = R() * W, y = R() * H
    const len = S * (0.1 + R() * 0.7)
    const drift = (R() - 0.5) * S * 0.05
    dctx.beginPath(); dctx.moveTo(x, y)
    if (vertical) dctx.lineTo(x + drift, y + (R() < 0.5 ? len : -len))
    else dctx.lineTo(x + (R() < 0.5 ? len : -len), y + drift)
    dctx.lineWidth = Math.max(0.5, (0.5 + R() * 1.2) * rt.pixelRatio)
    dctx.strokeStyle = bright
      ? `rgba(255,252,245,${(0.10 + R() * 0.22) * params.scratches})`
      : `rgba(15,12,10,${(0.10 + R() * 0.2) * params.scratches})`
    dctx.stroke()
  }

  // dust & specks — tiny dark and white grains
  const nDust = Math.round(params.dust * 900)
  for (let i = 0; i < nDust; i++) {
    const x = R() * W, y = R() * H, r = (0.3 + R() * 1.6) * rt.pixelRatio
    const white = R() < 0.5
    dctx.fillStyle = white
      ? `rgba(255,255,250,${(0.15 + R() * 0.5) * params.dust})`
      : `rgba(10,8,6,${(0.15 + R() * 0.5) * params.dust})`
    dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill()
  }
  // reset the seeded stream position roughly (rng already advanced; fine)
  dmgKey = key()
}
function key() {
  return [W, H, params.age, params.scratches, params.dust, params.smudges, params.water, rt.seed].join(':')
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }
  const rect = contentRect()
  // draw + grade the source into the reduced buffer
  src.draw(bctx, bw, bh, { mirror: params.mirror })
  const im = bctx.getImageData(0, 0, bw, bh)
  const d = im.data
  const T = TONES[params.tone]
  const lift = T.lift * (0.4 + params.age), inv = 1 / T.gamma
  const [tr, tg, tb] = T.tint
  const fade = T.fade * params.age
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2]
    const l = r * 0.299 + g * 0.587 + b * 0.114
    r = l + (r - l) * T.sat; g = l + (g - l) * T.sat; b = l + (b - l) * T.sat
    // gamma + lifted blacks, tint, and a milky fade toward warm grey
    r = lift + (255 - lift) * Math.pow(r / 255, inv)
    g = lift + (255 - lift) * Math.pow(g / 255, inv)
    b = lift + (255 - lift) * Math.pow(b / 255, inv)
    r *= tr; g *= tg; b *= tb
    d[i] = r + (214 - r) * fade
    d[i + 1] = g + (204 - g) * fade
    d[i + 2] = b + (186 - b) * fade
  }
  bctx.putImageData(im, 0, 0)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // paper/border
  if (params.border) {
    ctx.fillStyle = '#efe9dc'
    ctx.fillRect(0, 0, W, H)
    // subtle paper shadow around the window
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.min(W, H) * 0.02
    ctx.fillStyle = '#000'
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  } else {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buf, rect.x, rect.y, rect.w, rect.h)

  // vignette within the window
  if (params.vignette > 0.001) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
    const rad = Math.hypot(rect.w, rect.h) * 0.5
    const vg = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, `rgba(20,14,8,${0.55 * params.vignette})`)
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip()
    ctx.fillStyle = vg; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.restore()
  }

  // static damage on top (rebuild only when wear params change)
  if (dmgKey !== key()) buildDamage()
  ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip()
  ctx.drawImage(dmg, 0, 0)
  ctx.restore()

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
