// Frost Growth — dendritic ice creeping over a cold surface. Crystal tips
// nucleate along a chosen substrate (leaf veins, a rock edge, barbed wire, a
// chain-link fence, or a windowpane's corners) and grow outward as fern-like
// fronds: each tip advances, wanders a little, deposits ice, and occasionally
// forks. Ice accumulates on a persistent layer so the frost only ever spreads.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  surface: { value: 'Window glass', type: 'select', options: ['Leaf', 'Rock', 'Barbed wire', 'Chain link', 'Window glass'], label: 'Surface' },
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  branch: { value: 0.5, min: 0.05, max: 1, step: 0.02, label: 'Branchiness' },
  feather: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Feathering' },
  thaw: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Pointer thaw' },
  hue: { value: 200, min: 160, max: 260, step: 1, label: 'Ice hue' },
})
rt.mapInput('audio.level', 'growth', 0.4)

let W = 0, H = 0, PR = 1
const ice = document.createElement('canvas')
const ix = ice.getContext('2d')
const bg = document.createElement('canvas')
const bx = bg.getContext('2d')
let tips = []
let seeds = [] // { x, y } nucleation points along the surface
let lastSurface = ''

function drawSurfaceAndSeeds() {
  lastSurface = params.surface
  bg.width = W; bg.height = H
  ice.width = W; ice.height = H
  ix.clearRect(0, 0, W, H)
  bx.fillStyle = '#070a12'; bx.fillRect(0, 0, W, H)
  seeds = []
  const s = params.surface
  bx.strokeStyle = 'rgba(120,140,170,0.35)'
  bx.fillStyle = 'rgba(60,80,110,0.3)'
  bx.lineWidth = 2 * PR
  const addSeed = (x, y) => seeds.push({ x, y })
  if (s === 'Leaf') {
    // a leaf: midrib + lateral veins
    const cx = W / 2, top = H * 0.12, bot = H * 0.88
    bx.beginPath(); bx.moveTo(cx, bot); bx.lineTo(cx, top); bx.stroke()
    for (let k = 1; k <= 9; k++) {
      const y = bot - (bot - top) * (k / 10)
      for (const dir of [-1, 1]) {
        bx.beginPath(); bx.moveTo(cx, y)
        const ex = cx + dir * W * 0.22 * (1 - k / 12), ey = y - H * 0.06
        bx.quadraticCurveTo(cx + dir * W * 0.1, y - H * 0.01, ex, ey); bx.stroke()
        addSeed(cx + dir * W * 0.05, y - H * 0.008); addSeed(ex, ey)
      }
      addSeed(cx, y)
    }
  } else if (s === 'Rock') {
    for (let r = 0; r < 4; r++) {
      const rx = W * (0.15 + r * 0.22), ry = H * 0.7, rr = W * rt.random(0.1, 0.16)
      bx.beginPath(); bx.ellipse(rx, ry, rr, rr * 0.7, 0, Math.PI, Math.PI * 2); bx.fill()
      for (let a = Math.PI; a <= Math.PI * 2; a += 0.4) addSeed(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr * 0.7)
    }
  } else if (s === 'Barbed wire') {
    for (let row = 1; row <= 3; row++) {
      const y = (H * row) / 4
      bx.beginPath(); bx.moveTo(0, y); bx.lineTo(W, y); bx.stroke()
      for (let x = 0; x < W; x += 60 * PR) {
        bx.beginPath(); bx.moveTo(x - 8 * PR, y - 8 * PR); bx.lineTo(x + 8 * PR, y + 8 * PR); bx.moveTo(x + 8 * PR, y - 8 * PR); bx.lineTo(x - 8 * PR, y + 8 * PR); bx.stroke()
        addSeed(x, y); addSeed(x + 6 * PR, y - 6 * PR)
      }
      for (let x = 0; x < W; x += 20 * PR) addSeed(x, y)
    }
  } else if (s === 'Chain link') {
    const m = 46 * PR
    for (let y = 0; y < H + m; y += m) for (let x = 0; x < W + m; x += m) {
      bx.beginPath(); bx.moveTo(x, y); bx.lineTo(x + m / 2, y + m / 2); bx.moveTo(x + m / 2, y - m / 2); bx.lineTo(x + m, y + m / 2); bx.stroke()
      addSeed(x + m / 2, y)
    }
  } else {
    // window glass: frost nucleates from the corners and edges
    const N = 60
    for (let k = 0; k < N; k++) {
      const edge = k % 4
      const f = rt.rng()
      if (edge === 0) addSeed(f * W, 2); else if (edge === 1) addSeed(W - 2, f * H)
      else if (edge === 2) addSeed(f * W, H - 2); else addSeed(2, f * H)
    }
    addSeed(0, 0); addSeed(W, 0); addSeed(0, H); addSeed(W, H)
  }
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  drawSurfaceAndSeeds()
  tips = []
  spawnFromSeeds(seeds.length)
}
function spawnFromSeeds(count) {
  for (let i = 0; i < count && seeds.length; i++) {
    const s = seeds[(rt.rng() * seeds.length) | 0]
    tips.push({ x: s.x, y: s.y, a: rt.random(0, 6.28), life: rt.random(30, 90), w: rt.random(1, 2.2) })
  }
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })

function frame(now) {
  rt.tick(now)
  if (params.surface !== lastSurface) { drawSurfaceAndSeeds(); tips = []; spawnFromSeeds(seeds.length) }

  // thaw: clear a patch of ice near the pointer (it will re-freeze)
  if (performance.now() - ptr.t < 800 && params.thaw > 0.01) {
    ix.save(); ix.globalCompositeOperation = 'destination-out'
    const r = 60 * PR * params.thaw
    const g = ix.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, r)
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ix.fillStyle = g; ix.beginPath(); ix.arc(ptr.x, ptr.y, r, 0, 6.28); ix.fill(); ix.restore()
    // re-nucleate around the thawed edge
    spawnFromSeeds(2)
  }

  // grow tips onto the ice layer
  const steps = Math.max(1, Math.round(3 * params.growth))
  ix.lineCap = 'round'
  for (let s = 0; s < steps; s++) {
    for (let i = tips.length - 1; i >= 0; i--) {
      const tp = tips[i]
      const px = tp.x, py = tp.y
      tp.a += (rt.rng() - 0.5) * params.feather * 0.5
      const sp = 1.6 * PR
      tp.x += Math.cos(tp.a) * sp; tp.y += Math.sin(tp.a) * sp
      ix.strokeStyle = `hsla(${params.hue}, 60%, 85%, 0.5)`
      ix.lineWidth = tp.w * PR
      ix.beginPath(); ix.moveTo(px, py); ix.lineTo(tp.x, tp.y); ix.stroke()
      tp.life--
      tp.w *= 0.995
      // fork
      if (rt.rng() < params.branch * 0.08 && tips.length < 4000) {
        tips.push({ x: tp.x, y: tp.y, a: tp.a + (rt.rng() < 0.5 ? 1 : -1) * (0.4 + rt.rng() * 0.5), life: tp.life * 0.7, w: tp.w * 0.85 })
      }
      if (tp.life <= 0 || tp.x < 0 || tp.y < 0 || tp.x > W || tp.y > H) tips.splice(i, 1)
    }
  }
  // keep the frost slowly reaching new ground
  if (tips.length < 40 && seeds.length) spawnFromSeeds(6)

  // compose: surface, then ice, with a faint glow
  ctx.drawImage(bg, 0, 0)
  ctx.drawImage(ice, 0, 0)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
