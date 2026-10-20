// Stencil Spray — airbrushed stencils, rendered on the GPU.
//
// Each shape (card suits, stars, a crescent, a flower, a bolt, polygons, a
// drop) is rasterised once into a signed distance field and uploaded as one
// layer of a half-float texture array. A fragment shader turns the distance
// into spray density at full canvas resolution: densest right at the stencil
// edge and feathering outward, so the shape reads as clean negative space.
// The density is broken into real droplets (thresholded value noise, so thin
// paint falls apart into separate specks), sparse overspray spatter is
// scattered further out, and paint runs down in drips from the stencil's
// lower edges, growing while a shape is held. Shapes cross-dissolve or cut.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE, antialias: false })

const params = rt.params({
  autoCycle: { value: true, type: 'bool', label: 'auto cycle' },
  shape: { value: 0, min: 0, max: 11, step: 1, label: 'shape (manual)' },
  order: { value: 'In order', type: 'select', options: ['In order', 'Random'], label: 'cycle order' },
  transition: { value: 'Morph', type: 'select', options: ['Morph', 'Cut'], label: 'transition' },
  cycle: { value: 0.18, min: 0.02, max: 0.8, step: 0.01, label: 'cycle speed' },
  size: { value: 1.0, min: 0.5, max: 1.8, step: 0.01, label: 'stencil size' },
  spray: { value: 0.34, min: 0.05, max: 1.0, step: 0.01, label: 'halo width' },
  edge: { value: 0.16, min: 0.02, max: 0.6, step: 0.01, label: 'edge softness' },
  grain: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'spray grain' },
  droplet: { value: 3.2, min: 0.8, max: 8, step: 0.1, label: 'droplet size' },
  fizz: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'droplet fizz' },
  spatter: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'overspray spatter' },
  drips: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'drips' },
  dripLength: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'drip length' },
  fill: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'inside glow' },
  burn: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'core burn' },
  spin: { value: 0.0, min: -0.6, max: 0.6, step: 0.01, label: 'spin' },
  sprayHue: { value: 335, min: 0, max: 360, step: 1, label: 'spray hue' },
  hueShift: { value: 0, min: -180, max: 180, step: 1, label: 'outer hue shift' },
  spraySat: { value: 92, min: 0, max: 100, step: 1, label: 'spray sat' },
  bgHue: { value: 18, min: 0, max: 360, step: 1, label: 'paper hue A' },
  bgHue2: { value: 46, min: 0, max: 360, step: 1, label: 'paper hue B' },
  bgLight: { value: 52, min: 10, max: 90, step: 1, label: 'paper light' },
  paper: { value: 0.28, min: 0, max: 0.8, step: 0.01, label: 'paper grain' },
  pulse: { value: 0.5, min: 0, max: 1.5, step: 0.01, label: 'beat bloom' },
})
rt.mapInput('beat.pulse', 'pulse', 0.0) // opt-in; user can raise it

// ------------------------------------------------------------------- shapes
// Each draws a filled white silhouette centred in a GRID×GRID context, sized by
// `s` (half-extent in px). Unions of primitives keep the paths simple. The set
// is generic — card suits plus stars, a crescent, a flower, a bolt and a few
// polygons — and the sketch morphs/cuts between any of them.
const SHAPES = [
  'heart', 'spade', 'club', 'diamond', 'sparkle',
  'star', 'crescent', 'flower', 'bolt', 'hexagon', 'triangle', 'drop',
]

function drawHeart(c, cx, cy, s, flip = 1) {
  // two lobes + a triangle down to the point
  const lr = s * 0.56
  const ly = cy - flip * s * 0.28
  c.beginPath()
  c.arc(cx - s * 0.5, ly, lr, 0, Math.PI * 2)
  c.arc(cx + s * 0.5, ly, lr, 0, Math.PI * 2)
  c.fill()
  c.beginPath()
  c.moveTo(cx - s * 1.02, ly + flip * lr * 0.15)
  c.lineTo(cx + s * 1.02, ly + flip * lr * 0.15)
  c.lineTo(cx, cy + flip * s * 1.05)
  c.closePath()
  c.fill()
}
function drawStem(c, cx, cy, s) {
  // the little flared foot under a spade / club
  c.beginPath()
  c.moveTo(cx - s * 0.12, cy + s * 0.35)
  c.lineTo(cx + s * 0.12, cy + s * 0.35)
  c.lineTo(cx + s * 0.42, cy + s * 1.0)
  c.lineTo(cx - s * 0.42, cy + s * 1.0)
  c.closePath()
  c.fill()
}
// n-pointed star / sparkle: `pts` points alternating outer/inner radius.
function drawStar(c, cx, cy, s, pts, outR, inR) {
  c.beginPath()
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? s * outR : s * inR
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
  }
  c.closePath()
  c.fill()
}
function drawPoly(c, cx, cy, s, sides, rot = -Math.PI / 2) {
  c.beginPath()
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
  }
  c.closePath()
  c.fill()
}
function drawShape(c, name, cx, cy, s) {
  c.fillStyle = '#fff'
  if (name === 'heart') {
    drawHeart(c, cx, cy, s, 1)
  } else if (name === 'spade') {
    drawHeart(c, cx, cy - s * 0.08, s, -1) // heart pointing up
    drawStem(c, cx, cy + s * 0.35, s * 0.9)
  } else if (name === 'club') {
    // three lobes — each needs its own subpath (moveTo) or arc() links them
    // with stray connecting lines and the club comes out mangled
    const r = s * 0.44
    const lobe = (lx, ly) => { c.moveTo(lx + r, ly); c.arc(lx, ly, r, 0, Math.PI * 2) }
    c.beginPath()
    lobe(cx, cy - s * 0.42)
    lobe(cx - s * 0.5, cy + s * 0.1)
    lobe(cx + s * 0.5, cy + s * 0.1)
    c.fill()
    drawStem(c, cx, cy + s * 0.3, s * 0.95)
  } else if (name === 'diamond') {
    c.beginPath()
    c.moveTo(cx, cy - s * 1.05)
    c.lineTo(cx + s * 0.72, cy)
    c.lineTo(cx, cy + s * 1.05)
    c.lineTo(cx - s * 0.72, cy)
    c.closePath()
    c.fill()
  } else if (name === 'sparkle') {
    drawStar(c, cx, cy, s, 4, 1.05, 0.28) // four-point sparkle, deep notches
  } else if (name === 'star') {
    drawStar(c, cx, cy, s, 5, 1.05, 0.46) // classic five-point star
  } else if (name === 'crescent') {
    // outer disc minus an offset disc → a crescent (even-odd fill)
    c.beginPath()
    c.arc(cx, cy, s * 0.95, 0, Math.PI * 2)
    c.arc(cx + s * 0.42, cy - s * 0.04, s * 0.82, 0, Math.PI * 2)
    c.fill('evenodd')
  } else if (name === 'flower') {
    // a ring of petals around a centre — union of overlapping discs
    const petals = 6, pr = s * 0.46
    c.beginPath()
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * Math.PI * 2
      c.moveTo(cx + Math.cos(a) * s * 0.52 + pr, cy + Math.sin(a) * s * 0.52)
      c.arc(cx + Math.cos(a) * s * 0.52, cy + Math.sin(a) * s * 0.52, pr, 0, Math.PI * 2)
    }
    c.moveTo(cx + s * 0.5, cy); c.arc(cx, cy, s * 0.5, 0, Math.PI * 2)
    c.fill()
  } else if (name === 'bolt') {
    // a lightning bolt zig-zag
    const p = [[-0.1, -1.02], [0.4, -1.02], [-0.02, -0.12], [0.34, -0.12], [-0.4, 1.02], [-0.04, 0.1], [-0.46, 0.1]]
    c.beginPath()
    p.forEach(([x, y], i) => (i ? c.lineTo(cx + x * s, cy + y * s) : c.moveTo(cx + x * s, cy + y * s)))
    c.closePath()
    c.fill()
  } else if (name === 'hexagon') {
    drawPoly(c, cx, cy, s * 1.02, 6, 0)
  } else if (name === 'triangle') {
    drawPoly(c, cx, cy, s * 1.05, 3)
  } else if (name === 'drop') {
    // a teardrop: pointed at the top, round at the bottom
    c.beginPath()
    c.moveTo(cx, cy - s * 1.0)
    c.bezierCurveTo(cx + s * 0.92, cy - s * 0.12, cx + s * 0.72, cy + s * 0.98, cx, cy + s * 0.98)
    c.bezierCurveTo(cx - s * 0.72, cy + s * 0.98, cx - s * 0.92, cy - s * 0.12, cx, cy - s * 1.0)
    c.closePath()
    c.fill()
  }
}

// -------------------------------------------------------------- distance field
// Felzenszwalb 1-D squared distance transform.
function edt1d(f, n, d, v, z) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}
function edt2d(grid, W, H) {
  // grid: Float64Array, 0 = seed, Infinity elsewhere -> squared distance
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x]
    edt1d(f, H, d, v, z)
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x]
    edt1d(f, W, d, v, z)
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x]
  }
}
// Signed distance as a fraction of the field (+outside, -inside). The binary
// EDT puts the boundary on pixel centres; partially covered edge pixels use
// their coverage instead, so the upscaled edge has no stair steps.
function buildSDF(name, G) {
  const off = document.createElement('canvas')
  off.width = off.height = G
  const c = off.getContext('2d', { willReadFrequently: true })
  drawShape(c, name, G / 2, G / 2, G * 0.32)
  const px = c.getImageData(0, 0, G, G).data
  const fg = new Float64Array(G * G)
  const bg = new Float64Array(G * G)
  // NB: seed empty cells with a large *finite* value — Felzenszwalb's parabola
  // maths does f[q]-f[v] subtractions, and Infinity-Infinity would be NaN.
  const FAR = 1e12
  for (let i = 0; i < G * G; i++) {
    const inside = px[i * 4 + 3] > 127
    fg[i] = inside ? 0 : FAR // dist to shape (for outside px)
    bg[i] = inside ? FAR : 0 // dist to edge (for inside px)
  }
  edt2d(fg, G, G)
  edt2d(bg, G, G)
  const sdf = new Float32Array(G * G)
  const bottom = new Float32Array(DRIP_COLS).fill(-1)
  for (let i = 0; i < G * G; i++) {
    const a = px[i * 4 + 3] / 255
    let d = fg[i] > 0 ? Math.sqrt(fg[i]) - 0.5 : 0.5 - Math.sqrt(bg[i])
    if (a > 0.02 && a < 0.98) d = 0.5 - a
    sdf[i] = d / G
  }
  // lowest painted-over edge per drip column (field v, 0 = top)
  for (let k = 0; k < DRIP_COLS; k++) {
    const x = Math.min(G - 1, Math.floor(((k + 0.5) / DRIP_COLS) * G))
    for (let y = G - 1; y >= 0; y--) {
      if (px[(y * G + x) * 4 + 3] > 127) { bottom[k] = (y + 1) / G; break }
    }
  }
  return { sdf, bottom }
}

// ------------------------------------------------------------------- shaders
const DRIP_COLS = 96

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_sdf;
uniform sampler2D u_dripTex;     // DRIP_COLS x shapes, R = bottom edge v (-1 none)
uniform vec2 u_res;
uniform float u_span;           // field square size in canvas px
uniform float u_angle;
uniform vec2 u_layers;          // current, next
uniform float u_mix;            // 0 = current, 1 = next
uniform vec2 u_age;             // seconds each layer's drips have been running
uniform float u_wout, u_win, u_fill;
uniform float u_grain, u_drop, u_seed, u_spatter;
uniform float u_drips, u_dripLen, u_burn;
uniform vec3 u_spray;           // hue (deg), sat (0..1), outer hue shift (deg)
uniform vec3 u_paperA, u_paperB;
uniform float u_paper;
out vec4 outColor;

const float COLS = ${DRIP_COLS}.0;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1), k, s);
}

// distance to the stencil, extended linearly outside the field square
float sdfAt(vec2 uv, float layer) {
  vec2 c = clamp(uv, 0.0, 1.0);
  return texture(u_sdf, vec3(c, layer)).r + length(uv - c);
}
float sprayOf(float d) {
  float al = d >= 0.0 ? exp(-d / u_wout) : exp(d / u_win);
  if (u_fill > 0.0 && d < 0.0) al = max(al, u_fill * min(1.0, -d / (u_wout * 0.9)));
  return al;
}
// paint runs: one possible drip per column, hanging from the lowest edge
float dripOf(vec2 uv, float layer, float age, float aa) {
  if (u_drips <= 0.0 || uv.x < 0.0 || uv.x >= 1.0) return 0.0;
  float col = floor(uv.x * COLS);
  float top = texelFetch(u_dripTex, ivec2(int(col), int(layer)), 0).r;
  if (top < 0.0) return 0.0;
  vec2 h = hash22(vec2(col, layer * 17.0 + 3.0));
  if (h.x > u_drips) return 0.0;
  float h2 = hash12(vec2(col * 1.7, layer + 9.0));
  float speed = 0.25 + 0.75 * h2;
  float len = (0.03 + 0.32 * h.y) * u_dripLen * (1.0 - exp(-age * 0.35 * speed));
  float w0 = (0.18 + 0.22 * h2) / COLS;
  float cx = (col + 0.5 + (h.y - 0.5) * 0.4) / COLS;
  float s = (uv.y - top + 0.004) / max(len, 1e-4);
  if (s < 0.0 || s > 1.0 + w0 * 2.0 / max(len, 1e-4)) return 0.0;
  float w = w0 * (1.0 - 0.45 * clamp(s, 0.0, 1.0));
  float dx = abs(uv.x - cx);
  float body = s <= 1.0 ? w - dx : -1.0;
  float bulb = w0 * 1.15 - length(vec2(dx, (uv.y - top - len) * 0.8));  // drop at the tip
  return smoothstep(-aa, aa, max(body, bulb));
}

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * u_res;
  float ca = cos(u_angle), sa = sin(u_angle);
  p = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  vec2 uv = vec2(p.x, -p.y) / u_span + 0.5;      // field space, v down
  float aa = 1.2 / u_span;                       // ~1 px in field units

  float da = sdfAt(uv, u_layers.x), db = sdfAt(uv, u_layers.y);
  float al = mix(sprayOf(da), sprayOf(db), u_mix);
  float d = mix(da, db, u_mix);

  // droplets: thresholded two-octave value noise in canvas px, so dense paint
  // is solid and thin paint breaks into separate specks
  vec2 dp = (uv * u_span) / u_drop + u_seed * vec2(37.1, 11.7);
  float n = 0.62 * vnoise(dp) + 0.38 * vnoise(dp * 2.3 + 5.1);
  n = clamp((n - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  float speck = smoothstep(n - 0.08, n + 0.08, al * 1.08);
  float paint = mix(al, speck, u_grain);

  // overspray spatter: sparse round blots further out than the halo
  if (u_spatter > 0.0) {
    vec2 sp = (uv * u_span) / (u_drop * 7.0);
    vec2 cell = floor(sp);
    vec2 r2 = hash22(cell + 91.0);
    float r = 0.12 + 0.22 * r2.y;
    vec2 ctr = cell + r + (1.0 - 2.0 * r) * hash22(cell + 13.0);
    float far = exp(-max(d, 0.0) / (u_wout * 2.4)) * step(0.0, d);
    float on = step(r2.x, u_spatter * far * 0.45);
    float dot_ = 1.0 - smoothstep(r - 1.2 / (u_drop * 7.0), r, length(sp - ctr));
    paint = max(paint, on * dot_ * 0.9);
  }

  // drips from both shapes while dissolving
  float drip = mix(dripOf(uv, u_layers.x, u_age.x, aa), dripOf(uv, u_layers.y, u_age.y, aa), u_mix);
  paint = max(paint, drip * 0.95);
  paint = clamp(paint, 0.0, 1.0);

  // spray colour: hue drifts toward the halo's thin edge, dense paint burns darker
  vec3 spray = hsv(u_spray.x + u_spray.z * (1.0 - clamp(al, 0.0, 1.0)), u_spray.y, 1.0);
  spray *= 1.0 - u_burn * paint * paint;

  // paper: diagonal two-tone wash with fine fibre grain (static, full res)
  vec2 q = gl_FragCoord.xy / u_res;
  vec3 paperCol = mix(u_paperA, u_paperB, clamp((q.x + (1.0 - q.y)) * 0.5, 0.0, 1.0));
  float g = 0.55 * hash12(gl_FragCoord.xy) + 0.3 * vnoise(gl_FragCoord.xy * 0.35) + 0.15 * vnoise(gl_FragCoord.xy * vec2(0.04, 0.12));
  paperCol *= 1.0 + u_paper * (g - 0.5) * 1.1;

  outColor = vec4(mix(paperCol, spray, paint), 1.0);
}`

function compile(type, source) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program)
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
gl.useProgram(program)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const aPos = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(aPos)
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

const U = {}
for (const name of ['u_sdf', 'u_dripTex', 'u_drips', 'u_res', 'u_span', 'u_angle', 'u_layers', 'u_mix', 'u_age',
  'u_wout', 'u_win', 'u_fill', 'u_grain', 'u_drop', 'u_seed', 'u_spatter', 'u_dripLen',
  'u_burn', 'u_spray', 'u_paperA', 'u_paperB', 'u_paper']) U[name] = gl.getUniformLocation(program, name)
gl.uniform1i(U.u_sdf, 0)
gl.uniform1i(U.u_dripTex, 1)

const sdfTex = gl.createTexture()
const dripTex = gl.createTexture()

// --------------------------------------------------------------- field build
// G scales with the quality setting; rebuilt only when that changes.
let G = 0
function rebuild() {
  const want = Math.max(160, Math.min(512, Math.round(320 * rt.detail)))
  if (want === G) return
  G = want
  const N = SHAPES.length
  const sdf = new Float32Array(G * G * N)
  const drips = new Float32Array(DRIP_COLS * N)
  SHAPES.forEach((name, i) => {
    const f = buildSDF(name, G)
    sdf.set(f.sdf, i * G * G)
    drips.set(f.bottom, i * DRIP_COLS)
  })
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, sdfTex)
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, G, G, N, 0, gl.RED, gl.FLOAT, sdf)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, dripTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, DRIP_COLS, N, 0, gl.RED, gl.FLOAT, drips)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
}

function hsvRGB(h, s, v) {
  h = ((h % 360) + 360) % 360
  s /= 100
  v /= 100
  const k = (n) => {
    const x = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1))
  }
  return [k(5), k(3), k(1)]
}

function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  gl.viewport(0, 0, canvas.width, canvas.height)
}

// Generic shape-shifter: hold the current shape, then either morph or cut to a
// next shape chosen in order or at random. The two shapes' spray densities are
// cross-dissolved by `m` (lerping the distance fields fused them into broken
// hybrid shapes), so any shape can dissolve into any other.
let curIdx = 0
let nxtIdx = 1
let slotT = 0 // 0..1 progress through the current shape's slot
let curAge = 0 // seconds the current shape's drips have been running
let nxtAge = 0
let prevNow = 0
function pickNext(cur) {
  if (params.order === 'Random' && SHAPES.length > 1) {
    let n
    do { n = Math.floor(Math.random() * SHAPES.length) } while (n === cur)
    return n
  }
  return (cur + 1) % SHAPES.length
}
function advance(next) {
  curIdx = next
  curAge = nxtAge
  nxtAge = 0
}

function frame(now) {
  rt.tick(now)
  rebuild()
  const dt = Math.min(0.05, (now - prevNow) * 0.001 || 0.016)
  prevNow = now
  const W = canvas.width,
    H = canvas.height

  // --- advance the shape-shifter -------------------------------------------
  const N = SHAPES.length
  const cut = params.transition === 'Cut'
  let m = 0
  curAge += dt
  if (params.autoCycle) {
    slotT += dt * params.cycle
    if (slotT >= 1) { slotT -= Math.floor(slotT); advance(nxtIdx); nxtIdx = pickNext(curIdx) }
    // Cut: hold the current shape, snap at the slot boundary. Morph: hold the
    // clean shape for most of the slot, then a quick cross-dissolve.
    if (!cut) {
      const mt = Math.max(0, Math.min(1, (slotT - 0.78) / 0.2))
      m = mt * mt * (3 - 2 * mt)
    }
  } else {
    const target = ((Math.round(params.shape) % N) + N) % N
    if (target !== nxtIdx) nxtAge = 0
    nxtIdx = target
    if (target === curIdx) {
      slotT = 0
    } else if (cut) {
      advance(target); slotT = 0
    } else {
      slotT += dt * 3
      if (slotT >= 1) { advance(target); slotT = 0 }
      else m = slotT * slotT * (3 - 2 * slotT)
    }
  }
  if (m > 0) nxtAge += dt

  // --- uniforms --------------------------------------------------------------
  const pulse = rt.beat.state.pulse * params.pulse
  const pr = rt.pixelRatio
  // square covers the viewport at size≈1; larger zooms in, smaller pulls back
  const span = Math.max(W, H) * params.size * 1.05
  gl.uniform2f(U.u_res, W, H)
  gl.uniform1f(U.u_span, span)
  gl.uniform1f(U.u_angle, rt.phase('spin', params.spin)) // ∫ spin dt: dragging doesn't jump
  gl.uniform2f(U.u_layers, curIdx, nxtIdx)
  gl.uniform1f(U.u_mix, m)
  gl.uniform2f(U.u_age, curAge, nxtAge)
  gl.uniform1f(U.u_wout, params.spray * 0.6 * (1 + pulse * 0.6))
  gl.uniform1f(U.u_win, Math.max(1.5 / G, params.edge * 0.28 * 0.5))
  gl.uniform1f(U.u_fill, params.fill * (1 + pulse * 0.4))
  gl.uniform1f(U.u_grain, params.grain)
  gl.uniform1f(U.u_drop, params.droplet * pr)
  gl.uniform1f(U.u_seed, Math.floor(rt.phase('fizz', params.fizz * 24)) % 1000)
  gl.uniform1f(U.u_spatter, params.spatter)
  gl.uniform1f(U.u_drips, params.drips)
  gl.uniform1f(U.u_dripLen, params.dripLength)
  gl.uniform1f(U.u_burn, params.burn)
  gl.uniform3f(U.u_spray, params.sprayHue, params.spraySat / 100, params.hueShift)
  gl.uniform3f(U.u_paperA, ...hsvRGB(params.bgHue, 40, params.bgLight))
  gl.uniform3f(U.u_paperB, ...hsvRGB(params.bgHue2, 46, params.bgLight * 0.82))
  gl.uniform1f(U.u_paper, params.paper)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
