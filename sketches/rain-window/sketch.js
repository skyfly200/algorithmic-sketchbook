/**
 * Rain on a window over a live scene (camera / dropped photo or video / demo /
 * the Mixer layers below). The glass is misted, so the background reads soft
 * and pale. Droplets nucleate on it, grow, and each one acts as a little lens —
 * clip a circle, magnify and flip the scene behind it, add a bright specular
 * and a dark refracted rim. When a drop gets heavy it breaks loose and slides
 * down, swallowing the drops in its path (merging, area-conserving) and wiping
 * a clear streak through the fog that slowly mists back over.
 *
 * The drop simulation runs in JS (it is cheap); everything that touches the
 * picture is one fragment shader, so it can also run inside a Patch filter
 * chain. Each frame the drops are binned into a coarse grid and packed into a
 * small data texture (up to 8 drops per cell, centre + radius); the shader
 * finds the drops over its pixel and refracts the scene through them. The
 * wiped glass is a persistent "wet" mask kept at a third of the size in a 2D
 * canvas that fades (re-condenses) each frame, uploaded as a second texture.
 * The misted glass is a blur read from the source's mip chain.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: +rt.random(0.4, 0.85).toFixed(2), min: 0.1, max: 1, step: 0.02, label: 'Drop density' },
  fog: { value: +rt.random(0.4, 0.8).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Fogged glass' },
  gravity: { value: 0.6, min: 0.1, max: 1.5, step: 0.02, label: 'Run speed' },
  dropSize: { value: 1.0, min: 0.5, max: 2, step: 0.05, label: 'Drop size' },
  refraction: { value: 1.0, min: 0.3, max: 2, step: 0.05, label: 'Refraction' },
  wind: { value: +rt.random(0.3, 0.7).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Wind (sideways)' },
  trails: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Streak clarity' },
})
// Tilt which way the drops run by moving the mouse (or tilting the device).
// Centred: 0.5 is still air, so the pointer blows the rain either way around
// the (randomised) base wind instead of only ever to the right.
rt.mapInput('mouse.x', 'wind', 1, { center: true })

const K = 8 // drop slots per grid cell (2 texels each)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_drops;   // per cell: K slots of (x hi, x lo, y hi, y lo)(r hi, r lo, -, -)
uniform sampler2D u_wet;     // wiped-glass mask (red)
uniform vec2 u_res;
uniform float u_cell;        // grid cell size, px
uniform vec2 u_grid;         // grid size, cells
uniform float u_fog;
uniform float u_sigma;       // fog blur, px
uniform float u_trails;
uniform float u_mag;         // drop magnification
out vec4 outColor;

vec3 sharpAt(vec2 p) { return texture(u_tex, vec2(p.x / u_res.x, 1.0 - p.y / u_res.y)).rgb; }

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;   // y-down px

  // 1) misted glass: a blurred, brightened, paled copy of the scene
  float lod = max(0.0, log2(u_sigma * 0.5));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float r = u_sigma * 1.8 * sqrt((float(i) + 0.5) / 16.0);
    float a = float(i) * 2.39996;
    float w = exp(-0.5 * (r * r) / (u_sigma * u_sigma));
    acc += textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * r / u_res, lod).rgb * w;
    wsum += w;
  }
  vec3 col = min(acc / wsum * (1.0 + u_fog * 0.1), 1.0);
  col = mix(col, vec3(206.0, 212.0, 224.0) / 255.0, u_fog * 0.4);

  // 2) clear streaks: the sharp scene through the wet mask
  if (u_trails > 0.01) {
    float wet = texture(u_wet, v_uv).r;
    col = mix(col, sharpAt(px), wet * (0.55 + 0.45 * u_trails));
  }

  // 3) the drops over this pixel, painted in order
  ivec2 cell = clamp(ivec2(floor(px / u_cell)), ivec2(0), ivec2(u_grid) - 1);
  for (int k = 0; k < ${K}; k++) {
    ivec2 tp = ivec2((cell.x * ${K} + k) * 2, cell.y);
    vec4 b = floor(texelFetch(u_drops, tp + ivec2(1, 0), 0) * 255.0 + 0.5);
    float r = (b.x * 256.0 + b.y) / 64.0;
    if (r <= 0.0) break;
    vec4 a = floor(texelFetch(u_drops, tp, 0) * 255.0 + 0.5);
    vec2 c = vec2(a.x * 256.0 + a.y, a.z * 256.0 + a.w) / 8.0 - 64.0;
    float dist = length(px - c);
    if (dist > r * 1.03 + 1.0) continue;
    // the scene behind, magnified and point-inverted about a spot a touch above the centre
    float cov = clamp(r - dist + 0.5, 0.0, 1.0);
    if (cov > 0.0) {
      vec2 cc = c - vec2(0.0, r * 0.15);
      col = mix(col, sharpAt(cc - (px - cc) / u_mag), cov);
    }
    // refracted dark rim
    float lw = max(0.6, r * 0.12);
    float rim = clamp(lw * 0.5 + 0.5 - abs(dist - r * 0.96), 0.0, 1.0) * min(1.0, lw);
    col = mix(col, vec3(10.0, 14.0, 22.0) / 255.0, 0.45 * rim);
    // specular highlight (upper left): the tiny window reflection
    float hd = length(px - (c - vec2(0.32, 0.34) * r));
    col = mix(col, vec3(1.0), 0.85 * max(0.0, 1.0 - hd / (0.5 * r)));
  }
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })
const dropsTex = gf.addTexture('u_drops', 1, { filter: 'NEAREST', flipY: false })
const wetTex = gf.addTexture('u_wet', 2)

// Persistent "wet" mask at a third of the size — white where water has cleared
// the fog; fades back to black.
const WET_SCALE = 1 / 3
const wetC = document.createElement('canvas')
const wetCtx = wetC.getContext('2d')

let W = 0
let H = 0
let PR = 1
let cellPx = 32
let gridW = 1
let gridH = 1
let texW = 2
let data = new Uint8Array(8)
let counts = new Uint8Array(1)

// Called every frame: follows the render size (which changes when the filter
// joins or leaves a Patch chain) without ever caching it at load.
function ensureSize() {
  const w = gf.width
  const h = gf.height
  if (w === W && h === H && rt.pixelRatio === PR) return
  if (W > 0 && w > 0) { // keep the drops where they were on the glass
    const s = w / W
    for (const d of drops) { d.x *= s; d.y *= s; d.r *= s; d.vy *= s }
  }
  W = w
  H = h
  PR = rt.pixelRatio
  cellPx = Math.max(8, Math.round(32 * PR))
  gridW = Math.max(1, Math.ceil(W / cellPx))
  gridH = Math.max(1, Math.ceil(H / cellPx))
  texW = gridW * K * 2
  data = new Uint8Array(texW * gridH * 4)
  counts = new Uint8Array(gridW * gridH)
  wetC.width = Math.max(2, Math.ceil(W * WET_SCALE))
  wetC.height = Math.max(2, Math.ceil(H * WET_SCALE))
  wetCtx.fillStyle = '#000'
  wetCtx.fillRect(0, 0, wetC.width, wetC.height)
}

// --- droplets ---------------------------------------------------------------
// r is in render px. Small drops cling and grow; once heavy they slide.
let drops = []
const rand = (a, b) => a + rt.rng() * (b - a)

function spawn(x, y, r, sliding = false) {
  drops.push({ x, y, r, vy: 0, vx: 0, sliding, wob: rt.rng() * Math.PI * 2 })
}

function slideThreshold() {
  // Bigger window + bigger drops hold on longer before running.
  return (10 + 9 * params.dropSize) * PR
}

function step() {
  const g = slideThreshold()
  const maxDrops = Math.floor((260 + 360 * params.density) * rt.detail)
  const ws = wetC.width / W

  // Nucleation: seed new clinging droplets across the glass.
  const spawnTries = Math.ceil(params.density * 6)
  for (let i = 0; i < spawnTries; i++) {
    if (drops.length >= maxDrops) break
    if (rt.rng() < 0.5) spawn(rand(0, W), rand(0, H), rand(0.8, 2.2) * PR * params.dropSize)
  }

  const windX = (params.wind - 0.5) * 2 * 1.4 * PR // -1.4..1.4 px bias

  wetCtx.fillStyle = '#fff'
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]
    if (!d.sliding) {
      // Condensation growth, slowing as it gets big.
      d.r += (0.05 + 0.05 * params.density) * PR * (1 - d.r / (g * 1.6))
      if (d.r >= g * (0.85 + rt.rng() * 0.4)) {
        d.sliding = true
        d.vy = 0.4 * PR
      }
      continue
    }

    // Sliding: accelerate under gravity, wobble sideways, feel the wind.
    d.vy += 0.08 * params.gravity * PR * (0.6 + d.r / g)
    d.vy = Math.min(d.vy, 14 * PR * params.gravity)
    d.wob += 0.3
    d.x += windX + Math.sin(d.wob) * 0.4 * PR
    d.y += d.vy

    // Wipe the fog along the path and shed the odd residual bead.
    wetCtx.beginPath()
    wetCtx.arc(d.x * ws, d.y * ws, Math.max(0.5, d.r * 0.85 * ws), 0, Math.PI * 2)
    wetCtx.fill()
    if (rt.rng() < 0.14 && d.r > 4 * PR) {
      spawn(d.x + rand(-d.r, d.r) * 0.6, d.y - d.r, rand(0.9, 1.8) * PR * params.dropSize)
      d.r *= 0.985 // lose a little mass to the residual
    }

    // Swallow drops in the path (merge, area-conserving).
    for (let j = 0; j < drops.length; j++) {
      if (j === i) continue
      const o = drops[j]
      const dx = o.x - d.x
      const dy = o.y - d.y
      const rr = d.r + o.r
      if (dx * dx + dy * dy < rr * rr * 0.7) {
        const a = d.r * d.r + o.r * o.r
        d.r = Math.sqrt(a)
        drops.splice(j, 1)
        if (j < i) i--
      }
    }
  }

  // Coalescence among all drops (not just sliding sweepers): any two beads
  // that touch merge into one, area-conserving — the bigger keeps the spot.
  for (let i = 0; i < drops.length; i++) {
    let a = drops[i]
    for (let j = i + 1; j < drops.length; j++) {
      const b = drops[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rr = a.r + b.r
      if (dx * dx + dy * dy < rr * rr * 0.55) {
        const big = a.r >= b.r ? a : b
        const small = a.r >= b.r ? b : a
        const area = a.r * a.r + b.r * b.r
        big.r = Math.sqrt(area)
        big.sliding = big.sliding || small.sliding
        big.vy = Math.max(big.vy, small.vy)
        // the merged drop takes slot i and keeps merging as `a`
        drops[i] = big
        a = big
        drops.splice(j, 1)
        j--
      }
    }
  }

  // Cull off-screen and cap the herd.
  drops = drops.filter((d) => d.y - d.r < H + 4 && d.x > -20 * PR && d.x < W + 20 * PR)
  if (drops.length > maxDrops) drops.splice(0, drops.length - maxDrops)

  // Re-fog: the wet streaks slowly dry and mist over again.
  const dry = 0.006 + (1 - params.trails) * 0.05
  wetCtx.fillStyle = `rgba(0,0,0,${dry})`
  wetCtx.fillRect(0, 0, wetC.width, wetC.height)
}

// Bin the drops into the grid texture, in draw order (later drops paint over
// earlier ones). A cell that is somehow over-full drops the latest arrivals.
function pack() {
  data.fill(0)
  counts.fill(0)
  const clamp16 = (v) => (v < 0 ? 0 : v > 65535 ? 65535 : Math.round(v))
  for (const d of drops) {
    const ext = d.r * 1.03 + 1.5
    const x0 = Math.max(0, Math.floor((d.x - ext) / cellPx))
    const x1 = Math.min(gridW - 1, Math.floor((d.x + ext) / cellPx))
    const y0 = Math.max(0, Math.floor((d.y - ext) / cellPx))
    const y1 = Math.min(gridH - 1, Math.floor((d.y + ext) / cellPx))
    if (x0 > x1 || y0 > y1) continue
    const X = clamp16((d.x + 64) * 8)
    const Y = clamp16((d.y + 64) * 8)
    const R = Math.max(1, clamp16(d.r * 64))
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const ci = cy * gridW + cx
        const k = counts[ci]
        if (k >= K) continue
        counts[ci] = k + 1
        const o = (cy * texW + (cx * K + k) * 2) * 4
        data[o] = X >> 8
        data[o + 1] = X & 255
        data[o + 2] = Y >> 8
        data[o + 3] = Y & 255
        data[o + 4] = R >> 8
        data[o + 5] = R & 255
        data[o + 7] = 255
      }
    }
  }
}

function frame(now) {
  rt.tick(now)
  ensureSize()
  if (W > 0 && H > 0) {
    step()
    pack()
    dropsTex.upload(data, texW, gridH)
    wetTex.upload(wetC)
  }
  gf.render({ time: now * 0.001 }, (u) => {
    u.f('u_cell', cellPx)
    u.v2('u_grid', gridW, gridH)
    u.f('u_fog', params.fog)
    u.f('u_sigma', (3 + params.fog * 7) * PR)
    u.f('u_trails', params.trails)
    u.f('u_mag', 1 + 0.35 * params.refraction)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
