/**
 * Fractal Explorer — Mandelbrot / Julia with smooth escape-time coloring.
 * Pan (drag), zoom (wheel, toward the cursor), reset (double-click). In Julia
 * mode the seed c is a live param (cRe/cIm), so it can be mapped to tilt or the
 * music to morph the set. Single-precision floats zoom cleanly to ~1e-5.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const FRACTALS = ['Mandelbrot', 'Burning Ship', 'Tricorn', 'Multibrot', 'Celtic']
const params = rt.params({
  fractal: { value: 'Mandelbrot', type: 'select', options: FRACTALS, label: 'Fractal' },
  iterations: { value: 260, min: 50, max: 1500, step: 10, label: 'Iterations' },
  autoZoom: { value: false, type: 'bool', label: 'Auto-zoom (endless dive)' },
  zoomSpeed: { value: 0.35, min: 0, max: 2, step: 0.01, label: 'Auto-zoom speed' },
  julia: { value: false, type: 'bool', label: 'Julia mode' },
  cRe: { value: -0.8, min: -1, max: 1, step: 0.001, label: 'Julia c — real' },
  cIm: { value: 0.156, min: -1, max: 1, step: 0.001, label: 'Julia c — imag' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  colorCycle: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Palette cycle' },
})
// Music gently cycles the palette by default; map tilt→cRe/cIm to morph Julia,
// or beat→zoomSpeed to pump the dive.
rt.mapInput('audio.volume', 'colorCycle', 0.6)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })
const hint = document.getElementById('hint')

// View state (complex plane). scale = half-height in complex units.
const DEFAULTS = {
  Mandelbrot: { center: [-0.5, 0], scale: 1.4 },
  'Burning Ship': { center: [-0.5, -0.5], scale: 1.5 },
  Tricorn: { center: [0, 0], scale: 1.6 },
  Multibrot: { center: [0, 0], scale: 1.6 },
  Celtic: { center: [-0.5, 0], scale: 1.6 },
  julia: { center: [0, 0], scale: 1.5 },
}
// A deep, detail-rich point to dive toward in each set's auto-zoom.
const DIVE = {
  Mandelbrot: [-0.743643887037158, 0.131825904205311], // seahorse valley
  'Burning Ship': [-1.7757, -0.0323],
  Tricorn: [-0.2018, 1.1002],
  Multibrot: [0.4179, 0.3418],
  Celtic: [-1.0505, 0.2606],
}
function defaultView() {
  return params.julia ? DEFAULTS.julia : DEFAULTS[params.fractal] ?? DEFAULTS.Mandelbrot
}
let center = [...DEFAULTS.Mandelbrot.center]
let scale = DEFAULTS.Mandelbrot.scale

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res, u_center, u_c;
uniform float u_scale, u_iters, u_julia, u_hue, u_colorCycle, u_time, u_fractal;
out vec4 outColor;
vec3 palette(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)) + u_hue * 6.2831);
}
// One iteration step z -> f(z) + c, selected by u_fractal.
vec2 step_f(vec2 z, vec2 c) {
  if (u_fractal < 0.5) {                 // Mandelbrot: z^2 + c
    return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  } else if (u_fractal < 1.5) {          // Burning Ship
    return vec2(z.x * z.x - z.y * z.y, 2.0 * abs(z.x * z.y)) + c;
  } else if (u_fractal < 2.5) {          // Tricorn (Mandelbar): conj(z)^2 + c
    return vec2(z.x * z.x - z.y * z.y, -2.0 * z.x * z.y) + c;
  } else if (u_fractal < 3.5) {          // Multibrot: z^3 + c
    return vec2(z.x * z.x * z.x - 3.0 * z.x * z.y * z.y, 3.0 * z.x * z.x * z.y - z.y * z.y * z.y) + c;
  }                                       // Celtic: (|Re(z^2)|, Im(z^2)) + c
  return vec2(abs(z.x * z.x - z.y * z.y), 2.0 * z.x * z.y) + c;
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
  for (int k = 0; k < 1500; k++) {
    if (k >= N) break;
    z = step_f(z, c);
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
for (const n of ['u_res', 'u_center', 'u_c', 'u_scale', 'u_iters', 'u_julia', 'u_hue', 'u_colorCycle', 'u_time', 'u_fractal'])
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
  const d = defaultView()
  center = [...d.center]
  scale = d.scale
})

let wasJulia = false
let wasFractal = params.fractal
let autoWas = false
let diveTarget = null
let lastNow = 0

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  // Reset the view when switching mode/fractal so you land somewhere interesting.
  if (params.julia !== wasJulia || params.fractal !== wasFractal) {
    const d = defaultView()
    center = [...d.center]
    scale = d.scale
    wasJulia = params.julia
    wasFractal = params.fractal
    autoWas = false
  }

  // Auto-zoom: dive endlessly toward a detail-rich point, ramping iterations
  // with depth. Single-precision resolves to ~1e-5; past that we ease back out
  // and keep diving, so the zoom loops forever without shimmering to mush.
  if (params.autoZoom) {
    if (!autoWas) {
      const d = defaultView()
      center = [...d.center]
      scale = d.scale
      diveTarget = params.julia ? [...center] : DIVE[params.fractal] ?? [...center]
      autoWas = true
    }
    const ease = Math.min(1, dt * 0.9)
    center[0] += (diveTarget[0] - center[0]) * ease
    center[1] += (diveTarget[1] - center[1]) * ease
    scale *= Math.exp(-params.zoomSpeed * dt)
    if (scale < 1e-5) scale = defaultView().scale // loop the dive
    hint.style.opacity = 0
  } else {
    autoWas = false
  }

  // More iterations the deeper we are, so fine filaments stay resolved.
  const depth = Math.max(0, -Math.log10(scale))
  const iters = Math.min(1500, params.iterations + depth * 90)

  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform2f(u.u_center, center[0], center[1])
  gl.uniform2f(u.u_c, params.cRe, params.cIm)
  gl.uniform1f(u.u_scale, scale)
  gl.uniform1f(u.u_iters, iters)
  gl.uniform1f(u.u_julia, params.julia ? 1 : 0)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_colorCycle, params.colorCycle)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_fractal, FRACTALS.indexOf(params.fractal))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
