/**
 * Zen Garden — a raked-sand karesansui you tend with the cursor. The sand is a
 * height field: drag a rake and it carves a band of parallel grooves that follow
 * your stroke (curving as you curve); click on open sand to set a stone, and
 * concentric ripples ring it the way real gardens are raked around rocks. The
 * field is lit at a low grazing angle so every furrow casts a soft shadow and
 * catches a highlight on its far crest — the calm, tactile look of combed sand.
 *
 * Drag to rake · click to place a stone · press C to clear the sand.
 *
 * Left alone, the garden tends itself: an unseen monk rakes slow meandering
 * paths (pausing whenever you take over), the light drifts through the day on
 * a time.sin mapping, and now and then a stone is set or retired.
 *
 * The height field stays in JS (raking writes a few cells per frame) and only
 * the edited rectangle is uploaded to a float texture. Shading runs on the GPU:
 * one pass at grid resolution when the sand or the light changed, one pass that
 * scales it to the canvas and draws the stones (soft shadow + lit body).
 */
import { createRuntime } from '../_lib/runtime.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const params = rt.params({
  tines: { value: 7, min: 3, max: 16, step: 1, label: 'Rake tines' },
  spacing: { value: 10, min: 4, max: 26, step: 1, label: 'Groove spacing' },
  depth: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Groove depth' },
  light: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Light height' },
  sand: { value: 0.09, min: 0, max: 1, step: 0.01, label: 'Sand hue' },
  stoneSize: { value: 1, min: 0.5, max: 2.2, step: 0.05, label: 'Stone size' },
  auto: { value: 0.6, min: 0, max: 2, step: 0.05, label: 'Auto-tend speed' },
  wander: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Path wander' },
})
// The garden lives on its own: the sun arcs through the day, and loudness
// (when a mic or the Mixer feeds audio) quickens the monk's raking.
rt.mapInput('time.sin', 'light', 0.5)
rt.mapInput('audio.volume', 'auto', 0.5)

const canvas = document.getElementById('canvas')
// Made here first with antialias off: the sand is blitted onto the canvas, which a
// multisampled drawing buffer would refuse. glpipe then gets this same context.
canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const pipe = createGLPipe({ rt, src: null, canvas })
const gl = pipe.gl

let W, H, gsc, gw, gh
let height, grain
let dirty = true
let present = true // the canvas needs redrawing (stones or sand changed)
const stones = []
// grid rectangle edited since the last upload (inclusive), or empty
let dx0 = Infinity, dy0 = Infinity, dx1 = -1, dy1 = -1
function touch(x0, y0, x1, y1) {
  dx0 = Math.max(0, Math.min(dx0, x0)); dy0 = Math.max(0, Math.min(dy0, y0))
  dx1 = Math.min(gw - 1, Math.max(dx1, x1)); dy1 = Math.min(gh - 1, Math.max(dy1, y1))
  dirty = true
}

// height and grain as R32F textures (exact texelFetch reads, no filtering)
function floatTex() {
  const t = { tex: gl.createTexture() }
  gl.bindTexture(gl.TEXTURE_2D, t.tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
const heightTex = floatTex()
const grainTex = floatTex()
let shadeT = null

function build() {
  W = pipe.width // glpipe sized the canvas (its listener runs first)
  H = pipe.height
  gsc = Math.max(1.6, 2 * rt.pixelRatio) / rt.detail
  gw = Math.max(120, Math.floor(W / gsc))
  gh = Math.max(120, Math.floor(H / gsc))
  height = new Float32Array(gw * gh)
  grain = new Float32Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) grain[i] = rt.rng() // static sand tooth
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.bindTexture(gl.TEXTURE_2D, heightTex.tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, gw, gh, 0, gl.RED, gl.FLOAT, height)
  gl.bindTexture(gl.TEXTURE_2D, grainTex.tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, gw, gh, 0, gl.RED, gl.FLOAT, grain)
  pipe.release(shadeT)
  shadeT = pipe.target({ width: gw, height: gh })
  stones.length = 0
  dx0 = dy0 = Infinity; dx1 = dy1 = -1
  dirty = true
}

// Carve a band of parallel grooves along a stroke segment (grid coords).
function rakeSeg(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len, py = dx / len // unit perpendicular
  const sp = params.spacing / gsc
  const halfW = (params.tines * sp) / 2
  const steps = Math.ceil(len) + 1
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const cx = ax + dx * t, cy = ay + dy * t
    for (let w = -halfW; w <= halfW; w += 0.5) {
      const gx = Math.round(cx + px * w)
      const gy = Math.round(cy + py * w)
      if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue
      const edge = 1 - Math.abs(w / halfW) ** 4 // fade the band's outer edges
      height[gy * gw + gx] = -params.depth * Math.cos((w / sp) * Math.PI * 2) * edge
    }
  }
  const m = halfW + 1
  touch(Math.floor(Math.min(ax, bx) - m), Math.floor(Math.min(ay, by) - m), Math.ceil(Math.max(ax, bx) + m), Math.ceil(Math.max(ay, by) + m))
}

// Concentric ripples around a stone.
function ripples(cx, cy, R) {
  const sp = params.spacing / gsc
  const r = Math.ceil(R)
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y)
      if (d > R) continue
      const gx = (cx + x) | 0, gy = (cy + y) | 0
      if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue
      const fade = 1 - (d / R) ** 3
      height[gy * gw + gx] = -params.depth * Math.cos((d / sp) * Math.PI * 2) * fade
    }
  }
  touch((cx | 0) - r - 1, (cy | 0) - r - 1, (cx | 0) + r + 1, (cy | 0) + r + 1)
}

function placeStone(gx, gy) {
  const r = (14 + rt.random(0, 16)) * params.stoneSize
  stones.push({ x: gx, y: gy, r, ry: r * rt.random(0.62, 0.82), rot: rt.random(-0.4, 0.4), tone: rt.random(0.3, 0.55) })
  ripples(gx, gy, r / gsc + params.spacing / gsc * 3.2)
  present = true
}

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
out vec4 outColor;
`
// Shade the height field at grid resolution: grazing light so grooves emboss
// into ridged sand. Row 0 of the textures is the top row of the garden.
const SHADE = HEAD + `
uniform sampler2D u_height, u_grain;
uniform vec3 u_sandRgb, u_l;
float hAt(ivec2 p) { return texelFetch(u_height, p, 0).r + texelFetch(u_grain, p, 0).r * 0.12; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(u_res) - 1;
  float h = hAt(p);
  float hl = p.x > 0 ? hAt(p - ivec2(1, 0)) : h;
  float hr = p.x < mx.x ? hAt(p + ivec2(1, 0)) : h;
  float hu = p.y > 0 ? hAt(p - ivec2(0, 1)) : h;
  float hd = p.y < mx.y ? hAt(p + ivec2(0, 1)) : h;
  const float zScale = 4.5;
  vec3 n = normalize(vec3((hl - hr) * zScale, (hu - hd) * zScale, 1.0));
  float diff = max(0.0, dot(n, u_l));
  float v = 0.42 + diff * 0.7 + (texelFetch(u_grain, p, 0).r - 0.5) * 0.05; // ambient + light + tooth
  outColor = vec4(min(vec3(1.0), u_sandRgb * v), 1.0);
}`
// One stone (soft cast shadow + lit body), drawn inside a scissor box around it
// and blended over the sand (premultiplied alpha), in placement order.
const STONE = HEAD + `
uniform vec4 u_stone;   // x, y (canvas px, top-down), r, ry
uniform vec2 u_stone2;  // rotation, tone
// coverage of an ellipse with radii rad at local point q, ~1 px anti-aliased edge
float ellipse(vec2 q, vec2 rad) {
  float k = length(q / rad);
  float g = length(q / (rad * rad));
  float d = (k - 1.0) * k / max(g, 1e-6); // distance to the rim in px (first order)
  return clamp(0.5 - d, 0.0, 1.0);
}
void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float r = u_stone.z, ry = u_stone.w;
  vec2 d = frag - u_stone.xy;
  float c = cos(u_stone2.x), sn = sin(u_stone2.x);
  vec2 q = vec2(d.x * c + d.y * sn, -d.x * sn + d.y * c); // into the stone's rotated frame
  // soft cast shadow toward the light-away side
  float sh = 0.28 * ellipse(q - vec2(r * 0.28, ry * 0.34), vec2(r, ry) * 1.02);
  // rock body, lit from upper-left: a two-circle radial gradient like Canvas2D's
  float cov = ellipse(q, vec2(r, ry));
  vec3 g = vec3(0.0);
  if (cov > 0.0) {
    vec2 c0 = vec2(-r * 0.4, -ry * 0.45);
    float r0 = r * 0.1;
    vec2 cd = -c0, pd = q - c0;
    float dr = r - r0;
    float A = dot(cd, cd) - dr * dr, B = dot(pd, cd) + r0 * dr, C = dot(pd, pd) - r0 * r0;
    float t;
    if (abs(A) < 1e-4) t = C / (2.0 * B);
    else {
      float sq = sqrt(max(0.0, B * B - A * C));
      float t1 = (B + sq) / A, t2 = (B - sq) / A;
      t = max(t1, t2);
      if (r0 + dr * t < 0.0) t = min(t1, t2);
    }
    t = clamp(t, 0.0, 1.0);
    vec3 g0 = vec3(150.0, 150.0, 158.0), g1 = vec3(90.0, 90.0, 98.0), g2 = vec3(40.0, 40.0, 46.0);
    g = (t < 0.6 ? mix(g0, g1, t / 0.6) : mix(g1, g2, (t - 0.6) / 0.4)) * u_stone2.y / 255.0;
  }
  // body over shadow, premultiplied
  outColor = vec4(g * cov, cov + sh * (1.0 - cov));
}`
const shadeP = pipe.program(SHADE)
const stoneP = pipe.program(STONE)

function hslArr(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

// Upload the edited rectangle of the height field, then re-shade the sand.
function shade() {
  if (dx1 >= dx0 && dy1 >= dy0) {
    gl.bindTexture(gl.TEXTURE_2D, heightTex.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, gw)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, dx0)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, dy0)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, dx0, dy0, dx1 - dx0 + 1, dy1 - dy0 + 1, gl.RED, gl.FLOAT, height)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
    dx0 = dy0 = Infinity; dx1 = dy1 = -1
  }
  const [sr, sg, sb] = hslArr(params.sand, 0.36, 0.66)
  const lz = 0.3 + params.light * 0.7
  const ln = 1 / Math.hypot(-0.6, -0.55, lz)
  pipe.run(shadeP, { u_height: heightTex, u_grain: grainTex }, shadeT, (u) => {
    u.v3('u_sandRgb', sr, sg, sb)
    u.v3('u_l', -0.6 * ln, -0.55 * ln, lz * ln)
  })
  dirty = false
  present = true
}

// Scale the shaded sand up to the canvas (a filtered blit, no shader), then the
// stones, each touching only the pixels in its own box.
function drawGarden() {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, shadeT.fbo)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  gl.blitFramebuffer(0, 0, gw, gh, 0, H, W, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR) // row 0 = top
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  if (stones.length) {
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.SCISSOR_TEST)
    for (const st of stones) {
      const x = st.x * gsc, y = st.y * gsc, R = st.r * 1.5 + 2 // shadow reach ~1.46 r
      const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(W, Math.ceil(x + R))
      const y0 = Math.max(0, Math.floor(H - y - R)), y1 = Math.min(H, Math.ceil(H - y + R))
      if (x1 <= x0 || y1 <= y0) continue
      gl.scissor(x0, y0, x1 - x0, y1 - y0)
      pipe.run(stoneP, {}, null, (u) => {
        u.v4('u_stone', x, y, st.r, st.ry)
        u.v2('u_stone2', st.rot, st.tone)
      })
    }
    gl.disable(gl.SCISSOR_TEST)
    gl.disable(gl.BLEND)
  }
  present = false
}

// --- the unseen monk: autonomous raking when the visitor is idle ------------
const monk = {
  x: 0, y: 0, heading: 0,
  ph1: rt.random(0, 6.28), ph2: rt.random(0, 6.28), // wander oscillator phases
  idleSince: 0, // last user interaction (ms)
  nextStone: 12 + rt.random(0, 14), // seconds until the next stone event
}
function stepMonk(now, dt) {
  if (params.auto <= 0.01) return
  if (now - monk.idleSince < 6000) return // the visitor has the rake
  const speed = params.auto * 26 * dt // grid cells per second, scaled
  if (speed <= 0) return
  // Meander: heading turns by two slow incommensurate oscillators, plus a
  // gentle pull back toward the middle so the path stays in the bed.
  const w = params.wander
  monk.ph1 += dt * (0.5 + w * 0.7)
  monk.ph2 += dt * 0.23
  monk.heading += (Math.sin(monk.ph1) * 0.9 + Math.sin(monk.ph2) * 0.5) * w * dt * 2.2
  const toCx = gw / 2 - monk.x
  const toCy = gh / 2 - monk.y
  const toC = Math.atan2(toCy, toCx)
  const dCentre = Math.hypot(toCx, toCy) / (Math.min(gw, gh) / 2)
  let dh = toC - monk.heading
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  monk.heading += dh * Math.min(1, Math.max(0, dCentre - 0.55)) * dt * 3
  const nx = monk.x + Math.cos(monk.heading) * speed
  const ny = monk.y + Math.sin(monk.heading) * speed
  rakeSeg(monk.x, monk.y, nx, ny)
  monk.x = nx
  monk.y = ny
  // Stone events: occasionally set a new stone off the raked path — and once
  // the garden is crowded, quietly retire the oldest with a fresh ripple ring.
  monk.nextStone -= dt * params.auto
  if (monk.nextStone <= 0) {
    monk.nextStone = 18 + rt.random(0, 20)
    if (stones.length >= 6) {
      const old = stones.shift()
      present = true
      ripples(old.x, old.y, old.r / gsc + (params.spacing / gsc) * 2.5)
    } else {
      placeStone(rt.random(0.15, 0.85) * gw, rt.random(0.15, 0.85) * gh)
    }
  }
}

let lastLight = -1
let lastSand = -1
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0.016
  lastNow = now
  stepMonk(now, dt)
  // Mapped params (the drifting sun) re-shade the standing field.
  if (Math.abs(params.light - lastLight) > 0.004 || params.sand !== lastSand) {
    lastLight = params.light
    lastSand = params.sand
    dirty = true
  }
  if (dirty) shade()
  // nothing changed: the canvas keeps showing the last frame
  if (present) drawGarden()
  requestAnimationFrame(frame)
}

// Auto-tend a calm starting garden.
function seedGarden() {
  // A gentle horizontal comb across the whole bed.
  for (let y = 0; y < gh; y += (params.tines * params.spacing) / gsc) rakeSeg(0, y, gw, y)
  placeStone(gw * 0.32, gh * 0.4)
  placeStone(gw * 0.66, gh * 0.62)
  placeStone(gw * 0.5, gh * 0.24)
}

// --- interaction: drag to rake, click to place a stone ---
let down = false
let moved = false
let prev = null
function toGrid(e) { return [(e.clientX * rt.pixelRatio) / gsc, (e.clientY * rt.pixelRatio) / gsc] }
canvas.addEventListener('pointerdown', (e) => { down = true; moved = false; prev = toGrid(e); monk.idleSince = performance.now() })
canvas.addEventListener('pointermove', (e) => {
  if (!down) return
  const p = toGrid(e)
  if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1) {
    moved = true
    rakeSeg(prev[0], prev[1], p[0], p[1])
    prev = p
    monk.idleSince = performance.now()
  }
})
window.addEventListener('pointerup', (e) => {
  if (down && !moved) { const p = toGrid(e); placeStone(p[0], p[1]) }
  down = false
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') { height.fill(0); stones.length = 0; touch(0, 0, gw - 1, gh - 1) }
})

function resize() {
  build()
  seedGarden()
  monk.x = rt.random(0.2, 0.8) * gw
  monk.y = rt.random(0.2, 0.8) * gh
  monk.heading = rt.random(0, Math.PI * 2)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
