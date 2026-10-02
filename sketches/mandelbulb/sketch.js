/**
 * Mandelbulb — the canonical 3D fractal, ray-marched with a distance estimator.
 * Space is folded by the polar power map z → z^n + c; the surface where it stops
 * escaping is a bulbous, coral-like solid crawling with self-similar detail. An
 * orbiting camera circles it, an orbit trap tints the shell through an iq cosine
 * palette, and rays that graze the surface accumulate a soft halo.
 *
 * DE after Daniel White / Paul Nylander (the "power 8" Mandelbulb).
 *
 * Render mode: "Native" ray-marches every pixel. The "Temporal" modes (a prototype of FSR2-style
 * temporal upscaling, see _lib/gltaau.js) march a fraction of the pixels each frame with a
 * sub-pixel jitter and rebuild the full picture from the reprojected history. The fractal is
 * static and the camera orbit is known exactly, so the reprojection is exact; changing a shape
 * parameter forces a fresh start.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createTAAU } from '../_lib/gltaau.js'
import { probeCapability } from '../../src/lib/patch/capability.js'

// Ray-marching every pixel is too slow on anything but a fast discrete GPU, so lower
// tiers start in Temporal 0.5x (a saved scene or the control panel still overrides it).
const DEFAULT_RENDER = probeCapability().gpu === 'discrete' ? 'Native' : 'Temporal 0.5x'

const rt = createRuntime()
const params = rt.params({
  power: { value: 8, min: 2, max: 12, step: 0.1, label: 'Power (bulb order)' },
  detail: { value: 9, min: 4, max: 16, step: 1, label: 'Fractal detail (iterations)' },
  spin: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Orbit speed' },
  dist: { value: 2.6, min: 1.8, max: 4, step: 0.05, label: 'Camera distance' },
  hue: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hue' },
  glow: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Halo glow' },
  render: { value: DEFAULT_RENDER, type: 'select', options: ['Native', 'Temporal 0.75x', 'Temporal 0.5x', 'Temporal 0.33x'], label: 'Render mode' },
})
const RENDER_SCALE = { 'Temporal 0.75x': 0.75, 'Temporal 0.5x': 0.5, 'Temporal 0.33x': 1 / 3 }
// Music: loudness nudges the orbit, beats flare the halo.
rt.mapInput('audio.volume', 'spin', 0.4)
rt.mapInput('audio.pulse', 'glow', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_power, u_iters, u_hue, u_glow;
uniform vec3 u_ro, u_uu, u_vv, u_ww;   // camera (set from JS so the temporal pass can reproject it)
uniform float u_f;
uniform vec2 u_jitter;                 // sub-pixel offset of this frame's samples (0 when native)
layout(location = 0) out vec4 outColor;
layout(location = 1) out float outDepth; // ray distance, for the temporal pass (unused when native)

vec3 palette(float t) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d + u_hue));
}

// Mandelbulb distance estimator; also returns an orbit trap (closest approach).
float de(vec3 pos, out float trap) {
  vec3 z = pos;
  float dr = 1.0, r = 0.0;
  trap = 1e10;
  int N = int(u_iters);
  for (int i = 0; i < 16; i++) {
    if (i >= N) break;
    r = length(z);
    if (r > 2.0) break;
    float theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0));
    float phi = atan(z.y, z.x);
    dr = pow(r, u_power - 1.0) * u_power * dr + 1.0;
    float zr = pow(r, u_power);
    theta *= u_power; phi *= u_power;
    z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + pos;
    trap = min(trap, r);
  }
  return 0.5 * log(max(r, 1e-6)) * r / dr;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0006, 0.0);
  float t;
  return normalize(vec3(
    de(p + e.xyy, t) - de(p - e.xyy, t),
    de(p + e.yxy, t) - de(p - e.yxy, t),
    de(p + e.yyx, t) - de(p - e.yyx, t)));
}

void main() {
  vec2 uv = (2.0 * (gl_FragCoord.xy + u_jitter) - u_res) / u_res.y;
  vec3 ro = u_ro;
  vec3 rd = normalize(uv.x * u_uu + uv.y * u_vv + u_f * u_ww);

  float t = 0.0, trap = 0.0, glow = 0.0;
  bool hit = false;
  for (int i = 0; i < 150; i++) {
    vec3 p = ro + rd * t;
    float tr;
    float d = de(p, tr);
    glow += 0.02 / (1.0 + d * d * 90.0); // near-surface halo
    if (d < 0.0004 * t + 0.00015) { hit = true; trap = tr; break; }
    t += d * 0.85;
    if (t > 6.0) break;
  }

  vec3 bg = vec3(0.02, 0.03, 0.05);
  vec3 col = bg;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 lig = normalize(vec3(0.7, 0.8, 0.4));
    float dif = clamp(dot(n, lig), 0.0, 1.0);
    float amb = 0.4 + 0.6 * n.y;
    float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    vec3 base = palette(trap * 1.2 + 0.1);
    col = base * (0.25 * amb + dif) + fre * vec3(0.6, 0.7, 1.0) * 0.5;
    col = mix(col, bg, 1.0 - exp(-0.12 * t * t)); // depth fog
  }
  col += palette(0.6) * glow * u_glow * 0.6;      // coloured halo
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));  // gamma
  outColor = vec4(col, 1.0);
  outDepth = hit ? t : 6.0;
}`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program); gl.useProgram(program)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const U = (n) => gl.getUniformLocation(program, n)
const uRes = U('u_res'), uPower = U('u_power'), uIters = U('u_iters'), uHue = U('u_hue'), uGlow = U('u_glow'),
  uRo = U('u_ro'), uUu = U('u_uu'), uVv = U('u_vv'), uWw = U('u_ww'), uF = U('u_f'), uJitter = U('u_jitter')

// The orbiting camera (the same one the shader used to build from time): position, basis, focal length.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function cameraAt(t) {
  const ct = t * params.spin
  const ro = [Math.sin(ct) * params.dist, 0.3 * params.dist, Math.cos(ct) * params.dist]
  const ww = norm([-ro[0], -ro[1], -ro[2]])
  const uu = norm(cross(ww, [0, 1, 0]))
  return { ro, uu, vv: cross(uu, ww), ww, f: 1.7 }
}

let taau = null // lazily created, null when the GPU can't render to float targets
let taauTried = false
const contentKey = () => [params.power, params.detail, params.hue, params.glow]
let lastKey = contentKey()

function resize() {
  // Ray marching is heavy — cap the internal resolution so it stays smooth on
  // dense fractals (rt.detail already reflects the viewer's quality setting).
  const scale = Math.min(rt.pixelRatio, 1.5) * (0.7 + 0.3 * rt.detail)
  canvas.width = Math.floor(window.innerWidth * scale)
  canvas.height = Math.floor(window.innerHeight * scale)
  gl.viewport(0, 0, canvas.width, canvas.height)
  if (taau) taau.resize(canvas.width, canvas.height, RENDER_SCALE[params.render] ?? 1)
}

const taauOpts = new URLSearchParams(location.search) // ?alpha=0.15 &history=0 &kernel=3 (tuning / comparison)
function frame(now) {
  rt.tick(now)
  const cam = cameraAt(now * 0.001)
  const scale = RENDER_SCALE[params.render]
  if (scale && !taauTried) { taauTried = true; taau = createTAAU(gl); if (taau) resize() }
  gl.useProgram(program)
  gl.uniform1f(uPower, params.power)
  gl.uniform1f(uIters, params.detail)
  gl.uniform1f(uHue, params.hue)
  gl.uniform1f(uGlow, params.glow)
  gl.uniform3fv(uRo, cam.ro); gl.uniform3fv(uUu, cam.uu); gl.uniform3fv(uVv, cam.vv); gl.uniform3fv(uWw, cam.ww)
  gl.uniform1f(uF, cam.f)
  if (taau && scale) {
    taau.resize(canvas.width, canvas.height, scale)
    // a changed shape parameter invalidates the history (hue / glow drift is blended in instead)
    const key = contentKey()
    const shapeChanged = key[0] !== lastKey[0] || key[1] !== lastKey[1]
    const tintChanged = key[2] !== lastKey[2] || key[3] !== lastKey[3]
    lastKey = key
    if (shapeChanged) taau.reset()
    const { size, jitter } = taau.begin()
    gl.uniform2f(uRes, size[0], size[1])
    gl.uniform2f(uJitter, jitter[0], jitter[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    taau.end(cam, {
      alpha: tintChanged ? 0.6 : +(taauOpts.get('alpha') ?? 0.15),
      history: taauOpts.get('history') !== '0',
      kernel: +(taauOpts.get('kernel') ?? 6),
    })
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(uRes, canvas.width, canvas.height)
    gl.uniform2f(uJitter, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
