/**
 * Fractal Cube — a Menger sponge, ray-marched with a distance estimator.
 * A cube loses its centre and face-centres, and every remaining sub-cube does the same,
 * level after level. The sponge is written as a kaleidoscopic IFS (fold into one octant,
 * sort the axes, rotate, scale about a corner), so extra knobs grow variants of it: twist
 * and tumble at every level, a fold scale other than 3, a stretched fold offset, smaller
 * or rounded sub-cubes. An orbiting camera circles it, an orbit trap tints the surface
 * through an iq cosine palette, the distance field gives ambient occlusion, and rays
 * that graze the lattice build a soft halo.
 *
 * By default it never sits still: an auto zoom swings the camera from a wide view to a
 * close, long-lens dive into the holes and back, and a slow morph drifts the shape knobs
 * (twist, tumble, scale, stretch, cube size) around their set values. Both are rates
 * integrated with rt.phase, and both can be turned off.
 *
 * KIFS Menger after Knighty (Fragmentarium). Render mode works as in mandelbulb: the
 * temporal upscaler (_lib/gltaau.js) reprojects through the camera; a shape change made
 * by hand forces a fresh start, the morph's slow drift is blended in instead.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createTAAU } from '../_lib/gltaau.js'
import { probeCapability } from '../../src/lib/patch/capability.js'

// Ray-marching every pixel is too slow on anything but a fast discrete GPU, so lower
// tiers start in Temporal 0.5x (a saved scene or the control panel still overrides it).
const DEFAULT_RENDER = probeCapability().gpu === 'discrete' ? 'Native' : 'Temporal 0.5x'
const COLOR_MODES = ['Orbit trap', 'Level', 'Facing', 'Height']

const rt = createRuntime()
const params = rt.params({
  // shape
  depth: { value: 4, min: 1, max: 7, step: 1, label: 'Recursion depth' },
  scale: { value: 3, min: 2.2, max: 3.8, step: 0.01, label: 'Fold scale (3 = Menger)' },
  twist: { value: 0, min: -0.6, max: 0.6, step: 0.01, label: 'Twist per level' },
  tumble: { value: 0, min: -0.6, max: 0.6, step: 0.01, label: 'Tumble per level' },
  stretch: { value: 1, min: 0.5, max: 1.5, step: 0.01, label: 'Fold stretch' },
  cubeSize: { value: 1, min: 0.6, max: 1.2, step: 0.01, label: 'Sub-cube size' },
  round: { value: 0, min: 0, max: 0.5, step: 0.01, label: 'Rounded edges' },
  // automatic motion
  morph: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Auto morph amount' },
  morphSpeed: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Auto morph speed' },
  zoom: { value: 0.75, min: 0, max: 1, step: 0.01, label: 'Auto zoom amount' },
  zoomSpeed: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Auto zoom speed' },
  // camera
  spin: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'Orbit speed' },
  turn: { value: 0, min: -3.14, max: 3.14, step: 0.01, label: 'Camera turn' },
  tilt: { value: 0.45, min: -0.4, max: 1.3, step: 0.01, label: 'Camera tilt' },
  dist: { value: 4, min: 2.2, max: 7, step: 0.05, label: 'Camera distance' },
  lens: { value: 1.8, min: 0.8, max: 4, step: 0.05, label: 'Lens (focal length)' },
  // look
  colorMode: { value: 'Orbit trap', type: 'select', options: COLOR_MODES, label: 'Colour by' },
  hue: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Hue' },
  hueDrift: { value: 0.05, min: 0, max: 1, step: 0.01, label: 'Hue drift speed' },
  spread: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Palette spread' },
  sat: { value: 1, min: 0, max: 1.5, step: 0.01, label: 'Saturation' },
  shine: { value: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Specular shine' },
  ao: { value: 1, min: 0, max: 1, step: 0.01, label: 'Ambient occlusion' },
  glow: { value: 0.4, min: 0, max: 1.5, step: 0.05, label: 'Halo glow' },
  fog: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Depth fog' },
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

const FAR = 16
const NEAR_DIST = 2.1 // closest the auto zoom brings the camera (just outside the cube's corners)
const MAX_ZOOM = 6 // focal-length multiplier at the deepest point of the auto zoom

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_depth, u_scale, u_twist, u_tumble, u_stretch, u_size, u_round;
uniform float u_hue, u_spread, u_sat, u_shine, u_ao, u_glow, u_fog;
uniform int u_colorMode;
uniform vec3 u_ro, u_uu, u_vv, u_ww;   // camera (set from JS so the temporal pass can reproject it)
uniform float u_f;
uniform vec2 u_jitter;                 // sub-pixel offset of this frame's samples (0 when native)
layout(location = 0) out vec4 outColor;
layout(location = 1) out float outDepth; // ray distance, for the temporal pass (unused when native)

const float FAR = ${FAR.toFixed(1)};

vec3 palette(float x) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.0, 0.33, 0.67);
  vec3 col = a + b * cos(6.28318 * (c * x + d + u_hue));
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  return max(mix(vec3(l), col, u_sat), 0.0);
}

// KIFS Menger sponge. Each level folds space into the octant x >= y >= z >= 0, twists and
// tumbles it, and scales it about the (1, 1, stretch) corner; the z shift keeps the edge
// cubes. With scale 3, stretch 1, no rotation and full-size cubes this is the exact Menger
// construction. trap.x: closest folded approach to the origin; trap.y: the level it came from.
float de(vec3 p, out vec2 trap) {
  float s = 1.0;
  float k = u_scale - 1.0;
  vec3 off = vec3(1.0, 1.0, u_stretch) * k;
  float c1 = cos(u_twist), s1 = sin(u_twist);
  float c2 = cos(u_tumble), s2 = sin(u_tumble);
  mat2 twist = mat2(c1, -s1, s1, c1);
  mat2 tumble = mat2(c2, -s2, s2, c2);
  trap = vec2(1e10, 0.0);
  int N = int(u_depth);
  for (int i = 0; i < 8; i++) {
    if (i >= N) break;
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p.xy = twist * p.xy;
    p.yz = tumble * p.yz;
    float r = dot(p, p);
    if (r < trap.x) trap = vec2(r, float(i));
    p.xy = p.xy * u_scale - off.xy;
    p.z = p.z * u_scale;
    if (p.z > 0.5 * off.z) p.z -= off.z;
    s *= u_scale;
  }
  vec3 q = abs(p) - (u_size - u_round);
  return (length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - u_round) / s;
}

vec3 calcNormal(vec3 p, float eps) {
  vec2 e = vec2(eps, 0.0);
  vec2 tr;
  return normalize(vec3(
    de(p + e.xyy, tr) - de(p - e.xyy, tr),
    de(p + e.yxy, tr) - de(p - e.yxy, tr),
    de(p + e.yyx, tr) - de(p - e.yyx, tr)));
}

float calcAO(vec3 p, vec3 n, float reach) {
  float occ = 0.0, w = 1.0;
  vec2 tr;
  for (int i = 1; i <= 5; i++) {
    float h = reach * (0.3 + 0.9 * float(i));
    occ += (h - de(p + n * h, tr)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 3.5 * occ / (reach * 25.0), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * (gl_FragCoord.xy + u_jitter) - u_res) / u_res.y;
  vec3 ro = u_ro;
  vec3 rd = normalize(uv.x * u_uu + uv.y * u_vv + u_f * u_ww);
  float pix = 1.5 / (u_res.y * u_f); // world size of a pixel per unit of ray distance

  float t = 0.0, glow = 0.0;
  vec2 trap = vec2(0.0);
  bool hit = false;
  int steps = 0;
  for (int i = 0; i < 180; i++) {
    vec3 p = ro + rd * t;
    vec2 tr;
    float d = de(p, tr);
    glow += 0.015 / (1.0 + d * d * 120.0); // near-surface halo
    steps = i;
    if (d < pix * t + 0.00002) { hit = true; trap = tr; break; }
    t += d * 0.9;
    if (t > FAR) break;
  }

  vec3 bg = mix(vec3(0.015, 0.02, 0.035), vec3(0.05, 0.04, 0.07), 0.5 + 0.5 * uv.y);
  vec3 col = bg;
  if (hit) {
    vec3 p = ro + rd * t;
    float eps = max(pix * t, 0.00005);
    vec3 n = calcNormal(p, eps);
    float occ = calcAO(p, n, clamp(eps * 12.0, 0.006, 0.04)) * (1.0 - float(steps) / 240.0);
    float ao = mix(1.0, occ, u_ao);
    vec3 key = normalize(vec3(0.6, 0.8, 0.35));
    vec3 rim = normalize(vec3(-0.7, 0.2, -0.6));
    float dif = clamp(dot(n, key), 0.0, 1.0);
    float back = clamp(dot(n, rim), 0.0, 1.0);
    float amb = 0.5 + 0.5 * n.y;
    float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    float spe = pow(clamp(dot(reflect(rd, n), key), 0.0, 1.0), 24.0);
    float idx;
    if (u_colorMode == 1) idx = trap.y / max(u_depth, 1.0) + 0.15 * sqrt(trap.x);
    else if (u_colorMode == 2) idx = dot(abs(n), vec3(0.0, 0.33, 0.66));
    else if (u_colorMode == 3) idx = 0.5 + 0.35 * p.y;
    else idx = sqrt(trap.x) * 0.6;
    vec3 base = palette(u_spread * idx + 0.1);
    col = base * (0.3 * amb * ao + 0.9 * dif * (0.4 + 0.6 * ao) + 0.25 * back * ao)
        + spe * u_shine * ao + fre * palette(0.5) * 0.25 * ao;
    float fogK = u_fog * 0.02;
    col = mix(col, bg, 1.0 - exp(-fogK * t * t)); // depth fog
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

const U = {}
for (const n of ['u_res', 'u_depth', 'u_scale', 'u_twist', 'u_tumble', 'u_stretch', 'u_size', 'u_round',
  'u_hue', 'u_spread', 'u_sat', 'u_shine', 'u_ao', 'u_glow', 'u_fog', 'u_colorMode',
  'u_ro', 'u_uu', 'u_vv', 'u_ww', 'u_f', 'u_jitter']) U[n] = gl.getUniformLocation(program, n)

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const smooth = (x) => 0.5 - 0.5 * Math.cos(x) // 0..1, eases at both ends

// The shape actually drawn: the set values plus the auto morph's slow drift. Each knob
// drifts on its own incommensurate sine, so the combination rarely repeats.
function shapeNow() {
  const ph = rt.phase('morph', params.morphSpeed)
  const m = params.morph
  return {
    depth: Math.round(params.depth),
    scale: clamp(params.scale + m * 0.22 * Math.sin(ph * 0.37 + 2.1), 2.2, 3.8),
    twist: params.twist + m * 0.35 * Math.sin(ph),
    tumble: params.tumble + m * 0.25 * Math.sin(ph * 0.61 + 1.3),
    stretch: params.stretch + m * 0.25 * Math.sin(ph * 0.83 + 0.4),
    size: params.cubeSize - m * 0.12 * smooth(ph * 0.29),
    round: params.round,
  }
}

// Orbiting camera: position, basis, focal length (the temporal pass reprojects through it).
// The auto zoom pulls it in to just outside the cube and lengthens the lens, then back out.
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function cameraAt() {
  const yaw = rt.phase('spin', params.spin) + params.turn // spin is modulated: integrate it
  const pitch = params.tilt
  const z = params.zoom * smooth(rt.phase('zoom', params.zoomSpeed))
  const d = params.dist + (Math.min(NEAR_DIST, params.dist) - params.dist) * z
  const f = params.lens * (1 + (MAX_ZOOM - 1) * z * z)
  const ro = [Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d]
  const ww = norm([-ro[0], -ro[1], -ro[2]])
  const uu = norm(cross(ww, [0, 1, 0]))
  return { ro, uu, vv: cross(uu, ww), ww, f }
}

let taau = null // lazily created, null when the GPU can't render to float targets
let taauTried = false
// Hand-set shape params reset the temporal history; the morph's drift and the look are blended in.
const shapeKey = () => [params.depth, params.scale, params.twist, params.tumble, params.stretch, params.cubeSize, params.round].join('|')
const looseKey = (s) => [s.scale, s.twist, s.tumble, s.stretch, s.size, params.hue, params.spread, params.sat,
  params.shine, params.ao, params.glow, params.fog, params.colorMode].join('|')
let lastShape = shapeKey()
let lastLoose = ''

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
  const shape = shapeNow()
  const hue = (params.hue + rt.phase('hue', params.hueDrift * 0.05)) % 1
  const scale = RENDER_SCALE[params.render]
  if (scale && !taauTried) { taauTried = true; taau = createTAAU(gl); if (taau) resize() }
  gl.useProgram(program)
  gl.uniform1f(U.u_depth, shape.depth)
  gl.uniform1f(U.u_scale, shape.scale)
  gl.uniform1f(U.u_twist, shape.twist)
  gl.uniform1f(U.u_tumble, shape.tumble)
  gl.uniform1f(U.u_stretch, shape.stretch)
  gl.uniform1f(U.u_size, shape.size)
  gl.uniform1f(U.u_round, Math.min(shape.round, shape.size * 0.9))
  gl.uniform1f(U.u_hue, hue)
  gl.uniform1f(U.u_spread, params.spread)
  gl.uniform1f(U.u_sat, params.sat)
  gl.uniform1f(U.u_shine, params.shine)
  gl.uniform1f(U.u_ao, params.ao)
  gl.uniform1f(U.u_glow, params.glow)
  gl.uniform1f(U.u_fog, params.fog)
  gl.uniform1i(U.u_colorMode, Math.max(0, COLOR_MODES.indexOf(params.colorMode)))
  gl.uniform3fv(U.u_ro, cam.ro); gl.uniform3fv(U.u_uu, cam.uu); gl.uniform3fv(U.u_vv, cam.vv); gl.uniform3fv(U.u_ww, cam.ww)
  gl.uniform1f(U.u_f, cam.f)
  if (taau && scale) {
    taau.resize(canvas.width, canvas.height, scale)
    const key = shapeKey(), loose = looseKey(shape)
    const drifting = loose !== lastLoose
    if (key !== lastShape) taau.reset()
    lastShape = key; lastLoose = loose
    const { size, jitter } = taau.begin()
    gl.uniform2f(U.u_res, size[0], size[1])
    gl.uniform2f(U.u_jitter, jitter[0], jitter[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    taau.end(cam, { alpha: drifting ? 0.5 : 0.15 })
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(U.u_res, canvas.width, canvas.height)
    gl.uniform2f(U.u_jitter, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
