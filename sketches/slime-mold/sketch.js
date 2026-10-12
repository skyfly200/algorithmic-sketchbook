/**
 * Slime Mold — an agent-based Physarum plasmodium. Thousands of tiny agents
 * each crawl forward, sniffing a trail map at three points ahead (left / centre
 * / right) and turning toward wherever the scent is strongest, depositing their
 * own trail as they go. The trail diffuses and evaporates. Out of these three
 * rules a living, stringy, ever-reconfiguring vein network emerges — irregular,
 * organic, and never settling into a repeating pattern. Click to drop food that
 * the colony reaches toward and swarms.
 *
 * Performance: the agents, deposit and diffusion stay on the CPU (the agents
 * sense the trail, so it has to live there), on a grid capped at 600 cells on
 * the long side. Everything that scales with the screen — colouring the trail,
 * upscaling it, the bloom blur and the oat flakes — runs in WebGL2: the trail
 * is uploaded once a frame as an R32F texture.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 1.2, min: 0.2, max: 2, step: 0.05, label: 'Colony density' },
  speed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Crawl speed' },
  sensorDist: { value: 7, min: 3, max: 24, step: 0.5, label: 'Sensor distance' },
  sensorAngle: { value: 32, min: 8, max: 70, step: 1, label: 'Sensor angle°' },
  turn: { value: 38, min: 5, max: 80, step: 1, label: 'Turn°' },
  wiggle: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'Wander (chaos)' },
  deposit: { value: 1.1, min: 0.2, max: 2, step: 0.05, label: 'Trail deposit' },
  decay: { value: 0.05, min: 0.02, max: 0.3, step: 0.005, label: 'Evaporation' },
  // The colonised region breathes: it advances out from the inoculation point at
  // `grow`, and once it has reached full spread it pulls back in at `recede`
  // (the abandoned outer web stops being fed and evaporates), then grows again —
  // a living plasmodium that never fully settles. recede: 0 = grow once and hold.
  grow: { value: 1, min: 0.05, max: 3, step: 0.05, label: 'Fan advance (grow)' },
  recede: { value: 0.35, min: 0, max: 3, step: 0.05, label: 'Fan pull-back (recede)' },
  // Vein sharpening: a gentle unsharp feedback that pulls a little protoplasm out
  // of the faint mesh into the strong routes, so thick transport trunks emerge
  // and taper to fine twigs — the vein *hierarchy* real Physarum shows — while
  // the reticulated net behind the front survives. Push it high to prune toward
  // a few bold tubes; keep it low for a dense, lacy web.
  sharpen: { value: 0.32, min: 0, max: 1, step: 0.02, label: 'Vein sharpening' },
  glisten: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Wet sheen' },
  bloom: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Glow' },
  hue: { value: 0.44, min: 0, max: 1, step: 0.01, label: 'Tint (gold ↔ green)' },
})
// Music: beats surge the crawl, loudness thickens the trails.
rt.mapInput('audio.pulse', 'speed', 0.5)
rt.mapInput('audio.volume', 'deposit', 0.4)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE, antialias: false, alpha: false })

let W, H, trail, tmp
let agents = null // Float32Array packed [x, y, heading] * N
let nAgents = 0
let srcX = 0, srcY = 0 // the inoculation point the colony grows out from
let reach = 0, reachMin = 0, reachMax = 0, reachDir = 1 // colonised radius; breathes in/out
const foods = [] // { x, y, born } in grid coords, emit trail so the colony seeks them

function wantAgents() { return Math.min(120000, Math.round(W * H * 0.14 * params.density * rt.detail)) }

function build() {
  const long = Math.min(Math.max(window.innerWidth, window.innerHeight), 600)
  const ar = window.innerWidth / window.innerHeight
  W = ar >= 1 ? long : Math.round(long * ar)
  H = ar >= 1 ? Math.round(long / ar) : long
  trail = new Float32Array(W * H)
  tmp = new Float32Array(W * H)
  buildTargets()
  seedAgents()
}
function seedAgents() {
  nAgents = wantAgents()
  agents = new Float32Array(nAgents * 3)
  // Inoculate at the centre. Agents are pre-scattered across the whole dish at
  // the target density (so the web is properly dense everywhere), but they only
  // LAY trail inside a radius `reach` of the source that grows over time — so the
  // dense reticulated web forms progressively outward from the centre, a
  // colonised region spreading across the dish, the way a real plasmodium fans
  // out (see the reference macros).
  srcX = W / 2; srcY = H / 2
  reachMax = Math.hypot(W, H) * 0.52 // reaches the corners from the centre
  reachMin = Math.min(W, H) * 0.05   // the core it pulls back to
  reach = reachMin                   // small starting colony
  reachDir = 1
  for (let i = 0; i < nAgents; i++) {
    const o = i * 3
    agents[o] = rt.random(0, W)
    agents[o + 1] = rt.random(0, H)
    agents[o + 2] = rt.random(0, Math.PI * 2)
  }
  if (trail) trail.fill(0)
}
function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  build()
}

canvas.addEventListener('pointerdown', (e) => {
  foods.push({ x: (e.clientX / window.innerWidth) * W, y: (e.clientY / window.innerHeight) * H, born: performance.now(), ang: rt.random(0, Math.PI * 2) })
  if (foods.length > 12) foods.shift()
})

// A single rolled-oat flake — a pale, ridged oval with a central groove — drawn
// where you dropped food, shrinking as the colony consumes it. Drawn once into a
// sprite at a reference size; the frame loop only places, rotates and scales it.
function drawOat(cctx, x, y, r, ang, life) {
  cctx.save()
  cctx.translate(x, y)
  cctx.rotate(ang)
  const w = r * (0.7 + life * 0.3)
  // soft shadow
  cctx.fillStyle = 'rgba(0,0,0,0.25)'
  cctx.beginPath(); cctx.ellipse(1.5, 2, w * 1.05, w * 0.62, 0, 0, 6.28); cctx.fill()
  // oat body
  const g = cctx.createLinearGradient(0, -w * 0.6, 0, w * 0.6)
  g.addColorStop(0, '#f3e6c4')
  g.addColorStop(1, '#d9c294')
  cctx.fillStyle = g
  cctx.beginPath(); cctx.ellipse(0, 0, w, w * 0.6, 0, 0, 6.28); cctx.fill()
  // central groove
  cctx.strokeStyle = 'rgba(150,120,70,0.6)'; cctx.lineWidth = Math.max(1, w * 0.06)
  cctx.beginPath(); cctx.moveTo(-w * 0.75, 0); cctx.lineTo(w * 0.75, 0); cctx.stroke()
  // a few flat-roll ridges + flecks
  cctx.strokeStyle = 'rgba(190,165,110,0.5)'; cctx.lineWidth = Math.max(0.5, w * 0.03)
  for (let k = -2; k <= 2; k++) {
    if (k === 0) continue
    cctx.beginPath(); cctx.ellipse(0, k * w * 0.16, w * (1 - Math.abs(k) * 0.18), w * 0.06, 0, 0, 6.28); cctx.stroke()
  }
  cctx.restore()
}
// Sprite: the full-life oat at OAT_REF px radius, centred, with room for the
// shadow offset (which is in pixels, so it is scaled with the sprite: close enough).
const OAT_REF = 64
const OAT_HALF = Math.ceil(OAT_REF * 1.12 + 4)
const oatSprite = document.createElement('canvas')
oatSprite.width = oatSprite.height = OAT_HALF * 2
drawOat(oatSprite.getContext('2d'), OAT_HALF, OAT_HALF, OAT_REF, 0, 1)

// Bounded (non-wrapping) field: clamp sample coordinates so the trail doesn't
// wrap around the dish edges.
function sample(x, y) {
  const xi = x < 0 ? 0 : x >= W ? W - 1 : x | 0
  const yi = y < 0 ? 0 : y >= H ? H - 1 : y | 0
  return trail[yi * W + xi]
}

function step() {
  const SA = (params.sensorAngle * Math.PI) / 180
  const SD = params.sensorDist
  const TA = (params.turn * Math.PI) / 180
  const sp = params.speed
  const dep = params.deposit * 0.6
  const wig = params.wiggle
  // cos/sin(h ± SA) by angle addition: two trig calls per sensor set, not six.
  const cSA = Math.cos(SA), sSA = Math.sin(SA)
  const r2 = reach * reach
  const tr = trail, ag = agents, w = W, hh = H, rng = rt.rng
  for (let i = 0; i < nAgents; i++) {
    const o = i * 3
    let x = ag[o], y = ag[o + 1], h = ag[o + 2]
    // How raw is the ground here? 1 at the untouched advancing edge, →0 inside an
    // established vein. This is what separates the two behaviours: at the front
    // the fan spreads and pushes out; behind it, agents lock onto veins.
    const here = tr[(y | 0) * w + (x | 0)]
    const front = Math.max(0, 1 - here * 1.3)
    const ch = Math.cos(h), sh = Math.sin(h)
    const c = sample(x + ch * SD, y + sh * SD)
    const l = sample(x + (ch * cSA + sh * sSA) * SD, y + (sh * cSA - ch * sSA) * SD)
    const r = sample(x + (ch * cSA - sh * sSA) * SD, y + (sh * cSA + ch * sSA) * SD)
    // Chemotaxis, damped at the front so agents there DON'T all funnel onto the
    // first thread (which is what collapses a fan into a few radial spokes) —
    // they stay a broad advancing sheet, and consolidate into veins only once the
    // ground behind them has thickened.
    const chemo = TA * (1 - front * 0.7)
    if (c > l && c > r) { /* straight on */ }
    else if (c < l && c < r) h += (rng() < 0.5 ? -1 : 1) * chemo // valley → pick a side
    else if (l < r) h += chemo
    else if (r < l) h -= chemo
    // Wander, widened at the front so the just-reached margin splays sideways and
    // fills its arc as a fine mesh instead of running as straight fingers.
    h += (rng() - 0.5) * wig * (1 + front * 3)
    x += Math.cos(h) * sp
    y += Math.sin(h) * sp
    // Never leave the dish (reflect off the rim).
    if (x < 1) { x = 1; h = Math.PI - h }
    else if (x >= w - 1) { x = w - 2; h = Math.PI - h }
    if (y < 1) { y = 1; h = -h }
    else if (y >= hh - 1) { y = hh - 2; h = -h }
    ag[o] = x; ag[o + 1] = y; ag[o + 2] = h
    // Only lay trail inside the colonised radius. Agents beyond it still roam
    // (staying evenly spread, ready), but no web forms there until the advancing
    // margin reaches them — so the fan grows dense from the bottom out.
    const ddx = x - srcX, ddy = y - srcY
    if (ddx * ddx + ddy * ddy <= r2) tr[(y | 0) * w + (x | 0)] += dep
  }
}

// Food emits a puff of trail each frame, so agents climb toward it and swarm.
function emitFood(now) {
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i]
    const age = now - f.born
    if (age > 14000) { foods.splice(i, 1); continue }
    const life = 1 - age / 14000 // fades as it's "eaten"
    const rad = 5
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const d = Math.hypot(dx, dy)
      if (d > rad) continue
      const xi = (f.x + dx) | 0, yi = (f.y + dy) | 0
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue
      trail[yi * W + xi] += (1 - d / rad) * 2.5 * life
    }
  }
}

// diffuse (Gaussian 3x3) + vein-sharpening feedback + evaporate
const CAP = 6 // protoplasm density ceiling — keeps sharpening from running away
function diffuse() {
  const dk = 1 - params.decay
  const sh = params.sharpen
  const src = trail, dst = tmp, w = W
  for (let y = 0; y < H; y++) {
    // the blur wraps at the edges (as it always has); only the neighbour rows /
    // the first and last column need the wrap, so the inner loop has no modulo
    const y0 = ((y - 1 + H) % H) * w, y1 = y * w, y2 = ((y + 1) % H) * w
    for (let x = 0; x < w; x++) {
      const x0 = x === 0 ? w - 1 : x - 1, x2 = x === w - 1 ? 0 : x + 1
      // Gaussian 3x3 (1 2 1 / 2 4 2 / 1 2 1) — far more isotropic than a flat box
      // blur, so a point source no longer spreads into an axis-aligned cross.
      const c = src[y1 + x]
      const s = src[y0 + x0] + 2 * src[y0 + x] + src[y0 + x2] +
        2 * src[y1 + x0] + 4 * c + 2 * src[y1 + x2] +
        src[y2 + x0] + 2 * src[y2 + x] + src[y2 + x2]
      const blur = s * 0.0625
      // Unsharp mask: add back a fraction of the high-frequency detail (c − blur)
      // so ridges gain and hollows lose — but scale it by how much protoplasm is
      // actually here (min(1, c·2)) so the empty agar stays smooth instead of
      // sparkling. This is what carves the thick-trunk / fine-twig hierarchy.
      const v = (blur + sh * (c - blur) * (c < 1 ? c : 1)) * dk
      dst[y1 + x] = v < 0 ? 0 : v > CAP ? CAP : v
    }
  }
  trail = dst; tmp = src
}

// ---- WebGL2 display: colour → bloom blur → upscale + composite → oats ------

const VERT = `#version 300 es
in vec2 p;
out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// The colouring, exactly as the old per-pixel JS loop did it, at grid size.
const FRAG_COLOR = `#version 300 es
precision highp float;
uniform sampler2D u_trail;
uniform float u_tint, u_glis;
out vec4 o;
// The dark, faintly warm agar the plasmodium grows on (as in the macro shots):
// near-black so the plasmodium reads as glowing gold veins, greenish at the fine
// foraging mesh and paling to a wet cream sheen along the thick transport tubes.
const vec3 DISH = vec3(10.0, 13.0, 9.0) / 255.0;
vec3 hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h / 30.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * max(vec3(-1.0), min(k - 3.0, min(9.0 - k, vec3(1.0))));
}
void main() {
  // the grid is stored top row first; flip so the canvas shows it upright
  ivec2 sz = textureSize(u_trail, 0);
  ivec2 ip = ivec2(int(gl_FragCoord.x), sz.y - 1 - int(gl_FragCoord.y));
  float v = min(1.0, texelFetch(u_trail, ip, 0).r * 0.26);
  if (v < 0.006) { o = vec4(DISH, 1.0); return; }
  // Colour by vein weight: the faint frontier mesh runs green (~95°), thick
  // trunks swing to gold (~46°). Lightness climbs with weight; a steep core
  // term paints the wet, near-white sheen down the middle of the biggest tubes
  // only, so fine twigs stay dim and dark and the hierarchy reads.
  float mixv = smoothstep(0.1, 0.7, v);
  float hDeg = (88.0 - 44.0 * mixv) + u_tint;
  float sat = 0.98 - 0.34 * v;
  float light = 0.06 + 0.5 * pow(v, 0.7);
  vec3 c = hsl(hDeg, sat, light);
  float gloss = pow(v, 5.0) * u_glis;
  c += (vec3(252.0, 247.0, 205.0) / 255.0 - c) * gloss;
  // frontier mesh stays translucent over the agar; trunks go opaque
  float a = min(1.0, 0.1 + v * 2.6);
  o = vec4(mix(DISH, c, a), 1.0);
}`

// Separable Gaussian (the bloom's blur(σ) from the old canvas filter), at grid size.
const FRAG_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;   // one texel along the blur axis
uniform float u_sigma;
in vec2 vUv;
out vec4 o;
void main() {
  int r = int(min(ceil(u_sigma * 3.0), 24.0));
  float k = -0.5 / (u_sigma * u_sigma);
  vec3 acc = texture(u_src, vUv).rgb;
  float wsum = 1.0;
  for (int i = 1; i <= 24; i++) {
    if (i > r) break;
    float w = exp(float(i * i) * k);
    acc += w * (texture(u_src, vUv + u_dir * float(i)).rgb + texture(u_src, vUv - u_dir * float(i)).rgb);
    wsum += 2.0 * w;
  }
  o = vec4(acc / wsum, 1.0);
}`

// Upscale (bilinear, like drawImage with smoothing) + additive bloom ('lighter').
const FRAG_OUT = `#version 300 es
precision highp float;
uniform sampler2D u_col, u_glow;
uniform float u_bloom;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 c = texture(u_col, vUv).rgb;
  if (u_bloom > 0.001) c += u_bloom * texture(u_glow, vUv).rgb;
  o = vec4(min(c, vec3(1.0)), 1.0);
}`

// An oat sprite quad: unit corners → rotated, scaled, placed in canvas pixels.
const VERT_OAT = `#version 300 es
in vec2 p;
uniform vec2 u_center, u_canvas;
uniform float u_half, u_ang;
out vec2 vUv;
void main() {
  vUv = p * 0.5 + 0.5;
  float c = cos(u_ang), s = sin(u_ang);
  vec2 q = p * u_half;
  vec2 px = u_center + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = vec4(px / u_canvas * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`
const FRAG_OAT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_alpha;
in vec2 vUv;
out vec4 o;
void main() { o = texture(u_tex, vUv) * u_alpha; }`

function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
}
function program(vs, fs) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  const u = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name) }
  return { p, u }
}
const progColor = program(VERT, FRAG_COLOR)
const progBlur = program(VERT, FRAG_BLUR)
const progOut = program(VERT, FRAG_OUT)
const progOat = program(VERT_OAT, FRAG_OAT)

const quad = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, quad)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

function makeTex(filter) {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
const trailTex = makeTex(gl.NEAREST)
// colour, half-blurred, blurred — RGBA8 render targets at grid size
const targets = [0, 1, 2].map(() => ({ tex: makeTex(gl.LINEAR), fb: gl.createFramebuffer() }))
const oatTex = makeTex(gl.LINEAR_MIPMAP_LINEAR)
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oatSprite)
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
gl.generateMipmap(gl.TEXTURE_2D)

function buildTargets() {
  gl.bindTexture(gl.TEXTURE_2D, trailTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, null)
  for (const t of targets) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
}

function pass(target, prog) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
  if (target) gl.viewport(0, 0, W, H)
  else gl.viewport(0, 0, canvas.width, canvas.height)
  gl.useProgram(prog.p)
}
function bindTex(unit, tex) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
}

function render() {
  gl.disable(gl.BLEND)
  bindTex(0, trailTex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, trail)
  const [col, half, glow] = targets
  pass(col, progColor)
  gl.uniform1i(progColor.u.u_trail, 0)
  gl.uniform1f(progColor.u.u_tint, (params.hue - 0.5) * 40) // <0 warmer/gold · >0 cooler/green
  gl.uniform1f(progColor.u.u_glis, params.glisten)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  // Bloom: a blurred, additive re-draw so the bright veins bleed a soft glow
  // into the agar — the luminous wet look of a lit plasmodium. Same σ as the
  // old canvas blur() (in canvas px), converted to grid texels.
  const bloom = params.bloom
  if (bloom > 0.001) {
    const sigma = Math.max(0.5, Math.max(2, Math.max(canvas.width, canvas.height) * 0.004) * W / canvas.width)
    pass(half, progBlur)
    bindTex(0, col.tex)
    gl.uniform1i(progBlur.u.u_src, 0)
    gl.uniform1f(progBlur.u.u_sigma, sigma)
    gl.uniform2f(progBlur.u.u_dir, 1 / W, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    pass(glow, progBlur)
    bindTex(0, half.tex)
    gl.uniform2f(progBlur.u.u_dir, 0, 1 / H)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  pass(null, progOut)
  bindTex(0, col.tex)
  bindTex(1, glow.tex)
  gl.uniform1i(progOut.u.u_col, 0)
  gl.uniform1i(progOut.u.u_glow, 1)
  gl.uniform1f(progOut.u.u_bloom, bloom)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  // the food: a single oat flake at each drop point, being eaten over time
  if (foods.length) {
    const kx = canvas.width / W, ky = canvas.height / H
    const oatR = Math.min(canvas.width, canvas.height) * 0.03
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(progOat.p)
    bindTex(0, oatTex)
    gl.uniform1i(progOat.u.u_tex, 0)
    gl.uniform2f(progOat.u.u_canvas, canvas.width, canvas.height)
    gl.uniform1f(progOat.u.u_alpha, 1)
    const now = performance.now()
    for (const f of foods) {
      const life = Math.max(0, 1 - (now - f.born) / 14000)
      if (life <= 0) continue
      const scale = (oatR * (0.7 + life * 0.3)) / OAT_REF
      gl.uniform2f(progOat.u.u_center, f.x * kx, f.y * ky)
      gl.uniform1f(progOat.u.u_half, OAT_HALF * scale)
      gl.uniform1f(progOat.u.u_ang, f.ang ?? 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gl.disable(gl.BLEND)
  }
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  if (nAgents !== wantAgents()) seedAgents()
  // Breathe the colonised margin: grow out to full spread, then (if recede > 0)
  // pull back to the core and grow again. Beat pulse surges the outward phase, so
  // the fan lurches forward on the music.
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  const base = Math.min(W, H) * 0.12
  if (reachDir > 0) {
    reach += params.grow * base * (0.7 + rt.beat.state.pulse) * dt
    if (reach >= reachMax) { reach = reachMax; if (params.recede > 0.001) reachDir = -1 }
  } else {
    reach -= params.recede * base * dt
    if (reach <= reachMin) { reach = reachMin; reachDir = 1 }
  }
  emitFood(now)
  step()
  diffuse()
  render()
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
