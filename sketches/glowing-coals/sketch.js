// Glowing Coals — a bed of embers seen from above. Rounded coal chunks pack the
// frame edge-to-edge, each one incandescent from within: a hot core fading to an
// ashen crust rim, with molten light bleeding up through the thin cracks between
// them. A few slow "hot spots" of pooled heat drift across the bed. Each coal
// breathes on its own phase plus a shared airflow; fan a patch hotter with the
// pointer; beats gust the whole bed and lift sparks.
//
// Performance: a bed is ~600-2500 coals. Drawn with Canvas2D, every coal needed
// its own path fill, radial gradient and clip() (for the crust flecks and the
// lit / shaded relief); the per-coal clip masks were what made it slow on a GPU
// (frames waiting on the rasteriser, not on JS). Now each coal's shape is baked
// once into an atlas (body coverage, crust flecks and the hot rim ring in the
// R / G / B channels), and the whole bed is a few WebGL draws: one full-screen
// pass for the ground and the ambient bed glow, one instanced draw for the
// under-halos, one for the coal bodies (heat gradient, flecks, highlight and
// shade computed per pixel from a single heat value per coal), one for sparks,
// and the ash bank, baked to a layer whenever its params change. JS only works
// out each coal's temperature.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const capture = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: capture })

const params = rt.params({
  heat: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Heat' },
  airflow: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Airflow amount' },
  airDir: { value: 20, min: 0, max: 360, step: 1, label: 'Airflow direction' },
  crust: { value: 0.7, min: 0.2, max: 1, step: 0.02, label: 'Crust darkness' },
  cracks: { value: 0.4, min: 0.05, max: 0.8, step: 0.02, label: 'Crack width' },
  coalSize: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Coal size' },
  wood: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Wood chunks' },
  ash: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Ash below' },
  hue: { value: 22, min: 0, max: 45, step: 1, label: 'Ember hue' },
  sparks: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Sparks' },
})
rt.mapInput('audio.level', 'airflow', 0.5)
rt.mapInput('audio.pulse', 'heat', 0.25)

let W = 0, H = 0, PR = 1
let coals = []
let hotspots = []
let ashClumps = []
let ashEdge = [] // wavy top-edge heights of the ash bank

// Trace a closed, rounded blob through the coal's vertices: draw quadratic
// curves through the midpoints of each edge, using the vertices as control
// points. This smooths a jagged polygon into an organic rounded pebble.
function traceBlob(c, verts, scale, ox, oy) {
  const n = verts.length
  const mx = (i) => ox + (verts[i][0] + verts[(i + 1) % n][0]) * 0.5 * scale
  const my = (i) => oy + (verts[i][1] + verts[(i + 1) % n][1]) * 0.5 * scale
  c.moveTo(mx(n - 1), my(n - 1))
  for (let i = 0; i < n; i++) c.quadraticCurveTo(ox + verts[i][0] * scale, oy + verts[i][1] * scale, mx(i), my(i))
  c.closePath()
}
// Angular trace for charred wood chunks — straight edges through the vertices
// so they read as split, splintered sticks rather than smooth pebbles.
function traceChunk(c, verts, scale, ox, oy) {
  const n = verts.length
  c.moveTo(ox + verts[0][0] * scale, oy + verts[0][1] * scale)
  for (let i = 1; i < n; i++) c.lineTo(ox + verts[i][0] * scale, oy + verts[i][1] * scale)
  c.closePath()
}

function buildCoals() {
  coals = []
  // pack tighter than the coal radius so blobs overlap and leave only thin cracks
  const step = 46 * PR * params.coalSize
  const jit = step * 0.34
  for (let y = -step; y < H + step; y += step) {
    for (let x = -step; x < W + step; x += step) {
      const cx = x + rt.random(-jit, jit)
      const cy = y + rt.random(-jit, jit)
      // a fraction are angular, elongated charred-wood chunks; the rest pebbles
      const wood = rt.rng() < params.wood
      const nv = wood ? 6 + Math.floor(rt.random(0, 3)) : 9 + Math.floor(rt.random(0, 4))
      const rBase = step * 0.62 * rt.random(0.85, 1.14)
      const aspect = wood ? rt.random(1.8, 3.0) : 1 // stretch wood into sticks
      const rot = rt.random(0, Math.PI)
      const cr = Math.cos(rot), sr = Math.sin(rot)
      const verts = []
      for (let k = 0; k < nv; k++) {
        const a = (k / nv) * Math.PI * 2 + rt.random(-0.12, wood ? 0.28 : 0.12)
        const rr = rBase * rt.random(wood ? 0.55 : 0.68, wood ? 1.15 : 1.08)
        // stretch along local x, then rotate to a random heading
        let vx = Math.cos(a) * rr * aspect, vy = Math.sin(a) * rr / Math.sqrt(aspect)
        verts.push([vx * cr - vy * sr, vx * sr + vy * cr])
      }
      // baked ash flecks, in local coords, for a crusty ashen surface texture
      const flecks = []
      for (let k = 0; k < 6; k++) flecks.push([rt.random(-rBase * 0.6, rBase * 0.6), rt.random(-rBase * 0.6, rBase * 0.6), rt.random(1.2, 3) * PR])
      coals.push({
        x: cx, y: cy, verts, flecks, r: rBase, wood,
        ox: rt.random(-0.28, 0.28) * rBase, oy: rt.random(-0.28, 0.28) * rBase,
        base: rt.random(0.35, 1), phase: rt.random(0, 6.28), rate: rt.random(0.3, 1.1),
      })
    }
  }
  bakeAtlas()
}

function buildAsh() {
  // pale ash clumps dusted over the bed, weighted toward the bottom, plus a
  // wavy top edge for the ash bank the coals sit in
  ashClumps = []
  const n = Math.round((90 + Math.floor(W * H / (14000 * PR * PR))) * rt.detail)
  for (let i = 0; i < n; i++) {
    const yb = Math.pow(rt.rng(), 0.5) // bias downward
    ashClumps.push({ x: rt.random(0, W), y: H * (1 - yb * 0.55), r: rt.random(6, 26) * PR, g: rt.random(0.5, 1), white: rt.rng() < 0.3 })
  }
  ashEdge = []
  const N = 48
  for (let i = 0; i <= N; i++) {
    const x = i / N
    ashEdge.push(0.02 * Math.sin(x * Math.PI * 2 * 3 + 1.3) + 0.014 * Math.sin(x * Math.PI * 2 * 7 + 4) + rt.random(-0.01, 0.01))
  }
  ashKey = ''
}

function buildHotspots() {
  hotspots = []
  const n = 3 + Math.floor(rt.random(0, 3))
  const m = Math.min(W, H)
  for (let i = 0; i < n; i++) hotspots.push({
    x: rt.random(W * 0.2, W * 0.8), y: rt.random(H * 0.2, H * 0.8),
    vx: rt.random(-7, 7) * PR, vy: rt.random(-7, 7) * PR,
    r: rt.random(0.2, 0.36) * m, phase: rt.random(0, 6.28), pulse: 1,
  })
}

// --- WebGL plumbing ------------------------------------------------------------
function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
function program(vs, fs, attribs = []) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  const locs = {}
  return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) }
}

const HSL = `
vec3 hsl(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}`
const QUAD = `const vec2 Q[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(0,1), vec2(0,1), vec2(1,0), vec2(1,1));`
const toClip = `vec4 toClip(vec2 px) { return vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0); }`

// Ground + ambient bed: a dim deep-red radial glow so the heap reads as hot
// embers, brightest toward the centre where a real bed pools heat.
const pBed = program(`#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`, `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_hue, u_gust;
out vec4 o;
${HSL}
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float t = clamp(length(p - u_res * 0.5) / (max(u_res.x, u_res.y) * 0.6), 0.0, 1.0);
  vec3 c = mix(hsl(u_hue + 2.0, 1.0, (16.0 + u_gust * 6.0) / 100.0), hsl(6.0, 1.0, 0.07), t);
  o = vec4(vec3(10.0, 4.0, 2.0) / 255.0 + c * 0.5 * (1.0 - t), 1.0);
}`)

// Coal instances: centre, radius, gradient focus, local sprite box, atlas rect.
const COAL_ATTRS = ['a_center', 'a_r', 'a_focal', 'a_box', 'a_uv', 'a_h']
const COAL_VS = `#version 300 es
in vec2 a_center; in float a_r; in vec2 a_focal; in vec4 a_box; in vec4 a_uv; in float a_h;
uniform vec2 u_res;
uniform float u_scale, u_crack;
out vec2 v_local, v_uv, v_focal; out float v_h, v_r;
${QUAD}
${toClip}
void main() {
  vec2 q = Q[gl_VertexID];
  v_local = mix(a_box.xy, a_box.zw, q) * u_scale;
  v_uv = mix(a_uv.xy, a_uv.zw, q);
  v_focal = a_focal;
  v_h = a_h;
  v_r = a_r * u_crack * 1.05;
  gl_Position = toClip(a_center + v_local);
}`
const pBody = program(COAL_VS, `#version 300 es
precision highp float;
in vec2 v_local, v_uv, v_focal; in float v_h, v_r;
uniform sampler2D u_atlas;
uniform float u_hue, u_crust;
out vec4 o;
${HSL}
void main() {
  vec3 m = texture(u_atlas, v_uv).rgb; // body coverage, crust flecks, rim ring
  if (m.r + m.b < 0.002) discard;
  float h = v_h, cool = 1.0 - min(1.0, h), hot = max(0.0, h - 0.9);
  // incandescent body: radial gradient from a hot (off-centre) core to an ashen rim
  vec3 c0 = hsl(u_hue + 14.0 + hot * 16.0, max(0.0, 92.0 - cool * 74.0 - hot * 60.0) / 100.0, min(95.0, 26.0 + h * 42.0 + hot * 34.0) / 100.0);
  vec3 c1 = hsl(u_hue + h * 8.0, (92.0 - cool * 46.0) / 100.0, (16.0 + h * 24.0) / 100.0);
  vec3 c2 = hsl(u_hue - 8.0 + cool * 10.0, (40.0 - cool * 26.0) / 100.0, max(3.0, (6.0 + h * 9.0) * (1.15 - u_crust * 0.7)) / 100.0);
  vec2 f = v_focal * 0.4, d = v_local - f;
  float a = dot(f, f) - v_r * v_r, b = dot(d, f), cc = dot(d, d);
  float t = clamp((b + sqrt(max(0.0, b * b - a * cc))) / -a, 0.0, 1.0);
  vec3 col = t < 0.5 ? mix(c0, c1, t * 2.0) : mix(c1, c2, t * 2.0 - 1.0);
  // crust mottle
  col = mix(col, hsl(24.0, (10.0 + cool * 12.0) / 100.0, max(6.0, 30.0 - h * 18.0) / 100.0), (0.22 + cool * 0.5) * m.g);
  // lit top-left highlight (additive) and shaded bottom-right, in units of the radius
  vec2 q = v_local / v_r;
  float tl = length(q - vec2(-0.45, -0.5)) / 1.35 / 0.6;
  col = min(vec3(1.0), col + mix(vec3(255.0, 236.0, 205.0), vec3(255.0, 230.0, 200.0), min(tl, 1.0)) / 255.0 * max(0.0, 1.0 - tl) * (0.16 + h * 0.12));
  float ts = length(q - vec2(0.5, 0.55)) / 1.25 / 0.7;
  col *= 1.0 - max(0.0, 1.0 - ts) * (0.2 + cool * 0.16);
  // faint hot rim ring on a hot coal
  float sa = h > 0.15 ? min(0.5, h * 0.45) * m.b : 0.0;
  vec3 sc = hsl(u_hue + 10.0, 1.0, min(72.0, 42.0 + h * 30.0) / 100.0);
  o = vec4(sc * sa + col * m.r * (1.0 - sa), sa + m.r * (1.0 - sa));
}`, COAL_ATTRS)
// Soft under-halo per coal (heat quantised to 1/20 like the old sprite cache).
const pHalo = program(`#version 300 es
in vec2 a_center; in float a_r; in vec2 a_focal; in vec4 a_box; in vec4 a_uv; in float a_h;
uniform vec2 u_res;
out vec2 v_q; out float v_h;
${QUAD}
${toClip}
void main() {
  v_q = Q[gl_VertexID] * 2.0 - 1.0;
  v_h = a_h;
  gl_Position = a_h < 0.05 ? vec4(2.0, 2.0, 2.0, 1.0) : toClip(a_center + v_q * a_r * 1.9);
}`, `#version 300 es
precision highp float;
in vec2 v_q; in float v_h;
uniform float u_hue;
out vec4 o;
${HSL}
void main() {
  float d = length(v_q);
  if (d >= 1.0) discard;
  float hq = max(1.0, floor(v_h * 20.0 + 0.5)) / 20.0;
  vec3 c = mix(hsl(u_hue + hq * 16.0, 1.0, min(58.0, 22.0 + hq * 30.0) / 100.0), hsl(8.0, 1.0, 0.11), d);
  o = vec4(c * min(0.5, hq * 0.5) * (1.0 - d), 0.0);
}`, COAL_ATTRS)
const pSpark = program(`#version 300 es
in vec3 a_s; // x, y, life
uniform vec2 u_res;
uniform float u_pr;
out vec2 v_p; out float v_life, v_rad;
${QUAD}
${toClip}
void main() {
  v_life = a_s.z;
  v_rad = 1.6 * u_pr * a_s.z;
  v_p = (Q[gl_VertexID] * 2.0 - 1.0) * (v_rad + 1.0);
  gl_Position = toClip(a_s.xy + v_p);
}`, `#version 300 es
precision highp float;
in vec2 v_p; in float v_life, v_rad;
uniform float u_hue;
out vec4 o;
${HSL}
void main() {
  float cov = clamp(v_rad - length(v_p) + 0.5, 0.0, 1.0);
  o = vec4(hsl(u_hue + 20.0, 1.0, (60.0 + v_life * 30.0) / 100.0) * v_life * cov, 0.0);
}`, ['a_s'])
// Ash bank layers (baked in Canvas2D): the ash itself over the bed, the ember glow on its crest added.
const pLayer = program(`#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 v_uv;
void main() { v_uv = P[gl_VertexID] * vec2(0.5, -0.5) + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`, `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o;
void main() { o = texture(u_tex, v_uv); }`)

function makeTex(filter = gl.LINEAR) {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
function upload(tex, src, premultiply) {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
}
const atlasTex = makeTex()
const ashTex = makeTex()
const crestTex = makeTex()

// Instance buffers: static per-coal data (rebuilt with the coals) + heat per frame.
const STRIDE = 13 // center2 r1 focal2 box4 uv4
const staticBuf = gl.createBuffer()
const heatBuf = gl.createBuffer()
const sparkBuf = gl.createBuffer()
let heat = new Float32Array(0)
let sparkData = new Float32Array(3 * 256)
const coalVao = gl.createVertexArray()
gl.bindVertexArray(coalVao)
gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf)
;[[0, 2, 0], [1, 1, 2], [2, 2, 3], [3, 4, 5], [4, 4, 9]].forEach(([loc, size, off]) => {
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4)
  gl.vertexAttribDivisor(loc, 1)
})
gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf)
gl.enableVertexAttribArray(5)
gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 4, 0)
gl.vertexAttribDivisor(5, 1)
const sparkVao = gl.createVertexArray()
gl.bindVertexArray(sparkVao)
gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0)
gl.vertexAttribDivisor(0, 1)
const emptyVao = gl.createVertexArray()
gl.bindVertexArray(null)

// --- shape atlas -------------------------------------------------------------
// Each coal's outline at the current crack width, drawn once into its own cell
// of an opaque-black atlas: R = body coverage, G = crust flecks, B = the hot-rim
// ring. Opaque black base + additive channels keeps the coverage values exact.
const atlasC = document.createElement('canvas')
const actx = atlasC.getContext('2d')
let bakedCrack = 1
function bakeAtlas() {
  bakedCrack = 1 - params.cracks * 0.3
  const k = bakedCrack
  const margin = 0.6 * PR + 2
  const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE))
  const boxes = coals.map((c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [vx, vy] of c.verts) { x0 = Math.min(x0, vx * k); y0 = Math.min(y0, vy * k); x1 = Math.max(x1, vx * k); y1 = Math.max(y1, vy * k) }
    const [fx, fy, fr] = c.flecks[c.flecks.length - 1] // the rim ring (see below) may poke out
    x0 = Math.min(x0, fx * k - fr); y0 = Math.min(y0, fy * k - fr); x1 = Math.max(x1, fx * k + fr); y1 = Math.max(y1, fy * k + fr)
    return [x0 - margin, y0 - margin, x1 + margin, y1 + margin]
  })
  // shelf-pack at scale s (atlas px per canvas px); shrink until it fits
  let s = Math.min(1, Math.sqrt((maxTex * maxTex * 0.7) / boxes.reduce((a, b) => a + (b[2] - b[0] + 2) * (b[3] - b[1] + 2), 1)))
  let cells, AH
  for (;;) {
    cells = []
    let x = 0, y = 0, row = 0
    for (const b of boxes) {
      const w = Math.ceil((b[2] - b[0]) * s) + 2, h = Math.ceil((b[3] - b[1]) * s) + 2
      if (x + w > maxTex) { x = 0; y += row; row = 0 }
      cells.push([x + 1, y + 1, w - 2, h - 2])
      x += w; row = Math.max(row, h)
    }
    AH = y + row
    if (AH <= maxTex) break
    s *= 0.85
  }
  const AW = maxTex
  atlasC.width = AW
  atlasC.height = Math.max(2, AH)
  actx.fillStyle = '#000'
  actx.fillRect(0, 0, AW, atlasC.height)
  const data = new Float32Array(coals.length * STRIDE)
  coals.forEach((c, i) => {
    const b = boxes[i], [cx, cy, cw, ch] = cells[i]
    const ox = cx - b[0] * s, oy = cy - b[1] * s // atlas position of the coal's centre
    const trace = c.wood ? traceChunk : traceBlob
    actx.save()
    actx.beginPath(); actx.rect(cx, cy, cw, ch); actx.clip() // axis-aligned: a cheap scissor
    actx.globalCompositeOperation = 'source-over'
    actx.fillStyle = '#f00'
    actx.beginPath(); trace(actx, c.verts, k * s, ox, oy); actx.fill()
    actx.globalCompositeOperation = 'lighter'
    actx.fillStyle = '#0f0' // flecks outside the body are masked by R in the shader
    for (const [fx, fy, fr] of c.flecks) { actx.beginPath(); actx.arc(ox + fx * k * s, oy + fy * k * s, fr * s, 0, 6.28); actx.fill() }
    // The "hot rim" stroke of the Canvas2D version stroked the current path, which
    // by then was the coal's last crust fleck: a small glowing ring. Kept as it looked.
    const [fx, fy, fr] = c.flecks[c.flecks.length - 1]
    actx.strokeStyle = '#00f'
    actx.lineWidth = 1.2 * PR * s
    actx.beginPath(); actx.arc(ox + fx * k * s, oy + fy * k * s, fr * s, 0, 6.28); actx.stroke()
    actx.restore()
    data.set([c.x, c.y, c.r, c.ox, c.oy, b[0], b[1], b[2], b[3], cx / AW, cy / atlasC.height, (cx + cw) / AW, (cy + ch) / atlasC.height], i * STRIDE)
  })
  upload(atlasTex, atlasC, false)
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  heat = new Float32Array(coals.length)
  gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf)
  gl.bufferData(gl.ARRAY_BUFFER, heat.byteLength, gl.DYNAMIC_DRAW)
}

// --- ash bank layer ------------------------------------------------------------
// A bank of pale grey-white ash the coals sit in, rising along the bottom edge,
// mottled and catching a little ember glow at its crest. Static apart from its
// params, so it is drawn in Canvas2D only when those change.
const ashC = document.createElement('canvas')
const ashCtx = ashC.getContext('2d')
const crestC = document.createElement('canvas')
const crestCtx = crestC.getContext('2d')
let ashKey = ''
function bakeAsh(hue) {
  const amt = params.ash
  const key = [amt, hue, W, H].join('|')
  if (key === ashKey) return
  ashKey = key
  for (const c of [ashC, crestC]) { c.width = W; c.height = H }
  if (amt <= 0.01) { upload(ashTex, ashC, true); upload(crestTex, crestC, true); return }
  const ctx = ashCtx
  const baseTop = H * (1 - 0.05 - amt * 0.16)
  const topAt = (x) => baseTop + (ashEdge.length ? ashEdge[Math.round(x / W * (ashEdge.length - 1))] : 0) * H
  ctx.beginPath()
  ctx.moveTo(0, H)
  ctx.lineTo(0, topAt(0))
  for (let i = 0; i < ashEdge.length; i++) ctx.lineTo(i / (ashEdge.length - 1) * W, topAt(i / (ashEdge.length - 1) * W))
  ctx.lineTo(W, H); ctx.closePath()
  ctx.save(); ctx.clip()
  const g = ctx.createLinearGradient(0, baseTop - H * 0.05, 0, H)
  g.addColorStop(0, 'rgba(205,200,193,0)')
  g.addColorStop(0.18, `rgba(198,193,186,${0.9 * amt})`)
  g.addColorStop(1, `rgba(150,146,140,${0.96 * amt})`)
  ctx.fillStyle = g; ctx.fillRect(0, baseTop - H * 0.1, W, H)
  // mottle the ash with grey/white clumps
  for (const a of ashClumps) {
    if (a.y < baseTop - H * 0.02) continue
    const lg = a.white ? 235 : 150 + a.g * 60
    ctx.fillStyle = `rgba(${lg},${lg - 6},${lg - 12},${0.1 + a.g * 0.14})`
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
  // warm ember glow licking the ash crest
  crestCtx.strokeStyle = `hsla(${hue + 8}, 100%, 55%, ${0.25 * amt})`
  crestCtx.lineWidth = 4 * PR
  crestCtx.beginPath()
  for (let i = 0; i < ashEdge.length; i++) { const x = i / (ashEdge.length - 1) * W; i ? crestCtx.lineTo(x, topAt(x)) : crestCtx.moveTo(x, topAt(x)) }
  crestCtx.stroke()
  upload(ashTex, ashC, true)
  upload(crestTex, crestC, true)
}

function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  buildCoals()
  buildHotspots()
  buildAsh()
}

const ptr = { x: -1e9, y: -1e9, t: -1e9 }
window.addEventListener('pointermove', (e) => { ptr.x = e.clientX * PR; ptr.y = e.clientY * PR; ptr.t = performance.now() })

const sparks = []
let gust = 0
rt.onBeat(({ energy }) => { gust = 0.5 + energy * 0.6 })


let lastSize = 1
let lastWood = 0.35
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  gust = Math.max(0, gust - dt * 1.2)
  if (params.coalSize !== lastSize || params.wood !== lastWood) { lastSize = params.coalSize; lastWood = params.wood; buildCoals() }
  // airflow blows in this direction; the glow ripples across the bed along it
  const adRad = params.airDir * Math.PI / 180
  const adx = Math.cos(adRad), ady = Math.sin(adRad)
  const breathPh = rt.phase('breath', 0.8 * (0.5 + params.airflow))
  const ripplePh = rt.phase('ripple', 1.2 + params.airflow * 2.2)

  // drift the hot spots slowly, bouncing off the frame's inner margins
  for (const s of hotspots) {
    s.x += s.vx * dt; s.y += s.vy * dt
    if (s.x < W * 0.1 || s.x > W * 0.9) s.vx *= -1
    if (s.y < H * 0.1 || s.y > H * 0.9) s.vy *= -1
    s.pulse = 0.55 + 0.45 * Math.sin(t * 0.4 + s.phase)
  }

  const hue = params.hue
  const fanNear = performance.now() - ptr.t < 1200
  const crackScale = 1 - params.cracks * 0.3 // shrink blobs → wider cracks between them

  // 1) compute each coal's temperature: own breath + shared airflow + gust +
  //    pooled heat from nearby drifting hot spots + the pointer's fanning.
  for (let i = 0; i < coals.length; i++) {
    const c = coals[i]
    const breath = 0.72 + 0.28 * Math.sin(breathPh - c.x * 0.004 - c.y * 0.0025)
    let h = c.base * (0.55 + 0.45 * Math.sin(t * c.rate + c.phase)) * breath
    h *= 1 + params.airflow * 0.35 * Math.sin(t * 0.7 + c.x * 0.003)
    // incoming airflow: a bright ripple of pooled oxygen sweeps across the bed
    // along the airflow direction, flaring embers hotter as it passes over them
    const proj = (c.x * adx + c.y * ady) * 0.011
    const ripple = Math.sin(proj - ripplePh)
    h += params.airflow * 0.5 * Math.max(0, ripple) * (0.6 + 0.4 * ripple)
    h += gust * 0.4
    for (const s of hotspots) {
      const d = Math.hypot(c.x - s.x, c.y - s.y)
      if (d < s.r) { const f = 1 - d / s.r; h += f * f * s.pulse * 0.9 }
    }
    if (fanNear) {
      const d = Math.hypot(c.x - ptr.x, c.y - ptr.y)
      h += Math.max(0, 1 - d / (160 * PR)) * (0.6 + params.airflow)
    }
    heat[i] = c.h = Math.max(0, Math.min(1.6, h * params.heat))
  }

  // 4) the odd spark lifting off a hot coal
  if (params.sparks > 0.01) {
    for (const c of coals) {
      if (c.h > 0.85 && rt.rng() < params.sparks * 0.02) {
        sparks.push({ x: c.x, y: c.y, vy: -rt.random(20, 60) * PR, vx: rt.random(-10, 10) * PR, life: 1 })
      }
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 8 * PR * dt; s.life -= dt * 0.8
    if (s.life <= 0) sparks.splice(i, 1)
  }
  bakeAsh(hue)

  // --- draw ---
  gl.viewport(0, 0, W, H)
  gl.disable(gl.BLEND)
  gl.bindVertexArray(emptyVao)
  gl.useProgram(pBed.p)
  gl.uniform2f(pBed.u('u_res'), W, H)
  gl.uniform1f(pBed.u('u_hue'), hue)
  gl.uniform1f(pBed.u('u_gust'), gust)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.enable(gl.BLEND)
  gl.bindVertexArray(coalVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, heat)
  // 2) soft under-halo per coal so heat bleeds up through the cracks
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.useProgram(pHalo.p)
  gl.uniform2f(pHalo.u('u_res'), W, H)
  gl.uniform1f(pHalo.u('u_hue'), hue)
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, coals.length)
  // 3) the coal bodies, each incandescent from within
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.useProgram(pBody.p)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, atlasTex)
  gl.uniform1i(pBody.u('u_atlas'), 0)
  gl.uniform2f(pBody.u('u_res'), W, H)
  gl.uniform1f(pBody.u('u_scale'), crackScale / bakedCrack)
  gl.uniform1f(pBody.u('u_crack'), crackScale)
  gl.uniform1f(pBody.u('u_hue'), hue)
  gl.uniform1f(pBody.u('u_crust'), params.crust)
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, coals.length)

  if (sparks.length && params.sparks > 0.01) {
    if (sparkData.length < sparks.length * 3) sparkData = new Float32Array(sparks.length * 6)
    sparks.forEach((s, i) => { sparkData[i * 3] = s.x; sparkData[i * 3 + 1] = s.y; sparkData[i * 3 + 2] = s.life })
    gl.bindVertexArray(sparkVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf)
    gl.bufferData(gl.ARRAY_BUFFER, sparkData.subarray(0, sparks.length * 3), gl.DYNAMIC_DRAW)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(pSpark.p)
    gl.uniform2f(pSpark.u('u_res'), W, H)
    gl.uniform1f(pSpark.u('u_pr'), PR)
    gl.uniform1f(pSpark.u('u_hue'), hue)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sparks.length)
  }

  // 5) the pale ash bank the coals sit in, then the glow on its crest
  if (params.ash > 0.01) {
    gl.bindVertexArray(emptyVao)
    gl.useProgram(pLayer.p)
    gl.uniform1i(pLayer.u('u_tex'), 0)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindTexture(gl.TEXTURE_2D, ashTex)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindTexture(gl.TEXTURE_2D, crestTex)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
