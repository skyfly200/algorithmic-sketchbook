/**
 * Fluid — a real-time incompressible fluid on a grid, after Jos Stam's "Stable
 * Fluids": semi-Lagrangian advection carries the velocity field and coloured dye
 * along the flow, a Jacobi pressure solve keeps it divergence-free (so it swirls
 * instead of piling up), and vorticity confinement feeds energy back into the
 * curl so the eddies stay lively. Drag to push the fluid and inject dye; it also
 * runs itself with drifting emitters.
 *
 * The whole solver runs on the GPU (sketches/_lib/glpipe.js): velocity, dye,
 * pressure, divergence and curl live in ping-pong float textures the size of the
 * grid, each step is a handful of tiny full-grid passes, and the dye is upscaled
 * to the screen with bilinear filtering. The walls follow Stam's set_bnd (the
 * normal velocity reflects, everything else copies the neighbour cell), applied
 * when a pass reads past the edge instead of in a separate border pass. Without
 * float render targets the state is packed into RGBA8 (16-bit fixed point for
 * velocity and pressure, dithered 8-bit dye).
 */
import { createRuntime } from '../_lib/runtime.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const params = rt.params({
  force: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Push force' },
  swirl: { value: 3, min: 0, max: 8, step: 0.1, label: 'Vorticity (swirl)' },
  fade: { value: 0.5, min: 0, max: 2, step: 0.02, label: 'Dye fade' },
  iters: { value: 14, min: 4, max: 40, step: 1, label: 'Solver quality' },
  emit: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'Auto emitters' },
  hue: { value: +rt.random(0, 1).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Palette' },
})
// Music: beats shove the fluid, loudness spins up the swirl.
rt.mapInput('audio.pulse', 'force', 0.7)
rt.mapInput('audio.volume', 'swirl', 0.5)

const canvas = document.getElementById('canvas')
const pipe = createGLPipe({ rt, src: null, canvas })
const PACK = !pipe.floatTargets

// --- shaders -------------------------------------------------------------------
// Grid cell (i, j) is texel (i, j); j grows downward like the screen. A read past
// the edge returns the wall value (Stam's set_bnd): scalars copy the nearest
// interior cell, velocity also flips its component normal to that wall.
const HEAD = `#version 300 es
precision highp float;
precision highp int;
${PACK ? '#define PACK' : ''}
in vec2 v_uv;
uniform vec2 u_res; // glpipe sets it to the target size: the grid, except in the display pass
out vec4 o;
#define VMAX 96.0
#define PMAX 16.0
#define DMAX 4.0
#define CMAX 256.0
float unpack16(vec2 c) { return (floor(c.x * 255.0 + 0.5) * 256.0 + floor(c.y * 255.0 + 0.5)) / 65535.0; }
vec2 pack16(float t) { float n = floor(clamp(t, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(n / 256.0); return vec2(hi, n - hi * 256.0) / 255.0; }
#ifdef PACK
vec2 decV(vec4 c) { return (vec2(unpack16(c.rg), unpack16(c.ba)) * 2.0 - 1.0) * VMAX; }
vec4 encV(vec2 v) { return vec4(pack16(v.x / VMAX * 0.5 + 0.5), pack16(v.y / VMAX * 0.5 + 0.5)); }
float decS(vec4 c, float m) { return (unpack16(c.rg) * 2.0 - 1.0) * m; }
vec4 encS(float s, float m) { return vec4(pack16(s / m * 0.5 + 0.5), 0.0, 1.0); }
#else
vec2 decV(vec4 c) { return c.xy; }
vec4 encV(vec2 v) { return vec4(v, 0.0, 1.0); }
float decS(vec4 c, float m) { return c.x; }
vec4 encS(float s, float m) { return vec4(s, 0.0, 0.0, 1.0); }
#endif
ivec2 cell() { return ivec2(gl_FragCoord.xy); }
vec2 velAt(sampler2D t, ivec2 ij) {
  ivec2 c = clamp(ij, ivec2(0), ivec2(u_res) - 1);
  vec2 v = decV(texelFetch(t, c, 0));
  if (ij.x != c.x) v.x = -v.x;
  if (ij.y != c.y) v.y = -v.y;
  return v;
}
float sAt(sampler2D t, ivec2 ij, float m) { return decS(texelFetch(t, clamp(ij, ivec2(0), ivec2(u_res) - 1), 0), m); }
`
// Add up to three splats (velocity and dye are separate passes). Weights follow the
// old CPU splat exactly: integer cell offsets from floor(splat centre), Gaussian
// falloff, cut at the radius. Splat centres are in 1-based grid coords.
const SPLAT_W = `
uniform vec4 u_sp[3];   // gx, gy, fx, fy
uniform vec4 u_sc[3];   // r, g, b, radius
uniform int u_n;
float splatW(int k, out vec4 sp, out vec4 sc) {
  sp = u_sp[k]; sc = u_sc[k];
  vec2 d = vec2(cell() + 1) - floor(sp.xy);
  float r2 = sc.w * sc.w, d2 = dot(d, d);
  return d2 > r2 ? 0.0 : exp(-d2 / (r2 * 0.4));
}`
const pSplatV = pipe.program(HEAD + SPLAT_W + `
uniform sampler2D u_vel;
void main() {
  vec2 v = velAt(u_vel, cell());
  for (int k = 0; k < 3; k++) { if (k >= u_n) break; vec4 sp, sc; float w = splatW(k, sp, sc); v += sp.zw * w; }
  o = encV(v);
}`)
const pSplatD = pipe.program(HEAD + SPLAT_W + `
uniform sampler2D u_dye;
void main() {
  vec3 d = texelFetch(u_dye, cell(), 0).rgb;
  for (int k = 0; k < 3; k++) { if (k >= u_n) break; vec4 sp, sc; float w = splatW(k, sp, sc); d += sc.rgb * w; }
  o = vec4(d, 1.0);
}`)
// Vorticity confinement: push velocity back toward the local curl so eddies don't
// dissipate (the classic trick for lively, turbulent-looking fluid).
const pCurl = pipe.program(HEAD + `
uniform sampler2D u_vel;
float curlAt(ivec2 c) { return (velAt(u_vel, c + ivec2(1, 0)).y - velAt(u_vel, c - ivec2(1, 0)).y - velAt(u_vel, c + ivec2(0, 1)).x + velAt(u_vel, c - ivec2(0, 1)).x) * 0.5; }
void main() { o = encS(abs(curlAt(cell())), CMAX); }`)
const pVort = pipe.program(HEAD + `
uniform sampler2D u_vel, u_curl;
uniform float u_k; // eps * dt
void main() {
  ivec2 c = cell(), n = ivec2(u_res);
  vec2 v = velAt(u_vel, c);
  if (c.x >= 1 && c.y >= 1 && c.x <= n.x - 2 && c.y <= n.y - 2) {
    vec2 g = vec2(sAt(u_curl, c + ivec2(1, 0), CMAX) - sAt(u_curl, c - ivec2(1, 0), CMAX),
                  sAt(u_curl, c + ivec2(0, 1), CMAX) - sAt(u_curl, c - ivec2(0, 1), CMAX)) * 0.5;
    g /= length(g) + 1e-5;
    float w = (velAt(u_vel, c + ivec2(1, 0)).y - velAt(u_vel, c - ivec2(1, 0)).y - velAt(u_vel, c + ivec2(0, 1)).x + velAt(u_vel, c - ivec2(0, 1)).x) * 0.5;
    v += u_k * vec2(g.y * w * float(n.x), -g.x * w * float(n.y));
  }
  o = encV(v);
}`)
// Projection: divergence, Jacobi pressure iterations, subtract the gradient.
const pDiv = pipe.program(HEAD + `
uniform sampler2D u_vel;
void main() {
  ivec2 c = cell(), n = ivec2(u_res);
  float h = 1.0 / float(max(n.x, n.y));
  o = encS(-0.5 * h * (velAt(u_vel, c + ivec2(1, 0)).x - velAt(u_vel, c - ivec2(1, 0)).x + velAt(u_vel, c + ivec2(0, 1)).y - velAt(u_vel, c - ivec2(0, 1)).y), DMAX);
}`)
const pJacobi = pipe.program(HEAD + `
uniform sampler2D u_p, u_div;
uniform float u_first;
void main() {
  ivec2 c = cell();
  float s = u_first > 0.5 ? 0.0 : sAt(u_p, c + ivec2(1, 0), PMAX) + sAt(u_p, c - ivec2(1, 0), PMAX) + sAt(u_p, c + ivec2(0, 1), PMAX) + sAt(u_p, c - ivec2(0, 1), PMAX);
  o = encS((sAt(u_div, c, DMAX) + s) * 0.25, PMAX);
}`)
const pGrad = pipe.program(HEAD + `
uniform sampler2D u_vel, u_p;
void main() {
  ivec2 c = cell(), n = ivec2(u_res);
  float h = 1.0 / float(max(n.x, n.y));
  vec2 v = velAt(u_vel, c);
  v -= 0.5 * vec2(sAt(u_p, c + ivec2(1, 0), PMAX) - sAt(u_p, c - ivec2(1, 0), PMAX), sAt(u_p, c + ivec2(0, 1), PMAX) - sAt(u_p, c - ivec2(0, 1), PMAX)) / h;
  o = encV(v);
}`)
// Semi-Lagrangian advection: trace back along the velocity, bilinear sample (by
// hand, so packed state and the wall rule work the same way).
const BACKTRACE = `
uniform sampler2D u_vel;
uniform float u_dt;
void backtrace(out ivec2 i0, out vec2 f) {
  ivec2 c = cell(), n = ivec2(u_res);
  vec2 v = velAt(u_vel, c);
  vec2 x = clamp(vec2(c) - u_dt * vec2(n) * v, vec2(-0.5), vec2(n) - 0.5);
  vec2 b = floor(x);
  i0 = ivec2(b); f = x - b;
}`
const pAdvectV = pipe.program(HEAD + BACKTRACE + `
void main() {
  ivec2 i; vec2 f; backtrace(i, f);
  o = encV(mix(mix(velAt(u_vel, i), velAt(u_vel, i + ivec2(1, 0)), f.x), mix(velAt(u_vel, i + ivec2(0, 1)), velAt(u_vel, i + ivec2(1, 1)), f.x), f.y));
}`)
const pAdvectD = pipe.program(HEAD + BACKTRACE + `
uniform sampler2D u_dye; // LINEAR + clamp-to-edge: the hardware does the bilinear and the wall rule
uniform float u_keep, u_seed;
void main() {
  ivec2 i; vec2 f; backtrace(i, f);
  vec3 d = texture(u_dye, (vec2(i) + f + 0.5) / u_res).rgb * u_keep;
#ifdef PACK
  // 8-bit dye: stochastic rounding so the fade reaches black instead of sticking
  float r = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
  d = floor(clamp(d, 0.0, 1.0) * 255.0 + r) / 255.0;
#endif
  o = vec4(d, 1.0);
}`)
const pShow = pipe.program(HEAD + `
uniform sampler2D u_dye;
void main() {
  o = vec4(min(texture(u_dye, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0), 1.0); // bilinear upscale, grid row 0 at the top

}`)

// --- grid state --------------------------------------------------------------
let W = 0, H = 0
let vel = [], dye = [], pr = [], divT = null, curlT = null
function build() {
  const long = Math.round(Math.min(Math.max(window.innerWidth, window.innerHeight), 220) * rt.detail)
  const ar = window.innerWidth / window.innerHeight
  W = Math.max(2, ar >= 1 ? long : Math.round(long * ar))
  H = Math.max(2, ar >= 1 ? Math.round(long / ar) : long)
  ;[...vel, ...dye, ...pr, divT, curlT].forEach((t) => pipe.release(t))
  const mk = (filter = 'NEAREST') => pipe.target({ width: W, height: H, float: true, filter })
  vel = [mk(), mk()]
  dye = [mk('LINEAR'), mk('LINEAR')] // dye is never packed, so it can be filtered
  pr = [mk(), mk()]
  divT = mk()
  curlT = mk()
  if (PACK) { // packed zero velocity is mid-range, not 0: clear to "no flow"
    const gl = pipe.gl
    for (const t of vel) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clearColor(0.5, 0, 0.5, 0) // 32767.5/65535 ≈ 0.5 in each 16-bit pair
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
  }
}
const swapV = () => { vel = [vel[1], vel[0]] }

// Pressure starts from zero each time, like the old CPU solver. (A warm start from
// the previous solve was tried: its stale low-frequency error is what Jacobi
// removes slowest, and it showed as large-scale drift that smeared the dye.)
function project(iters) {
  pipe.run(pDiv, { u_vel: vel[0] }, divT)
  for (let k = 0; k < iters; k++) {
    pipe.run(pJacobi, { u_p: pr[0], u_div: divT }, pr[1], (u) => u.f('u_first', k === 0 ? 1 : 0))
    pr = [pr[1], pr[0]]
  }
  pipe.run(pGrad, { u_vel: vel[0], u_p: pr[0] }, vel[1])
  swapV()
}

function hslRGB(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

// --- interaction + auto emitters -----------------------------------------
const pointer = { x: 0, y: 0, px: 0, py: 0, down: false, moved: false }
function toGrid(e) {
  const r = canvas.getBoundingClientRect()
  return [1 + (e.clientX - r.left) / r.width * W, 1 + (e.clientY - r.top) / r.height * H]
}
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = toGrid(e)
  pointer.x = pointer.px = x
  pointer.y = pointer.py = y
  pointer.down = true
})
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toGrid(e)
  pointer.px = pointer.x
  pointer.py = pointer.y
  pointer.x = x
  pointer.y = y
  pointer.moved = true
})
window.addEventListener('pointerup', () => (pointer.down = false))

const sp = new Float32Array(12)
const sc = new Float32Array(12)
let hueDrift = 0
let lastNow = 0
let frameNo = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.03, lastNow ? (now - lastNow) / 1000 : 0.016)
  lastNow = now
  hueDrift += dt * 0.05
  // Gauss-Seidel (the old CPU solver) converges about twice as fast per sweep as
  // Jacobi, so double the sweeps to keep "Solver quality" meaning the same.
  const iters = Math.round(params.iters) * 2

  // Splats this frame: the mouse drag (push + dye along the drag) and a couple
  // of drifting auto-emitter jets that keep it alive with no input.
  let n = 0
  const addSplat = (gx, gy, fx, fy, col, rad) => {
    sp.set([gx, gy, fx, fy], n * 4)
    sc.set([col[0], col[1], col[2], rad], n * 4)
    n++
  }
  if (pointer.down && pointer.moved) {
    const fx = (pointer.x - pointer.px) * params.force * 6
    const fy = (pointer.y - pointer.py) * params.force * 6
    const col = hslRGB((params.hue + hueDrift) % 1, 0.9, 0.6)
    addSplat(pointer.x, pointer.y, fx, fy, col, Math.max(3, W * 0.03))
    pointer.px = pointer.x
    pointer.py = pointer.y
    pointer.moved = false
  }
  if (params.emit > 0) {
    const t = now * 0.001
    for (let e = 0; e < 2; e++) {
      const ph = t * (0.3 + e * 0.17) + e * 2.1
      const gx = 1 + W * (0.5 + 0.32 * Math.cos(ph * 1.3 + e))
      const gy = 1 + H * (0.5 + 0.32 * Math.sin(ph + e * 2))
      const ang = ph * 1.7
      const f = params.emit * params.force * 2.2
      const col = hslRGB((params.hue + hueDrift + e * 0.4) % 1, 0.9, 0.6)
      addSplat(gx, gy, Math.cos(ang) * f, Math.sin(ang) * f, col.map((c) => c * params.emit), Math.max(2.5, W * 0.02))
    }
  }
  const setSplats = (u) => {
    pipe.gl.uniform4fv(u === pSplatV.u ? pSplatV.loc('u_sp') : pSplatD.loc('u_sp'), sp)
    pipe.gl.uniform4fv(u === pSplatV.u ? pSplatV.loc('u_sc') : pSplatD.loc('u_sc'), sc)
    u.i('u_n', n)
  }
  if (n) {
    pipe.run(pSplatV, { u_vel: vel[0] }, vel[1], setSplats)
    swapV()
    pipe.run(pSplatD, { u_dye: dye[0] }, dye[1], setSplats)
    dye = [dye[1], dye[0]]
  }

  // velocity step: vorticity confinement, project, self-advect, project
  if (params.swirl > 0) {
    pipe.run(pCurl, { u_vel: vel[0] }, curlT)
    pipe.run(pVort, { u_vel: vel[0], u_curl: curlT }, vel[1], (u) => u.f('u_k', params.swirl * 0.03 * dt))
    swapV()
  }
  project(iters)
  pipe.run(pAdvectV, { u_vel: vel[0] }, vel[1], (u) => u.f('u_dt', dt))
  swapV()
  project(iters)
  // dye step: carried by the final velocity, fading a little each frame
  pipe.run(pAdvectD, { u_vel: vel[0], u_dye: dye[0] }, dye[1], (u) => {
    u.f('u_dt', dt)
    u.f('u_keep', 1 - params.fade * 0.02)
    u.f('u_seed', (frameNo++ % 997) * 0.731)
  })
  dye = [dye[1], dye[0]]

  pipe.run(pShow, { u_dye: dye[0] }, null)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', build)
build()
requestAnimationFrame(frame)
