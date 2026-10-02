// Stacked ridgelines à la Joy Division's "Unknown Pleasures" cover — itself a
// stack of the pulsar CP 1919's radio pulses. Each row is a rectified fractal
// profile pulled up under a central Gaussian, so the spikes gather mid-width
// and flatten to a line at the edges. Rows are drawn back (top) to front
// (bottom); filling under each curve with the background colour hides the rows
// behind it, giving the woodcut, overlapping-mountains look. The noise field
// scrolls, so the ridges breathe and drift.
//
// WebGL version: every row is one instance of an instanced draw. The noise
// profile is evaluated in the vertex shader (fbm per vertex), the "fill under the
// curve" occlusion is the depth buffer, and each line is a ribbon whose fragment
// shader draws the crisp stroke plus its glow — no per-point JS, no shadowBlur.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const capture = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { antialias: true, depth: true, preserveDrawingBuffer: capture })

const params = rt.params({
  lines: { value: 62, min: 12, max: 140, step: 1, label: 'Lines' },
  amplitude: { value: 1.0, min: 0.2, max: 2.5, step: 0.05, label: 'Amplitude' },
  spread: { value: 0.5, min: 0.15, max: 1, step: 0.01, label: 'Spread' },
  speed: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Speed' },
  detail: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Detail' },
  wander: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Wander' },
  glow: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'Glow' },
  hue: { value: 210, min: 0, max: 360, step: 1, label: 'Hue' },
  tint: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'Tint' },
})

// Loudness swells the peaks, a beat flares the glow — a good default feel.
rt.mapInput('audio.volume', 'amplitude', 0.5)
rt.mapInput('audio.pulse', 'glow', 0.4)

const seedOff = rt.rng() * 1000

// Shared by both passes: the profile height of row r at column c (px above its baseline).
const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_lines, u_cols, u_marginX, u_spanX, u_marginTop, u_dy, u_peak, u_inv2s2;
uniform float u_freq, u_scroll, u_wander, u_detail, u_seed, u_t;

float hash1(float x) { return fract(sin(x * 127.1 + u_seed) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}
float fbm(float x) {
  float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
  for (int k = 0; k < 5; k++) {
    sum += amp * vnoise(x * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}
// y position (px, y down) of row r at column c
float rowY(float r, float c) {
  float baseY = u_marginTop + r * u_dy;
  float u = clamp(c / u_cols, 0.0, 1.0);
  float du = u - 0.5;
  float edge = min(u, 1.0 - u) / 0.07;
  float fade = edge < 1.0 ? edge * edge * (3.0 - 2.0 * edge) : 1.0;     // land flat on the baseline
  float env = exp(-(du * du) * u_inv2s2) * fade;
  float rowDrift = u_scroll + sin(r * 0.5 + u_t * u_wander * 0.6) * u_wander * 1.5;
  float raw = fbm(u * u_freq + r * 8.13 + rowDrift);
  float spike = max((raw - 0.42) / 0.58, 0.0);
  spike = pow(spike, 1.0 + u_detail * 1.8);
  return baseY - env * spike * u_peak;
}
float rowDepth(float r) { return 1.0 - (r + 1.0) / (u_lines + 2.0); }     // later rows are nearer
vec4 toClip(vec2 px, float z) { return vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, z * 2.0 - 1.0, 1.0); }
`

// pass 1: the silhouette under each curve, in the background colour (writes depth).
// Drawn nearest row first so the depth test rejects the hidden rows' pixels early
// instead of overdrawing every pixel once per row.
const FILL_VS = COMMON + `
void main() {
  float r = u_lines - 1.0 - float(gl_InstanceID);
  float c = float(gl_VertexID >> 1);
  bool bottom = (gl_VertexID & 1) == 1;
  float x = u_marginX + c / u_cols * u_spanX;
  float y = bottom ? u_res.y : rowY(r, c);
  gl_Position = toClip(vec2(x, y), rowDepth(r));
}`
const FILL_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(5.0 / 255.0, 6.0 / 255.0, 10.0 / 255.0, 1.0); }`

// pass 2: the stroke + its glow as a ribbon along the curve (depth-tested, no depth write)
const LINE_VS = COMMON + `
uniform float u_halfW;
out float v_side;
void main() {
  float r = float(gl_InstanceID);
  float c = float(gl_VertexID >> 1);
  float side = (gl_VertexID & 1) == 1 ? 1.0 : -1.0;
  float step_ = u_spanX / u_cols;
  float y0 = rowY(r, c - 1.0), y1 = rowY(r, c + 1.0);
  vec2 tangent = normalize(vec2(2.0 * step_, y1 - y0));
  vec2 normal = vec2(-tangent.y, tangent.x);
  vec2 p = vec2(u_marginX + c * step_, rowY(r, c)) + normal * side * u_halfW;
  v_side = side;
  gl_Position = toClip(p, rowDepth(r) - 0.0005);
}`
const LINE_FS = `#version 300 es
precision highp float;
in float v_side;
uniform vec3 u_stroke;
uniform float u_halfW, u_lw, u_glow, u_glowR;
out vec4 outColor;
void main() {
  float d = abs(v_side) * u_halfW;                       // distance from the line's centre, px
  float core = 1.0 - smoothstep(u_lw * 0.5 - 0.6, u_lw * 0.5 + 0.6, d);
  float halo = u_glow * 0.55 * exp(-(d * d) / (2.0 * u_glowR * u_glowR + 1e-3));
  float a = clamp(core + halo * (1.0 - core), 0.0, 1.0);
  outColor = vec4(u_stroke, a);
}`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
function program(vs, fs) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  const locs = {}
  return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) }
}
const fill = program(FILL_VS, FILL_FS)
const line = program(LINE_VS, LINE_FS)
const vao = gl.createVertexArray() // attribute-less draws need a VAO bound

const hsl = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))
  return [f(0), f(8), f(4)]
}

let W = 0
let H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  gl.viewport(0, 0, W, H)
}

function setCommon(prog, t, lines, cols) {
  const marginX = W * 0.16
  const spanX = W - marginX * 2
  const marginTop = H * 0.14
  const marginBot = H * 0.12
  const dy = (H - marginTop - marginBot) / (lines - 1)
  const sigma = 0.1 + params.spread * 0.34 // envelope: a central Gaussian, wider with `spread`
  const set1 = (n, v) => gl.uniform1f(prog.u(n), v)
  gl.uniform2f(prog.u('u_res'), W, H)
  set1('u_lines', lines)
  set1('u_cols', cols)
  set1('u_marginX', marginX)
  set1('u_spanX', spanX)
  set1('u_marginTop', marginTop)
  set1('u_dy', dy)
  set1('u_peak', dy * 3.4 * params.amplitude) // how far the tallest spike rises
  set1('u_inv2s2', 1 / (2 * sigma * sigma))
  set1('u_freq', 2.5 + params.detail * 15)
  set1('u_scroll', t * params.speed)
  set1('u_wander', params.wander)
  set1('u_detail', params.detail)
  set1('u_seed', seedOff)
  set1('u_t', t)
  return { spanX }
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const lines = Math.max(8, Math.round(params.lines))
  const spanX = W - W * 0.32
  // Sample density. The step is a fixed ~2.4 CSS px (it used to shrink as pixelRatio grew, so
  // columns scaled with pixelRatio squared) and widens as quality drops (rt.detail). The floor
  // keeps the top fbm octave (u_freq * 16 cycles across the span) at >= 0.5 columns per cycle (it carries 1/32 of the amplitude).
  const freq = 2.5 + params.detail * 15
  const stepPx = (2.4 * rt.pixelRatio) / Math.max(0.35, rt.detail)
  const cols = Math.max(80, Math.ceil(freq * 8), Math.round(spanX / stepPx))

  gl.bindVertexArray(vao)
  gl.clearColor(5 / 255, 6 / 255, 10 / 255, 1)
  gl.clearDepth(1)
  gl.depthMask(true)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.disable(gl.BLEND)

  // 1) silhouettes: each row hides those behind it
  gl.useProgram(fill.p)
  setCommon(fill, t, lines, cols)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (cols + 1) * 2, lines)

  // 2) the lines themselves, with their glow
  const lw = Math.max(1, 1.15 * rt.pixelRatio)
  const glowR = params.glow * 12 * rt.pixelRatio
  const halfW = lw * 0.5 + (params.glow > 0.01 ? glowR * 2.2 : 1)
  gl.useProgram(line.p)
  setCommon(line, t, lines, cols)
  gl.uniform3f(line.u('u_stroke'), ...hsl(Math.round(params.hue), Math.round(params.tint * 60) / 100, 0.92))
  gl.uniform1f(line.u('u_halfW'), halfW)
  gl.uniform1f(line.u('u_lw'), lw)
  gl.uniform1f(line.u('u_glow'), params.glow > 0.01 ? params.glow : 0)
  gl.uniform1f(line.u('u_glowR'), glowR)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.depthMask(false)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (cols + 1) * 2, lines)
  gl.depthMask(true)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
