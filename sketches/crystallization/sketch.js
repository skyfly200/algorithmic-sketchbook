// Crystallization — supercooled liquid freezing into crystals: seeds nucleate
// and grow dendritic arms outward on a hex/quad lattice, branching like frost
// on a window, until the pane is glazed over — then it thaws and re-nucleates.
// Click drops a seed; beats trigger a flash-freeze burst.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  branch: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Branching' },
  symmetry: { value: 6, min: 3, max: 8, step: 1, label: 'Arm symmetry' },
  thickness: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Arm width' },
  hue: { value: 195, min: 0, max: 360, step: 1, label: 'Ice hue' },
  glow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Facet glow' },
  thaw: { value: true, type: 'bool', label: 'Thaw & refreeze' },
})
rt.mapInput('audio.pulse', 'growth', 0.8)

let W = 0, H = 0
let tips = []
let frozenArea = 0
let thawing = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  ctx.fillStyle = '#050810'; ctx.fillRect(0, 0, W, H)
  tips = []; frozenArea = 0; thawing = 0
  seed(rt.random(W * 0.3, W * 0.7), rt.random(H * 0.3, H * 0.7))
}
function seed(x, y) {
  const sym = Math.round(params.symmetry)
  const base = rt.random(0, Math.PI * 2)
  for (let i = 0; i < sym; i++) {
    const a = base + (i / sym) * Math.PI * 2
    tips.push({ x, y, a, len: 0, gen: 0, w: 1, life: rt.random(60, 160) })
  }
}
canvas.addEventListener('pointerdown', (e) => seed(e.clientX * rt.pixelRatio, e.clientY * rt.pixelRatio))
rt.onBeat(({ energy }) => { for (let i = 0; i < 1 + energy * 2; i++) seed(rt.random(0, W), rt.random(0, H)) })

let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t

  if (thawing > 0) {
    ctx.fillStyle = `rgba(5,8,16,${0.04})`
    ctx.fillRect(0, 0, W, H)
    thawing += dt
    if (thawing > 3) { resize() }
    requestAnimationFrame(frame); return
  }

  const px = rt.pixelRatio
  const speed = params.growth * 40 * px
  ctx.globalCompositeOperation = 'lighter'
  const maxTips = 1200
  for (let i = tips.length - 1; i >= 0; i--) {
    const tip = tips[i]
    const step = speed * dt
    const nx = tip.x + Math.cos(tip.a) * step
    const ny = tip.y + Math.sin(tip.a) * step
    const light = 45 + tip.gen * 6
    ctx.strokeStyle = `hsla(${params.hue}, 70%, ${light}%, ${0.5 + params.glow * 0.4})`
    ctx.lineWidth = Math.max(0.5, tip.w * params.thickness * px)
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(nx, ny); ctx.stroke()
    // facet sparkle
    if (rt.rng() < 0.05) { ctx.fillStyle = `hsla(${params.hue}, 40%, 90%, ${params.glow})`; ctx.fillRect(nx - px, ny - px, 2 * px, 2 * px) }
    tip.x = nx; tip.y = ny; tip.len += step; tip.life -= 1
    tip.w *= 0.996
    frozenArea += step
    // side branches at lattice angles
    if (rt.rng() < params.branch * 0.06 && tips.length < maxTips && tip.gen < 4) {
      const da = (Math.PI / 3) * (rt.rng() < 0.5 ? 1 : -1)
      tips.push({ x: nx, y: ny, a: tip.a + da, len: 0, gen: tip.gen + 1, w: tip.w * 0.7, life: tip.life * 0.6 })
    }
    if (tip.life <= 0 || tip.w < 0.3 || nx < 0 || nx > W || ny < 0 || ny > H) tips.splice(i, 1)
  }
  ctx.globalCompositeOperation = 'source-over'

  // keep the pane alive
  if (!tips.length && thawing === 0) {
    if (params.thaw && frozenArea > W * H * 0.5) thawing = 0.01
    else seed(rt.random(0, W), rt.random(0, H))
  }
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
