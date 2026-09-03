/**
 * Mandelbulb — the canonical 3D fractal, ray-marched with a distance estimator.
 * Space is folded by the polar power map z → z^n + c; the surface where it stops
 * escaping is a bulbous, coral-like solid crawling with self-similar detail. An
 * orbiting camera circles it, an orbit trap tints the shell through an iq cosine
 * palette, and rays that graze the surface accumulate a soft halo.
 *
 * DE after Daniel White / Paul Nylander (the "power 8" Mandelbulb).
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  power: { value: 8, min: 2, max: 12, step: 0.1, label: 'Power (bulb order)' },
  detail: { value: 9, min: 4, max: 16, step: 1, label: 'Fractal detail (iterations)' },
  spin: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Orbit speed' },
  dist: { value: 2.6, min: 1.8, max: 4, step: 0.05, label: 'Camera distance' },
  hue: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hue' },
  glow: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Halo glow' },
})
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
uniform float u_time, u_power, u_iters, u_spin, u_dist, u_hue, u_glow;
out vec4 outColor;

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
  vec2 uv = (2.0 * gl_FragCoord.xy - u_res) / u_res.y;
  float ct = u_time * u_spin;
  vec3 ro = vec3(sin(ct), 0.3, cos(ct)) * u_dist;
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.7 * ww);

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
const uRes = U('u_res'), uTime = U('u_time'), uPower = U('u_power'), uIters = U('u_iters'),
  uSpin = U('u_spin'), uDist = U('u_dist'), uHue = U('u_hue'), uGlow = U('u_glow')

function resize() {
  // Ray marching is heavy — cap the internal resolution so it stays smooth on
  // dense fractals (rt.detail already reflects the viewer's quality setting).
  const scale = Math.min(rt.pixelRatio, 1.5) * (0.7 + 0.3 * rt.detail)
  canvas.width = Math.floor(window.innerWidth * scale)
  canvas.height = Math.floor(window.innerHeight * scale)
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(uRes, canvas.width, canvas.height)
  gl.uniform1f(uTime, now * 0.001)
  gl.uniform1f(uPower, params.power)
  gl.uniform1f(uIters, params.detail)
  gl.uniform1f(uSpin, params.spin)
  gl.uniform1f(uDist, params.dist)
  gl.uniform1f(uHue, params.hue)
  gl.uniform1f(uGlow, params.glow)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
