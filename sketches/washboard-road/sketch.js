// Washboard Road — a dirt road seen straight down from above, corrugating over
// time. The washboard instability: traffic scrapes grains and throws them a
// little downstream on every bounce, so faint bumps grow into regular transverse
// ripples that march along the road. The lane starts smooth and ruts up until the
// ripples saturate. A grader blade sweeps across on a beat (or on a timer) and
// scrapes it flat again, and the whole cycle repeats.
//
// The 1D road profile (512 cells) is cheap and stays in JS; it is uploaded as a
// tiny float texture each frame and the per-pixel shading (cross warp, slope
// lighting, wheel tracks, graded sheen) runs on the GPU: one pass into a small
// buffer at the same resolution the old Canvas2D path used, a blit that scales
// it up to the canvas, and the grader blade drawn at full resolution.
import { createRuntime } from '../_lib/runtime.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
// Made here first with antialias off: the buffer is blitted onto the canvas, which a
// multisampled drawing buffer would refuse. glpipe then gets this same context.
canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const pipe = createGLPipe({ rt, src: null, canvas })
const gl = pipe.gl

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

// The corrugation is shaded per pixel into a small buffer (so it keeps the soft
// look of the original), then scaled up to fill the whole view.
let fw = 0, fh = 0, fieldT = null

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
  W = pipe.width; H = pipe.height // glpipe sized the canvas (its listener runs first)
  // shade the corrugation into a capped-resolution buffer, then upscale to fill
  fw = Math.min(W, Math.round(520 * (0.5 + 0.5 * rt.detail)))
  fh = Math.max(2, Math.round(fw * H / W))
  pipe.release(fieldT)
  fieldT = pipe.target({ width: fw, height: fh })
  if (!road.some((v) => v !== 0)) seedRoad()
}

// road profile + graded sheen per cell, as an N x 1 RG32F texture (texelFetch)
const roadTex = { tex: gl.createTexture() }
const roadBuf = new Float32Array(N * 2)
gl.bindTexture(gl.TEXTURE_2D, roadTex.tex)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, N, 1, 0, gl.RG, gl.FLOAT, roadBuf)
function uploadRoad() {
  for (let i = 0; i < N; i++) { roadBuf[i * 2] = road[i]; roadBuf[i * 2 + 1] = graded[i] }
  gl.bindTexture(gl.TEXTURE_2D, roadTex.tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 1, gl.RG, gl.FLOAT, roadBuf)
}

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
out vec4 outColor;
`
// Shade the road into the fw x fh buffer: the same maths as the old per-pixel loop.
const SHADE = HEAD + `
uniform sampler2D u_road;      // N x 1: r = ripple height, g = graded sheen
uniform float u_scroll, u_cellsPerPx, u_xVar, u_tph, u_tracks, u_hue;
const float N = ${N}.0;
vec2 cellAt(float i) { return texelFetch(u_road, ivec2(int(i), 0), 0).rg; }
float sampleRoad(float fx) {
  float i = mod(fx, N);
  float i0 = floor(i), f = i - i0;
  return mix(cellAt(i0).r, cellAt(mod(i0 + 1.0, N)).r, f);
}
vec3 hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * clamp(min(k - 3.0, 9.0 - k), -1.0, 1.0);
}
void main() {
  float px = floor(gl_FragCoord.x), py = u_res.y - 1.0 - floor(gl_FragCoord.y); // top-down, like the canvas
  float fw = u_res.x;
  float nx = px / fw;
  // cross-axis warp: two spatial waves + a slow drift bend the ripple lines
  float warp = u_xVar > 0.001
    ? u_xVar * (sin(nx * 9.42 + py * 0.02 + u_tph) + 0.5 * sin(nx * 19.5 - u_tph * 0.7)) * 2.2
    : 0.0;
  float cell = u_scroll + py * u_cellsPerPx + warp;
  float h0 = sampleRoad(cell), h1 = sampleRoad(cell + 0.6);
  float slope = clamp((h1 - h0) * 2.4, -1.0, 1.0);
  // dirt colour by slope (windward lit, lee shaded)
  float l = clamp(33.0 + slope * 15.0, 19.0, 58.0);
  vec3 c = hsl(u_hue / 360.0, (38.0 - slope * 6.0) / 100.0, l / 100.0);
  // compacted wheel tracks bite darker where tyres run
  if (u_tracks > 0.5) {
    float wa = fw * 0.3, wb = fw * 0.7, ww = fw * 0.14;
    float tr = min(1.0, (max(0.0, ww - abs(px - wa)) + max(0.0, ww - abs(px - wb))) / ww);
    c *= 1.0 - tr * 0.28;
  }
  // fresh-graded cells flash a pale scraped sheen
  float gr = cellAt(floor(mod(cell, N))).g;
  if (gr > 0.02) c = mix(c, vec3(220.0, 210.0, 190.0) / 255.0, gr * 0.35);
  outColor = vec4(c, 1.0);
}`
// The grader blade, drawn in a scissor box over the scaled-up buffer and blended
// (premultiplied): a bright 6 px bar with the grey 5 px blade over its lower half.
const BLADE = HEAD + `
uniform float u_blade, u_pr;   // blade y in canvas px (top-down)
void main() {
  float d = (u_res.y - gl_FragCoord.y) - u_blade;
  float a1 = 0.9 * clamp(min(d + 3.0 * u_pr, 3.0 * u_pr - d) + 0.5, 0.0, 1.0);
  float a2 = 0.9 * clamp(min(d, 5.0 * u_pr - d) + 0.5, 0.0, 1.0);
  vec3 c1 = vec3(255.0, 240.0, 210.0) / 255.0, c2 = vec3(120.0, 130.0, 140.0) / 255.0;
  outColor = vec4(c2 * a2 + c1 * a1 * (1.0 - a2), a2 + a1 * (1.0 - a2));
}`
const shadeP = pipe.program(SHADE)
const bladeP = pipe.program(BLADE)

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
  uploadRoad()
  const tph = (now * 0.00018) % (20 * Math.PI) // 20π keeps both warp waves continuous
  pipe.run(shadeP, { u_road: roadTex }, fieldT, (u) => {
    u.f('u_scroll', scrollPos % N) // the road loops every N cells
    u.f('u_cellsPerPx', N / fh * 0.35) // vertical zoom in the buffer
    u.f('u_xVar', params.xVar)
    u.f('u_tph', tph)
    u.f('u_tracks', params.tracks ? 1 : 0)
    u.f('u_hue', params.hue)
  })
  // scale the buffer up to the canvas: a filtered blit, no shader pass
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fieldT.fbo)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  gl.blitFramebuffer(0, 0, fw, fh, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)

  // the grader blade: a bright bar sweeping down the whole road
  if (grader >= 0) {
    const by = (((grader * N - scrollPos) / (N / H * 0.35)) % H + H) % H
    const y0 = Math.max(0, Math.floor(H - by - 5 * PR - 1)), y1 = Math.min(H, Math.ceil(H - by + 3 * PR + 1))
    if (y1 > y0) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, y0, W, y1 - y0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      pipe.run(bladeP, {}, null, (u) => { u.f('u_blade', by); u.f('u_pr', PR) })
      gl.disable(gl.BLEND)
      gl.disable(gl.SCISSOR_TEST)
    }
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
