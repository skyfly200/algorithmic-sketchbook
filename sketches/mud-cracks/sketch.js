// Mud Cracks — a drying mud flat that fractures into polygonal tiles. A cellular
// (Worley) fracture network, plus finer secondary cracks inside the big plates,
// is baked once into a distance field — but the sample coordinates are domain-
// warped by multi-octave noise so the boundaries meander like real cracks rather
// than sitting on clean Voronoi bisectors, the crack lips are roughened to a
// ragged, variable width, and the fine cracks only appear in patches. Each frame
// the dryness sets how wide/deep the cracks have opened; regions dry at different
// rates, tiles curl at their edges (bump-shaded from the field gradient) and cast
// shadow into the gaps, and the mud shifts wet-brown → dusty tan. Drag to wet the
// surface and the cracks heal, then re-open as it dries again.
//
// All per-pixel work runs on the GPU (WebGL2): the static fields are baked by a
// shader into a float texture (edge distance, plate tone, open threshold, damp
// grain) whenever the geometry changes, and each frame a shading pass colours
// the render buffer, which is then upscaled to the canvas. If float render
// targets are missing, the bake falls back to the CPU and is uploaded once.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE, antialias: false, depth: false })

const params = rt.params({
  dryness: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Dryness' },
  autoDry: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Drying cycle' },
  scale: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Tile size' },
  crackWidth: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Crack width' },
  curl: { value: 1, min: 0, max: 2, step: 0.05, label: 'Edge curl' },
  detail: { value: 1, min: 0, max: 2, step: 0.05, label: 'Fine cracks' },
  irregular: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'Irregularity' },
  hue: { value: 27, min: 0, max: 360, step: 1, label: 'Mud hue' },
  sat: { value: 1, min: 0, max: 1.6, step: 0.05, label: 'Mud saturation' },
})
rt.mapInput('audio.level', 'dryness', 0.3)

// ---------------------------------------------------------------- GL helpers
const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
function program(frag) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
  gl.bindAttribLocation(p, 0, 'position')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  const u = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name) }
  return { p, u }
}
const vao = gl.createVertexArray()
gl.bindVertexArray(vao)
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

function makeTex(w, h, internal, format, type, filter, data = null) {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
function makeFbo(tex) {
  const f = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, f)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return ok ? f : null
}

// Float render target for the baked field: RGBA32F, else RGBA16F, else CPU bake.
const hasF32 = !!gl.getExtension('EXT_color_buffer_float')
const hasF16 = hasF32 || !!gl.getExtension('EXT_color_buffer_half_float')

// ---------------------------------------------------------------- shaders
// Integer hash + value noise + fbm + warped Worley, matching the original JS.
// Seed offsets (seed * 0.137 etc.) are split into integer + fraction so the
// noise lattice stays precise in 32-bit floats.
const NOISE = `
float hash2(int x, int y) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u;
  h = (h ^ (h >> 13)) * 1274126177u; h ^= h >> 16;
  return float(h) / 4294967296.0;
}
int pmod(int a, int p) { int r = a % p; return r < 0 ? r + p : r; }
// value noise at integer offset io + fractional position p, periodic in x
float vnoise(vec2 p, ivec2 io, int per) {
  vec2 fl = floor(p); vec2 f = p - fl;
  int x0 = int(fl.x) + io.x, y0 = int(fl.y) + io.y;
  float v00 = hash2(pmod(x0, per), y0), v10 = hash2(pmod(x0 + 1, per), y0);
  float v01 = hash2(pmod(x0, per), y0 + 1), v11 = hash2(pmod(x0 + 1, per), y0 + 1);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(v00, v10, u.x), mix(v01, v11, u.x), u.y);
}
float fbm(vec2 p, int s) {
  // offset = (s * 0.137, s * 0.371), split exactly
  int ax = s * 137, ay = s * 371;
  ivec2 io = ivec2(ax / 1000, ay / 1000);
  vec2 fo = vec2(float(ax - (ax / 1000) * 1000), float(ay - (ay / 1000) * 1000)) / 1000.0;
  float v = 0.0, amp = 0.5, f = 1.0;
  for (int o = 0; o < 4; o++) {
    v += amp * vnoise(p * f + fo, io, 4096);
    amp *= 0.5; f *= 2.0;
  }
  return v;
}
float smooth01(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`

const BAKE = `#version 300 es
precision highp float;
precision highp int;
uniform int u_seed;
uniform vec2 u_rres;
uniform float u_big, u_small, u_irr, u_detail;
out vec4 outColor;
${NOISE}
// jittered-grid Worley: F2 - F1 (edge distance, px) in .x, nearest cell hash in .y
vec2 worley(vec2 pt, float cell, int seed) {
  vec2 g = pt / cell;
  int xi = int(floor(g.x)), yi = int(floor(g.y));
  float f1 = 1e9, f2 = 1e9, id = 0.0;
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    int cx = xi + ox, cy = yi + oy;
    float fx = float(cx) + hash2(cx + seed, cy * 131 + seed);
    float fy = float(cy) + hash2(cx + seed + 17, cy * 131 + seed + 91);
    vec2 d = vec2(fx, fy) - g;
    float dd = dot(d, d);
    if (dd < f1) { f2 = f1; f1 = dd; id = hash2(cx * 92821 + seed, cy * 53987 + seed); }
    else if (dd < f2) { f2 = dd; }
  }
  return vec2((sqrt(f2) - sqrt(f1)) * cell, id);
}
void main() {
  vec2 p = floor(gl_FragCoord.xy);      // (x, y) with y counted top-down
  int seed = u_seed;
  float big = u_big, irr = u_irr;
  float wf = 1.3 / big, wAmp = big * 0.5 * irr, wf2 = wf * 2.7;
  float wx = (fbm(p * wf, seed + 40) - 0.5) * 2.0 * wAmp + (fbm(p * wf2, seed + 55) - 0.5) * wAmp * 0.5;
  float wy = (fbm(p * wf + vec2(11.3, 4.7), seed + 70) - 0.5) * 2.0 * wAmp + (fbm(p * wf2 + vec2(3.1, 8.9), seed + 85) - 0.5) * wAmp * 0.5;
  vec2 sp = p + vec2(wx, wy);
  vec2 b = worley(sp, big, seed);
  float fineMask = fbm(p * 0.9 / big, seed + 500);
  float sE = 1e9;
  if (fineMask > 0.52 - irr * 0.12) { sE = worley(sp, u_small, seed + 7).x / (0.5 + u_detail); }
  float rough = (fbm(p * 0.08, seed + 200) - 0.5) * big * 0.09 * irr;
  float edge = max(0.0, min(b.x, sE) + rough);
  float tone = 0.5 + (b.y - 0.5) * 0.6 + (fbm(p * 0.03, seed + 900) - 0.5) * 0.35 * irr;
  float openF = vnoise(vec2(p.x / u_rres.x * 3.0, p.y / u_rres.y * 3.0), ivec2(seed + 3, 0), 3) * 0.7;
  float grain = (fbm(p * 0.06, seed + 1300) - 0.5) + (fbm(p * 0.22, seed + 1700) - 0.5) * 0.5;
  outColor = vec4(edge, tone, openF, grain);
}`

const SHADE = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_rres;
uniform float u_dry, u_cwMax, u_curl, u_hue, u_sat;
uniform vec3 u_wet; // x, y (render px, top-down), amount
out vec4 outColor;
float smooth01(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 hsl(float h, float s, float l) {
  s /= 100.0; l /= 100.0;
  float a = s * min(l, 1.0 - l);
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h / 30.0, 12.0);
  return l - a * max(vec3(-1.0), min(k - 3.0, min(9.0 - k, vec3(1.0))));
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(u_rres) - 1;
  vec4 F = texelFetch(u_field, ip, 0);
  float e = F.x;
  float RH = u_rres.y;
  float ldry = u_dry;
  if (u_wet.z > 0.01) {
    float dd = distance(vec2(ip), u_wet.xy);
    ldry = max(0.0, ldry - u_wet.z * smooth01(RH * 0.22, RH * 0.04, dd));
  }
  float opened = smooth01(F.z, F.z + 0.32, ldry);
  float cw = u_cwMax * (0.12 + ldry * 0.9) * (0.28 + 0.72 * opened);
  float crack = 1.0 - smooth01(cw * 0.5, cw + 1.0, e);
  float lig = (13.0 + ldry * 22.0) * (0.85 + F.y * 0.3);
  float sat = (45.0 - ldry * 22.0) * u_sat;
  float eL = texelFetch(u_field, ivec2(max(ip.x - 1, 0), ip.y), 0).x;
  float eR = texelFetch(u_field, ivec2(min(ip.x + 1, mx.x), ip.y), 0).x;
  float eU = texelFetch(u_field, ivec2(ip.x, max(ip.y - 1, 0)), 0).x;
  float eD = texelFetch(u_field, ivec2(ip.x, min(ip.y + 1, mx.y)), 0).x;
  float bevel = (-(eR - eL) * 0.6 - (eD - eU) * 0.7) * u_curl * opened;
  float rim = smooth01(cw, cw + RH * 0.02, e);
  float damp = F.w * (7.0 + (1.0 - ldry) * 16.0);
  float L = clamp(lig + damp + bevel * 14.0 * rim, 4.0, 70.0);
  vec3 col = hsl(u_hue, sat, L);
  col *= 1.0 - crack * (0.82 + ldry * 0.12);
  outColor = vec4(col, 1.0);
}`

// upscale the render buffer to the canvas (bilinear), flipping to top-down rows
const BLIT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 outColor;
void main() { outColor = vec4(texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0); }`

const bakeP = (hasF16 ? program(BAKE) : null)
const shadeP = program(SHADE)
const blitP = program(BLIT)

// ---------------------------------------------------------------- CPU fallback bake
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(gx, gy, per) {
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0
  const m = (a) => ((a % per) + per) % per
  const v00 = hash2(m(x0), y0), v10 = hash2(m(x0 + 1), y0)
  const v01 = hash2(m(x0), y0 + 1), v11 = hash2(m(x0 + 1), y0 + 1)
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = v00 + (v10 - v00) * ux, b = v01 + (v11 - v01) * ux
  return a + (b - a) * uy
}
function fbm(x, y, seed) {
  let v = 0, amp = 0.5, f = 1
  for (let o = 0; o < 4; o++) {
    v += amp * vnoise(x * f + seed * 0.137, y * f + seed * 0.371, 4096)
    amp *= 0.5; f *= 2
  }
  return v
}
function worley(px, py, cell, seed) {
  const gx = px / cell, gy = py / cell
  const xi = Math.floor(gx), yi = Math.floor(gy)
  let f1 = 1e9, f2 = 1e9, id = 0
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cxi = xi + ox, cyi = yi + oy
    const fx = cxi + hash2(cxi + seed, cyi * 131 + seed)
    const fy = cyi + hash2(cxi + seed + 17, cyi * 131 + seed + 91)
    const dx = fx - gx, dy = fy - gy
    const dd = dx * dx + dy * dy
    if (dd < f1) { f2 = f1; f1 = dd; id = hash2(cxi * 92821 + seed, cyi * 53987 + seed) }
    else if (dd < f2) { f2 = dd }
  }
  return { e: (Math.sqrt(f2) - Math.sqrt(f1)) * cell, id }
}
function cpuBake(seed, big, small, irr) {
  const out = new Float32Array(RW * RH * 4)
  const wf = 1.3 / big, wAmp = big * 0.5 * irr, wf2 = wf * 2.7
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const wx = (fbm(x * wf, y * wf, seed + 40) - 0.5) * 2 * wAmp + (fbm(x * wf2, y * wf2, seed + 55) - 0.5) * wAmp * 0.5
      const wy = (fbm(x * wf + 11.3, y * wf + 4.7, seed + 70) - 0.5) * 2 * wAmp + (fbm(x * wf2 + 3.1, y * wf2 + 8.9, seed + 85) - 0.5) * wAmp * 0.5
      const sx = x + wx, sy = y + wy
      const b = worley(sx, sy, big, seed)
      const fineMask = fbm(x * 0.9 / big, y * 0.9 / big, seed + 500)
      let sE = 1e9
      if (fineMask > 0.52 - irr * 0.12) { const s = worley(sx, sy, small, seed + 7); sE = s.e / (0.5 + params.detail) }
      const rough = (fbm(x * 0.08, y * 0.08, seed + 200) - 0.5) * big * 0.09 * irr
      const p = (y * RW + x) * 4
      out[p] = Math.max(0, Math.min(b.e, sE) + rough)
      out[p + 1] = 0.5 + (b.id - 0.5) * 0.6 + (fbm(x * 0.03, y * 0.03, seed + 900) - 0.5) * 0.35 * irr
      out[p + 2] = vnoise((x / RW) * 3 + seed + 3, (y / RH) * 3, 3) * 0.7
      out[p + 3] = (fbm(x * 0.06, y * 0.06, seed + 1300) - 0.5) + (fbm(x * 0.22, y * 0.22, seed + 1700) - 0.5) * 0.5
    }
  }
  return out
}

// ---------------------------------------------------------------- state
let W = 0, H = 0, PR = 1
// render buffer (below device res, then upscaled) + baked static field texture
let RW = 0, RH = 0
let fieldTex = null, fieldFbo = null, lowTex = null, lowFbo = null

function build() {
  const CAP = Math.round(900000 * rt.detail)
  RW = Math.round(window.innerWidth)
  RH = Math.round(window.innerHeight)
  const sc = Math.sqrt(CAP / (RW * RH)); if (sc < 1) { RW = Math.round(RW * sc); RH = Math.round(RH * sc) }
  RW = Math.max(1, RW); RH = Math.max(1, RH)
  const seed = Math.floor(rt.random(0, 90000))
  const big = Math.max(24, RH * 0.14 / params.scale)
  const small = big * 0.42
  const irr = params.irregular

  for (const t of [fieldTex, lowTex]) if (t) gl.deleteTexture(t)
  for (const f of [fieldFbo, lowFbo]) if (f) gl.deleteFramebuffer(f)
  fieldTex = fieldFbo = null
  lowTex = makeTex(RW, RH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
  lowFbo = makeFbo(lowTex)

  if (bakeP) {
    fieldTex = hasF32
      ? makeTex(RW, RH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST)
      : makeTex(RW, RH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST)
    fieldFbo = makeFbo(fieldTex)
    if (!fieldFbo) { gl.deleteTexture(fieldTex); fieldTex = null }
  }
  if (fieldFbo) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFbo)
    gl.viewport(0, 0, RW, RH)
    gl.useProgram(bakeP.p)
    const u = bakeP.u
    gl.uniform1i(u.u_seed, seed)
    gl.uniform2f(u.u_rres, RW, RH)
    gl.uniform1f(u.u_big, big); gl.uniform1f(u.u_small, small)
    gl.uniform1f(u.u_irr, irr); gl.uniform1f(u.u_detail, params.detail)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  } else {
    // no float render target: bake on the CPU once and upload (float textures
    // are always sampleable in WebGL2 with NEAREST filtering)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    fieldTex = makeTex(RW, RH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, cpuBake(seed, big, small, irr))
  }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}

const wet = { x: -1e9, y: -1e9, amt: 0 }
function wetAt(e) {
  wet.x = (e.clientX / window.innerWidth) * RW
  wet.y = (e.clientY / window.innerHeight) * RH
  wet.amt = 1
}
window.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') wetAt(e) })
window.addEventListener('pointerdown', wetAt)

let sig = '', pending = null, pendingAt = 0
function paramSig() { return [params.scale, params.detail, params.irregular].join(',') }

function frame(now) {
  rt.tick(now)

  // rebuild the baked field only when the geometry params change (debounced)
  const s = paramSig()
  if (s !== sig) { if (pending !== s) { pending = s; pendingAt = now } else if (now - pendingAt > 200) { build(); sig = s; pending = null } }

  // global dryness with an optional slow wet↔dry cycle
  let dry = params.dryness
  if (params.autoDry > 0.01) dry = Math.max(0, Math.min(1, dry + Math.sin(rt.phase('autoDry', params.autoDry * 0.3)) * 0.4))
  wet.amt = Math.max(0, wet.amt - 0.008) // slower, smoother re-dry after a splash

  // shade the render buffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, lowFbo)
  gl.viewport(0, 0, RW, RH)
  gl.useProgram(shadeP.p)
  const u = shadeP.u
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, fieldTex)
  gl.uniform1i(u.u_field, 0)
  gl.uniform2f(u.u_rres, RW, RH)
  gl.uniform1f(u.u_dry, dry)
  gl.uniform1f(u.u_cwMax, (RH * 0.02) * params.crackWidth)
  gl.uniform1f(u.u_curl, params.curl)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_sat, params.sat)
  gl.uniform3f(u.u_wet, wet.x, wet.y, wet.amt)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  // upscale to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(blitP.p)
  gl.bindTexture(gl.TEXTURE_2D, lowTex)
  gl.uniform1i(blitP.u.u_tex, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
