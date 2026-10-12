// Sand Dunes — Werner's cellular dune model. The field is a grid of sand-slab
// heights; each step a slab is picked up from a random cell, saltates a hop
// downwind, and is deposited (more readily in a wind shadow), then avalanches
// wherever the slope exceeds the angle of repose. Barchans and ridges emerge,
// crawl downwind, split and merge — evolving forever. Rendered from above with
// a low raking sun: sky-blue-filled shadows, migrating wind ripples corrugating
// the gentle windward flanks, and darker, smoother lee slip-faces.
//
// The sim stays on the CPU (a small grid, independent of screen size); its
// heights are uploaded each frame as an integer texture and all resampling,
// smoothing and shading runs in a WebGL2 fragment shader.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE, antialias: false, depth: false })

const params = rt.params({
  wind: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Wind strength' },
  windDir: { value: 0, min: -180, max: 180, step: 5, label: 'Wind direction°' },
  hop: { value: 3, min: 1, max: 8, step: 1, label: 'Saltation hop' },
  supply: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Sand supply' },
  avalanche: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Avalanche' },
  sun: { value: 40, min: 0, max: 90, step: 1, label: 'Sun angle°' },
  hue: { value: 34, min: 0, max: 60, step: 1, label: 'Sand hue' },
})
rt.mapInput('audio.level', 'wind', 0.4)

// The dune dynamics run on a coarse grid (h). Rendering happens on a finer grid
// (RS× the sim), where the height field is smoothly resampled and shaded
// per-pixel — so the physics stays cheap but the picture looks smooth.
const RS = 3
let GW = 0, GH = 0, h = null, W = 0, H = 0, PR = 1
let RW = 0, RH = 0, hTex = null, wTex = null, lowTex = null, lowFbo = null
function build() {
  GW = Math.round(130 * (0.6 + 0.4 * rt.detail)); GH = Math.max(50, Math.round(GW * (H / W)))   // coarser grid → bigger dunes
  h = new Uint16Array(GW * GH)
  // Seed transverse dune ridges (perpendicular to the wind) so there is real
  // dune structure from the start; the Werner saltation then migrates, splits
  // and reshapes them into barchans and ridges as it runs.
  const wr = (params.windDir * Math.PI) / 180
  const wx = Math.cos(wr), wy = Math.sin(wr)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const proj = x * wx + y * wy
      let v = 9 + 4.5 * Math.sin(proj * 0.12) + 2.5 * Math.sin(proj * 0.29 + 2.0)
        + 2.0 * Math.sin(y * 0.18 + 1.3) * Math.sin(x * 0.05)
      v += rt.rng() * 2
      h[y * GW + x] = Math.max(0, Math.round(v))
    }
  }
  RW = GW * RS; RH = GH * RS
  for (const t of [hTex, wTex, lowTex]) if (t) gl.deleteTexture(t)
  if (lowFbo) gl.deleteFramebuffer(lowFbo)
  hTex = makeTex(GW, GH, gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, gl.NEAREST)
  wTex = makeTex(Math.max(RW, RH), 3, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, axisWeights())
  lowTex = makeTex(RW, RH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
  lowFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, lowFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lowTex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
}
// The original resampled the coarse grid with smoothstep weights and then
// box-blurred it (radius RS, clamped at the borders); both are linear and
// separable, so a fine pixel's smoothed height is a 4x4 weighted sum of sim
// cells. The per-axis weights only depend on the fine coordinate, so they're
// tabulated once per build: row 0 = x weights, row 1 = y weights (cells
// base..base+3), row 2 = (x base, y base).
function axisWeights() {
  const TW = Math.max(RW, RH), out = new Float32Array(TW * 3 * 4)
  const rad = RS
  for (const [row, R] of [[0, RW], [1, RH]]) {
    for (let p = 0; p < R; p++) {
      const base = Math.floor(Math.min(R - 1, Math.max(0, p - rad)) / RS)
      const o = (row * TW + p) * 4
      for (let k = -rad; k <= rad; k++) {
        const f = Math.min(R - 1, Math.max(0, p + k)) / RS
        const i0 = Math.floor(f); let t = f - i0; t = t * t * (3 - 2 * t)
        out[o + i0 - base] += (1 - t) / (2 * rad + 1)
        if (i0 + 1 - base < 4) out[o + i0 + 1 - base] += t / (2 * rad + 1)
      }
      out[(2 * TW + p) * 4 + row] = base
    }
  }
  return out
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  build()
}
const wrap = (v, n) => ((v % n) + n) % n
const at = (x, y) => h[wrap(y, GH) * GW + wrap(x, GW)]
function add(x, y, d) { h[wrap(y, GH) * GW + wrap(x, GW)] += d }

// avalanche: if a cell towers over a downhill neighbour by > repose, topple one
function relax(x, y) {
  const c = at(x, y)
  const repose = 2
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dx, dy] of dirs) {
    if (c - at(x + dx, y + dy) > repose) { add(x, y, -1); add(x + dx, y + dy, 1); return }
  }
}

function step() {
  const ang = (params.windDir * Math.PI) / 180
  const hopLen = Math.round(params.hop)
  // nearest of the 8 grid directions (cos and sin can't both round to 0)
  const wx = Math.round(Math.cos(ang)), wy = Math.round(Math.sin(ang))
  const iters = Math.round(GW * GH * 0.5 * params.wind * params.supply)
  for (let k = 0; k < iters; k++) {
    const x = (rt.rng() * GW) | 0, y = (rt.rng() * GH) | 0
    if (at(x, y) <= 0) continue
    add(x, y, -1) // pick up a slab
    // saltate downwind until it deposits
    let tx = x, ty = y
    for (let hopn = 0; hopn < 6; hopn++) {
      tx += wx * hopLen; ty += wy * hopLen
      // deposit probability: high in a shadow (behind higher sand), else 0.4
      const shadow = at(tx - wx, ty - wy) > at(tx, ty)
      if (shadow || rt.rng() < 0.4) break
    }
    add(tx, ty, 1)
  }
  // a few avalanche passes
  const av = Math.round(GW * GH * 0.4 * params.avalanche)
  for (let k = 0; k < av; k++) relax((rt.rng() * GW) | 0, (rt.rng() * GH) | 0)
}


// ---------------------------------------------------------------- GPU render
const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`

// Shade the fine render buffer (RS x the sim grid). Smoothed heights come from
// the weight table (see axisWeights) applied to a 5x5 block of sim cells.
const SHADE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_h;
uniform sampler2D u_w;    // axis weight table
uniform ivec2 u_grid;     // GW, GH
uniform ivec2 u_rres;     // RW, RH
uniform vec2 u_light;     // sun direction
uniform vec2 u_wind;      // wind direction (unit)
uniform float u_ripT, u_hue;
out vec4 outColor;
// shift a 4-cell weight vector by off (0 or 1) into a 5-cell row: (lo.xyzw, hi)
vec4 lo5(vec4 w, int off) { return off == 0 ? w : vec4(0.0, w.xyz); }
float hi5(vec4 w, int off) { return off == 0 ? 0.0 : w.w; }
vec3 hsl(float h, float s, float l) {
  s /= 100.0; l /= 100.0;
  float a = s * min(l, 1.0 - l);
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h / 30.0, 12.0);
  return l - a * max(vec3(-1.0), min(k - 3.0, min(9.0 - k, vec3(1.0))));
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);   // y counted top-down
  int x = ip.x, y = ip.y;
  int RW = u_rres.x, RH = u_rres.y;
  int xl = max(x - 1, 0), xr = min(x + 1, RW - 1);
  int yu = max(y - 1, 0), yd = min(y + 1, RH - 1);
  vec4 wxc = texelFetch(u_w, ivec2(x, 0), 0), wxl = texelFetch(u_w, ivec2(xl, 0), 0), wxr = texelFetch(u_w, ivec2(xr, 0), 0);
  vec4 wyc = texelFetch(u_w, ivec2(y, 1), 0), wyu = texelFetch(u_w, ivec2(yu, 1), 0), wyd = texelFetch(u_w, ivec2(yd, 1), 0);
  int bxc = int(texelFetch(u_w, ivec2(x, 2), 0).x), bxl = int(texelFetch(u_w, ivec2(xl, 2), 0).x), bxr = int(texelFetch(u_w, ivec2(xr, 2), 0).x);
  int byc = int(texelFetch(u_w, ivec2(y, 2), 0).y), byu = int(texelFetch(u_w, ivec2(yu, 2), 0).y), byd = int(texelFetch(u_w, ivec2(yd, 2), 0).y);
  // x-1 and x+1 are under 1 cell apart, so all five samples fit in a 5x5 block
  // of sim cells starting at (bxl, byu): fetch it once (wrapping like at()).
  vec4 wl = wxl, wc = lo5(wxc, bxc - bxl), wr = lo5(wxr, bxr - bxl);
  float wl5 = 0.0, wc5 = hi5(wxc, bxc - bxl), wr5 = hi5(wxr, bxr - bxl);
  vec4 vu = wyu, vc = lo5(wyc, byc - byu), vd = lo5(wyd, byd - byu);
  float vu5 = 0.0, vc5 = hi5(wyc, byc - byu), vd5 = hi5(wyd, byd - byu);
  ivec4 cx = (ivec4(bxl) + ivec4(0, 1, 2, 3)) % u_grid.x;
  int cx5 = (bxl + 4) % u_grid.x;
  vec4 rl, rc, rr; float rl5 = 0.0, rc5 = 0.0, rr5 = 0.0;   // x-weighted row sums for x-1, x, x+1
  for (int j = 0; j < 5; j++) {
    int yy = (byu + j) % u_grid.y;
    vec4 h4 = vec4(float(texelFetch(u_h, ivec2(cx.x, yy), 0).r), float(texelFetch(u_h, ivec2(cx.y, yy), 0).r),
                   float(texelFetch(u_h, ivec2(cx.z, yy), 0).r), float(texelFetch(u_h, ivec2(cx.w, yy), 0).r));
    float h5 = float(texelFetch(u_h, ivec2(cx5, yy), 0).r);
    float sl = dot(wl, h4) + wl5 * h5, sc = dot(wc, h4) + wc5 * h5, sr = dot(wr, h4) + wr5 * h5;
    if (j < 4) { rl[j] = sl; rc[j] = sc; rr[j] = sr; } else { rl5 = sl; rc5 = sc; rr5 = sr; }
  }
  float c = dot(vc, rc) + vc5 * rc5;
  float hL = dot(vc, rl) + vc5 * rl5, hR = dot(vc, rr) + vc5 * rr5;
  float hU = dot(vu, rc) + vu5 * rc5, hD = dot(vd, rc) + vd5 * rc5;
  const float gs = 0.55, nz = 2.2, rAmp = 0.13, rFreq = 0.62;
  float sx = (hR - hL) * gs;
  float sy = (hD - hU) * gs;
  float nlen = length(vec3(sx, sy, nz));
  float shade = 0.34 + 0.72 * max(0.0, (-sx * u_light.x - sy * u_light.y + nz * 0.4) / nlen);
  float slope = length(vec2(sx, sy));
  float gdotw = sx * u_wind.x + sy * u_wind.y;
  float stoss = max(0.0, gdotw) / (slope + 0.001);
  float fx = float(x), fy = float(y);
  float proj = fx * u_wind.x + fy * u_wind.y;
  float rip = sin(proj * rFreq - u_ripT) + 0.35 * sin(proj * rFreq * 2.7 + (fx * u_wind.y - fy * u_wind.x) * 0.13);
  float rmask = stoss * min(1.0, slope * 2.5) * max(0.0, 1.0 - slope * 0.4);
  shade += rip * rAmp * rmask;
  float lee = max(0.0, -gdotw) / (slope + 0.001);
  shade -= lee * max(0.0, min(0.14, (slope - 1.1) * 0.12));
  shade = clamp(shade, 0.12, 1.15);
  float L = min(88.0, 30.0 + shade * 54.0 + min(0.1, c * 0.008) * 60.0);
  vec3 col = hsl(u_hue, 46.0, L);
  float dk = max(0.0, 0.55 - shade) * 0.6;
  col = col * (1.0 - dk) + vec3(78.0, 96.0, 128.0) / 255.0 * dk;
  outColor = vec4(col, 1.0);
}`

// upscale the render buffer to the canvas (bilinear), flipping to top-down rows
const BLIT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 outColor;
void main() { outColor = vec4(texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0); }`

function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src); gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
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
const shadeP = program(SHADE)
const blitP = program(BLIT)
const vao = gl.createVertexArray()
gl.bindVertexArray(vao)
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

function render() {
  const sun = (params.sun * Math.PI) / 180
  const ripT = rt.phase('ripple', params.wind * 1.4) // wind is modulated: integrate it
  const wr = (params.windDir * Math.PI) / 180

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, hTex)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RED_INTEGER, gl.UNSIGNED_SHORT, h)

  gl.bindFramebuffer(gl.FRAMEBUFFER, lowFbo)
  gl.viewport(0, 0, RW, RH)
  gl.useProgram(shadeP.p)
  const u = shadeP.u
  gl.uniform1i(u.u_h, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, wTex)
  gl.uniform1i(u.u_w, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.uniform2i(u.u_grid, GW, GH)
  gl.uniform2i(u.u_rres, RW, RH)
  gl.uniform2f(u.u_light, Math.cos(sun), Math.sin(sun))
  gl.uniform2f(u.u_wind, Math.cos(wr), Math.sin(wr))
  gl.uniform1f(u.u_ripT, ripT)
  gl.uniform1f(u.u_hue, params.hue)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(blitP.p)
  gl.bindTexture(gl.TEXTURE_2D, lowTex)
  gl.uniform1i(blitP.u.u_tex, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

function frame(now) {
  rt.tick(now)
  step()
  render()
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
