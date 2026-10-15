// Fog — rolling banks of volumetric fog drift across a live source (camera /
// dropped media / demo / the Mixer or Patch feed). Layers of baked fractal
// noise slide at different speeds with a height bias (fog pools low), the
// scene dims into the murk with density, and beats send a slow extra surge
// rolling through.
//
// One fragment shader: the two seeded fbm tiles are baked once into one small
// texture (with a 1 px wrap border so they tile seamlessly), so it can also run
// inside a Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  density: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Density' },
  drift: { value: 1, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  height: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Ground hug' },
  murk: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Murk' },
  cool: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Cool tint' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.low', 'density', 0.25)
rt.mapInput('audio.pulse', 'drift', 0.5)


// --- baked fog noise: seeded, tileable fbm, softened with a wrapping blur ---
const S = 256
function bakeNoise(scale) {
  const P = new Uint8Array(512)
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rt.rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  // tileable value noise: lattice indices wrap at `rep`
  function vn(x, y, rep) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const h = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const a = h(xi, yi) + u * (h(xi + 1, yi) - h(xi, yi))
    const b = h(xi, yi + 1) + u * (h(xi + 1, yi + 1) - h(xi, yi + 1))
    return a + fade(yf) * (b - a)
  }
  const out = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * scale
      const fy = (y / S) * scale
      const n = 0.55 * vn(fx, fy, scale) + 0.3 * vn(fx * 2, fy * 2, scale * 2) + 0.15 * vn(fx * 4, fy * 4, scale * 4)
      out[y * S + x] = Math.min(1, Math.max(0, (n - 0.32) * 1.6)) // lift the shapes out of the mid-gray
    }
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
const noiseData = packTiles([bakeNoise(5), bakeNoise(9)])

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_noise;  // r = tile A, g = tile B; 258² with a wrap border
uniform vec2 u_res;
uniform vec2 u_buf;         // fog buffer size (half resolution, as the 2D version)
uniform vec3 u_l0;          // layer: offset x, offset y (buffer px), tile size
uniform vec3 u_l1;
uniform vec3 u_l2;
uniform vec3 u_la;          // layer alphas
uniform vec3 u_grad;        // ground-hug alpha at y = 0, 0.55, 1
uniform vec3 u_murk;        // murk colour
uniform float u_murkA;
uniform vec3 u_cast;        // colour cast
uniform float u_castA;
out vec4 outColor;

vec4 tile(vec2 bp, vec3 l) {
  vec2 q = fract((bp + l.xy) / l.z);
  return texture(u_noise, (1.0 + q * 256.0) / 258.0);
}

void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  // the scene recedes into the murk before the fog is laid on
  col = mix(col, u_murk, u_murkA);
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);    // y down
  vec2 bp = p * u_buf;
  float a = u_la.x * tile(bp, u_l0).r + u_la.y * tile(bp, u_l1).g + u_la.z * tile(bp, u_l2).r;
  float g = p.y < 0.55 ? mix(u_grad.x, u_grad.y, p.y / 0.55) : mix(u_grad.y, u_grad.z, (p.y - 0.55) / 0.45);
  a = clamp(a, 0.0, 1.0) * g;
  col = mix(col, vec3(1.0), a);
  // gentle colour cast over the fogged scene
  col = mix(col, u_cast, u_castA);
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })
gf.addTexture('u_noise', 1, { flipY: false }).upload(noiseData, S + 2, S + 2)

function frame(now) {
  rt.tick(now)
  const v = rt.phase('drift', 40 * params.drift)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const d = Math.min(1, params.density * (1 + rt.beat.state.pulse * 0.3))
    const fw = Math.max(2, gf.width >> 1)
    const fh = Math.max(2, gf.height >> 1)
    const big = Math.max(fw, fh)
    const lay = (name, ox, oy, scale) => {
      const t = big * scale
      u.v3(name, ((ox % t) + t) % t, ((oy % t) + t) % t, t)
    }
    lay('u_l0', v * 0.6, v * 0.08, 1.6)
    lay('u_l1', -v * 0.35, v * 0.05, 2.2)
    lay('u_l2', v * 1.15, -v * 0.06, 0.9)
    u.v3('u_la', d * 0.5, d * 0.4, d * 0.35)
    u.v2('u_buf', fw, fh)
    u.v3('u_grad', 1 - params.height * 0.85, 1 - params.height * 0.35, 1)
    const c = params.cool
    u.v3('u_murk', (26 - c * 14) / 255, (30 - c * 6) / 255, (36 + c * 10) / 255)
    u.f('u_murkA', d * params.murk * 0.75)
    const warm = 1 - c
    u.v3('u_cast', (200 * warm + 150 * c) / 255, (205 * warm + 175 * c) / 255, (195 * warm + 235 * c) / 255)
    u.f('u_castA', d * 0.1)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
