// Glowing Coals — a bed of embers seen from above. Rounded coal chunks pack the
// frame edge-to-edge, each one incandescent from within: a hot core fading to an
// ashen crust rim, with molten light bleeding up through the thin cracks between
// them. A few slow "hot spots" of pooled heat drift across the bed. Each coal
// breathes on its own phase plus a shared airflow; fan a patch hotter with the
// pointer; beats gust the whole bed and lift sparks.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  heat: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Heat' },
  airflow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Airflow' },
  crust: { value: 0.7, min: 0.2, max: 1, step: 0.02, label: 'Crust darkness' },
  cracks: { value: 0.4, min: 0.05, max: 0.8, step: 0.02, label: 'Crack width' },
  coalSize: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Coal size' },
  hue: { value: 22, min: 0, max: 45, step: 1, label: 'Ember hue' },
  sparks: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Sparks' },
})
rt.mapInput('audio.level', 'airflow', 0.5)
rt.mapInput('audio.pulse', 'heat', 0.25)

let W = 0, H = 0, PR = 1
let coals = []
let hotspots = []

// Trace a closed, rounded blob through the coal's vertices: draw quadratic
// curves through the midpoints of each edge, using the vertices as control
// points. This smooths a jagged polygon into an organic rounded pebble.
function traceBlob(c, verts, scale) {
  const n = verts.length
  const mx = (i) => (verts[i][0] + verts[(i + 1) % n][0]) * 0.5 * scale
  const my = (i) => (verts[i][1] + verts[(i + 1) % n][1]) * 0.5 * scale
  c.moveTo(mx(n - 1), my(n - 1))
  for (let i = 0; i < n; i++) c.quadraticCurveTo(verts[i][0] * scale, verts[i][1] * scale, mx(i), my(i))
  c.closePath()
}

function buildCoals() {
  coals = []
  // pack tighter than the coal radius so blobs overlap and leave only thin cracks
  const step = 46 * PR * params.coalSize
  const jit = step * 0.34
  for (let y = -step; y < H + step; y += step) {
    for (let x = -step; x < W + step; x += step) {
      const cx = x + rt.random(-jit, jit)
      const cy = y + rt.random(-jit, jit)
      const nv = 9 + Math.floor(rt.random(0, 4))
      const rBase = step * 0.62 * rt.random(0.85, 1.14)
      const verts = []
      for (let k = 0; k < nv; k++) {
        const a = (k / nv) * Math.PI * 2 + rt.random(-0.12, 0.12)
        const rr = rBase * rt.random(0.68, 1.08)
        verts.push([Math.cos(a) * rr, Math.sin(a) * rr])
      }
      // baked ash flecks, in local coords, for a crusty ashen surface texture
      const flecks = []
      for (let k = 0; k < 6; k++) flecks.push([rt.random(-rBase * 0.6, rBase * 0.6), rt.random(-rBase * 0.6, rBase * 0.6), rt.random(1.2, 3) * PR])
      coals.push({
        x: cx, y: cy, verts, flecks, r: rBase,
        ox: rt.random(-0.28, 0.28) * rBase, oy: rt.random(-0.28, 0.28) * rBase,
        base: rt.random(0.35, 1), phase: rt.random(0, 6.28), rate: rt.random(0.3, 1.1),
      })
    }
  }
}

function buildHotspots() {
  hotspots = []
  const n = 3 + Math.floor(rt.random(0, 3))
  const m = Math.min(W, H)
  for (let i = 0; i < n; i++) hotspots.push({
    x: rt.random(W * 0.2, W * 0.8), y: rt.random(H * 0.2, H * 0.8),
    vx: rt.random(-7, 7) * PR, vy: rt.random(-7, 7) * PR,
    r: rt.random(0.2, 0.36) * m, phase: rt.random(0, 6.28), pulse: 1,
  })
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  buildCoals()
  buildHotspots()
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })

const sparks = []
let gust = 0
rt.onBeat(({ energy }) => { gust = 0.5 + energy * 0.6 })

let lastSize = 1
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  gust = Math.max(0, gust - dt * 1.2)
  if (params.coalSize !== lastSize) { lastSize = params.coalSize; buildCoals() }

  // drift the hot spots slowly, bouncing off the frame's inner margins
  for (const s of hotspots) {
    s.x += s.vx * dt; s.y += s.vy * dt
    if (s.x < W * 0.1 || s.x > W * 0.9) s.vx *= -1
    if (s.y < H * 0.1 || s.y > H * 0.9) s.vy *= -1
    s.pulse = 0.55 + 0.45 * Math.sin(t * 0.4 + s.phase)
  }

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#0a0402'
  ctx.fillRect(0, 0, W, H)

  const hue = params.hue
  const fanNear = performance.now() - ptr.t < 1200
  const crackScale = 1 - params.cracks * 0.3 // shrink blobs → wider cracks between them

  // 0) a dim, deep-red ambient bed so the whole heap reads as hot embers, not
  //    isolated dots — brightest toward the centre where a real bed pools heat.
  ctx.globalCompositeOperation = 'lighter'
  const bed = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6)
  bed.addColorStop(0, `hsla(${hue + 2}, 100%, ${16 + gust * 6}%, 0.5)`)
  bed.addColorStop(1, 'hsla(6, 100%, 7%, 0)')
  ctx.fillStyle = bed
  ctx.fillRect(0, 0, W, H)

  // 1) compute each coal's temperature: own breath + shared airflow + gust +
  //    pooled heat from nearby drifting hot spots + the pointer's fanning.
  for (const c of coals) {
    const breath = 0.72 + 0.28 * Math.sin(t * 0.8 * (0.5 + params.airflow) - c.x * 0.004 - c.y * 0.0025)
    let h = c.base * (0.55 + 0.45 * Math.sin(t * c.rate + c.phase)) * breath
    h *= 1 + params.airflow * 0.35 * Math.sin(t * 0.7 + c.x * 0.003)
    h += gust * 0.4
    for (const s of hotspots) {
      const d = Math.hypot(c.x - s.x, c.y - s.y)
      if (d < s.r) { const f = 1 - d / s.r; h += f * f * s.pulse * 0.9 }
    }
    if (fanNear) {
      const d = Math.hypot(c.x - ptr.x, c.y - ptr.y)
      h += Math.max(0, 1 - d / (160 * PR)) * (0.6 + params.airflow)
    }
    c.h = Math.max(0, Math.min(1.6, h * params.heat))
  }

  // 2) soft under-halo per coal so heat bleeds up through the cracks
  ctx.globalCompositeOperation = 'lighter'
  for (const c of coals) {
    const h = c.h
    if (h < 0.05) continue
    const r = c.r * 1.9
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
    g.addColorStop(0, `hsla(${hue + h * 16}, 100%, ${Math.min(58, 22 + h * 30)}%, ${Math.min(0.5, h * 0.5)})`)
    g.addColorStop(1, 'hsla(8, 100%, 11%, 0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
  }

  // 3) the coal bodies, each incandescent from within: a radial gradient from a
  //    hot core (white-hot when very hot) out to an ashen crust rim.
  ctx.globalCompositeOperation = 'source-over'
  for (const c of coals) {
    const h = c.h
    const cool = 1 - Math.min(1, h) // cool coals go ashen grey
    const hot = Math.max(0, h - 0.9) // white-hot excess
    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.beginPath(); traceBlob(ctx, c.verts, crackScale)
    const r = c.r * crackScale * 1.05
    const g = ctx.createRadialGradient(c.ox * 0.4, c.oy * 0.4, 0, 0, 0, r)
    const coreSat = Math.round(92 - cool * 74)
    const coreLight = Math.min(95, 26 + h * 42 + hot * 34)
    const rimLight = Math.max(3, (6 + h * 9) * (1.15 - params.crust * 0.7))
    g.addColorStop(0, `hsl(${hue + 14 + hot * 16}, ${Math.max(0, coreSat - hot * 60)}%, ${coreLight}%)`)
    g.addColorStop(0.5, `hsl(${hue + h * 8}, ${Math.round(92 - cool * 46)}%, ${16 + h * 24}%)`)
    g.addColorStop(1, `hsl(${hue - 8 + cool * 10}, ${Math.round(40 - cool * 26)}%, ${rimLight}%)`)
    ctx.fillStyle = g
    ctx.fill()
    // crust mottle: dark ash flecks, stronger and greyer on the cooler coals
    ctx.save(); ctx.clip()
    for (const [fx, fy, fr] of c.flecks) {
      const a = (0.22 + cool * 0.5)
      ctx.fillStyle = `hsla(24, ${Math.round(10 + cool * 12)}%, ${Math.round(Math.max(6, 30 - h * 18))}%, ${a})`
      ctx.beginPath(); ctx.arc(fx * crackScale, fy * crackScale, fr, 0, 6.28); ctx.fill()
    }
    ctx.restore()
    // faint hot rim where a hot coal meets the cooler cracks around it
    if (h > 0.15) {
      ctx.lineWidth = 1.2 * PR
      ctx.strokeStyle = `hsla(${hue + 10}, 100%, ${Math.min(72, 42 + h * 30)}%, ${Math.min(0.5, h * 0.45)})`
      ctx.stroke()
    }
    ctx.restore()
  }

  // 4) the odd spark lifting off a hot coal
  if (params.sparks > 0.01) {
    for (const c of coals) {
      if (c.h > 0.85 && rt.rng() < params.sparks * 0.02) {
        sparks.push({ x: c.x, y: c.y, vy: -rt.random(20, 60) * PR, vx: rt.random(-10, 10) * PR, life: 1 })
      }
    }
    ctx.globalCompositeOperation = 'lighter'
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 8 * PR * dt; s.life -= dt * 0.8
      if (s.life <= 0) { sparks.splice(i, 1); continue }
      ctx.fillStyle = `hsla(${hue + 20}, 100%, ${60 + s.life * 30}%, ${s.life})`
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6 * PR * s.life, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
