import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
// Retrofit: the classic plasma is now fully parametric — speed, field scale,
// orbit warp, palette — with seeded defaults so each load differs, and a
// brightness pulse that audio can drive.
const params = rt.params({
  speed: { value: +rt.random(0.4, 0.9).toFixed(2), min: 0, max: 3, step: 0.05, label: 'Speed' },
  scale: { value: +rt.random(0.7, 1.6).toFixed(2), min: 0.3, max: 3, step: 0.05, label: 'Field scale' },
  warp: { value: +rt.random(0.4, 1).toFixed(2), min: 0, max: 2, step: 0.05, label: 'Orbit warp' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue shift' },
  pulse: { value: 0, min: 0, max: 1, step: 0.01, label: 'Brightness pulse' },
})
// Music: beats flash the plasma, loudness speeds it up.
rt.mapInput('audio.pulse', 'pulse', 0.6)
rt.mapInput('audio.volume', 'speed', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time, u_scale, u_warp, u_hue, u_pulse;
out vec4 outColor;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv *= u_scale;
  float t = u_time;

  float v = 0.0;
  v += sin(uv.x * 4.0 + t);
  v += sin((uv.y + t) * 3.0);
  v += sin((uv.x + uv.y) * 3.0 + t * 0.5);
  vec2 c = uv + vec2(sin(t * 0.3), cos(t * 0.4)) * 0.7 * u_warp;
  v += sin(length(c) * 6.0 - t * 2.0);
  v *= 0.25;

  vec3 col = 0.5 + 0.5 * cos(6.2831 * (v + vec3(0.0, 0.33, 0.67) + u_hue) + t * 0.2);
  col *= 0.65 + 0.35 * smoothstep(1.6, 0.2, length(uv / u_scale));
  col *= 1.0 + u_pulse * 0.9;
  outColor = vec4(col, 1.0);
}`

function compile(type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }
  return shader
}

const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program)
gl.useProgram(program)

// Fullscreen triangle (covers the viewport with 3 vertices).
const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const u = {}
for (const n of ['u_resolution', 'u_time', 'u_scale', 'u_warp', 'u_hue', 'u_pulse'])
  u[n] = gl.getUniformLocation(program, n)

// Accumulate speed-scaled time so the speed param changes smoothly.
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

  gl.uniform2f(u.u_resolution, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, phase)
  gl.uniform1f(u.u_scale, params.scale)
  gl.uniform1f(u.u_warp, params.warp)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_pulse, params.pulse)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
