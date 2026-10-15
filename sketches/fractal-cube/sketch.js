/**
 * Fractal Cube — a Menger sponge, ray-marched with a distance estimator.
 * A cube loses its centre and face-centres, and every remaining sub-cube does the same,
 * level after level. The sponge is written as a kaleidoscopic IFS (fold into one octant,
 * sort the axes, scale about a corner), so two extra knobs grow variants of it: a twist
 * applied at every level and a fold scale other than 3. An orbiting camera circles it,
 * an orbit trap tints the surface through an iq cosine palette, the distance field gives
 * ambient occlusion, and rays that graze the lattice build a soft halo.
 *
 * KIFS Menger after Knighty (Fragmentarium). Render mode works as in mandelbulb: the
 * fractal is static and only the camera moves, so the temporal upscaler (_lib/gltaau.js)
 * reprojects exactly; changing a shape parameter forces a fresh start.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createTAAU } from '../_lib/gltaau.js'
import { probeCapability } from '../../src/lib/patch/capability.js'

// Ray-marching every pixel is too slow on anything but a fast discrete GPU, so lower
// tiers start in Temporal 0.5x (a saved scene or the control panel still overrides it).
const DEFAULT_RENDER = probeCapability().gpu === 'discrete' ? 'Native' : 'Temporal 0.5x'

const rt = createRuntime()
const params = rt.params({
  depth: { value: 4, min: 1, max: 7, step: 1, label: 'Recursion depth' },
  scale: { value: 3, min: 2.2, max: 3.8, step: 0.01, label: 'Fold scale (3 = Menger)' },
  twist: { value: 0, min: -0.6, max: 0.6, step: 0.01, label: 'Twist per level' },
  spin: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Orbit speed' },
  turn: { value: 0, min: -3.14, max: 3.14, step: 0.01, label: 'Camera turn' },
  tilt: { value: 0.45, min: -0.4, max: 1.3, step: 0.01, label: 'Camera tilt' },
  dist: { value: 3.6, min: 2.2, max: 6, step: 0.05, label: 'Camera distance' },
  hue: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Hue' },
  spread: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Palette spread' },
  glow: { value: 0.4, min: 0, max: 1.5, step: 0.05, label: 'Halo glow' },
  render: { value: DEFAULT_RENDER, type: 'select', options: ['Native', 'Temporal 0.75x', 'Temporal 0.5x', 'Temporal 0.33x'], label: 'Render mode' },
})
const RENDER_SCALE = { 'Temporal 0.75x': 0.75, 'Temporal 0.5x': 0.5, 'Temporal 0.33x': 1 / 3 }
// The pointer steers the camera around its resting angle, both ways.
rt.mapInput('mouse.x', 'turn', 0.5, { center: true })
rt.mapInput('mouse.y', 'tilt', 0.5, { center: true })
// Music: loudness nudges the orbit, beats flare the halo.
rt.mapInput('audio.volume', 'spin', 0.4)
rt.mapInput('audio.pulse', 'glow', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const FAR = 12

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_depth, u_scale, u_twist, u_hue, u_spread, u_glow;
uniform vec3 u_ro, u_uu, u_vv, u_ww;   // camera (set from JS so the temporal pass can reproject it)
uniform float u_f;
uniform vec2 u_jitter;                 // sub-pixel offset of this frame's samples (0 when native)
layout(location = 0) out vec4 outColor;
layout(location = 1) out float outDepth; // ray distance, for the temporal pass (unused when native)

const float FAR = ${FAR.toFixed(1)};

vec3 palette(float x) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * x + d + u_hue));
}

// KIFS Menger sponge. Each level folds space into the octant x >= y >= z >= 0, twists it,
// and scales it about the (1,1,1) corner; the z shift keeps the edge cubes. With scale 3
// and no twist this is the exact Menger construction. trap: closest folded approach to
// the origin, for colour.
float de(vec3 p, out float trap) {
  float s = 1.0;
  float k = u_scale - 1.0;
  float cs = cos(u_twist), sn = sin(u_twist);
  mat2 rot = mat2(cs, -sn, sn, cs);
  trap = 1e10;
  int N = int(u_depth);
  for (int i = 0; i < 8; i++) {
    if (i >= N) break;
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p.xy = rot * p.xy;
    trap = min(trap, dot(p, p));
    p = p * u_scale - k;
    if (p.z < -0.5 * k) p.z += k;
    s *= u_scale;
  }
  vec3 q = abs(p) - 1.0;
  return (length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0)) / s;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0004, 0.0);
  float tr;
  return normalize(vec3(
    de(p + e.xyy, tr) - de(p - e.xyy, tr),
    de(p + e.yxy, tr) - de(p - e.yxy, tr),
    de(p + e.yyx, tr) - de(p - e.yyx, tr)));
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, w = 1.0, tr;
  for (int i = 1; i <= 5; i++) {
    float h = 0.012 + 0.035 * float(i);
    occ += (h - de(p + n * h, tr)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 3.5 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * (gl_FragCoord.xy + u_jitter) - u_res) / u_res.y;
  vec3 ro = u_ro;
  vec3 rd = normalize(uv.x * u_uu + uv.y * u_vv + u_f * u_ww);

  float t = 0.0, trap = 0.0, glow = 0.0;
  bool hit = false;
  int steps = 0;
  for (int i = 0; i < 160; i++) {
    vec3 p = ro + rd * t;
    float tr;
    float d = de(p, tr);
    glow += 0.015 / (1.0 + d * d * 120.0); // near-surface halo
    steps = i;
    if (d < 0.0003 * t + 0.0001) { hit = true; trap = tr; break; }
    t += d * 0.9;
    if (t > FAR) break;
  }

  vec3 bg = mix(vec3(0.015, 0.02, 0.035), vec3(0.05, 0.04, 0.07), 0.5 + 0.5 * uv.y);
  vec3 col = bg;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float ao = calcAO(p, n) * (1.0 - float(steps) / 200.0);
    vec3 key = normalize(vec3(0.6, 0.8, 0.35));
    vec3 rim = normalize(vec3(-0.7, 0.2, -0.6));
    float dif = clamp(dot(n, key), 0.0, 1.0);
    float back = clamp(dot(n, rim), 0.0, 1.0);
    float amb = 0.5 + 0.5 * n.y;
    float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    float spe = pow(clamp(dot(reflect(rd, n), key), 0.0, 1.0), 24.0);
    vec3 base = palette(u_spread * sqrt(trap) * 0.6 + 0.1);
    col = base * (0.3 * amb * ao + 0.9 * dif * (0.4 + 0.6 * ao) + 0.25 * back * ao)
        + spe * 0.35 * ao + fre * palette(0.5) * 0.25 * ao;
    col = mix(col, bg, 1.0 - exp(-0.006 * t * t)); // depth fog
  }
  col += palette(0.55) * glow * u_glow * 0.6;     // coloured halo
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));  // gamma
  outColor = vec4(col, 1.0);
  outDepth = hit ? t : FAR;
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
const uRes = U('u_res'), uDepth = U('u_depth'), uScale = U('u_scale'), uTwist = U('u_twist'),
  uHue = U('u_hue'), uSpread = U('u_spread'), uGlow = U('u_glow'),
  uRo = U('u_ro'), uUu = U('u_uu'), uVv = U('u_vv'), uWw = U('u_ww'), uF = U('u_f'), uJitter = U('u_jitter')

// Orbiting camera: position, basis, focal length (the temporal pass reprojects through it).
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function cameraAt() {
  const yaw = rt.phase('spin', params.spin) + params.turn // spin is modulated: integrate it
  const pitch = params.tilt
  const d = params.dist
  const ro = [Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d]
  const ww = norm([-ro[0], -ro[1], -ro[2]])
  const uu = norm(cross(ww, [0, 1, 0]))
  return { ro, uu, vv: cross(uu, ww), ww, f: 1.8 }
}

let taau = null // lazily created, null when the GPU can't render to float targets
let taauTried = false
const shapeKey = () => `${params.depth}|${params.scale}|${params.twist}`
const tintKey = () => `${params.hue}|${params.spread}|${params.glow}`
let lastShape = shapeKey()
let lastTint = tintKey()

function resize() {
  // Ray marching is heavy — cap the internal resolution (rt.detail reflects the viewer's quality setting).
  const scale = Math.min(rt.pixelRatio, 1.5) * (0.7 + 0.3 * rt.detail)
  canvas.width = Math.floor(window.innerWidth * scale)
  canvas.height = Math.floor(window.innerHeight * scale)
  gl.viewport(0, 0, canvas.width, canvas.height)
  if (taau) taau.resize(canvas.width, canvas.height, RENDER_SCALE[params.render] ?? 1)
}

function frame(now) {
  rt.tick(now)
  const cam = cameraAt()
  const scale = RENDER_SCALE[params.render]
  if (scale && !taauTried) { taauTried = true; taau = createTAAU(gl); if (taau) resize() }
  gl.useProgram(program)
  gl.uniform1f(uDepth, Math.round(params.depth))
  gl.uniform1f(uScale, params.scale)
  gl.uniform1f(uTwist, params.twist)
  gl.uniform1f(uHue, params.hue)
  gl.uniform1f(uSpread, params.spread)
  gl.uniform1f(uGlow, params.glow)
  gl.uniform3fv(uRo, cam.ro); gl.uniform3fv(uUu, cam.uu); gl.uniform3fv(uVv, cam.vv); gl.uniform3fv(uWw, cam.ww)
  gl.uniform1f(uF, cam.f)
  if (taau && scale) {
    taau.resize(canvas.width, canvas.height, scale)
    // a changed shape invalidates the history; tint drift is blended in instead
    const shape = shapeKey(), tint = tintKey()
    const tintChanged = tint !== lastTint
    if (shape !== lastShape) taau.reset()
    lastShape = shape; lastTint = tint
    const { size, jitter } = taau.begin()
    gl.uniform2f(uRes, size[0], size[1])
    gl.uniform2f(uJitter, jitter[0], jitter[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    taau.end(cam, { alpha: tintChanged ? 0.6 : 0.15 })
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
