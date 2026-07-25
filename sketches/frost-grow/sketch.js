// Frost Growth — dendritic ice creeping over a cold surface, on the hexagonal
// lattice of real ice. Crystal tips nucleate along a chosen substrate (leaf
// veins, a rock edge, barbed wire, a chain-link fence, or a windowpane's
// corners), each carrying a crystal orientation, and grow as straight faceted
// spines that throw side-branches at fixed 60° angles — the regular comb of a
// frost fern — with occasional angular kinks and tip-splits. No random-walk
// wander, so it reads as crystal rather than string. Ice accumulates on a
// persistent layer, so the frost only ever spreads.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  surface: { value: 'Window glass', type: 'select', options: ['Leaf', 'Rock', 'Barbed wire', 'Chain link', 'Window glass'], label: 'Surface' },
  growth: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Growth speed' },
  branch: { value: 0.55, min: 0.05, max: 1, step: 0.02, label: 'Branch density' },
  feather: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Fern detail' },
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
const HEX = Math.PI / 3 // 60° — the ice lattice step
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// Snap a heading to the nearest lattice direction of a given crystal orientation,
// so spines stay straight and branches stay parallel (crystalline, not stringy).
function snap(a, orient) {
  return orient + Math.round((a - orient) / HEX) * HEX
}
function branchGap() { return (7 + (1 - clamp01(params.branch)) * 30) * PR }
function spawnFromSeeds(count) {
  for (let i = 0; i < count && seeds.length; i++) {
    const s = seeds[(rt.rng() * seeds.length) | 0]
    const orient = rt.random(0, HEX) // this frond's crystal domain orientation
    const a = orient + ((rt.rng() * 6) | 0) * HEX // start along a lattice axis
    tips.push({ x: s.x, y: s.y, a, orient, life: rt.random(50, 130), w: rt.random(1.4, 2.4), gen: 0, sinceBranch: rt.random(0, 8) * PR, gap: branchGap() })
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

  // grow tips onto the ice layer, on the hex lattice
  const steps = Math.max(1, Math.round(3 * params.growth))
  const maxGen = 2 + Math.round(params.feather * 3) // fern detail = branch depth
  const kinkP = params.feather * 0.02 // rare 60° facet kink along a spine
  ix.lineCap = 'round'
  for (let s = 0; s < steps; s++) {
    for (let i = tips.length - 1; i >= 0; i--) {
      const tp = tips[i]
      const px = tp.x, py = tp.y
      // heading is locked to the lattice; occasionally kink to an adjacent axis
      if (rt.rng() < kinkP) tp.a = snap(tp.a + (rt.rng() < 0.5 ? HEX : -HEX), tp.orient)
      const sp = 1.6 * PR
      tp.x += Math.cos(tp.a) * sp; tp.y += Math.sin(tp.a) * sp
      // crystalline deposit: a soft halo under a crisp bright core
      ix.strokeStyle = `hsla(${params.hue}, 55%, 80%, 0.13)`
      ix.lineWidth = (tp.w + 1.6) * PR
      ix.beginPath(); ix.moveTo(px, py); ix.lineTo(tp.x, tp.y); ix.stroke()
      ix.strokeStyle = `hsla(${params.hue}, 42%, 92%, 0.62)`
      ix.lineWidth = tp.w * PR
      ix.beginPath(); ix.moveTo(px, py); ix.lineTo(tp.x, tp.y); ix.stroke()
      tp.life--
      tp.w *= 0.997
      tp.sinceBranch += sp
      // regular ±60° side-branches at even spacing — the fern comb
      if (tp.sinceBranch >= tp.gap && tp.gen < maxGen && tips.length < 6000) {
        tp.sinceBranch = 0
        const g2 = tp.gap * 0.8
        for (const side of [1, -1]) {
          tips.push({ x: tp.x, y: tp.y, a: snap(tp.a + side * HEX, tp.orient), orient: tp.orient, life: tp.life * 0.5 + 8, w: Math.max(0.6, tp.w * 0.72), gen: tp.gen + 1, sinceBranch: rt.random(0, g2 * 0.4), gap: g2 })
        }
        // a tiny bright facet node where the branch springs
        ix.fillStyle = `hsla(${params.hue}, 38%, 96%, 0.5)`
        ix.beginPath(); ix.arc(tp.x, tp.y, tp.w * 0.9 * PR, 0, 6.28); ix.fill()
      }
      // rare dendrite tip-split into a 60° Y
      if (rt.rng() < 0.004 && tp.gen < maxGen && tips.length < 6000) {
        tips.push({ x: tp.x, y: tp.y, a: snap(tp.a - HEX, tp.orient), orient: tp.orient, life: tp.life, w: tp.w, gen: tp.gen, sinceBranch: tp.sinceBranch, gap: tp.gap })
        tp.a = snap(tp.a + HEX, tp.orient)
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
