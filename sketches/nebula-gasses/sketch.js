// Nebula Gasses — billowing clouds of interstellar gas bloom over a live
// source (camera / dropped media / demo / the Mixer or Patch feed). Layers of
// baked fractal noise drift and curl at different speeds, each tinted across a
// nebula palette and stacked additively so overlaps glow, with a scatter of
// twinkling stars. The source shows through the thin gas; beats make it surge.
//
// One fragment shader: the three seeded cloud tiles are baked once into the
// channels of one small texture (1 px wrap border, so they tile seamlessly) and
// the stars are hashed from a jittered grid, so it can also run inside a Patch
// filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Gas density' },
  drift: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  hue: { value: 285, min: 0, max: 360, step: 1, label: 'Nebula hue' },
  spread: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Colour spread' },
  glow: { value: 0.8, min: 0, max: 1.5, step: 0.02, label: 'Inner glow' },
  stars: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Stars' },
  dim: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Dim source' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.low', 'density', 0.25)
rt.mapInput('audio.pulse', 'glow', 0.5)


// --- baked cloud noise: seeded, tileable fbm masks, softened with a wrapping blur ---
const S = 256
function bakeNoise(scale) {
  const P = new Uint8Array(512)
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = Math.floor(rt.rng() * (i + 1));[p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  function vn(x, y, rep) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const h = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
    const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
    return a + fade(yf) * (b - a)
  }
  const out = new Float32Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = (x / S) * scale, fy = (y / S) * scale
    const n = 0.5 * vn(fx, fy, scale) + 0.3 * vn(fx * 2, fy * 2, scale * 2) + 0.2 * vn(fx * 4, fy * 4, scale * 4)
    out[y * S + x] = Math.min(1, Math.max(0, (n - 0.4) * 1.9)) // billowy shapes with dark gaps between clouds
  }
  return blurWrap(out, 2)
}
// separable gaussian with wrap-around, so the tile stays seamless
function blurWrap(a, sigma) {
  const r = Math.ceil(sigma * 3)
  const k = []
  let ks = 0
  for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); ks += w }
  const tmp = new Float32Array(S * S)
  const out = new Float32Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += a[y * S + ((x + i + S) % S)] * k[i + r]
    tmp[y * S + x] = s / ks
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += tmp[((y + i + S) % S) * S + x] * k[i + r]
    out[y * S + x] = s / ks
  }
  return out
}
// pack the tiles into channels of one (S+2)² texture with a 1 px wrap border
function packTiles(tiles) {
  const T = S + 2
  const data = new Uint8Array(T * T * 4)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const si = ((y - 1 + S) % S) * S + ((x - 1 + S) % S)
    const o = (y * T + x) * 4
    for (let c = 0; c < 4; c++) data[o + c] = c < tiles.length ? Math.round(tiles[c][si] * 255) : 255
  }
  return data
}
const cloudData = packTiles([bakeNoise(4), bakeNoise(7), bakeNoise(11)])
const starSeed = rt.random(0, 1000)

// CSS hsl() → 0..1 rgb
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const ch = (t) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)]
}

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_cloud;  // r, g, b = cloud tiles A, B, C; 258² with a wrap border
uniform vec2 u_res;
uniform vec2 u_buf;         // nebula buffer size (half resolution, as the 2D version)
uniform vec3 u_l0;          // layer: offset x, offset y (buffer px), tile size
uniform vec3 u_l1;
uniform vec3 u_l2;
uniform vec3 u_la;          // layer alphas
uniform vec3 u_cols[6];     // per layer: gradient start, gradient end colour
uniform float u_gain;       // nebula strength when laid over the scene
uniform float u_dimA;       // deepen the source toward space-black
uniform float u_stars;      // star brightness (0 = off)
uniform float u_cell;       // star grid cell, px
uniform float u_occ;        // fraction of cells holding a star
uniform float u_pr;         // pixel ratio
uniform float u_seed;
uniform float u_t;          // seconds, for the twinkle
out vec4 outColor;

vec4 tile(vec2 bp, vec3 l) {
  vec2 q = fract((bp + l.xy) / l.z);
  return texture(u_cloud, (1.0 + q * 256.0) / 258.0);
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  col = mix(col, vec3(4.0, 3.0, 12.0) / 255.0, u_dimA);

  // three tinted, drifting cloud layers stacked additively
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);    // y down
  vec2 bp = p * u_buf;
  float g = clamp(dot(bp, u_buf) / dot(u_buf, u_buf), 0.0, 1.0);
  vec3 neb = mix(u_cols[0], u_cols[1], g) * (u_la.x * tile(bp, u_l0).r)
           + mix(u_cols[2], u_cols[3], g) * (u_la.y * tile(bp, u_l1).g)
           + mix(u_cols[4], u_cols[5], g) * (u_la.z * tile(bp, u_l2).b);
  col += min(neb, 1.0) * u_gain;

  // stars twinkle through the thin gas: at most one per grid cell
  if (u_stars > 0.0) {
    vec2 px = p * u_res;
    vec2 cell = floor(px / u_cell);
    vec2 cs = cell + u_seed;
    if (hash(cs) < u_occ) {
      float r = mix(0.4, 1.6, hash(cs + 7.1)) * u_pr;
      float m = min(u_cell * 0.5, r + 1.0);
      vec2 c = cell * u_cell + m + vec2(hash(cs + 1.3), hash(cs + 2.9)) * (u_cell - 2.0 * m);
      float d = length(px - c);
      float cov = clamp(r + 0.5 - d, 0.0, 1.0) * min(1.0, r * r * 3.14159);
      if (cov > 0.0) {
        float tw = hash(cs + 4.7) * 6.28318, sp = mix(1.0, 3.0, hash(cs + 5.3));
        float a = u_stars * (0.4 + 0.6 * abs(sin(tw + u_t * sp)));
        col += vec3(220.0, 230.0, 255.0) / 255.0 * a * cov;
      }
    }
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })
gf.addTexture('u_cloud', 1, { flipY: false }).upload(cloudData, S + 2, S + 2)

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const v = rt.phase('drift', 26 * params.drift)
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    const pulse = rt.beat.state.pulse
    const d = Math.min(1, params.density * (1 + pulse * 0.25))
    const spread = params.spread * 90
    const light = params.glow * (0.6 + pulse * 0.4)
    const fw = Math.max(2, gf.width >> 1)
    const fh = Math.max(2, gf.height >> 1)
    const big = Math.max(fw, fh)
    const lay = (name, ox, oy, scale) => {
      const tl = big * scale
      u.v3(name, ((ox % tl) + tl) % tl, ((oy % tl) + tl) % tl, tl)
    }
    u.v2('u_buf', fw, fh)
    lay('u_l0', v * 0.5, v * 0.12, 1.7)
    lay('u_l1', -v * 0.32, v * 0.07, 2.4)
    lay('u_l2', v * 0.9, -v * 0.05, 1.15)
    u.v3('u_la', d * 0.9, d * 0.7, d * 0.55)
    const cols = []
    for (const [off, l] of [[-spread, light], [spread * 0.6, light * 0.9], [-spread * 1.4, light * 1.1]]) {
      const hue = (params.hue + off + 360) % 360
      cols.push(...hsl(hue, 0.9, Math.min(1, (26 + l * 34) / 100)), ...hsl(hue + 50, 0.85, Math.min(1, (20 + l * 28) / 100)))
    }
    u.v3arr('u_cols', cols)
    u.f('u_gain', 0.5 + light * 0.5)
    u.f('u_dimA', d * params.dim * 0.85)
    // stars: ~260 × detail over the frame, as the 2D version's scatter
    const n = Math.round(260 * rt.detail)
    const on = params.stars > 0.02 && n > 0
    const occ = 0.7
    u.f('u_stars', on ? params.stars : 0)
    u.f('u_cell', Math.sqrt((gf.width * gf.height * occ) / Math.max(1, n)))
    u.f('u_occ', occ)
    u.f('u_pr', rt.pixelRatio)
    u.f('u_seed', starSeed)
    u.f('u_t', on ? t : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
