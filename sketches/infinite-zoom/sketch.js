/**
 * Infinite Zoom — a seamless endless zoom. The motif is drawn at several
 * exponentially-spaced scales (a log-zoom stack); each layer fades in at the
 * center and out at the rim via a sin() window, so when its scale wraps the
 * contribution is zero and the jump is invisible. As time advances every layer
 * grows, new detail blooms from the middle forever, and the whole thing is a
 * true loop (period = 1 / (speed × layers)). Runs as a fragment shader.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  speed: { value: 0.2, min: -1, max: 1, step: 0.01, label: 'Zoom speed (±)' },
  zoom: { value: 4, min: 1.5, max: 12, step: 0.1, label: 'Zoom ratio' },
  layers: { value: 6, min: 2, max: 8, step: 1, label: 'Layers' },
  twist: { value: 0.6, min: -3, max: 3, step: 0.05, label: 'Spiral twist' },
  sectors: { value: 6, min: 2, max: 16, step: 1, label: 'Symmetry' },
  detail: { value: 8, min: 2, max: 24, step: 0.5, label: 'Ring detail' },
  hue: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Hue' },
})
// Music: loudness drives the zoom, beats kick the spiral.
rt.mapInput('beat.volume', 'speed', 0.5)
rt.mapInput('beat.pulse', 'twist', 0.4)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_zoom, u_layers, u_twist, u_sectors, u_detail, u_hue;
out vec4 outColor;
#define PI 3.14159265
#define MAXL 8

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 palette(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)) + u_hue * 6.2831);
}

// The motif: a kaleidoscopic mandala (mirror-folded sectors of rings + petals).
float motif(vec2 q, out vec3 col) {
  float r = length(q);
  float a = atan(q.y, q.x);
  float sec = 6.2831 / max(2.0, u_sectors);
  a = abs(mod(a + sec * 0.5, sec) - sec * 0.5); // mirror fold into one wedge
  float rings = 0.5 + 0.5 * sin(r * u_detail - 1.0);
  float petals = 0.5 + 0.5 * cos(a * u_sectors * 2.0);
  float m = smoothstep(0.30, 0.95, rings * petals);
  col = palette(r * 0.32 + a * 0.15);
  return m;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time; // already scaled by speed on the JS side (u_time = time*speed)
  int L = int(u_layers + 0.5);
  float lz = log(max(1.001, u_zoom));

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < MAXL; i++) {
    if (i >= L) break;
    float f = fract(t + float(i) / float(L)); // staggered phase 0..1
    float scale = exp(f * lz);
    vec2 q = rot(f * u_twist) * (uv * scale);
    vec3 c;
    float m = motif(q, c);
    float w = sin(f * PI); // 0 at wrap, 1 mid — hides the seam
    acc += c * m * w;
    wsum += w;
  }
  vec3 col = acc / max(wsum, 0.001);
  col *= 1.0 - 0.35 * dot(uv, uv); // gentle vignette
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
for (const name of ['u_res', 'u_time', 'u_zoom', 'u_layers', 'u_twist', 'u_sectors', 'u_detail', 'u_hue'])
  u[name] = gl.getUniformLocation(program, name)

// Accumulate the (speed-scaled) zoom phase so speed can change smoothly without
// jumping the zoom.
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
  gl.uniform1f(u.u_zoom, params.zoom)
  gl.uniform1f(u.u_layers, params.layers)
  gl.uniform1f(u.u_twist, params.twist)
  gl.uniform1f(u.u_sectors, params.sectors)
  gl.uniform1f(u.u_detail, params.detail)
  gl.uniform1f(u.u_hue, params.hue)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
