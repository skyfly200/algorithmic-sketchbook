/**
 * Fractal Explorer — Mandelbrot / Julia with smooth escape-time coloring.
 * Pan (drag), zoom (wheel, toward the cursor), reset (double-click). In Julia
 * mode the seed c is a live param (cRe/cIm), so it can be mapped to tilt or the
 * music to morph the set. Single-precision floats zoom cleanly to ~1e-5.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  iterations: { value: 220, min: 50, max: 1000, step: 10, label: 'Iterations' },
  julia: { value: false, type: 'bool', label: 'Julia mode' },
  cRe: { value: -0.8, min: -1, max: 1, step: 0.001, label: 'Julia c — real' },
  cIm: { value: 0.156, min: -1, max: 1, step: 0.001, label: 'Julia c — imag' },
  hue: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Hue' },
  colorCycle: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Palette cycle' },
})
// Music gently cycles the palette by default; map tilt→cRe/cIm to morph Julia.
rt.mapInput('beat.volume', 'colorCycle', 0.6)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })
const hint = document.getElementById('hint')

// View state (complex plane). scale = half-height in complex units.
const DEFAULTS = { mandel: { center: [-0.5, 0], scale: 1.4 }, julia: { center: [0, 0], scale: 1.5 } }
let center = [...DEFAULTS.mandel.center]
let scale = DEFAULTS.mandel.scale

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res, u_center, u_c;
uniform float u_scale, u_iters, u_julia, u_hue, u_colorCycle, u_time;
out vec4 outColor;
vec3 palette(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)) + u_hue * 6.2831);
}
void main() {
  float minr = min(u_res.x, u_res.y);
  vec2 uv = (2.0 * gl_FragCoord.xy - u_res) / minr;
  vec2 p = u_center + uv * u_scale;
  vec2 z = u_julia > 0.5 ? p : vec2(0.0);
  vec2 c = u_julia > 0.5 ? u_c : p;
  int N = int(u_iters);
  float iter = 0.0;
  bool escaped = false;
  for (int k = 0; k < 1000; k++) {
    if (k >= N) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) { escaped = true; iter = float(k); break; }
  }
  if (!escaped) { outColor = vec4(0.02, 0.02, 0.03, 1.0); return; } // inside set
  // Smooth (continuous) iteration count.
  float sm = iter + 1.0 - log2(log2(dot(z, z)) * 0.5);
  vec3 col = palette(sm * 0.025 + u_time * u_colorCycle * 0.08);
  outColor = vec4(col, 1.0);
}`

function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program)
gl.useProgram(program)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const u = {}
for (const n of ['u_res', 'u_center', 'u_c', 'u_scale', 'u_iters', 'u_julia', 'u_hue', 'u_colorCycle', 'u_time'])
  u[n] = gl.getUniformLocation(program, n)

// --- interaction ---
function aspect() {
  const minr = Math.min(canvas.width, canvas.height)
  return [canvas.width / minr, canvas.height / minr]
}
function complexAt(nx, ny) {
  const [ax, ay] = aspect()
  return [center[0] + (2 * nx - 1) * ax * scale, center[1] + (1 - 2 * ny) * ay * scale]
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const nx = e.clientX / window.innerWidth
  const ny = e.clientY / window.innerHeight
  const before = complexAt(nx, ny)
  scale *= Math.exp(e.deltaY * 0.0011)
  scale = Math.min(2.5, Math.max(1e-6, scale))
  const after = complexAt(nx, ny)
  center[0] += before[0] - after[0]
  center[1] += before[1] - after[1]
  hint.style.opacity = 0
}, { passive: false })

let dragging = false
let last = [0, 0]
canvas.addEventListener('pointerdown', (e) => {
  dragging = true
  last = [e.clientX, e.clientY]
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const [ax, ay] = aspect()
  const dnx = (e.clientX - last[0]) / window.innerWidth
  const dny = (e.clientY - last[1]) / window.innerHeight
  center[0] -= dnx * 2 * ax * scale
  center[1] += dny * 2 * ay * scale
  last = [e.clientX, e.clientY]
  hint.style.opacity = 0
})
canvas.addEventListener('pointerup', () => (dragging = false))
canvas.addEventListener('dblclick', () => {
  const d = params.julia ? DEFAULTS.julia : DEFAULTS.mandel
  center = [...d.center]
  scale = d.scale
})

let wasJulia = false

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  // Reset the view when switching mode so you land somewhere interesting.
  if (params.julia !== wasJulia) {
    const d = params.julia ? DEFAULTS.julia : DEFAULTS.mandel
    center = [...d.center]
    scale = d.scale
    wasJulia = params.julia
  }
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform2f(u.u_center, center[0], center[1])
  gl.uniform2f(u.u_c, params.cRe, params.cIm)
  gl.uniform1f(u.u_scale, scale)
  gl.uniform1f(u.u_iters, params.iterations)
  gl.uniform1f(u.u_julia, params.julia ? 1 : 0)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_colorCycle, params.colorCycle)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
