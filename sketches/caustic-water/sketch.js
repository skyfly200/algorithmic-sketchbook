/**
 * Caustic Water — procedural underwater caustics as a fragment shader: an
 * iterated phase-warp (each pass bends the domain by the sines of the last)
 * whose interference concentrates light into the dancing filament network sun
 * throws on a pool floor. A compact, compositable cousin of the external
 * Cymatic Caustic Caster app — this one lives locally so Patch and the Mixer
 * can capture and pipe it.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  scale: { value: +rt.random(0.8, 1.8).toFixed(2), min: 0.3, max: 4, step: 0.05, label: 'Pattern scale' },
  speed: { value: +rt.random(0.4, 0.9).toFixed(2), min: 0, max: 3, step: 0.05, label: 'Flow speed' },
  sharp: { value: +rt.random(5, 9).toFixed(1), min: 2, max: 14, step: 0.5, label: 'Filament sharpness' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Brightness' },
  depth: { value: +rt.random(0.3, 0.7).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Water depth (tint)' },
  hue: { value: +rt.random(0.45, 0.6).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Water hue' },
})
// Music: loudness churns the water, beats flash the light.
rt.mapInput('audio.volume', 'speed', 0.6)
rt.mapInput('audio.pulse', 'glow', 0.4)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const SEED = rt.random(0, 100)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_scale, u_sharp, u_glow, u_depth, u_hue, u_seed;
out vec4 outColor;
#define TAU 6.28318531

vec3 hsl(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / min(u_res.x, u_res.y);
  vec2 p = mod((uv * u_scale + u_seed) * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;

  // Iterated phase warp: each pass displaces the domain by sines of the
  // previous — their interference is what focuses light into caustics.
  for (int n = 0; n < 5; n++) {
    float t = u_time * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float light = pow(abs(c), u_sharp) * u_glow;

  // Water body colour deepens with u_depth; caustic filaments ride on top.
  vec3 water = hsl(u_hue, 0.75, 0.32 * (1.0 - u_depth * 0.7));
  vec3 col = water + vec3(light);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
for (const n of ['u_res', 'u_time', 'u_scale', 'u_sharp', 'u_glow', 'u_depth', 'u_hue', 'u_seed'])
  u[n] = gl.getUniformLocation(program, n)

let phase = 0
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
  phase += params.speed * dt

  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, phase)
  gl.uniform1f(u.u_scale, params.scale)
  gl.uniform1f(u.u_sharp, params.sharp)
  gl.uniform1f(u.u_glow, params.glow)
  gl.uniform1f(u.u_depth, params.depth)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_seed, SEED)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
