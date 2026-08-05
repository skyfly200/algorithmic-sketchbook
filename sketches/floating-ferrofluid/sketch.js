/**
 * Ferrofluid Speaker — floating black metaballs on a clean white field, driven
 * by sound. An electromagnet at the centre pulls the fluid into a clustered,
 * glossy central mass ringed by satellite droplets; on the bass the drops rush
 * inward and merge, then relax and scatter into beads between hits.
 *
 * The fluid is a metaball field so nearby drops fuse with smooth necks; it's
 * shaded like oily black chrome — a wet white specular, a cool sheen where the
 * lumps face the light, and a soft contact shadow seating it on the white.
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
  magnet: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Magnet pull' },
  drops: { value: 26, min: 8, max: 46, step: 1, label: 'Droplets' },
  blob: { value: 1.0, min: 0.5, max: 1.8, step: 0.05, label: 'Fluid amount' },
  spread: { value: 0.7, min: 0.2, max: 1.3, step: 0.05, label: 'Spread' },
  reach: { value: 0.8, min: 0, max: 1.8, step: 0.05, label: 'Reach / spikes' },
  viscosity: { value: 0.55, min: 0, max: 1, step: 0.02, label: 'Viscosity' },
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
let winX = 0, winY = 0, rx = 0, ry = 0 // backlit window ellipse
let bx0 = 0, by0 = 0, bw = 0, bh = 0 // field buffer footprint (window bbox)
let fw = 0, fh = 0 // field buffer resolution
let vgrid = null, img = null
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  rx = Math.min(W * 0.3, H * 0.34)
  ry = rx * 0.92
  winX = W * 0.47
  winY = H * 0.52
  // field buffer covers the window's bounding box, with a little margin
  bx0 = winX - rx * 1.05
  by0 = winY - ry * 1.05
  bw = rx * 2.1
  bh = ry * 2.1
  // higher-res field so the metaball edge stays crisp without a blur pass
  const scale = Math.max(1.9, 2.5 / rt.detail)
  fw = Math.max(100, Math.round(bw / scale))
  fh = Math.max(100, Math.round(bh / scale))
  buf.width = fw
  buf.height = fh
  vgrid = new Float32Array(fw * fh)
  img = bctx.createImageData(fw, fh)
  initDrops()
}

// --- droplets ----------------------------------------------------------------
// Beads of varied size scattered across the whole dish — no fixed central mass.
// Every bead feels the field; the electromagnet's grip is strongest at the
// centre and fades outward. Positions live in screen pixels, on the window disc.
let drops = []
let dropCount = -1
function initDrops() {
  dropCount = Math.round(params.drops)
  drops = []
  for (let i = 0; i < dropCount; i++) {
    const ang = rt.random(0, 6.28)
    // sqrt for an even spread over the disc's area, not clumped at the middle
    const rr = Math.sqrt(rt.random(0.03, 0.9))
    drops.push({
      x: winX + Math.cos(ang) * rr * rx,
      y: winY + Math.sin(ang) * rr * ry,
      vx: 0, vy: 0,
      r: rt.random(0.05, 0.14) * rx,
      mass: rt.random(0.6, 1.6),
      homeR: rr, // resting radius on the dish
      homeA: ang,
      drift: rt.random(-0.25, 0.25), // slow orbit of the rest angle
      wph: rt.random(0, 6.28),
      wsp: rt.random(0.5, 1.4),
      arm: rt.random(0.5, 1), // how hard the hit erupts this one
      split: rt.random(0, 6.28), // per-drop eruption swirl phase
    })
  }
}

function updateDrops(t, dt, field) {
  const mag = params.magnet * (0.35 + field * 2.0) // inward pull, surges on bass
  const reach = params.reach * Math.max(0, field - 0.25) * 2.6 // eruption on hits
  const maxR = 0.98
  for (const d of drops) {
    // the field's grip is strongest at the magnet and fades toward the rim
    const prox = 1 - Math.min(1, d.homeR)
    const grip = 0.35 + prox * 0.85
    // rest position: home on the dish, slowly orbiting; the field draws it inward
    const a = d.homeA + d.drift * t * 0.5 + Math.sin(t * d.wsp * 0.4 + d.wph) * 0.25 * params.spread
    const hr = d.homeR * (1 - field * 0.5 * grip)
    const hx = winX + Math.cos(a) * hr * rx
    const hy = winY + Math.sin(a) * hr * ry
    d.vx += (hx - d.x) * 5.5 / d.mass * dt
    d.vy += (hy - d.y) * 5.5 / d.mass * dt
    // inward magnet pull on the bass — EVERY drop reacts, central ones the most
    let dx = winX - d.x, dy = winY - d.y
    const dist = Math.hypot(dx, dy) || 1e-3
    dx /= dist; dy /= dist
    d.vx += dx * mag * grip / d.mass * dt * 30
    d.vy += dy * mag * grip / d.mass * dt * 30
    // on the hit the surface goes unstable and every drop erupts outward along
    // its own swirled axis (splitting off the cluster) before springing home
    if (reach > 0) {
      const push = reach * d.arm * grip / d.mass
      const ea = Math.atan2(-dy, -dx) + Math.sin(t * 3 + d.split) * 0.6
      d.vx += Math.cos(ea) * push * dt * 42
      d.vy += Math.sin(ea) * push * dt * 42
    }
    // jitter
    d.vx += Math.cos(t * d.wsp * 2.1 + d.wph) * params.spread * 3 * dt
    d.vy += Math.sin(t * d.wsp * 2.4 + d.wph) * params.spread * 3 * dt
    // damping rises with distance from the centre — outer drops settle quickly
    // while the ones near the magnet stay lively
    const distProx = Math.min(1, Math.hypot(d.x - winX, d.y - winY) / rx)
    const visc = params.viscosity * (1 - Math.min(0.7, distProx * 0.6))
    const damp = Math.pow(0.02 + visc * 0.78, dt * 6)
    d.vx *= damp
    d.vy *= damp
    d.x += d.vx * dt * 60
    d.y += d.vy * dt * 60
  }
  // soft mutual repulsion so lumps keep their identity instead of collapsing
  for (let i = 0; i < drops.length; i++) {
    const a = drops[i]
    for (let j = i + 1; j < drops.length; j++) {
      const b = drops[j]
      let dx = b.x - a.x, dy = b.y - a.y
      let dd = Math.hypot(dx, dy)
      const min = (a.r + b.r) * 0.72
      if (dd < min && dd > 1e-3) {
        const f = ((min - dd) / min) * 0.5
        dx /= dd; dy /= dd
        a.x -= dx * f * min * 0.5; a.y -= dy * f * min * 0.5
        b.x += dx * f * min * 0.5; b.y += dy * f * min * 0.5
      }
    }
  }
  // keep every drop inside the disc (project back onto the rim)
  for (const d of drops) {
    const nx = (d.x - winX) / rx, ny = (d.y - winY) / ry
    const rr = Math.hypot(nx, ny)
    if (rr > maxR) {
      d.x = winX + (nx / rr) * maxR * rx
      d.y = winY + (ny / rr) * maxR * ry
      d.vx *= 0.4; d.vy *= 0.4
    }
  }
}

// --- metaball field + chrome shading ----------------------------------------
function smooth(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t) }

function renderFluid() {
  const sx = bw / fw, sy = bh / fh
  const soft = sx * sy // 1/d^2 epsilon
  vgrid.fill(0)
  // Full metaball sum (every drop over every cell) — no per-drop bounding box,
  // so there are no stamp-edge discontinuities to streak the shaded normals.
  const n = drops.length
  const dc = new Float32Array(n), dr = new Float32Array(n), dw = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    dc[k] = (drops[k].x - bx0) / sx
    dr[k] = (drops[k].y - by0) / sy
    dw[k] = drops[k].r * drops[k].r * params.blob * params.blob
  }
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let v = 0
      for (let k = 0; k < n; k++) {
        const dx = (x - dc[k]) * sx
        const dy = (y - dr[k]) * sy
        v += dw[k] / (dx * dx + dy * dy + soft)
      }
      vgrid[y * fw + x] = v
    }
  }
  const data = img.data
  const thr = 0.9
  const e = 0.42
  // cool sheen tint for the reflected window highlight (0..1)
  const [rtc, gtc, btc] = hsl(params.hue / 360, 0.45, 0.85)
  const Lx = -0.45, Ly = -0.62, Lz = 0.64
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x
      const v = vgrid[i]
      const surf = smooth(thr - e, thr + e, v)
      let r, gg, b, a
      if (surf > 0.02) {
        // normal from the field gradient (points "downhill" out of the lump)
        const vl = x > 0 ? vgrid[i - 1] : v
        const vr = x < fw - 1 ? vgrid[i + 1] : v
        const vu = y > 0 ? vgrid[i - fw] : v
        const vd = y < fh - 1 ? vgrid[i + fw] : v
        let nx = (vl - vr) * 3.2, ny = (vu - vd) * 3.2, nz = 1
        const il = 1 / Math.sqrt(nx * nx + ny * ny + 1)
        nx *= il; ny *= il; nz *= il
        const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz)
        // half-vector spec toward the viewer for a tight wet glint
        const hx = Lx, hy = Ly, hz = Lz + 1
        const ih = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz)
        const spec = Math.pow(Math.max(0, nx * hx * ih + ny * hy * ih + nz * hz * ih), 40)
        // flanks facing up mirror a thin bright reflection of the lit window
        const up = Math.max(0, -ny)
        const rim = up * up * up * 0.6
        // oily black chrome: near-black body, neutral grey diffuse, cool rim, white glint
        r = 4 + diff * 20 + rim * 90 * rtc + spec * 240
        gg = 5 + diff * 22 + rim * 96 * gtc + spec * 246
        b = 7 + diff * 26 + rim * 110 * btc + spec * 255
        a = surf * 255
      } else {
        // soft contact shadow just outside the fluid, on the bright glass
        const sh = smooth(thr * 0.3, thr * 0.92, v)
        r = 5; gg = 6; b = 9
        a = sh * 70
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

// --- the enclosure -----------------------------------------------------------
function drawBackground() {
  // solid white backdrop — the ferrofluid sits on a clean white field
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
}

function drawFluid() {
  // crisp — no framing circle, no edge blur; the metaball threshold gives a
  // clean silhouette and the upscale's bilinear smoothing is enough
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buf, bx0, by0, bw, bh)
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  if (Math.round(params.drops) !== dropCount) initDrops()
  readAudio(t)

  const pulse = rt.beat.state.pulse
  const field = bass * params.drive * 1.3 + pulse * 0.4
  updateDrops(t, dt, field)
  renderFluid()

  drawBackground()
  drawFluid()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
