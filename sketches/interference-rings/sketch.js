/**
 * Interference Rings — a field of overlapping zone plates. A zone plate is a
 * sin(r²) grating: concentric rings that pack tighter with radius. Summing the
 * squared-distance phase from a lattice of centers makes them beat together
 * into moiré interference — the same family of patterns diffraction gratings
 * throw. Runs as a fragment shader on a fullscreen triangle.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  freq: { value: 40, min: 5, max: 160, step: 1, label: 'Ring frequency' },
  ratio: { value: 0.6, min: 0, max: 2, step: 0.01, label: 'Satellite strength' },
  spread: { value: 0.8, min: 0.1, max: 2, step: 0.05, label: 'Satellite spread' },
  zoom: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Zoom' },
  drift: { value: 0.5, min: 0, max: 4, step: 0.05, label: 'Drift' },
  binary: { value: true, type: 'bool', label: '1-bit (crisp)' },
  softness: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Edge softness' },
  hue: { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue tint (0 = mono)' },
})
// Map the music onto the motion by default (remix in the controls panel).
rt.mapInput('beat.volume', 'drift', 0.9) // louder = faster drift
rt.mapInput('beat.pulse', 'zoom', 0.25) // beats breathe the zoom

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_freq, u_ratio, u_spread, u_zoom, u_drift, u_binary, u_soft, u_hue;
out vec4 outColor;

vec3 hsl(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  p *= u_zoom;

  // Central zone plate plus a 3x3 lattice of satellites; summing the r² phase
  // is what makes them interfere into moiré.
  float phase = dot(p, p) * u_freq;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      if (i == 0 && j == 0) continue;
      vec2 d = p - vec2(float(i), float(j)) * u_spread;
      phase += dot(d, d) * u_freq * u_ratio;
    }
  }
  phase -= u_time * u_drift;

  float rings = sin(phase);
  // Anti-alias the (very high frequency) rings so they resolve to gray far out
  // instead of shimmering.
  float aa = fwidth(rings) * (1.0 + u_soft * 4.0) + 1e-4;
  float g = u_binary > 0.5
    ? smoothstep(-aa, aa, rings)
    : 0.5 + 0.5 * rings;

  vec3 col = u_hue > 0.001 ? hsl(fract(u_hue + g * 0.15), 0.7, g) : vec3(g);
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
for (const name of ['u_res', 'u_time', 'u_freq', 'u_ratio', 'u_spread', 'u_zoom', 'u_drift', 'u_binary', 'u_soft', 'u_hue'])
  u[name] = gl.getUniformLocation(program, name)

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_freq, params.freq)
  gl.uniform1f(u.u_ratio, params.ratio)
  gl.uniform1f(u.u_spread, params.spread)
  gl.uniform1f(u.u_zoom, params.zoom)
  gl.uniform1f(u.u_drift, params.drift)
  gl.uniform1f(u.u_binary, params.binary ? 1 : 0)
  gl.uniform1f(u.u_soft, params.softness)
  gl.uniform1f(u.u_hue, params.hue)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
