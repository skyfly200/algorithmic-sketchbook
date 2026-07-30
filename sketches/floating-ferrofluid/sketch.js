/**
 * Ferrofluid Speaker — black magnetic fluid on a clean white field, driven by
 * sound. An electromagnet under the centre magnetises the fluid; along the
 * field lines it doesn't just bead up, it stands up into a crown of Rosensweig
 * spikes — ridged peaks that radiate out along the field arcs. On the bass the
 * field surges and the spikes climb and lean; between hits they sink back into
 * a glossy central pool.
 *
 * The fluid is an anisotropic metaball field: each lump is stretched along the
 * local field direction, so the sum forms radial ridges (peaks) instead of
 * round balls. It's shaded like oily black chrome — a wet white specular and a
 * cool rim where the flanks catch the light — with a soft contact shadow
 * seating it on the white. Gravity is ignored: the only forces are the magnet
 * and the fluid's own cohesion.
 *
 * Turn on the mic (bottom-right) to drive it live; with no mic it runs on a
 * synthetic kick so it always dances.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  drive: { value: 1.1, min: 0, max: 2.5, step: 0.05, label: 'Audio drive' },
  magnet: { value: 0.6, min: 0, max: 1.6, step: 0.05, label: 'Field strength' },
  spikes: { value: 9, min: 3, max: 16, step: 1, label: 'Spikes' },
  reach: { value: 1.0, min: 0.2, max: 2.0, step: 0.05, label: 'Spike reach' },
  sharp: { value: 1.7, min: 1, max: 3, step: 0.05, label: 'Peak sharpness' },
  arc: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Field-arc curl' },
  fluid: { value: 1.0, min: 0.5, max: 1.8, step: 0.05, label: 'Fluid amount' },
  viscosity: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Viscosity' },
  hue: { value: Math.round(rt.random(195, 235)), min: 0, max: 360, step: 1, label: 'Sheen hue' },
})
rt.onBeat(() => {}) // mounts the mic toggle; audio is read below

// --- audio: real mic when on, a synthetic kick otherwise ---------------------
let bass = 0, high = 0
function readAudio(t) {
  const s = rt.beat.state
  if (s.active) {
    bass += (s.low - bass) * 0.35
    high += (s.high - high) * 0.35
  } else {
    const ph = (t * 2.05) % 1
    const thump = Math.exp(-ph * 6) * 0.95
    bass += ((0.16 + thump + 0.1 * Math.sin(t * 1.1)) - bass) * 0.3
    high += ((0.14 + 0.12 * Math.sin(t * 8)) - high) * 0.3
  }
}

// --- layout ------------------------------------------------------------------
let W = 0, H = 0, PR = 1
let cxp = 0, cyp = 0, R = 0 // centre + fluid working radius (px)
let bx0 = 0, by0 = 0, bw = 0, bh = 0 // field buffer footprint
let fw = 0, fh = 0 // field buffer resolution
let vgrid = null, img = null
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  R = Math.min(W * 0.24, H * 0.26)
  cxp = W * 0.5
  cyp = H * 0.5
  // buffer covers the fully-extended crown of spikes with margin
  const ext = R * 3.0
  bx0 = cxp - ext / 2
  by0 = cyp - ext / 2
  bw = bh = ext
  const scale = Math.max(3.4, 4.4 / rt.detail)
  fw = fh = Math.max(90, Math.round(bw / scale))
  buf.width = fw
  buf.height = fh
  vgrid = new Float32Array(fw * fh)
  img = bctx.createImageData(fw, fh)
  initSpikes()
}

// --- the spike crown ---------------------------------------------------------
// Each spike is a ray from the magnet centre; along it we place a tapering chain
// of anisotropic lumps that read as one ridged peak. Spike length breathes with
// the field. A central pool of lumps keeps the base filled.
let spikes = []
let spikeCount = -1
function initSpikes() {
  spikeCount = Math.round(params.spikes)
  spikes = []
  for (let i = 0; i < spikeCount; i++) {
    spikes.push({
      ang: (i / spikeCount) * Math.PI * 2 + rt.random(-0.12, 0.12),
      len: R * 0.3,
      wph: rt.random(0, 6.28),
      wsp: rt.random(0.6, 1.5),
      curl: rt.random(-1, 1), // which way this spike bows into its arc
      lift: rt.random(0.85, 1.15), // per-spike height variation
    })
  }
}

const FRACS = [0.24, 0.5, 0.74, 0.94] // where lumps sit along a spike
let drops = [] // rebuilt each frame from the spike state

function buildDrops(t, field, dt) {
  const ease = Math.min(1, dt * (9 - params.viscosity * 6))
  drops = []
  // central pool — a couple of overlapping lumps so the base is always full
  const pool = R * (0.22 + field * 0.05) * params.fluid
  drops.push({ x: cxp, y: cyp, r: pool, ux: 1, uy: 0, el: 1 })
  drops.push({ x: cxp, y: cyp, r: pool * 0.7, ux: 0, uy: 1, el: 1 })
  for (const s of spikes) {
    // breathe the spike length with the field (Rosensweig spikes climb on the
    // bass); a little per-spike wobble keeps the crown alive
    const wob = 0.85 + 0.25 * Math.sin(t * s.wsp + s.wph)
    const target = R * (0.26 + field * params.reach * 0.85) * s.lift * wob
    s.len += (target - s.len) * ease
    s.ang += Math.sin(t * s.wsp * 0.5 + s.wph) * 0.004 // gentle sway
    for (let j = 0; j < FRACS.length; j++) {
      const f = FRACS[j]
      // the ray bows sideways with radius → field lines read as arcs, not spokes
      const a = s.ang + params.arc * s.curl * f * 0.6
      const rad = s.len * f
      const ux = Math.cos(a), uy = Math.sin(a)
      drops.push({
        x: cxp + ux * rad,
        y: cyp + uy * rad,
        r: R * (0.15 - 0.1 * f) * params.fluid, // taper to a point at the tip
        ux, uy,
        el: 1 + (params.sharp - 1) * (0.4 + f), // sharper, more elongated near the tip
      })
    }
  }
}

// --- anisotropic metaball field + chrome shading -----------------------------
function smooth(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t) }

function renderFluid() {
  const sx = bw / fw, sy = bh / fh
  const soft = sx * sy
  vgrid.fill(0)
  const n = drops.length
  const dc = new Float32Array(n), dr = new Float32Array(n), dw = new Float32Array(n)
  const dux = new Float32Array(n), duy = new Float32Array(n), del = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    dc[k] = (drops[k].x - bx0) / sx
    dr[k] = (drops[k].y - by0) / sy
    dw[k] = drops[k].r * drops[k].r
    dux[k] = drops[k].ux; duy[k] = drops[k].uy; del[k] = drops[k].el
  }
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let v = 0
      for (let k = 0; k < n; k++) {
        const dx = (x - dc[k]) * sx
        const dy = (y - dr[k]) * sy
        // rotate into the lump's field-aligned frame and stretch along it
        const along = (dx * dux[k] + dy * duy[k]) / del[k]
        const perp = (-dx * duy[k] + dy * dux[k]) * del[k]
        v += dw[k] / (along * along + perp * perp + soft)
      }
      vgrid[y * fw + x] = v
    }
  }
  const data = img.data
  const thr = 0.9
  const e = 0.34
  const [rtc, gtc, btc] = hsl(params.hue / 360, 0.45, 0.85)
  const Lx = -0.45, Ly = -0.62, Lz = 0.64
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x
      const v = vgrid[i]
      const surf = smooth(thr - e, thr + e, v)
      let r, gg, b, a
      if (surf > 0.02) {
        const vl = x > 0 ? vgrid[i - 1] : v
        const vr = x < fw - 1 ? vgrid[i + 1] : v
        const vu = y > 0 ? vgrid[i - fw] : v
        const vd = y < fh - 1 ? vgrid[i + fw] : v
        let nx = (vl - vr) * 3.4, ny = (vu - vd) * 3.4, nz = 1
        const il = 1 / Math.sqrt(nx * nx + ny * ny + 1)
        nx *= il; ny *= il; nz *= il
        const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz)
        const hx = Lx, hy = Ly, hz = Lz + 1
        const ih = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz)
        const spec = Math.pow(Math.max(0, nx * hx * ih + ny * hy * ih + nz * hz * ih), 46)
        const up = Math.max(0, -ny)
        const rim = up * up * up * 0.6
        r = 4 + diff * 20 + rim * 90 * rtc + spec * 245
        gg = 5 + diff * 22 + rim * 96 * gtc + spec * 250
        b = 7 + diff * 26 + rim * 110 * btc + spec * 255
        a = surf * 255
      } else {
        // soft contact shadow just outside the fluid
        const sh = smooth(thr * 0.3, thr * 0.92, v)
        r = 5; gg = 6; b = 9
        a = sh * 64
      }
      data[i * 4] = r > 255 ? 255 : r
      data[i * 4 + 1] = gg > 255 ? 255 : gg
      data[i * 4 + 2] = b > 255 ? 255 : b
      data[i * 4 + 3] = a
    }
  }
  bctx.putImageData(img, 0, 0)
}

function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (Math.round(params.spikes) !== spikeCount) initSpikes()
  readAudio(t)

  const pulse = rt.beat.state.pulse
  const field = params.magnet * (0.35 + bass * params.drive * 1.5 + pulse * 0.4)
  buildDrops(t, field, dt)
  renderFluid()

  // solid white backdrop
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  // the fluid, crisp (no edge blur, no framing circle)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buf, bx0, by0, bw, bh)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
