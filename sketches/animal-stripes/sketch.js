/**
 * Animal Stripes — a generator of the striped coats you find in the wild:
 * zebra, tiger, white tiger, okapi, brindle, kudu. Real fur stripes are what
 * biologists model as anisotropic Turing patterns — bands of one pigment laid
 * down along the body, wavering and *forking* into Y-branches where they spread
 * apart. Here that's built procedurally: a directional stripe wave, domain-
 * warped for the organic waver and given phase dislocations for the forks, then
 * thresholded into two (or three, with a paler belly) coat tones with a little
 * fur grain over the top. A species preset sets the colours and character;
 * frequency, waver, forking, curve, width, crispness, orientation and flow are
 * live. Runs as a fragment shader; leave flow at 0 for still fur or drive it
 * with the music.
 */
import { createRuntime } from '../_lib/runtime.js'

const PRESETS = {
  Zebra: { coat: '#f3efe6', stripe: '#141109', belly: '#ece7db', freq: 0.85, warp: 1.15, fork: 0.85, curve: 1.1, width: 0.5 },
  Tiger: { coat: '#d67b2b', stripe: '#180f06', belly: '#efe4cf', freq: 1.0, warp: 0.8, fork: 0.6, curve: 0.7, width: 0.64 },
  'White tiger': { coat: '#eef1f4', stripe: '#14120f', belly: '#ffffff', freq: 1.0, warp: 0.8, fork: 0.6, curve: 0.7, width: 0.64 },
  Okapi: { coat: '#3c2416', stripe: '#e7dabc', belly: '#2e1b10', freq: 1.5, warp: 0.5, fork: 0.3, curve: 1.4, width: 0.74 },
  Brindle: { coat: '#9a6a37', stripe: '#241407', belly: '#7a5228', freq: 1.2, warp: 1.6, fork: 1.1, curve: 0.4, width: 0.6 },
  Kudu: { coat: '#8a7d6b', stripe: '#efe9dd', belly: '#6f6252', freq: 1.7, warp: 0.35, fork: 0.25, curve: 1.2, width: 0.8 },
}
const rt = createRuntime()
const params = rt.params({
  species: { value: 'Zebra', type: 'select', options: Object.keys(PRESETS), label: 'Species' },
  frequency: { value: 14, min: 3, max: 44, step: 0.5, label: 'Stripe frequency' },
  warp: { value: 1, min: 0, max: 2.2, step: 0.05, label: 'Waver' },
  forking: { value: 0.7, min: 0, max: 1.6, step: 0.05, label: 'Forking' },
  curve: { value: 0.4, min: -1.2, max: 1.2, step: 0.05, label: 'Curve' },
  width: { value: 0.5, min: 0.25, max: 0.78, step: 0.01, label: 'Stripe width' },
  crisp: { value: 0.06, min: 0.004, max: 0.32, step: 0.004, label: 'Softness' },
  orient: { value: 0, min: 0, max: 180, step: 1, label: 'Orientation' },
  flow: { value: 0, min: 0, max: 1, step: 0.02, label: 'Flow (morph)' },
  texture: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Fur grain' },
})
rt.mapInput('audio.level', 'flow', 0.6) // music can grow the coat
rt.mapInput('audio.pulse', 'warp', 0.3) // beats wobble the stripes

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_freq, u_warp, u_fork, u_curve, u_width, u_crisp, u_orient, u_flow, u_tex;
uniform vec3 u_coat, u_stripe, u_belly;
out vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec2 uvO = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float a = radians(u_orient);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 q = R * uvO;

  // curvature: bend the stripes into body-following arcs
  q.x += u_curve * (q.y * q.y - 0.3);

  // stripe phase: directional wave, domain-warped for the organic waver
  float wv1 = fbm(q * 2.5 + vec2(0.0, u_time * u_flow * 0.5));
  float ph = q.x * u_freq + (wv1 - 0.5) * u_warp * 5.0;
  // phase dislocations → the Y-forks where stripes split
  float disl = fbm(q * 1.7 + 20.0 + u_time * u_flow * 0.2);
  ph += 3.14159265 * u_fork * smoothstep(0.42, 0.58, disl);

  float wv = 0.5 + 0.5 * sin(ph);
  float e = u_crisp + fwidth(wv) * 1.2;
  float coat = smoothstep(u_width - e, u_width + e, wv); // 1 = coat, 0 = stripe

  // paler belly toward the bottom of the frame
  vec3 base = mix(u_belly, u_coat, smoothstep(-0.25, 0.7, uvO.y));
  vec3 col = mix(u_stripe, base, coat);

  // fur grain + a fine directional sheen
  float fur = 0.88 + 0.24 * fbm(q * 42.0);
  col *= mix(1.0, fur, u_tex);
  col *= 0.93 + 0.11 * fbm(q * vec2(3.0, 34.0));

  // soft vignette
  col *= 1.0 - 0.16 * dot(uvO, uvO);
  outColor = vec4(max(col, 0.0), 1.0);
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
for (const name of ['u_res', 'u_time', 'u_freq', 'u_warp', 'u_fork', 'u_curve', 'u_width', 'u_crisp', 'u_orient', 'u_flow', 'u_tex', 'u_coat', 'u_stripe', 'u_belly'])
  u[name] = gl.getUniformLocation(program, name)

function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  const p = PRESETS[params.species] ?? PRESETS.Zebra
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_freq, params.frequency * p.freq)
  gl.uniform1f(u.u_warp, params.warp * p.warp)
  gl.uniform1f(u.u_fork, params.forking * p.fork)
  gl.uniform1f(u.u_curve, params.curve * p.curve)
  gl.uniform1f(u.u_width, Math.max(0.12, Math.min(0.88, p.width + (params.width - 0.5))))
  gl.uniform1f(u.u_crisp, params.crisp)
  gl.uniform1f(u.u_orient, params.orient)
  gl.uniform1f(u.u_flow, params.flow)
  gl.uniform1f(u.u_tex, params.texture)
  gl.uniform3fv(u.u_coat, hexRgb(p.coat))
  gl.uniform3fv(u.u_stripe, hexRgb(p.stripe))
  gl.uniform3fv(u.u_belly, hexRgb(p.belly))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
