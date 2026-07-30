/**
 * Ferrofluid Speaker — the desktop gadget with a grey enclosure and a bright,
 * backlit circular window. Black ferrofluid sits on the lit glass and an
 * electromagnet behind the centre pulls it into a clustered, glossy central
 * mass ringed by satellite droplets. The music drives the field: on the bass
 * the drops rush inward and the mass throws out reaching arms and spikes, then
 * relaxes and spreads into scattered beads between hits.
 *
 * The fluid is a metaball field so nearby drops merge with smooth necks; it's
 * shaded like oily black chrome — a wet white specular, a cool sheen where the
 * lumps face the light, and a soft contact shadow seating it on the glass.
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
  const scale = Math.max(2.4, 3.0 / rt.detail)
  fw = Math.max(80, Math.round(bw / scale))
  fh = Math.max(80, Math.round(bh / scale))
  buf.width = fw
  buf.height = fh
  vgrid = new Float32Array(fw * fh)
  img = bctx.createImageData(fw, fh)
  initDrops()
}

// --- droplets ----------------------------------------------------------------
// A mix of a few heavy lumps (the central mass) and many light beads (satellites
// and spray). Positions live in screen pixels, constrained to the window disc.
let drops = []
let dropCount = -1
function initDrops() {
  dropCount = Math.round(params.drops)
  drops = []
  for (let i = 0; i < dropCount; i++) {
    const heavy = i < Math.max(3, dropCount * 0.28)
    const ang = rt.random(0, 6.28)
    // heavy lumps rest near the magnet; light beads park scattered out on the dish
    const rr = heavy ? rt.random(0, 0.22) : rt.random(0.32, 0.94)
    drops.push({
      x: winX + Math.cos(ang) * rr * rx,
      y: winY + Math.sin(ang) * rr * ry,
      vx: 0, vy: 0,
      r: (heavy ? rt.random(0.12, 0.19) : rt.random(0.03, 0.07)) * rx,
      heavy,
      mass: heavy ? rt.random(1.5, 2.4) : rt.random(0.4, 0.8),
      homeR: rr, // resting radius on the dish
      homeA: ang,
      drift: rt.random(-0.25, 0.25), // slow orbit of the rest angle
      wph: rt.random(0, 6.28),
      wsp: rt.random(0.5, 1.4),
      arm: rt.random(0, 1), // how strongly the bass flings this one outward
    })
  }
}

function updateDrops(t, dt, field) {
  const damp = Math.pow(0.02 + params.viscosity * 0.78, dt * 6) // heavier = slower
  const mag = params.magnet * (0.35 + field * 2.0) // extra inward pull, surges on bass
  const reach = params.reach * Math.max(0, field - 0.3) * 2.4 // outward on hits
  const maxR = 0.98
  for (const d of drops) {
    // rest position: the drop's home on the dish, slowly orbiting
    const a = d.homeA + d.drift * t * 0.5 + Math.sin(t * d.wsp * 0.4 + d.wph) * 0.25 * params.spread
    const hr = d.homeR * (1 - field * 0.55) // the field draws every home inward
    const hx = winX + Math.cos(a) * hr * rx
    const hy = winY + Math.sin(a) * hr * ry
    d.vx += (hx - d.x) * 5.5 / d.mass * dt
    d.vy += (hy - d.y) * 5.5 / d.mass * dt
    // extra pull straight to the magnet on the bass
    let dx = winX - d.x, dy = winY - d.y
    const dist = Math.hypot(dx, dy) || 1e-3
    dx /= dist; dy /= dist
    d.vx += dx * mag / d.mass * dt * 30
    d.vy += dy * mag / d.mass * dt * 30
    // bass flings the lighter beads outward into reaching arms / spikes
    if (reach > 0) {
      const push = reach * d.arm * (d.heavy ? 0.3 : 1) / d.mass
      d.vx -= dx * push * dt * 40
      d.vy -= dy * push * dt * 40
    }
    // jitter
    d.vx += Math.cos(t * d.wsp * 2.1 + d.wph) * params.spread * 3 * dt
    d.vy += Math.sin(t * d.wsp * 2.4 + d.wph) * params.spread * 3 * dt
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
function drawEnclosure() {
  // dark surround behind the box
  ctx.fillStyle = '#141518'
  ctx.fillRect(0, 0, W, H)
  const topH = H * 0.1
  const sideW = W * 0.09
  const faceR = W - sideW
  // top face (lighter, receding to the right)
  ctx.fillStyle = '#c7cace'
  ctx.beginPath()
  ctx.moveTo(0, topH)
  ctx.lineTo(faceR, topH)
  ctx.lineTo(W, 0)
  ctx.lineTo(sideW * 0.9, 0)
  ctx.closePath()
  ctx.fill()
  // fine grille lines on the top face
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, topH); ctx.lineTo(faceR, topH); ctx.lineTo(W, 0); ctx.lineTo(sideW * 0.9, 0); ctx.closePath()
  ctx.clip()
  ctx.strokeStyle = 'rgba(120,125,132,0.45)'
  for (let i = 1; i < 10; i++) {
    const yy = (i / 10) * topH
    ctx.beginPath(); ctx.moveTo(-20, yy + 6); ctx.lineTo(W, yy - topH * 0.9 + 6); ctx.stroke()
  }
  ctx.restore()
  // right side face (darker)
  ctx.fillStyle = '#8b8e93'
  ctx.beginPath()
  ctx.moveTo(faceR, topH)
  ctx.lineTo(W, 0)
  ctx.lineTo(W, H)
  ctx.lineTo(faceR, H)
  ctx.closePath()
  ctx.fill()
  // front face (cool neutral grey, softly lit from the top)
  const fg = ctx.createLinearGradient(0, topH, 0, H)
  fg.addColorStop(0, '#bcbfc4')
  fg.addColorStop(0.55, '#adb0b5')
  fg.addColorStop(1, '#9fa2a7')
  ctx.fillStyle = fg
  ctx.fillRect(0, topH, faceR, H - topH)
  // subtle vignette on the front face
  const vg = ctx.createRadialGradient(winX, winY, rx * 0.6, winX, winY, Math.max(W, H) * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.16)')
  ctx.fillStyle = vg
  ctx.fillRect(0, topH, faceR, H - topH)
  // two little knobs lower-left
  for (let i = 0; i < 2; i++) {
    const kx = sideW * 0.55, ky = H * 0.74 + i * H * 0.1
    const kr = W * 0.02
    const kg = ctx.createRadialGradient(kx - kr * 0.3, ky - kr * 0.3, kr * 0.1, kx, ky, kr)
    kg.addColorStop(0, '#eef0f2')
    kg.addColorStop(1, '#c2c5c9')
    ctx.fillStyle = kg
    ctx.beginPath(); ctx.ellipse(kx, ky, kr, kr * 1.1, 0, 0, 6.28); ctx.fill()
  }
}

function drawWindow() {
  // recessed shadow ring around the window
  ctx.save()
  ctx.beginPath(); ctx.ellipse(winX, winY, rx * 1.06, ry * 1.06, 0, 0, 6.28)
  ctx.fillStyle = 'rgba(20,22,26,0.55)'
  ctx.fill()
  ctx.restore()
  // the bright backlit dish
  ctx.save()
  ctx.beginPath(); ctx.ellipse(winX, winY, rx, ry, 0, 0, 6.28); ctx.clip()
  const dg = ctx.createRadialGradient(winX - rx * 0.12, winY - ry * 0.12, 0, winX, winY, rx * 1.05)
  dg.addColorStop(0, '#ffffff')
  dg.addColorStop(0.68, '#f2f5f8')
  dg.addColorStop(0.9, '#dfe6ec')
  dg.addColorStop(1, '#cdd6de')
  ctx.fillStyle = dg
  ctx.fillRect(winX - rx, winY - ry, rx * 2, ry * 2)
  // inner shadow at the rim for a lensed, recessed feel
  const ig = ctx.createRadialGradient(winX, winY, rx * 0.82, winX, winY, rx)
  ig.addColorStop(0, 'rgba(0,0,0,0)')
  ig.addColorStop(1, 'rgba(120,140,160,0.35)')
  ctx.fillStyle = ig
  ctx.fillRect(winX - rx, winY - ry, rx * 2, ry * 2)
  ctx.restore()
}

function drawFluid() {
  ctx.save()
  ctx.beginPath(); ctx.ellipse(winX, winY, rx * 0.995, ry * 0.995, 0, 0, 6.28); ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // a whisper of blur dissolves residual grid stepping from the low-res field
  ctx.filter = `blur(${0.7 * PR}px)`
  ctx.drawImage(buf, bx0, by0, bw, bh)
  ctx.filter = 'none'
  ctx.restore()
}

function drawRim() {
  // bright glass rim highlight over everything
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 2.4 * PR
  ctx.beginPath(); ctx.ellipse(winX, winY, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke()
  ctx.strokeStyle = 'rgba(60,70,82,0.5)'
  ctx.lineWidth = 1.6 * PR
  ctx.beginPath(); ctx.ellipse(winX, winY, rx, ry, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke()
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

  drawEnclosure()
  drawWindow()
  drawFluid()
  drawRim()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
