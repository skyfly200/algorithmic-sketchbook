// Bones: a slow drift of tumbling femurs and ribs through a cold, foggy dark.
// Sprites are baked once; the frame loop only transforms and blits them.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  count: { value: 60, min: 8, max: 400, step: 1, label: 'Bones', scale: 'log' },
  speed: { value: 0.12, min: 0.005, max: 2, step: 0.005, label: 'Fall speed', scale: 'log' },
  tumble: { value: 0.5, min: 0.02, max: 6, step: 0.01, label: 'Tumble', scale: 'log' },
  size: { value: 0.1, min: 0.02, max: 0.5, step: 0.005, label: 'Bone size', scale: 'log' },
  glow: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Ghost glow' },
  fog: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Fog' },
  rattle: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Beat rattle' },
})
rt.mapInput('beat.pulse', 'glow', 0.3)

const MAX = 400
const SPR_W = 256
const SPR_H = 96

function bakeBone(kind) {
  const c = document.createElement('canvas')
  c.width = SPR_W
  c.height = SPR_H
  const g = c.getContext('2d')
  const cy = SPR_H / 2
  const grad = g.createLinearGradient(0, 0, 0, SPR_H)
  grad.addColorStop(0, '#f4efe0')
  grad.addColorStop(0.55, '#d6cdb4')
  grad.addColorStop(1, '#9a917a')
  g.fillStyle = grad
  g.strokeStyle = 'rgba(40,34,24,0.7)'
  g.lineWidth = 2
  g.beginPath()
  if (kind === 0) {
    // femur: shaft with a double knob at each end
    g.rect(40, cy - 9, SPR_W - 80, 18)
    for (const x of [34, SPR_W - 34]) {
      g.moveTo(x + 18, cy - 20)
      g.arc(x, cy - 20, 18, 0, Math.PI * 2)
      g.moveTo(x + 18, cy + 20)
      g.arc(x, cy + 20, 18, 0, Math.PI * 2)
    }
  } else {
    // rib: a curved sliver
    g.moveTo(24, cy + 30)
    g.quadraticCurveTo(SPR_W / 2, cy - 70, SPR_W - 24, cy + 30)
    g.quadraticCurveTo(SPR_W / 2, cy - 44, 24, cy + 30)
  }
  g.fill()
  g.stroke()
  // speckle so the bone isn't flat plastic
  g.fillStyle = 'rgba(60,50,30,0.25)'
  for (let i = 0; i < 40; i++) g.fillRect(30 + Math.random() * (SPR_W - 60), 20 + Math.random() * (SPR_H - 40), 2, 2)
  return c
}
const sprites = [bakeBone(0), bakeBone(1)]

let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const bones = Array.from({ length: MAX }, () => ({
  x: rand(), y: rand(), z: 0.3 + rand() * 0.7,
  a: rand() * 6.283, spin: (rand() - 0.5) * 2, sway: rand() * 6.283,
  kind: rand() < 0.65 ? 0 : 1,
}))

let W = 1
let H = 1
let fogGrad = null
function resize() {
  W = canvas.width = window.innerWidth * rt.pixelRatio
  H = canvas.height = window.innerHeight * rt.pixelRatio
  fogGrad = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.7)
  fogGrad.addColorStop(0, 'rgba(120,150,170,0.35)')
  fogGrad.addColorStop(1, 'rgba(10,14,20,0)')
}

function frame(now) {
  rt.tick(now)
  const fall = rt.phase('fall', params.speed)
  const turn = rt.phase('turn', params.tumble)
  const pulse = rt.beat.state.pulse

  ctx.globalAlpha = 1
  ctx.fillStyle = '#04070b'
  ctx.fillRect(0, 0, W, H)
  if (params.fog > 0) {
    ctx.globalAlpha = params.fog
    ctx.fillStyle = fogGrad
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
  }

  const n = Math.min(MAX, Math.round(params.count * Math.max(0.3, rt.detail)))
  const base = Math.min(W, H) * params.size
  // far bones first
  for (let i = 0; i < n; i++) {
    const b = bones[i]
    const d = b.z
    const margin = 0.2
    const y = ((b.y + fall * d) % 1 + 1) % 1
    const px = (b.x + Math.sin(turn * 0.3 + b.sway) * 0.03 * d) * W
    const py = (y * (1 + margin * 2) - margin) * H
    const rattle = pulse * params.rattle
    const ang = b.a + turn * b.spin * d + Math.sin(now * 0.04 + i) * 0.15 * rattle
    const s = (base * d) / SPR_W * (1 + 0.12 * rattle)
    const lit = 0.25 + 0.75 * d
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(ang)
    ctx.scale(s, s)
    ctx.globalAlpha = lit
    if (params.glow > 0) {
      ctx.shadowColor = 'rgba(150,230,210,0.9)'
      ctx.shadowBlur = 30 * params.glow * rt.pixelRatio / Math.max(s, 0.05) * s
    }
    ctx.drawImage(sprites[b.kind], -SPR_W / 2, -SPR_H / 2)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
