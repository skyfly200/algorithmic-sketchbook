/**
 * Neon fluid: thousands of luminous particles swept along a divergence-free
 * curl-noise flow field, leaving glowing trails on a dark ground. Curl of a
 * scrolling fractal potential gives an incompressible, fluid-like velocity
 * field (it swirls instead of piling up); additive blending plus a bloom pass
 * make the streaks read as neon. Drag to stir the fluid; beats pulse the flow.
 *
 * Everything runs on the GPU (sketches/_lib/glpipe.js): particle positions live
 * in a texture (one texel per particle, 16-bit fixed point so it works with or
 * without float targets) that a shader pass advances through the curl field;
 * the particles are then splatted as additive points into a persistent trail
 * texture (float when available, so the fade reaches true black), and the
 * display adds a separable Gaussian bloom of the trails, never fed back.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const params = rt.params({
  flow: { value: 1.0, min: 0.2, max: 3, step: 0.05, label: 'Flow speed' },
  swirl: { value: 1.0, min: 0.3, max: 2.5, step: 0.05, label: 'Swirl' },
  scale: { value: 1.0, min: 0.4, max: 2.5, step: 0.05, label: 'Field scale' },
  density: { value: 0.7, min: 0.15, max: 1, step: 0.05, label: 'Particles' },
  fade: { value: 0.09, min: 0.02, max: 0.3, step: 0.01, label: 'Trail length' },
  glow: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Bloom' },
  hue: { value: 185, min: 0, max: 360, step: 1, label: 'Base hue' },
  hueSpread: { value: 170, min: 0, max: 260, step: 1, label: 'Hue spread' },
})
rt.mapInput('audio.volume', 'flow', 0.6)
rt.mapInput('audio.pulse', 'swirl', 0.5)

const canvas = document.getElementById('canvas')
const pipe = createGLPipe({ rt, src: null, canvas })
const gl = pipe.gl
const seedOff = rt.rng() * 100
const seedPos = rt.rng() * 100
const seedHue = rt.rng() * 100

// --- shaders -------------------------------------------------------------------
// Particle state: texel k = particle k, x in RG and y in BA as 16-bit fractions of
// the canvas size (y down, like the old canvas coordinates).
const PACK16 = `
float unpack16(vec2 c) { return (floor(c.x * 255.0 + 0.5) * 256.0 + floor(c.y * 255.0 + 0.5)) / 65536.0; }
vec2 pack16(float t) { float n = floor(clamp(t, 0.0, 0.99999) * 65536.0); float hi = floor(n / 256.0); return vec2(hi, n - hi * 256.0) / 255.0; }
vec2 decPos(vec4 c) { return vec2(unpack16(c.rg), unpack16(c.ba)); }
vec4 encPos(vec2 p) { return vec4(pack16(p.x), pack16(p.y)); }
float hash1(float n, float s) { return fract(sin(n * 0.1031 + s) * 43758.5453); }
`
const STATE_W = 256
const pSeed = pipe.program(`#version 300 es
precision highp float;
uniform float u_seed;
out vec4 o;
${PACK16}
void main() {
  float k = floor(gl_FragCoord.y) * ${STATE_W}.0 + floor(gl_FragCoord.x);
  o = encPos(vec2(hash1(k, u_seed), hash1(k + 7919.0, u_seed * 1.37 + 3.1)));
}`)
// Curl of a scrolling 4-octave value-noise potential → divergence-free velocity,
// normalised to a constant speed; plus the pointer stir; wrap at the edges.
const pStep = pipe.program(`#version 300 es
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_size;      // canvas px
uniform float u_sc, u_spd, u_curl, u_scroll, u_seed;
uniform vec4 u_mouse;     // x, y (px), vx, vy (px / frame)
uniform float u_stir, u_stirR;
out vec4 o;
${PACK16}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5, f = 1.0, n = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p * f); n += a; a *= 0.5; f *= 2.0; }
  return s / n;
}
void main() {
  vec2 x = decPos(texelFetch(u_state, ivec2(gl_FragCoord.xy), 0)) * u_size;
  vec2 p = vec2(x.x * u_sc, x.y * u_sc + u_scroll);
  const float e = 1.2;
  vec2 v = vec2(fbm(p + vec2(0, e)) - fbm(p - vec2(0, e)), -(fbm(p + vec2(e, 0)) - fbm(p - vec2(e, 0)))) * u_curl;
  v *= u_spd / (length(v) + 1e-4);
  if (u_stir > 0.5) {
    float d = length(x - u_mouse.xy);
    if (d < u_stirR) v += u_mouse.zw * (1.0 - d / u_stirR) * 1.6;
  }
  o = encPos(fract((x + v) / u_size));
}`)
const pFade = pipe.program(`#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_trail;
uniform float u_keep;
out vec4 o;
void main() { o = vec4(min(texture(u_trail, v_uv).rgb, 1.0) * u_keep, 1.0); }`)
// Bloom: half-resolution separable Gaussian with sigma = 3.5 px x pixelRatio
// (what the old canvas blur(3.5px) did), on the clamped trails.
const pBlur = pipe.program(`#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_in;
uniform vec2 u_dir;    // one texel of the input along the blur axis (uv)
uniform float u_sigma; // in output texels
out vec4 o;
void main() {
  vec3 s = vec3(0.0); float ws = 0.0;
  int r = min(24, int(ceil(u_sigma * 3.0)));
  for (int k = -r; k <= r; k++) {
    float w = exp(-0.5 * float(k * k) / (u_sigma * u_sigma));
    s += min(texture(u_in, v_uv + u_dir * float(k)).rgb, 1.0) * w; ws += w;
  }
  o = vec4(s / ws, 1.0);
}`)
const pShow = pipe.program(`#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_trail, u_glow;
uniform float u_amt;
out vec4 o;
void main() {
  vec3 c = vec3(4.0, 4.0, 10.0) / 255.0 + min(texture(u_trail, v_uv).rgb, 1.0);
  c = min(c, 1.0) + texture(u_glow, v_uv).rgb * u_amt;
  o = vec4(min(c, 1.0), 1.0);
}`)

// Particle splat: one point per particle, read from the state texture by vertex id.
// Each covers the canvas pixels a PR x PR square at its sub-pixel position would
// (like the old antialiased fillRect), in hsl(hue + spread·k + 40·speed, 100%,
// 52 + 24·speed %). Speed comes from the old and new positions.
function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
const ptProg = gl.createProgram()
gl.attachShader(ptProg, compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform sampler2D u_prev, u_next;
uniform vec2 u_size;
uniform float u_pr, u_spd, u_hue, u_spread, u_seed;
out vec3 v_col; out vec2 v_pos;
${PACK16}
vec3 hsl(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
void main() {
  ivec2 t = ivec2(gl_VertexID % ${STATE_W}, gl_VertexID / ${STATE_W});
  vec2 x = decPos(texelFetch(u_next, t, 0)) * u_size;
  vec2 d = x - decPos(texelFetch(u_prev, t, 0)) * u_size;
  d -= u_size * floor(d / u_size + 0.5); // across a wrap
  float speed = length(d) / u_spd;
  float h = mod(u_hue + hash1(float(gl_VertexID), u_seed) * u_spread + speed * 40.0, 360.0);
  v_col = hsl(h, 1.0, min(1.0, (52.0 + speed * 24.0) / 100.0));
  v_pos = x;
  float sz = ceil(u_pr) + 1.0; // enough pixels for any sub-pixel offset
  gl_PointSize = sz;
  vec2 c = floor(x) + sz * 0.5;
  gl_Position = vec4(c.x / u_size.x * 2.0 - 1.0, 1.0 - c.y / u_size.y * 2.0, 0.0, 1.0);
}`))
gl.attachShader(ptProg, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec3 v_col; in vec2 v_pos;
uniform vec2 u_size;
uniform float u_pr;
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) - 0.5; // this pixel's top-left, canvas coords
  vec2 ov = max(vec2(0.0), min(px + 1.0, v_pos + u_pr) - max(px, v_pos));
  float cov = ov.x * ov.y;
  if (cov <= 0.0) discard;
  o = vec4(v_col * cov, 1.0);
}`))
gl.linkProgram(ptProg)
if (!gl.getProgramParameter(ptProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(ptProg))
const ptLoc = {}
const ptU = (n) => (n in ptLoc ? ptLoc[n] : (ptLoc[n] = gl.getUniformLocation(ptProg, n)))
const ptVao = gl.createVertexArray()

// --- state -----------------------------------------------------------------------
const MAX_N = Math.floor(5200 * (0.5 + rt.detail)) // particles at density 1
const STATE_H = Math.ceil(MAX_N / STATE_W)
let state = [0, 1].map(() => pipe.target({ width: STATE_W, height: STATE_H, filter: 'NEAREST' }))
let trail = []
let glowA = null, glowB = null
let W = 0, H = 0, PR = 1

function resize() {
  PR = rt.pixelRatio
  W = pipe.width
  H = pipe.height
  ;[...trail, glowA, glowB].forEach((t) => pipe.release(t))
  trail = [0, 1].map(() => pipe.target({ width: W, height: H, float: true }))
  glowA = pipe.target({ width: Math.ceil(W / 2), height: Math.ceil(H / 2), float: true })
  glowB = pipe.target({ width: Math.ceil(W / 2), height: Math.ceil(H / 2), float: true })
  // fresh particles, like the old resize (positions are fractions, so any size works)
  pipe.run(pSeed, {}, state[0], (u) => u.f('u_seed', seedPos + rt.random(0, 10)))
}

// --- pointer stirring -------------------------------------------------------
const mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, active: false }
function setMouse(e) {
  const nx = e.clientX * PR
  const ny = e.clientY * PR
  mouse.vx = nx - mouse.x
  mouse.vy = ny - mouse.y
  mouse.x = nx
  mouse.y = ny
  mouse.active = true
}
canvas.addEventListener('pointerdown', (e) => {
  mouse.down = true
  setMouse(e)
})
window.addEventListener('pointermove', setMouse)
window.addEventListener('pointerup', () => (mouse.down = false))

let tScroll = 0
function frame(now) {
  rt.tick(now)
  // particle count follows the density (and detail) the way the old allocator did
  const N = Math.min(MAX_N, Math.floor((5200 * params.density) * (0.5 + rt.detail)))

  tScroll += 0.0016 * params.flow
  const sc = (0.0022 / PR) * params.scale // spatial frequency of the field
  const spd = 2.4 * PR * params.flow
  const mvx = mouse.vx
  const mvy = mouse.vy
  const stir = mouse.down || (mouse.active && (Math.abs(mvx) + Math.abs(mvy)) > 0.5)
  mouse.vx *= 0.8
  mouse.vy *= 0.8

  // advance the particles: state[0] → state[1]
  pipe.run(pStep, { u_state: state[0] }, state[1], (u) => {
    u.v2('u_size', W, H)
    u.f('u_sc', sc)
    u.f('u_spd', spd)
    u.f('u_curl', params.swirl)
    u.f('u_scroll', tScroll)
    u.f('u_seed', seedOff)
    u.v4('u_mouse', mouse.x, mouse.y, mvx, mvy)
    u.f('u_stir', stir ? 1 : 0)
    u.f('u_stirR', 150 * PR)
  })

  // fade the trail buffer toward black (this is the trail length), then add the particles
  pipe.run(pFade, { u_trail: trail[0] }, trail[1], (u) => u.f('u_keep', 1 - params.fade))
  trail = [trail[1], trail[0]]
  const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING)
  gl.useProgram(ptProg)
  gl.bindFramebuffer(gl.FRAMEBUFFER, trail[0].fbo)
  gl.viewport(0, 0, W, H)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, state[0].tex)
  gl.uniform1i(ptU('u_prev'), 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, state[1].tex)
  gl.uniform1i(ptU('u_next'), 1)
  gl.uniform2f(ptU('u_size'), W, H)
  gl.uniform1f(ptU('u_pr'), PR)
  gl.uniform1f(ptU('u_spd'), spd)
  gl.uniform1f(ptU('u_hue'), params.hue)
  gl.uniform1f(ptU('u_spread'), params.hueSpread)
  gl.uniform1f(ptU('u_seed'), seedHue)
  gl.bindVertexArray(ptVao)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.drawArrays(gl.POINTS, 0, N)
  gl.disable(gl.BLEND)
  gl.bindVertexArray(vao)
  state = [state[1], state[0]]

  // display: dark ground + trails + bloom (blurred trails, display only)
  const glow = params.glow > 0.02
  if (glow) {
    const sigma = 1.75 * PR // 3.5 px x PR at half resolution
    pipe.run(pBlur, { u_in: trail[0] }, glowA, (u) => { u.v2('u_dir', 2 / W, 0); u.f('u_sigma', sigma) })
    pipe.run(pBlur, { u_in: glowA }, glowB, (u) => { u.v2('u_dir', 0, 1 / glowA.h); u.f('u_sigma', sigma) })
  }
  pipe.run(pShow, { u_trail: trail[0], u_glow: glowB }, null, (u) => u.f('u_amt', glow ? params.glow : 0))
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
