/**
 * Moiré Lab — layered line/ring gratings whose overlap beats into moiré
 * interference. Three gratings (each linear or radial) are combined with a
 * chosen op (multiply / difference / screen); as they rotate and drift at
 * fractionally different rates the interference fringes crawl and bloom. A
 * compact, compositable local cousin of the external Moiré Pattern Generator
 * so Patch and the Mixer can capture and pipe it.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const OPS = ['multiply', 'difference', 'screen']
const params = rt.params({
  freq: { value: Math.round(rt.random(40, 110)), min: 8, max: 240, step: 1, label: 'Grating frequency' },
  radialMix: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Radial ↔ linear' },
  spin: { value: +rt.random(0.05, 0.3).toFixed(2), min: 0, max: 1.5, step: 0.01, label: 'Rotate speed' },
  drift: { value: +rt.random(0.1, 0.5).toFixed(2), min: 0, max: 2, step: 0.05, label: 'Drift speed' },
  op: { value: rt.pick(OPS), type: 'select', options: OPS, label: 'Combine op' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue tint (0 = mono)' },
  contrast: { value: 1.2, min: 0.4, max: 3, step: 0.05, label: 'Fringe contrast' },
})
// Music: loudness spins the gratings, beats jolt the drift.
rt.mapInput('audio.volume', 'spin', 0.7)
rt.mapInput('audio.pulse', 'drift', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const SEED = rt.random(0, 6.28)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_freq, u_radial, u_op, u_hue, u_contrast, u_seed;
out vec4 outColor;
#define TAU 6.28318531

vec3 hsl(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

// One grating sampled at p, rotated by ang, mixed between linear and radial.
float grating(vec2 p, float ang, float phase) {
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  float lin = q.x * u_freq;
  float rad = length(p) * u_freq;
  float v = mix(lin, rad, u_radial) + phase;
  return 0.5 + 0.5 * sin(v);
}

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time;

  // Three gratings at fractionally different rates → crawling moiré.
  float g1 = grating(p, u_seed + t * 0.5, t * 2.0);
  float g2 = grating(p, u_seed + 1.7 + t * 0.53, -t * 2.1);
  float g3 = grating(p, u_seed + 3.1 - t * 0.47, t * 1.7);

  float m;
  if (u_op < 0.5) m = g1 * g2 * g3;              // multiply
  else if (u_op < 1.5) m = abs(g1 - g2) * (1.0 - abs(g2 - g3)); // difference
  else m = 1.0 - (1.0 - g1) * (1.0 - g2) * (1.0 - g3); // screen

  m = clamp((m - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 col = u_hue > 0.001 ? hsl(fract(u_hue + m * 0.2), 0.7, m) : vec3(m);
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
for (const n of ['u_res', 'u_time', 'u_freq', 'u_radial', 'u_op', 'u_hue', 'u_contrast', 'u_seed'])
  u[n] = gl.getUniformLocation(program, n)

let spinPhase = 0
let driftPhase = 0
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
  spinPhase += params.spin * dt
  driftPhase += params.drift * dt

  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, spinPhase + driftPhase * 0.5)
  gl.uniform1f(u.u_freq, params.freq)
  gl.uniform1f(u.u_radial, params.radialMix)
  gl.uniform1f(u.u_op, OPS.indexOf(params.op))
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_contrast, params.contrast)
  gl.uniform1f(u.u_seed, SEED)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
