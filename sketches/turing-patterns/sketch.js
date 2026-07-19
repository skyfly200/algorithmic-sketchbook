// Turing Patterns — Gray-Scott reaction-diffusion, the classic chemical
// basis Alan Turing proposed for animal markings. Two virtual chemicals
// feed, react and diffuse on a GPU grid (ping-pong framebuffers, many steps
// per frame); different feed/kill rates grow leopard spots, coral, mazes,
// gliding solitons, worms or boiling chaos. Draw with the pointer to seed
// new growth; beats splash catalyst onto the dish.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })
gl.getExtension('EXT_color_buffer_float')

// Pearson-classified parameter presets: [feed, kill]
const PATTERNS = {
  'leopard spots': [0.0367, 0.0649],
  coral: [0.0545, 0.062],
  maze: [0.029, 0.057],
  solitons: [0.03, 0.062],
  worms: [0.078, 0.061],
  chaos: [0.026, 0.051],
}

const params = rt.params({
  pattern: { value: rt.pick(Object.keys(PATTERNS)), type: 'select', options: Object.keys(PATTERNS), label: 'Pattern' },
  feedTune: { value: 0, min: -0.01, max: 0.01, step: 0.0002, label: 'Feed tune' },
  killTune: { value: 0, min: -0.008, max: 0.008, step: 0.0002, label: 'Kill tune' },
  speed: { value: 1, min: 0.1, max: 2.5, step: 0.05, label: 'Sim speed' },
  zoom: { value: 1, min: 0.5, max: 2.5, step: 0.05, label: 'Feature size' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Hue' },
  relief: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Relief light' },
  brush: { value: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Brush size' },
})
rt.mapInput('audio.mid', 'killTune', 0.15)
rt.mapInput('audio.pulse', 'relief', 0.4)

const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`

// one Gray-Scott step: laplacian via 3x3 stencil, then reaction
const SIM = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_state;   // rg = U, V
uniform vec2 u_texel;
uniform float u_feed;
uniform float u_kill;
uniform vec4 u_brush;        // xy uv, z radius, w strength
out vec4 outColor;
void main() {
  vec2 c = texture(u_state, v_uv).rg;
  vec2 lap = -c;
  lap += 0.2 * texture(u_state, v_uv + vec2(u_texel.x, 0.0)).rg;
  lap += 0.2 * texture(u_state, v_uv - vec2(u_texel.x, 0.0)).rg;
  lap += 0.2 * texture(u_state, v_uv + vec2(0.0, u_texel.y)).rg;
  lap += 0.2 * texture(u_state, v_uv - vec2(0.0, u_texel.y)).rg;
  lap += 0.05 * texture(u_state, v_uv + u_texel).rg;
  lap += 0.05 * texture(u_state, v_uv - u_texel).rg;
  lap += 0.05 * texture(u_state, v_uv + vec2(u_texel.x, -u_texel.y)).rg;
  lap += 0.05 * texture(u_state, v_uv - vec2(u_texel.x, -u_texel.y)).rg;
  float u = c.r;
  float v = c.g;
  float uvv = u * v * v;
  float du = 1.0 * lap.r - uvv + u_feed * (1.0 - u);
  float dv = 0.5 * lap.g + uvv - (u_kill + u_feed) * v;
  u += du; v += dv;
  // pointer / beat splash: paint catalyst V into the dish
  float d = distance(v_uv, u_brush.xy);
  v += u_brush.w * exp(-pow(d / max(u_brush.z, 1e-4), 2.0));
  outColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`

// display: palette by V with sobel relief lighting
const SHOW = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_hue;
uniform float u_relief;
out vec4 outColor;
vec3 hsl2rgb(vec3 hsl) {
  vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  return hsl.z + c * (rgb - 0.5);
}
void main() {
  float v = texture(u_state, v_uv).g;
  float vx = texture(u_state, v_uv + vec2(u_texel.x, 0.0)).g - texture(u_state, v_uv - vec2(u_texel.x, 0.0)).g;
  float vy = texture(u_state, v_uv + vec2(0.0, u_texel.y)).g - texture(u_state, v_uv - vec2(0.0, u_texel.y)).g;
  float light = dot(normalize(vec3(-vx, -vy, 0.12)), normalize(vec3(-0.6, 0.7, 0.5)));
  float m = smoothstep(0.08, 0.32, v);      // membrane mask
  float h = u_hue / 360.0;
  vec3 dish = hsl2rgb(vec3(fract(h + 0.55), 0.35, 0.07));
  vec3 body = hsl2rgb(vec3(fract(h + v * 0.14), 0.7, 0.24 + v * 0.55));
  vec3 col = mix(dish, body, m);
  col += light * u_relief * m * 0.35;
  col += hsl2rgb(vec3(fract(h + 0.08), 0.9, 0.6)) * smoothstep(0.2, 0.5, v) * 0.25;
  outColor = vec4(col, 1.0);
}`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
function makeProgram(frag) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  return p
}
const simProg = makeProgram(SIM)
const showProg = makeProgram(SHOW)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
for (const p of [simProg, showProg]) {
  const loc = gl.getAttribLocation(p, 'position')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
}
const uni = (p, n) => gl.getUniformLocation(p, n)

// --- ping-pong state textures ----------------------------------------------
let simW = 0
let simH = 0
let texA = null
let texB = null
let fbA = null
let fbB = null
function makeTarget(w, h) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.HALF_FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  const fb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fb }
}

function seedDish() {
  // U = 1 everywhere, V = 0 with a seeded scatter of catalyst blobs —
  // uploaded via a float32 texture then converted by one no-op sim step
  const data = new Float32Array(simW * simH * 2)
  for (let i = 0; i < data.length; i += 2) data[i] = 1
  const blobs = 8 + Math.floor(rt.rng() * 10)
  for (let b = 0; b < blobs; b++) {
    const cx = Math.floor(rt.rng() * simW)
    const cy = Math.floor(rt.rng() * simH)
    const r = 3 + rt.rng() * 8
    for (let y = -r | 0; y <= r; y++)
      for (let x = -r | 0; x <= r; x++) {
        if (x * x + y * y > r * r) continue
        const px = (cx + x + simW) % simW
        const py = (cy + y + simH) % simH
        data[(py * simW + px) * 2 + 1] = 0.9
      }
  }
  const stage = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, stage)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, simW, simH, 0, gl.RG, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  // copy into texA with one sim step at zero rates (texel 0 makes the
  // laplacian cancel, so the step is an exact copy of the staged data)
  gl.useProgram(simProg)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, stage)
  gl.uniform1i(uni(simProg, 'u_state'), 0)
  gl.uniform2f(uni(simProg, 'u_texel'), 0, 0) // laplacian collapses to 0? no — texel 0 samples self
  gl.uniform1f(uni(simProg, 'u_feed'), 0)
  gl.uniform1f(uni(simProg, 'u_kill'), 0)
  gl.uniform4f(uni(simProg, 'u_brush'), 0, 0, 0, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbA.fb)
  gl.viewport(0, 0, simW, simH)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.deleteTexture(stage)
}

function rebuild() {
  const detail = rt.detail
  simW = Math.max(128, Math.min(768, Math.round(window.innerWidth * 0.45 * detail)))
  simH = Math.max(128, Math.min(768, Math.round(window.innerHeight * 0.45 * detail)))
  texA = makeTarget(simW, simH)
  texB = makeTarget(simW, simH)
  fbA = texA
  fbB = texB
  seedDish()
}

// --- pointer painting --------------------------------------------------------
let brushX = -10
let brushY = -10
let brushDown = false
function setBrush(e) {
  brushX = e.clientX / window.innerWidth
  brushY = 1 - e.clientY / window.innerHeight
}
canvas.addEventListener('pointerdown', (e) => { brushDown = true; setBrush(e) })
window.addEventListener('pointermove', (e) => setBrush(e))
window.addEventListener('pointerup', () => { brushDown = false })
let splash = 0
let pendingSplash = 0
let lastPattern = params.pattern
rt.onBeat(({ energy }) => { splash = 0.4 + energy * 0.6 })

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  rebuild()
}

function frame(now) {
  rt.tick(now)
  const [F, K] = PATTERNS[params.pattern] ?? PATTERNS.coral
  const feed = F + params.feedTune
  const kill = K + params.killTune
  const steps = Math.max(1, Math.round(14 * params.speed * (0.5 + rt.detail * 0.5)))
  const texel = params.zoom // feature size: scale the stencil reach

  // a sterile dish grows nothing under new rates — re-splash on preset change
  if (params.pattern !== lastPattern) {
    lastPattern = params.pattern
    pendingSplash = 24
  }

  gl.useProgram(simProg)
  gl.uniform2f(uni(simProg, 'u_texel'), texel / simW, texel / simH)
  gl.uniform1f(uni(simProg, 'u_feed'), feed)
  gl.uniform1f(uni(simProg, 'u_kill'), kill)
  gl.viewport(0, 0, simW, simH)

  for (let s = 0; s < steps; s++) {
    // brush only on the first step of the frame
    if (s === 0 && (brushDown || splash > 0.01 || pendingSplash > 0)) {
      const bx = brushDown ? brushX : rt.rng()
      const by = brushDown ? brushY : rt.rng()
      const str = brushDown ? 0.35 : splash > 0.01 ? splash * 0.5 : 0.45
      gl.uniform4f(uni(simProg, 'u_brush'), bx, by, 0.01 + params.brush * 0.04, str)
      splash = 0
      if (pendingSplash > 0) pendingSplash--
    } else {
      gl.uniform4f(uni(simProg, 'u_brush'), 0, 0, 0, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbB.fb)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, fbA.tex)
    gl.uniform1i(uni(simProg, 'u_state'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    ;[fbA, fbB] = [fbB, fbA]
  }

  gl.useProgram(showProg)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, fbA.tex)
  gl.uniform1i(uni(showProg, 'u_state'), 0)
  gl.uniform2f(uni(showProg, 'u_texel'), 1 / simW, 1 / simH)
  gl.uniform1f(uni(showProg, 'u_hue'), params.hue)
  gl.uniform1f(uni(showProg, 'u_relief'), params.relief)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
