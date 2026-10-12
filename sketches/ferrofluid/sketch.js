/**
 * Ferrofluid Field — a puddle of magnetic fluid under a field. As the field
 * rises the surface goes unstable (the Rosensweig / normal-field instability)
 * and erupts into a hexagonal array of peaks standing along the field lines.
 *
 * The fluid is a real height field: a connected pool with Gaussian peaks on a
 * hex lattice, their height set by the local field. It's shaded per pixel like
 * the chrome-black liquid it is — diffuse + a tight specular + a procedural
 * environment reflection off the surface normal + Fresnel edge sheen — so peaks
 * catch the light on their flanks and glint at the tips, connected by the
 * mirror-dark valleys between them. The mouse is a magnet that pulls the peaks
 * up and leans the reflection toward the cursor.
 *
 * The CPU only updates each peak's amplitude (a few hundred values); a WebGL2
 * shader evaluates the height field and shades it per grid cell (the grid is the
 * canvas downsampled by ~1.9x, as before), and a second pass upscales it to the
 * canvas with a whisper of blur.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  field: { value: 0.7, min: 0, max: 1.3, step: 0.02, label: 'Field strength' },
  spikes: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Spike density' },
  magnet: { value: 0.8, min: 0, max: 2.5, step: 0.05, label: 'Magnet pull' },
  wobble: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Wobble' },
  hue: { value: +rt.random(0.55, 0.68).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Sheen hue' },
})
// Music: beats surge the field, loudness excites the wobble.
rt.mapInput('audio.pulse', 'field', 0.5)
rt.mapInput('audio.volume', 'wobble', 0.8)

const canvas = document.getElementById('canvas')
const capture = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: capture, antialias: false })

let W, H, gw, gh, gsc, cxg, cyg, Rg
let sites, siteCols, siteRows, siteData, latLeft, latTop, latStep, latRowH
const mouse = { x: -1e4, y: -1e4 }

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`

// Pass 1: height field + shading, one fragment per grid cell (grid y = 0 at the top).
const SHADE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_sites; // RGBA32F per lattice slot: gx, gy, stamped amplitude (0 = none)
uniform ivec2 u_siteDim;         // lattice columns, rows
uniform vec4 u_lat;              // lattice left, top, step, row height (grid units)
uniform vec2 u_grid;             // gw, gh
uniform vec3 u_pool;             // cxg, cyg, Rg
uniform float u_sg;              // Gaussian sigma
uniform float u_rad;             // stamp half-window, ceil(3 sigma)
uniform vec3 u_tint;
out vec4 outColor;

float mound(vec2 p) {
  float d = length(p - u_pool.xy) / u_pool.z;
  return d < 1.0 ? 0.45 * (1.0 - d * d) : 0.0;
}

void main() {
  vec2 c = vec2(floor(gl_FragCoord.x), u_grid.y - 1.0 - floor(gl_FragCoord.y));
  // the cell and its four neighbours (clamped at the border, like the CPU version)
  vec2 pl = vec2(max(c.x - 1.0, 0.0), c.y);
  vec2 pr = vec2(min(c.x + 1.0, u_grid.x - 1.0), c.y);
  vec2 pu = vec2(c.x, max(c.y - 1.0, 0.0));
  vec2 pd = vec2(c.x, min(c.y + 1.0, u_grid.y - 1.0));
  float h = mound(c), hl = mound(pl), hr = mound(pr), hu = mound(pu), hd = mound(pd);

  // Each peak is stamped on the square window [int(g - rad), int(g + rad)] (clipped
  // to the grid), exactly as the CPU stamp did. Only lattice slots that can reach
  // this 3x3 neighbourhood are visited.
  float inv = 1.0 / (2.0 * u_sg * u_sg);
  float reach = u_rad + 2.0;
  int r0 = max(0, int(floor((c.y - reach - u_lat.y) / u_lat.w)));
  int r1 = min(u_siteDim.y - 1, int(ceil((c.y + reach - u_lat.y) / u_lat.w)));
  int k0 = max(0, int(floor((c.x - reach - u_lat.x) / u_lat.z)) - 1);
  int k1 = min(u_siteDim.x - 1, int(ceil((c.x + reach - u_lat.x) / u_lat.z)));
  for (int r = r0; r <= r1; r++) {
    for (int k = k0; k <= k1; k++) {
      vec4 s = texelFetch(u_sites, ivec2(k, r), 0);
      if (s.z <= 0.0) continue;
      vec2 lo = max(vec2(0.0), vec2(ivec2(s.xy - u_rad)));
      vec2 hi = min(u_grid - 1.0, vec2(ivec2(s.xy + u_rad)));
      #define STAMP(P, V) if (all(greaterThanEqual(P, lo)) && all(lessThanEqual(P, hi))) { vec2 d = P - s.xy; V += s.z * exp(-dot(d, d) * inv); }
      STAMP(c, h)
      STAMP(pl, hl)
      STAMP(pr, hr)
      STAMP(pu, hu)
      STAMP(pd, hd)
    }
  }

  // --- shade the surface as chrome-black liquid metal.
  const float zScale = 3.4; // vertical exaggeration for the normals
  const vec3 L = vec3(-0.42, -0.5, 0.76); // key light
  vec3 n = normalize(vec3((hl - hr) * zScale, (hu - hd) * zScale, 1.0));
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = max(0.0, dot(n, L));
  float spec = pow(max(0.0, dot(n, hv)), 55.0);
  // Reflection of the top-down view about the normal, sampled against two
  // narrow bright studio strips -> mirror-black metal with sharp reflected
  // bands on the flanks, and mostly-black valleys for that oily contrast.
  float ry = 2.0 * n.z * n.y;
  float band = exp(-((ry + 0.55) * (ry + 0.55)) / 0.045) + 0.55 * exp(-((ry - 0.5) * (ry - 0.5)) / 0.06);
  // quiet the reflections toward the pool's rim so no bright halo rings it
  float rimQ = clamp((length(c - u_pool.xy) / u_pool.z - 0.7) / 0.25, 0.0, 1.0);
  float calm = 1.0 - 0.95 * rimQ;
  float env = 0.5 * band * calm;
  float fres = pow(1.0 - n.z, 3.0) * 0.6 * calm;
  const float base = 0.02;
  vec3 t = u_tint;
  vec3 col = vec3(
    base + diff * 0.06 * t.r + env * t.r * 0.85 + fres * t.r * 0.3 + spec * 1.7,
    base + diff * 0.06 * t.g + env * t.g * 0.9 + fres * t.g * 0.3 + spec * 1.7,
    base + diff * 0.07 * t.b + env * t.b * 1.05 + fres * t.b * 0.4 + spec * 1.8);
  // fade the shading out over the last sliver of the mound: the steep rim
  // slope would otherwise light up as a white halo
  float p = clamp((h - 0.004) / 0.05, 0.0, 1.0);
  outColor = vec4(min(vec3(1.0), col * p + vec3(0.012, 0.014, 0.02)), 1.0);
}`

// Pass 2: smooth upscale of the grid to the canvas plus a small Gaussian blur
// (sigma in canvas pixels), which dissolves residual grid stepping in the glints.
const UPSCALE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_img;
uniform vec2 u_res;
uniform float u_sigma;
out vec4 outColor;
void main() {
  vec2 px = 1.0 / u_res;
  float w1 = exp(-0.5 / (u_sigma * u_sigma));
  float w2 = w1 * w1;
  vec3 acc = texture(u_img, v_uv).rgb;
  acc += w1 * (texture(u_img, v_uv + vec2(px.x, 0.0)).rgb + texture(u_img, v_uv - vec2(px.x, 0.0)).rgb
             + texture(u_img, v_uv + vec2(0.0, px.y)).rgb + texture(u_img, v_uv - vec2(0.0, px.y)).rgb);
  acc += w2 * (texture(u_img, v_uv + px).rgb + texture(u_img, v_uv - px).rgb
             + texture(u_img, v_uv + vec2(px.x, -px.y)).rgb + texture(u_img, v_uv + vec2(-px.x, px.y)).rgb);
  outColor = vec4(acc / (1.0 + 4.0 * w1 + 4.0 * w2), 1.0);
}`

function compile(type, source) {
  const s = gl.createShader(type)
  gl.shaderSource(s, source)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
function link(frag) {
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
const shadeProg = link(SHADE)
const upProg = link(UPSCALE)
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

function makeTex(filter) {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
const siteTex = makeTex(gl.NEAREST) // per-peak data, RGBA32F
const gridTex = makeTex(gl.LINEAR) // shaded grid, RGBA8
const fbo = gl.createFramebuffer()

function build() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  gsc = Math.max(1.6, 1.9 * rt.pixelRatio) / rt.detail // grid downsample (finer = smoother)
  gw = Math.max(120, Math.floor(W / gsc))
  gh = Math.max(120, Math.floor(H / gsc))
  gl.bindTexture(gl.TEXTURE_2D, gridTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gridTex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  cxg = gw / 2
  cyg = gh * 0.56
  Rg = Math.min(gw, gh) * 0.4
  // Hex lattice of peak sites inside the pool disc. Every lattice slot gets a
  // texel (row, col); slots outside the disc stay empty (amplitude 0).
  sites = []
  const step = (Math.min(gw, gh) * 0.062) / params.spikes
  const rowH = step * 0.866
  latLeft = cxg - Rg; latTop = cyg - Rg; latStep = step; latRowH = rowH
  siteCols = 0
  siteRows = 0
  for (let y = -Rg, row = 0; y <= Rg; y += rowH, row++) {
    const xoff = row % 2 ? step / 2 : 0
    let col = 0
    for (let x = -Rg; x <= Rg; x += step, col++) {
      const px = x + xoff
      if (Math.hypot(px, y) > Rg) continue
      sites.push({ gx: cxg + px, gy: cyg + y, rr: Math.hypot(px, y) / Rg, ph: rt.random(0, 6.28), n: rt.random(0.75, 1.15), slot: [col, row] })
    }
    siteCols = Math.max(siteCols, col)
    siteRows = row + 1
  }
  siteData = new Float32Array(siteCols * siteRows * 4)
  for (const s of sites) {
    s.idx = (s.slot[1] * siteCols + s.slot[0]) * 4
    siteData[s.idx] = s.gx
    siteData[s.idx + 1] = s.gy
  }
}
let builtSpikes = 1
function resize() { build(); builtSpikes = params.spikes }

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  if (params.spikes !== builtSpikes) resize()

  // --- each peak's amplitude from the field, the magnet and the wobble.
  const step = (Math.min(gw, gh) * 0.062) / params.spikes
  const sg = step * 0.32 // tighter → pointier peaks, darker valleys
  const field = params.field
  const magR = Math.min(gw, gh) * 0.16
  for (const s of sites) {
    let a = field * (1 - s.rr * 0.5) * s.n
    if (params.magnet > 0) {
      const md = Math.hypot(mouse.x / gsc - s.gx, mouse.y / gsc - s.gy)
      a += params.magnet * Math.exp(-((md / magR) ** 2))
    }
    a += params.wobble * 0.1 * Math.sin(t * 3 + s.ph)
    siteData[s.idx + 2] = a > 0.04 ? a * 3.0 : 0
  }
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, siteTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, siteCols, siteRows, 0, gl.RGBA, gl.FLOAT, siteData)

  // --- pass 1: height field + shading at grid resolution
  const [tr, tg, tb] = hslArr(params.hue, 0.85, 0.62) // sheen tint
  const S = shadeProg.u
  gl.useProgram(shadeProg.p)
  gl.uniform1i(S.u_sites, 0)
  gl.uniform2i(S.u_siteDim, siteCols, siteRows)
  gl.uniform4f(S.u_lat, latLeft, latTop, latStep, latRowH)
  gl.uniform2f(S.u_grid, gw, gh)
  gl.uniform3f(S.u_pool, cxg, cyg, Rg)
  gl.uniform1f(S.u_sg, sg)
  gl.uniform1f(S.u_rad, Math.ceil(sg * 3))
  gl.uniform3f(S.u_tint, tr, tg, tb)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.viewport(0, 0, gw, gh)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  // --- pass 2: upscale to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(upProg.p)
  gl.bindTexture(gl.TEXTURE_2D, gridTex)
  gl.uniform1i(upProg.u.u_img, 0)
  gl.uniform2f(upProg.u.u_res, W, H)
  gl.uniform1f(upProg.u.u_sigma, Math.max(0.3, 0.6 * rt.pixelRatio))
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  requestAnimationFrame(frame)
}

canvas.addEventListener('pointermove', (e) => { mouse.x = e.clientX * rt.pixelRatio; mouse.y = e.clientY * rt.pixelRatio })
canvas.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4 })
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
