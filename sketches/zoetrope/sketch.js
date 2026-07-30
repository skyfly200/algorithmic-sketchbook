// Zoetrope — the Victorian animation drum. A slotted cylinder spins on a wooden
// stand; the animation strip is painted around the inside wall, and through the
// slits you glimpse it a frame at a time, so persistence of vision fuses the
// stills into motion. The frame shown is locked to the drum's rotation (a slit
// = a frame): as it spins the figure animates; slow it and the sequence
// stutters. Pick a subject — the classic Muybridge gallop, a walk cycle, a
// flapping bird and more.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const SUBJECTS = ['Galloping horse', 'Walk cycle', 'Runner', 'Bird', 'Leaping fish', 'Bouncing ball', 'Blooming flower', 'Spinning star']
const params = rt.params({
  subject: { value: 'Galloping horse', type: 'select', options: SUBJECTS, label: 'Subject' },
  frames: { value: 12, min: 6, max: 24, step: 1, label: 'Frames' },
  spin: { value: 1, min: -3, max: 3, step: 0.05, label: 'Spin speed' },
  slit: { value: 0.35, min: 0.1, max: 0.7, step: 0.02, label: 'Slit width' },
  strobe: { value: true, type: 'bool', label: 'Strobe (lock to frame)' },
  strip: { value: true, type: 'bool', label: 'Show strip on back wall' },
  glow: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Lamp glow' },
  hue: { value: 30, min: 0, max: 360, step: 1, label: 'Drum hue' },
})
rt.mapInput('audio.pulse', 'spin', 0.6)

const INK = '#f4ecd8'
let W = 0, H = 0, PR = 1, cx = 0, cy = 0, Rd = 0
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  cx = W / 2; cy = H * 0.5; Rd = Math.min(W * 0.42, H * 0.34)
}

// ---- a reusable two-segment limb (hip → knee → foot) -----------------------
function limb(hx, hy, len, swing, bend) {
  const kx = hx + Math.sin(swing) * len * 0.5
  const ky = hy + Math.cos(swing) * len * 0.5
  const fx = kx + Math.sin(swing + bend) * len * 0.5
  const fy = ky + Math.cos(swing + bend) * len * 0.5
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke()
}

// Draw the subject at animation phase p∈[0,1) in a box of half-size s at (x,y).
function drawFigure(x, y, s, p, hue) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = Math.max(1.4, s * 0.055)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const a = p * Math.PI * 2
  const sub = params.subject

  if (sub === 'Galloping horse') {
    const bob = Math.sin(a * 2) * s * 0.06
    ctx.translate(0, bob)
    ctx.lineWidth = s * 0.09
    // legs (behind the body): a gallop gait — legs gather then extend
    const leg = (hx, ph) => limb(hx, s * 0.05, s * 0.46, Math.sin(a + ph) * 0.9, Math.sin(a + ph + 1.6) * 0.9 - 0.5)
    leg(-s * 0.26, 0); leg(-s * 0.18, 0.5) // hind
    leg(s * 0.24, Math.PI + 0.1); leg(s * 0.32, Math.PI + 0.6) // fore
    // body
    ctx.beginPath(); ctx.ellipse(0, -s * 0.06, s * 0.42, s * 0.2, 0, 0, 6.28); ctx.fill()
    // neck + head (facing +x)
    ctx.lineWidth = s * 0.17; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(s * 0.3, -s * 0.14); ctx.quadraticCurveTo(s * 0.54, -s * 0.34, s * 0.6, -s * 0.5); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(s * 0.63, -s * 0.53, s * 0.13, s * 0.08, -0.5, 0, 6.28); ctx.fill()
    // tail
    ctx.lineWidth = s * 0.1
    ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.12); ctx.quadraticCurveTo(-s * 0.62, -s * 0.02 + Math.sin(a) * s * 0.06, -s * 0.6, s * 0.22); ctx.stroke()
  } else if (sub === 'Walk cycle') {
    const bob = -Math.abs(Math.cos(a)) * s * 0.05
    ctx.translate(0, bob)
    ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.13, 0, 6.28); ctx.stroke() // head
    ctx.beginPath(); ctx.moveTo(0, -s * 0.37); ctx.lineTo(0, s * 0.08); ctx.stroke() // torso
    limb(0, s * 0.08, s * 0.42, Math.sin(a) * 0.7, Math.max(0, -Math.cos(a)) * 0.9 + 0.15) // legs
    limb(0, s * 0.08, s * 0.42, Math.sin(a + Math.PI) * 0.7, Math.max(0, Math.cos(a)) * 0.9 + 0.15)
    limb(0, -s * 0.28, s * 0.34, Math.PI + Math.sin(a + Math.PI) * 0.6, 0.4) // arms
    limb(0, -s * 0.28, s * 0.34, Math.PI + Math.sin(a) * 0.6, 0.4)
  } else if (sub === 'Runner') {
    ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.14, 0, 6.28); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, -s * 0.36); ctx.lineTo(0, s * 0.15); ctx.stroke()
    limb(0, s * 0.15, s * 0.44, Math.sin(a) * 1.0, Math.abs(Math.cos(a)) * 0.9 + 0.2)
    limb(0, s * 0.15, s * 0.44, Math.sin(a + Math.PI) * 1.0, Math.abs(Math.cos(a + Math.PI)) * 0.9 + 0.2)
    limb(0, -s * 0.2, s * 0.3, Math.PI * 0.5 + Math.sin(a + Math.PI) * 0.7, 0.5)
    limb(0, -s * 0.2, s * 0.3, -Math.PI * 0.5 + Math.sin(a) * 0.7, -0.5)
  } else if (sub === 'Bird') {
    const flap = Math.sin(a)
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.15, s * 0.09, 0, 0, 6.28); ctx.fill()
    ctx.lineWidth = s * 0.06
    for (const dir of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, -s * 0.02)
      ctx.quadraticCurveTo(dir * s * 0.3, -flap * s * 0.4, dir * s * 0.55, -flap * s * 0.12 + s * 0.04)
      ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(s * 0.14, -s * 0.02); ctx.lineTo(s * 0.24, 0); ctx.stroke() // beak
  } else if (sub === 'Leaping fish') {
    const arc = -Math.abs(Math.sin(p * Math.PI)) * s * 0.5 // jump arc
    ctx.translate(0, arc)
    const bend = Math.sin(a) * 0.5
    ctx.rotate(-bend * 0.4)
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.34, s * 0.16, 0, 0, 6.28); ctx.fill() // body
    const tf = Math.sin(a * 2) * s * 0.18
    ctx.beginPath(); ctx.moveTo(-s * 0.3, 0); ctx.lineTo(-s * 0.52, -s * 0.14 + tf); ctx.lineTo(-s * 0.52, s * 0.14 + tf); ctx.closePath(); ctx.fill() // tail
    ctx.beginPath(); ctx.moveTo(0, -s * 0.12); ctx.lineTo(s * 0.08, -s * 0.26); ctx.lineTo(s * 0.16, -s * 0.12); ctx.closePath(); ctx.fill() // fin
    ctx.fillStyle = '#0c0a08'; ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.03, s * 0.035, 0, 6.28); ctx.fill()
  } else if (sub === 'Bouncing ball') {
    const h = Math.abs(Math.sin(p * Math.PI))
    const by = s * 0.7 - h * s * 1.3
    const squash = 1 + (1 - h) * 0.4
    ctx.beginPath(); ctx.ellipse(0, by, s * 0.28 * squash, s * 0.28 / squash, 0, 0, 6.28); ctx.fill()
    ctx.strokeStyle = 'rgba(244,236,216,0.3)'; ctx.beginPath(); ctx.moveTo(-s * 0.4, s * 0.72); ctx.lineTo(s * 0.4, s * 0.72); ctx.stroke()
  } else if (sub === 'Blooming flower') {
    const open = 0.15 + 0.85 * Math.pow(Math.sin(p * Math.PI), 0.6)
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2
      ctx.fillStyle = `hsl(${(hue + k * 12) % 360}, 80%, 65%)`
      ctx.beginPath()
      ctx.ellipse(Math.cos(ang) * s * 0.3 * open, Math.sin(ang) * s * 0.3 * open, s * 0.22 * open, s * 0.1 * open, ang, 0, 6.28)
      ctx.fill()
    }
    ctx.fillStyle = '#f2c94c'; ctx.beginPath(); ctx.arc(0, 0, s * 0.12, 0, 6.28); ctx.fill()
  } else {
    // Spinning star: a five-point star that rotates and pulses over the cycle
    ctx.rotate(a)
    const pulse = 0.8 + 0.2 * Math.sin(a * 2)
    ctx.fillStyle = `hsl(${(hue + 40) % 360}, 85%, 68%)`
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2
      const rr = (i % 2 ? s * 0.24 : s * 0.55) * pulse
      const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    }
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()
}

let rot = 0, last = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const N = Math.round(params.frames)
  rot += params.spin * dt * 2.2
  const seg = (Math.PI * 2) / N
  const fIdx = params.strobe ? ((Math.floor(rot / seg) % N) + N) % N : (rot / seg) % N
  const p = (fIdx / N + 1) % 1
  const hue = params.hue

  // --- room: a warm spotlight vignette on near-black --------------------------
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const bg = ctx.createRadialGradient(cx, cy - Rd * 0.1, Rd * 0.2, cx, cy, Math.max(W, H) * 0.7)
  bg.addColorStop(0, `hsl(${hue}, 22%, 12%)`)
  bg.addColorStop(1, '#07060a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const topY = cy - Rd * 0.5
  const botY = cy + Rd * 0.5
  const rimRy = Rd * 0.3 // vertical squash of the drum ellipses

  // --- wooden stand: base disc, spindle, and the drum's reflection on it ------
  const baseY = botY + Rd * 0.62
  const bg2 = ctx.createLinearGradient(0, baseY - rimRy, 0, baseY + rimRy * 1.6)
  bg2.addColorStop(0, `hsl(${hue}, 38%, 26%)`)
  bg2.addColorStop(1, `hsl(${hue}, 40%, 12%)`)
  ctx.fillStyle = bg2
  ctx.beginPath(); ctx.ellipse(cx, baseY, Rd * 0.9, rimRy * 0.95, 0, 0, 6.28); ctx.fill()
  ctx.fillStyle = `hsl(${hue}, 42%, 30%)`
  ctx.beginPath(); ctx.ellipse(cx, baseY - rimRy * 0.55, Rd * 0.7, rimRy * 0.7, 0, 0, 6.28); ctx.fill()
  // spindle from base up into the drum
  const spg = ctx.createLinearGradient(cx - Rd * 0.05, 0, cx + Rd * 0.05, 0)
  spg.addColorStop(0, `hsl(${hue}, 40%, 18%)`); spg.addColorStop(0.5, `hsl(${hue}, 45%, 40%)`); spg.addColorStop(1, `hsl(${hue}, 40%, 18%)`)
  ctx.fillStyle = spg
  ctx.fillRect(cx - Rd * 0.045, botY, Rd * 0.09, baseY - botY - rimRy * 0.3)

  // faint reflection of the drum on the base
  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.translate(cx, botY + (botY - cy) * 0.05)
  ctx.scale(1, -0.5)
  ctx.translate(-cx, -botY)
  ctx.fillStyle = `hsl(${hue}, 45%, 40%)`
  ctx.beginPath(); ctx.ellipse(cx, cy, Rd, rimRy, 0, 0, 6.28); ctx.fill()
  ctx.restore()

  // the cylinder silhouette (left edge, front of the bottom rim, right edge,
  // back of the top rim) — used to clip both walls so nothing spills past it
  const drumPath = () => {
    ctx.beginPath()
    ctx.moveTo(cx - Rd, topY); ctx.lineTo(cx - Rd, botY)
    ctx.ellipse(cx, botY, Rd, rimRy, 0, Math.PI, 0, true)
    ctx.lineTo(cx + Rd, topY)
    ctx.ellipse(cx, topY, Rd, rimRy, 0, 0, Math.PI, true)
    ctx.closePath()
  }

  // --- drum back inner wall + the animation strip painted around it ----------
  ctx.save()
  drumPath()
  ctx.clip()
  const innerWall = ctx.createLinearGradient(0, topY, 0, botY)
  innerWall.addColorStop(0, `hsl(${hue}, 30%, 22%)`)
  innerWall.addColorStop(1, `hsl(${hue}, 32%, 10%)`)
  ctx.fillStyle = innerWall
  ctx.fillRect(cx - Rd, topY, Rd * 2, botY - topY)
  // the strip: each frame of the sequence sits at its slot around the far wall
  if (params.strip) {
    for (let i = 0; i < N; i++) {
      const th = i * seg + rot + Math.PI // far wall = opposite the viewer
      if (Math.cos(th) > -0.15) continue // only the back arc reads through
      const depth = (-Math.cos(th) - 0.15) / 1.15 // 0..1 how far back
      const sx = cx + Math.sin(th) * Rd * 0.92
      const sy = cy - rimRy * 0.15 - Rd * 0.02
      const sc = Rd * 0.3 * (0.6 + depth * 0.4)
      ctx.globalAlpha = 0.16 + depth * 0.24
      drawFigure(sx, sy, sc, (i / N + 1) % 1, hue)
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()

  // --- front slit wall: posts, with the synced frame glimpsed through each gap
  ctx.save()
  drumPath()
  ctx.clip() // keep the posts inside the drum silhouette
  const slitFrac = params.slit
  for (let i = 0; i < N; i++) {
    const th = i * seg + rot
    if (Math.cos(th) <= 0.08) continue // near (front) arc only
    const depth = (Math.cos(th) - 0.08) / 0.92 // 0 edge … 1 dead centre
    const x = cx + Math.sin(th) * Rd
    const scale = 0.62 + depth * 0.38
    const halfSlot = Rd * seg * scale * 0.5
    const top = cy - Rd * 0.5 * scale
    const bot = cy + Rd * 0.5 * scale
    // the figure seen through this slot (brightly lit)
    ctx.save()
    ctx.beginPath(); ctx.rect(x - halfSlot * slitFrac, top, halfSlot * 2 * slitFrac, bot - top); ctx.clip()
    if (params.glow > 0) {
      ctx.shadowColor = `hsla(${hue}, 80%, 72%, ${params.glow * 0.7})`
      ctx.shadowBlur = Rd * 0.03 * params.glow
    }
    drawFigure(x, (top + bot) / 2, Rd * 0.42 * scale, p, hue)
    ctx.restore()
    // the post between slits (near wall), shaded by depth
    const postW = halfSlot * (1 - slitFrac)
    const g = ctx.createLinearGradient(x - postW, 0, x + postW, 0)
    g.addColorStop(0, `hsl(${hue}, 45%, ${12 + depth * 8}%)`)
    g.addColorStop(0.5, `hsl(${hue}, 52%, ${26 + depth * 18}%)`)
    g.addColorStop(1, `hsl(${hue}, 45%, ${12 + depth * 8}%)`)
    ctx.fillStyle = g
    ctx.fillRect(x + halfSlot - postW, top, postW * 2, bot - top)
  }
  ctx.restore()

  // --- brass top & bottom rims -----------------------------------------------
  for (const [ry, y] of [[rimRy, topY], [rimRy, botY]]) {
    const rg = ctx.createLinearGradient(cx - Rd, 0, cx + Rd, 0)
    rg.addColorStop(0, `hsl(${hue}, 55%, 28%)`)
    rg.addColorStop(0.5, `hsl(${(hue + 8) % 360}, 70%, 62%)`)
    rg.addColorStop(1, `hsl(${hue}, 55%, 28%)`)
    ctx.strokeStyle = rg
    ctx.lineWidth = 5 * PR
    ctx.beginPath(); ctx.ellipse(cx, y, Rd, ry, 0, 0, 6.28); ctx.stroke()
  }
  // finial on top of the spindle
  ctx.fillStyle = `hsl(${(hue + 8) % 360}, 65%, 58%)`
  ctx.beginPath(); ctx.arc(cx, topY - rimRy * 0.2, Rd * 0.05, 0, 6.28); ctx.fill()

  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
