// Lava Lamp — buoyant wax blobs rise and sink in a warm glass column: a
// metaball field is threshold-rendered so blobs merge and split with gooey
// necks, heated at the base (they expand and rise) and cooled at the top
// (they flatten and sink). Click nudges a blob; beats warm the lamp.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const MAX_BLOBS = 16

const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`

// The whole lamp is one pass: glass gradient, base heat, the metaball field with an
// anti-aliased rim, and a halo taken from the same field.
const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_blobs[${MAX_BLOBS}];
uniform int u_n;
uniform float u_hue, u_bgHue, u_glow, u_warm, u_aspect;

vec3 hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * clamp(min(k - 3.0, 9.0 - k), -1.0, 1.0);
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y); // y down, like the old canvas
  // glass column
  vec3 c0 = hsl(u_bgHue / 360.0, 0.6, 0.08);
  vec3 c1 = hsl(u_bgHue / 360.0, 0.7, 0.16);
  vec3 c2 = hsl(mod(u_bgHue + 30.0, 360.0) / 360.0, 0.8, 0.10);
  vec3 col = p.y < 0.5 ? mix(c0, c1, p.y * 2.0) : mix(c1, c2, (p.y - 0.5) * 2.0);
  // base heat glow (a circle of radius 0.5 of the height around the bottom centre)
  vec2 q = vec2((p.x - 0.5) * u_aspect, 1.0 - p.y);
  float heat = clamp(1.0 - length(q) / 0.5, 0.0, 1.0);
  col = mix(col, hsl(u_hue / 360.0, 1.0, 0.55), heat * clamp(0.25 + u_warm, 0.0, 1.0));

  float f = 0.0;
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= u_n) break;
    vec2 d = p - u_blobs[i].xy;
    f += (u_blobs[i].z * u_blobs[i].z) / (dot(d, d) + 0.0004);
  }
  float lit = clamp((f - 1.3) * 0.25, 0.0, 1.0);
  vec3 wax = hsl(mod(u_hue + lit * 20.0, 360.0) / 360.0, 0.9, 0.36 + lit * 0.38);
  col += wax * clamp(f * 0.25, 0.0, 1.0) * u_glow * 0.35; // halo
  float cov = clamp((f - 1.05) * 3.0, 0.0, 1.0);
  col = mix(col, wax, cov);
  if (p.x > 0.2 && p.x < 0.28) col = mix(col, vec3(1.0), 0.04); // glass highlight
  outColor = vec4(col, 1.0);
}`

function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src); gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
}
const prog = gl.createProgram()
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
gl.bindAttribLocation(prog, 0, 'position')
gl.linkProgram(prog)
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
gl.useProgram(prog)
const vbo = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
const U = Object.fromEntries(['u_blobs', 'u_n', 'u_hue', 'u_bgHue', 'u_glow', 'u_warm', 'u_aspect'].map((n) => [n, gl.getUniformLocation(prog, n)]))
const blobData = new Float32Array(MAX_BLOBS * 3)

const params = rt.params({
  blobs: { value: 7, min: 3, max: MAX_BLOBS, step: 1, label: 'Blobs' },
  heat: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Heat' },
  viscosity: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Viscosity' },
  hue: { value: 20, min: 0, max: 360, step: 1, label: 'Wax hue' },
  bgHue: { value: 280, min: 0, max: 360, step: 1, label: 'Glass hue' },
  glow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Glow' },
})
rt.mapInput('audio.level', 'heat', 0.5)

let W = 0, H = 0
let blobs = []
function resize() {
  // render below full size on lower quality; the browser scales the canvas up
  const k = Math.max(0.4, rt.detail)
  W = canvas.width = Math.max(2, Math.floor(window.innerWidth * rt.pixelRatio * Math.min(1, 0.5 + 0.5 * k)))
  H = canvas.height = Math.max(2, Math.floor(window.innerHeight * rt.pixelRatio * Math.min(1, 0.5 + 0.5 * k)))
  gl.viewport(0, 0, W, H)
  init()
}
function init() {
  blobs = []
  const n = Math.round(params.blobs)
  for (let i = 0; i < n; i++) blobs.push({ x: rt.random(0.2, 0.8), y: rt.random(0.1, 0.9), r: rt.random(0.05, 0.11), vy: 0, vx: 0, temp: rt.random(0, 1) })
}
canvas.addEventListener('pointerdown', (e) => {
  const px = e.clientX / window.innerWidth, py = e.clientY / window.innerHeight
  for (const b of blobs) { const d = Math.hypot(b.x - px, b.y - py); if (d < 0.15) b.vy -= 0.4 }
})
let warm = 0
rt.onBeat(({ energy }) => { warm = 0.3 + energy * 0.4 })
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, t - last || 0.016)
  last = t
  if (Math.round(params.blobs) !== blobs.length) init()
  warm = Math.max(0, warm - dt)

  // physics: heat at base (y~1) warms blobs → they rise; cool at top
  for (const b of blobs) {
    const nearBase = Math.max(0, b.y - 0.6) / 0.4
    const nearTop = Math.max(0, 0.4 - b.y) / 0.4
    b.temp += (nearBase * (1.2 + warm) * params.heat - nearTop * 0.9 - 0.15) * dt
    b.temp = Math.max(0, Math.min(1.4, b.temp))
    // buoyancy: hot rises (negative y velocity)
    const buoy = (b.temp - 0.55) * -0.35 * params.heat
    b.vy += buoy * dt
    b.vy *= 1 - 0.9 * dt / params.viscosity
    b.vx += Math.sin(t * 0.5 + b.y * 6) * 0.02 * dt
    b.vx *= 1 - 1.2 * dt
    b.y += b.vy * dt
    b.x += b.vx * dt
    // soft walls
    if (b.y < 0.06) { b.y = 0.06; b.vy = Math.abs(b.vy) * 0.3 }
    if (b.y > 0.94) { b.y = 0.94; b.vy = -Math.abs(b.vy) * 0.3 }
    if (b.x < 0.08) { b.x = 0.08; b.vx = Math.abs(b.vx) * 0.5 }
    if (b.x > 0.92) { b.x = 0.92; b.vx = -Math.abs(b.vx) * 0.5 }
    // hot blobs swell
    b.rr = b.r * (0.85 + b.temp * 0.4)
  }

  const n = Math.min(MAX_BLOBS, blobs.length)
  for (let i = 0; i < n; i++) { blobData[i * 3] = blobs[i].x; blobData[i * 3 + 1] = blobs[i].y; blobData[i * 3 + 2] = blobs[i].rr }
  gl.uniform3fv(U.u_blobs, blobData)
  gl.uniform1i(U.u_n, n)
  gl.uniform1f(U.u_hue, params.hue)
  gl.uniform1f(U.u_bgHue, params.bgHue)
  gl.uniform1f(U.u_glow, params.glow)
  gl.uniform1f(U.u_warm, warm)
  gl.uniform1f(U.u_aspect, W / H)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
