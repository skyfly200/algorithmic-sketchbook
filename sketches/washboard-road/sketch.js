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
  xVar: { value: 0.4, min: 0, max: 1.5, step: 0.05, label: 'Cross variation' },
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

// The corrugation is shaded per pixel into a small buffer (so the cross-axis
// warp is cheap), then scaled up to fill the whole view.
const field = document.createElement('canvas')
const fctx = field.getContext('2d')
let fw = 0, fh = 0, fimg = null
const shadeLUT = new Uint8ClampedArray(128 * 3) // dirt colour by slope

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
// Any grade (manual, beat, or auto) restarts the auto-grade countdown, so a
// skip pushes the next automatic grade a full interval away.
let autoTimer = 0
function triggerGrade() { if (grader < 0) { grader = 0; autoTimer = 0 } }
rt.onBeat(() => { if (params.gradeOnBeat) triggerGrade() })
rt.onAction('regrade', triggerGrade) // "Regrade now" button in the controls
let lastNow = performance.now()

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  // shade the corrugation into a capped-resolution buffer, then upscale to fill
  fw = Math.min(W, 520)
  fh = Math.max(2, Math.round(fw * H / W))
  field.width = fw; field.height = fh
  fimg = fctx.createImageData(fw, fh)
  if (!road.some((v) => v !== 0)) seedRoad()
}

// dirt colour ramp by slope (windward lit → lee shaded), rebuilt when hue moves
let lutHue = -1
function buildShadeLUT() {
  lutHue = params.hue
  for (let i = 0; i < 128; i++) {
    const slope = (i / 127) * 2 - 1
    const l = Math.max(19, Math.min(58, 33 + slope * 15))
    const rgb = hslToRgb(params.hue, 38 - slope * 6, l)
    shadeLUT[i * 3] = rgb[0]; shadeLUT[i * 3 + 1] = rgb[1]; shadeLUT[i * 3 + 2] = rgb[2]
  }
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = l - c / 2
  let r = 0, g = 0, b = 0
  const seg = Math.floor(h * 6) % 6
  if (seg === 0) { r = c; g = x } else if (seg === 1) { r = x; g = c } else if (seg === 2) { g = c; b = x }
  else if (seg === 3) { g = x; b = c } else if (seg === 4) { r = x; b = c } else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
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

  // --- render: straight-down view filling the whole frame. Travel runs
  //     top→bottom; ripples are the transverse bands, warped across the width so
  //     the washboard also varies in x instead of reading as perfect stripes. ---
  if (params.hue !== lutHue) buildShadeLUT()
  const cellsPerPx = N / fh * 0.35     // vertical zoom in the buffer
  const xv = params.xVar
  const tph = now * 0.00018
  const data = fimg.data
  const wheelA = fw * 0.3, wheelB = fw * 0.7, wheelW = fw * 0.14
  for (let py = 0; py < fh; py++) {
    const cellBase = scrollPos + py * cellsPerPx
    const row = py * fw
    for (let px = 0; px < fw; px++) {
      const nx = px / fw
      // cross-axis warp: two spatial waves + a slow drift bend the ripple lines
      const warp = xv > 0.001
        ? xv * (Math.sin(nx * 9.42 + py * 0.02 + tph) + 0.5 * Math.sin(nx * 19.5 - tph * 0.7)) * 2.2
        : 0
      const cell = cellBase + warp
      const h0 = sampleRoad(cell), h1 = sampleRoad(cell + 0.6)
      let slope = (h1 - h0) * 2.4
      slope = slope < -1 ? -1 : slope > 1 ? 1 : slope
      const li = (((slope + 1) * 0.5) * 127) | 0
      let r = shadeLUT[li * 3], g = shadeLUT[li * 3 + 1], b = shadeLUT[li * 3 + 2]
      // compacted wheel tracks bite darker where tyres run
      if (params.tracks) {
        const tr = Math.min(1, (Math.max(0, wheelW - Math.abs(px - wheelA)) + Math.max(0, wheelW - Math.abs(px - wheelB))) / wheelW)
        if (tr > 0) { const k = 1 - tr * 0.28; r *= k; g *= k; b *= k }
      }
      // fresh-graded cells flash a pale scraped sheen
      const gr = sampleGraded(cell)
      if (gr > 0.02) { const a = gr * 0.35; r += (220 - r) * a; g += (210 - g) * a; b += (190 - b) * a }
      const o = (row + px) * 4
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255
    }
  }
  fctx.putImageData(fimg, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(field, 0, 0, W, H)

  // the grader blade: a bright bar sweeping down the whole road
  if (grader >= 0) {
    const by = (((grader * N - scrollPos) / (N / H * 0.35)) % H + H) % H
    ctx.fillStyle = 'rgba(255,240,210,0.9)'; ctx.fillRect(0, by - 3 * PR, W, 6 * PR)
    ctx.fillStyle = 'rgba(120,130,140,0.9)'; ctx.fillRect(0, by, W, 5 * PR)
  }

  requestAnimationFrame(frame)
}

function hsl(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)` }

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
