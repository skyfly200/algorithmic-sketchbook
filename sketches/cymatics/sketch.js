// Cymatics — sand on a Chladni plate. A standing wave rings the plate; the
// grains get shaken hardest at the antinodes and hardly at all along the nodal
// lines, so a random walk whose step is scaled by the local vibration amplitude
// naturally migrates every grain onto the nodes, drawing the resonant figure.
// Sweep the frequency to morph modes, or let the live mic's pitch drive it.
// The plate can be a full-screen rectangle, a square, a disc, or a regular
// polygon (triangle … octagon).
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
// WebGL2: the plate is a baked texture drawn as one quad and every grain is one
// point in a single draw call (60k fillRects a frame was the old bottleneck).
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE, antialias: false, alpha: false })

const params = rt.params({
  frequency: { value: 3.2, min: 1, max: 10, step: 0.05, label: 'Frequency (mode)' },
  amplitude: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Drive amplitude' },
  grains: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Grain count' },
  plate: { value: 'Rectangle', type: 'select', options: ['Rectangle', 'Square', 'Circle', 'Triangle', 'Pentagon', 'Hexagon', 'Octagon'], label: 'Plate shape' },
  audioDrive: { value: true, type: 'bool', label: 'Audio pitch drives it (mic)' },
  settle: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Settle speed' },
  hue: { value: 40, min: 0, max: 360, step: 1, label: 'Sand hue' },
})
rt.mapInput('audio.level', 'amplitude', 0.4)
rt.onBeat(() => {}) // mount the mic toggle for audio-drive

let W = 0, H = 0, PR = 1, S = 0, OX = 0, OY = 0, PW = 0, PH = 0
let grains = null // packed [x, y] * N in plate coords 0..1
let nG = 0
let verts3 = null // per-grain GPU attributes: [px, py, alpha] * N in canvas pixels

// --- GL setup ------------------------------------------------------------------
function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src); gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
}
function program(vs, fs) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  return p
}
// full-screen quad showing the baked background (dark ground + plate)
const bgProg = program(`#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() { vec2 p = P[gl_VertexID]; v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`,
`#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_tex, v_uv); }`)
// Grains: one point per grain. Each fragment works out how much of the grain's
// PR×PR square covers its pixel — the same box coverage canvas 2D's anti-aliased
// fillRect(px, py, PR, PR) gives, so the sand keeps its soft sub-pixel look.
const grainProg = program(`#version 300 es
in vec3 a_g; // canvas px (top-left of the grain square), alpha
uniform vec2 u_res;
uniform float u_size;
flat out vec3 v_g;
void main() {
  vec2 c = a_g.xy + 0.5 * u_size;
  gl_Position = vec4(c.x / u_res.x * 2.0 - 1.0, 1.0 - c.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_size + 2.0;
  v_g = a_g;
}`,
`#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_size;
uniform vec3 u_col;
flat in vec3 v_g;
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x - 0.5, u_res.y - gl_FragCoord.y - 0.5); // pixel's top-left, y down
  vec2 cov = clamp(min(px + 1.0, v_g.xy + u_size) - max(px, v_g.xy), 0.0, 1.0);
  float a = cov.x * cov.y * v_g.z;
  if (a <= 0.0) discard;
  o = vec4(u_col, a);
}`)
const uRes = gl.getUniformLocation(grainProg, 'u_res')
const uSize = gl.getUniformLocation(grainProg, 'u_size')
const uCol = gl.getUniformLocation(grainProg, 'u_col')
const aG = gl.getAttribLocation(grainProg, 'a_g')
const grainBuf = gl.createBuffer()
const grainVao = gl.createVertexArray()
gl.bindVertexArray(grainVao)
gl.bindBuffer(gl.ARRAY_BUFFER, grainBuf)
gl.enableVertexAttribArray(aG)
gl.vertexAttribPointer(aG, 3, gl.FLOAT, false, 12, 0)
const emptyVao = gl.createVertexArray()
gl.bindVertexArray(null)
const bgTex = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, bgTex)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
// the static background is baked here once per resize / plate change
const bgCanvas = document.createElement('canvas')
const bctx = bgCanvas.getContext('2d')

// --- plate shape -------------------------------------------------------------
const POLY = { Triangle: 3, Pentagon: 5, Hexagon: 6, Octagon: 8 }
function plateSides() { return POLY[params.plate] || 0 }
// radial (drumhead) modes for the disc and polygons; rectangular modes otherwise
function isRadial() { return params.plate === 'Circle' || plateSides() > 0 }
const _verts = new Map()
function vertsFor(sides) {
  if (_verts.has(sides)) return _verts.get(sides)
  const v = []
  for (let k = 0; k < sides; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / sides; v.push([0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]) }
  _verts.set(sides, v); return v
}
function pointInPoly(x, y, verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], yi = verts[i][1], xj = verts[j][0], yj = verts[j][1]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
// The plate's pixel rect — the full screen for Rectangle, a centred square box
// for everything else.
function layout() {
  if (params.plate === 'Rectangle') { OX = 0; OY = 0; PW = W; PH = H }
  else { PW = PH = S; OX = (W - S) / 2; OY = (H - S) / 2 }
  bakeBackground()
}

function want() { return Math.min(60000, Math.round(14000 * params.grains * rt.detail)) }
function seed() {
  nG = want()
  grains = new Float32Array(nG * 2)
  verts3 = new Float32Array(nG * 3)
  for (let i = 0; i < nG; i++) { const [u, v] = randInPlate(); grains[i * 2] = u; grains[i * 2 + 1] = v }
}
function resize() {
  PR = rt.pixelRatio
  W = canvas.width = Math.floor(window.innerWidth * PR)
  H = canvas.height = Math.floor(window.innerHeight * PR)
  S = Math.min(W, H) * 0.86
  layout()
  seed()
}

// Smoothed drive frequency, from audio pitch if enabled or the param otherwise.
let freqSm = 3.2
function driveFreq() {
  if (params.audioDrive && rt.beat.state.active) {
    const bins = rt.beat.getSpectrum()
    if (bins) {
      let peak = 0, pv = 0
      for (let i = 2; i < bins.length; i++) if (bins[i] > pv) { pv = bins[i]; peak = i }
      const f = 1 + (peak / bins.length) * 9
      freqSm += (f - freqSm) * 0.08
      return freqSm
    }
  }
  freqSm += (params.frequency - freqSm) * 0.1
  return freqSm
}

// Chladni standing-wave amplitude at plate coords (u,v)∈[0,1], mode from freq.
function ampRadial(u, v, m, n) {
  const du = u - 0.5, dv = v - 0.5
  const r = Math.hypot(du, dv) * 2
  const th = Math.atan2(dv, du)
  return Math.cos(m * th) * Math.cos(n * Math.PI * r)
}
function ampRect(u, v, m, n) {
  const a = Math.PI
  return Math.cos(m * a * u) * Math.cos(n * a * v) - Math.cos(n * a * u) * Math.cos(m * a * v)
}
function inPlate(u, v) {
  if (params.plate === 'Circle') return Math.hypot(u - 0.5, v - 0.5) <= 0.5
  const s = plateSides()
  if (s > 0) return pointInPoly(u, v, vertsFor(s))
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}
// A fresh random point guaranteed to sit on the plate (used to sweep grains that
// have wandered off the shape back on).
function randInPlate() {
  if (params.plate === 'Circle') {
    const a = rt.random(0, Math.PI * 2), r = 0.5 * Math.sqrt(rt.rng())
    return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]
  }
  const s = plateSides()
  if (s > 0) {
    const verts = vertsFor(s)
    let u = 0.5, v = 0.5
    for (let t = 0; t < 40; t++) { u = rt.rng(); v = rt.rng(); if (pointInPoly(u, v, verts)) break }
    return [u, v]
  }
  return [rt.rng(), rt.rng()]
}
let lastPlate = 'Rectangle'

// Trace the plate outline as a path (for the darker plate fill).
function platePath(ctx) {
  if (params.plate === 'Circle') { ctx.beginPath(); ctx.arc(OX + PW / 2, OY + PH / 2, PW / 2, 0, 6.28) }
  else {
    const s = plateSides()
    if (s > 0) {
      const v = vertsFor(s)
      ctx.beginPath()
      for (let i = 0; i < v.length; i++) { const x = OX + v[i][0] * PW, y = OY + v[i][1] * PH; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      ctx.closePath()
    } else { ctx.beginPath(); ctx.rect(OX, OY, PW, PH) }
  }
}
// Background + plate never change between frames: paint them once into a 2D
// canvas and upload it as a texture.
function bakeBackground() {
  if (!W || !H) return
  if (bgCanvas.width !== W || bgCanvas.height !== H) { bgCanvas.width = W; bgCanvas.height = H }
  bctx.fillStyle = '#0a0b10'
  bctx.fillRect(0, 0, W, H)
  bctx.fillStyle = '#12141c'
  platePath(bctx); bctx.fill()
  gl.bindTexture(gl.TEXTURE_2D, bgTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas)
}

// hsl(h, s%, l%) → linear 0..1 RGB triple (what the canvas fillStyle used to be)
function hslRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const ch = (t) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)]
}

function frame(now) {
  rt.tick(now)
  if (nG !== want()) seed()
  // Switching plate shape re-lays-out and sweeps any off-plate grains back on.
  if (params.plate !== lastPlate) {
    lastPlate = params.plate
    layout()
    for (let i = 0; i < nG; i++) {
      if (!inPlate(grains[i * 2], grains[i * 2 + 1])) { const [u, v] = randInPlate(); grains[i * 2] = u; grains[i * 2 + 1] = v }
    }
  }
  const f = driveFreq()
  const m = 1 + Math.floor(f)
  const n = 1 + Math.floor(f * 1.37 + 0.5)
  const amt = params.amplitude
  const st = params.settle

  // move grains, filling the point buffer as we go
  const step = 0.02 * st
  const amp = isRadial() ? ampRadial : ampRect
  const g = grains, out = verts3
  for (let i = 0; i < nG; i++) {
    let u = g[i * 2], v = g[i * 2 + 1]
    const A = Math.abs(amp(u, v, m, n))
    // random walk with a step scaled by local vibration → settles on nodes
    const kick = A * amt * step
    u += (rt.rng() - 0.5) * kick
    v += (rt.rng() - 0.5) * kick
    if (!inPlate(u, v)) { u = g[i * 2]; v = g[i * 2 + 1] } // reject a step off the plate
    g[i * 2] = u; g[i * 2 + 1] = v
    out[i * 3] = OX + u * PW
    out[i * 3 + 1] = OY + v * PH
    out[i * 3 + 2] = 0.5 + (1 - Math.min(1, A)) * 0.5
  }

  // background + plate (baked), then every grain in one draw call
  gl.viewport(0, 0, W, H)
  gl.disable(gl.BLEND)
  gl.useProgram(bgProg)
  gl.bindVertexArray(emptyVao)
  gl.bindTexture(gl.TEXTURE_2D, bgTex)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.useProgram(grainProg)
  gl.uniform2f(uRes, W, H)
  gl.uniform1f(uSize, PR)
  const c = hslRgb(params.hue, 0.7, 0.82)
  gl.uniform3f(uCol, c[0], c[1], c[2])
  gl.bindVertexArray(grainVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, grainBuf)
  gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, nG * 3), gl.STREAM_DRAW)
  gl.drawArrays(gl.POINTS, 0, nG)
  gl.bindVertexArray(null)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
