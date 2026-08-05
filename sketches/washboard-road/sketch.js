// Washboard Road — a dirt road seen straight down from above, corrugating over
// time. The washboard instability: traffic scrapes grains and throws them a
// little downstream on every bounce, so faint bumps grow into regular transverse
// ripples that march along the road. The lane starts smooth and ruts up until the
// ripples saturate. A grader blade sweeps across on a beat (or on a timer) and
// scrapes it flat again, and the whole cycle repeats.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Traffic speed' },
  passes: { value: 4, min: 0, max: 12, step: 1, label: 'Formation rate' },
  suspension: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Suspension bounce' },
  grip: { value: 1, min: 0.3, max: 2.2, step: 0.05, label: 'Scrape / carve' },
  transport: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Downstream drift' },
  relax: { value: 0.6, min: 0, max: 2, step: 0.05, label: 'Grain slump' },
  scroll: { value: 0.4, min: 0, max: 3, step: 0.05, label: 'Road scroll' },
  gradeEvery: { value: 12, min: 0, max: 30, step: 1, label: 'Auto-grade (s)' },
  gradeOnBeat: { value: true, type: 'bool', label: 'Grade on beat' },
  regrade: { type: 'action', label: 'Regrade now' },
  tracks: { value: true, type: 'bool', label: 'Wheel tracks' },
  hue: { value: 32, min: 10, max: 48, step: 1, label: 'Dirt hue' },
})

const TAU = Math.PI * 2
let W = 0, H = 0, PR = 1
const N = 512                      // looped road length in cells (travel axis)
let road = new Float32Array(N)     // ripple height per cell (+ = a raised crest)
const CLAMP = 1.4                  // saturation cap on the ripple amplitude
let scrollPos = 0                  // how far the road has slid past (cells)

// A grader blade sweeps across and scrapes the road flat behind it. -1 = idle,
// otherwise a 0..1 position along the road; grade[i] tracks how flat each cell is.
let grader = -1
const graded = new Float32Array(N) // 1 where the blade has just passed, decays

function seedRoad() {
  for (let i = 0; i < N; i++) road[i] = (rt.rng() - 0.5) * 0.25 // faint initial roughness
}

// One traffic pass: a hopping sprung wheel traverses the looped road, and on
// every landing it scoops a little material and drops it a few cells downstream —
// the feedback that turns noise into a regular washboard.
function pass() {
  const v = 3.5 * params.speed
  const grav = 0.9
  const push = 0.9 * params.suspension
  const carve = 0.012 * params.grip
  const drift = Math.max(1, Math.round(3 * params.transport))
  let x = (rt.random() * N) | 0
  let yw = road[x] + 1, vw = 0
  const dt = 1 / v
  for (let s = 0; s < N; s++) {
    x = (x + 1) % N
    vw -= grav * dt
    yw += vw * dt
    const ground = road[x] + 1
    if (yw <= ground) {
      const dig = Math.min(0.06, carve * (1 + Math.abs(vw)))
      road[x] += dig
      road[(x + drift) % N] -= dig
      yw = ground
      vw = push
    }
  }
}

function relaxRoad() {
  const k = params.relax * 0.12
  if (k > 0) {
    const prev0 = road[0], prevLast = road[N - 1]
    let left = prevLast
    for (let i = 0; i < N; i++) {
      const right = i === N - 1 ? prev0 : road[i + 1]
      const cur = road[i]
      road[i] = cur + k * ((left + right) * 0.5 - cur)
      left = cur
    }
  }
  // keep the mean near zero and hard-cap the amplitude so ripples saturate
  let m = 0
  for (let i = 0; i < N; i++) m += road[i]
  m /= N
  for (let i = 0; i < N; i++) {
    let v = road[i] - m
    if (v > CLAMP) v = CLAMP; else if (v < -CLAMP) v = -CLAMP
    road[i] = v
  }
}

// Start a grader pass — the blade sweeps the whole road once, scraping it flat.
function triggerGrade() { if (grader < 0) grader = 0 }
rt.onBeat(() => { if (params.gradeOnBeat) triggerGrade() })
rt.onAction('regrade', triggerGrade) // "Regrade now" button in the controls
let autoTimer = 0
let lastNow = performance.now()

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  if (!road.some((v) => v !== 0)) seedRoad()
}

const sampleRoad = (fx) => {
  const i = ((fx % N) + N) % N
  const i0 = Math.floor(i), f = i - i0
  return road[i0] * (1 - f) + road[(i0 + 1) % N] * f
}
const sampleGraded = (fx) => {
  const i = ((fx % N) + N) % N
  return graded[Math.floor(i)]
}

function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000)); lastNow = now

  // sculpt: fast passes evolve the road, then grains slump
  const np = Math.round(params.passes)
  for (let p = 0; p < np; p++) pass()
  relaxRoad()

  // auto-grade timer
  if (params.gradeEvery > 0) {
    autoTimer += dt
    if (autoTimer >= params.gradeEvery) { autoTimer = 0; triggerGrade() }
  } else autoTimer = 0

  // advance the grader blade across the road, flattening cells behind it
  if (grader >= 0) {
    const bladeV = 1.1 * dt              // fraction of the road per second
    const prev = grader
    grader += bladeV
    const from = Math.floor(prev * N), to = Math.floor(Math.min(1, grader) * N)
    for (let c = from; c < to; c++) { const i = ((c % N) + N) % N; road[i] *= 0.08; graded[i] = 1 }
    if (grader >= 1) grader = -1
  }
  for (let i = 0; i < N; i++) graded[i] *= 0.94 // the fresh-graded sheen fades

  scrollPos += params.scroll * dt * 8

  // --- render: straight-down view. Travel runs top→bottom; ripples are the
  //     transverse bands across the lane. ---
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const roadW = W * 0.62, x0 = (W - roadW) / 2, x1 = x0 + roadW
  // shoulders / surrounding dirt
  ctx.fillStyle = hsl(params.hue - 6, 28, 15)
  ctx.fillRect(0, 0, W, H)

  const cellsPerPx = N / H * 0.35     // vertical zoom: how many cells fill the view
  const step = Math.max(1, Math.floor(PR))
  for (let y = 0; y < H; y += step) {
    const cell = scrollPos + y * cellsPerPx
    const h0 = sampleRoad(cell), h1 = sampleRoad(cell + 0.6)
    const slope = Math.max(-1, Math.min(1, (h1 - h0) * 2.4)) // lit from the top
    // base dirt, brightened on windward slopes, shaded in the lee — kept off
    // pure black so ruts read as relief in dirt, not hard stripes
    const l = 33 + slope * 15
    ctx.fillStyle = hsl(params.hue, 38 - slope * 6, Math.max(19, Math.min(58, l)))
    ctx.fillRect(x0, y, roadW, step)
    // fresh-graded cells flash a pale scraped sheen
    const g = sampleGraded(cell)
    if (g > 0.02) { ctx.fillStyle = `rgba(220,210,190,${g * 0.35})`; ctx.fillRect(x0, y, roadW, step) }
  }

  // two compacted wheel tracks running down the lane — where ripples bite hardest
  if (params.tracks) {
    for (const cx of [x0 + roadW * 0.3, x0 + roadW * 0.7]) {
      const tw = roadW * 0.16
      const grad = ctx.createLinearGradient(cx - tw, 0, cx + tw, 0)
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad; ctx.fillRect(cx - tw, 0, tw * 2, H)
    }
  }

  // road edges
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2 * PR
  ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.moveTo(x1, 0); ctx.lineTo(x1, H); ctx.stroke()

  // the grader blade: a bright angled bar sweeping down the lane
  if (grader >= 0) {
    const by = (((grader * N - scrollPos) / cellsPerPx) % H + H) % H
    ctx.fillStyle = 'rgba(255,240,210,0.9)'
    ctx.fillRect(x0 - roadW * 0.06, by - 3 * PR, roadW * 1.12, 6 * PR)
    ctx.fillStyle = 'rgba(120,130,140,0.9)'
    ctx.fillRect(x0 - roadW * 0.06, by, roadW * 1.12, 5 * PR)
  }

  requestAnimationFrame(frame)
}

function hsl(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)` }

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
