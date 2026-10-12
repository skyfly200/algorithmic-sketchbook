// Shaky Film — a rickety old-projector look for a live source: the frame weaves
// and jitters in the gate, jumps as the film slips a frame, flickers in exposure,
// and is peppered with grain, drifting hair/dust and the occasional vertical
// scratch. A slight overscan hides the black edges as it shakes. Fully filmic
// damage — pair it with Film Tone for sepia/black & white.
//
// One fragment shader. The random events (jitter, jumps, scratches, specks,
// hairs) are rolled in JS each frame and passed as uniforms, so the picture is
// a pure function of the input and the uniforms and it can also run inside a
// Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  shake: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Gate weave / shake' },
  jump: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Frame jumps' },
  flicker: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Exposure flicker' },
  grain: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Grain' },
  scratches: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Scratches' },
  dust: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Dust & hair' },
  vignette: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'shake', 0.6)


const MAX_SCR = 16, MAX_DUST = 14, MAX_HAIR = 3

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec3 u_xf;          // translate x, y (px), rotation
uniform float u_over;       // overscan scale
uniform vec2 u_flick;       // veil alpha, veil grey (0 dark / 1 bright)
uniform vec3 u_grain;       // alpha, cell size (px), seed
uniform vec2 u_grainOff;    // tile offset, px
uniform int u_nScr;
uniform vec3 u_scr[${MAX_SCR}];     // x, width (px), alpha (+ bright / - dark)
uniform int u_nDust;
uniform vec3 u_dust[${MAX_DUST}];   // x, y, radius (+ bright / - dark)
uniform int u_nHair;
uniform vec3 u_hair[${MAX_HAIR * 3}]; // per hair: (x, y, a0) (a1, a2, a3) (a4, a5, -)
uniform float u_pr;
uniform float u_vig;
out vec4 outColor;

float hash(uvec2 q) {
  q = q * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  n ^= n >> 16; n *= 2246822519u; n ^= n >> 13;
  return float(n) * (1.0 / 4294967295.0);
}
float grainAt(vec2 c, uint seed) {
  // a 256² random tile, scaled up with bilinear smoothing like the 2D blit
  c -= 0.5;
  vec2 i = floor(c), f = c - i;
  uvec2 a = uvec2(ivec2(mod(i, 256.0))), b = uvec2(ivec2(mod(i + 1.0, 256.0)));
  uvec2 s = uvec2(seed, seed * 7u);
  return mix(mix(hash(uvec2(a.x, a.y) + s), hash(uvec2(b.x, a.y) + s), f.x),
             mix(hash(uvec2(a.x, b.y) + s), hash(uvec2(b.x, b.y) + s), f.x), f.y);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0));
}

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;   // y down, pixel centres

  // gate weave / jitter / jump: inverse of translate(centre + t) · rotate · scale
  vec2 c = u_res * 0.5;
  vec2 q = px - c - u_xf.xy;
  float cs = cos(u_xf.z), sn = sin(u_xf.z);
  q = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs) / u_over + c;
  vec2 suv = q / u_res;
  vec3 col = (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) ? vec3(0.0)
           : texture(u_tex, vec2(suv.x, 1.0 - suv.y)).rgb;

  // exposure flicker: a translucent black / white veil
  col = mix(col, vec3(u_flick.y), u_flick.x);

  // grain, overlay-blended
  if (u_grain.x > 0.0) {
    float g = grainAt((px + u_grainOff) / u_grain.y, uint(u_grain.z));
    vec3 ov = mix(2.0 * col * g, 1.0 - 2.0 * (1.0 - col) * (1.0 - g), step(0.5, col));
    col = mix(col, ov, u_grain.x);
  }

  // scratches: thin full-height lines
  float L = px.x - 0.5;
  for (int i = 0; i < ${MAX_SCR}; i++) {
    if (i >= u_nScr) break;
    vec3 s = u_scr[i];
    float cov = clamp(min(s.x + s.y, L + 1.0) - max(s.x, L), 0.0, 1.0);
    if (cov > 0.0) col = mix(col, s.z > 0.0 ? vec3(1.0, 1.0, 245.0 / 255.0) : vec3(20.0, 14.0, 8.0) / 255.0, abs(s.z) * cov);
  }

  // dust specks
  for (int i = 0; i < ${MAX_DUST}; i++) {
    if (i >= u_nDust) break;
    vec3 d = u_dust[i];
    float r = abs(d.z);
    float cov = clamp(r + 0.5 - length(px - d.xy), 0.0, 1.0);
    if (cov > 0.0) col = mix(col, d.z > 0.0 ? vec3(1.0, 1.0, 250.0 / 255.0) : vec3(0.0), 0.5 * cov);
  }

  // hairs: a short crooked stroke out from a point
  for (int h = 0; h < ${MAX_HAIR}; h++) {
    if (h >= u_nHair) break;
    vec3 h0 = u_hair[h * 3], h1 = u_hair[h * 3 + 1], h2 = u_hair[h * 3 + 2];
    vec2 o = h0.xy;
    float R = 8.0 * u_pr;
    float ang[5] = float[5](h0.z, h1.x, h1.y, h1.z, h2.x);
    vec2 prev = o;
    float dm = 1e9;
    for (int k = 0; k < 5; k++) {
      vec2 nx = o + vec2(cos(ang[k]), sin(ang[k])) * R;
      dm = min(dm, segDist(px, prev, nx));
      prev = nx;
    }
    float cov = clamp(u_pr * 0.5 + 0.5 - dm, 0.0, 1.0);
    if (cov > 0.0) col = mix(col, vec3(10.0, 8.0, 4.0) / 255.0, 0.6 * cov);
  }

  // vignette
  if (u_vig > 0.0) {
    float mn = min(u_res.x, u_res.y), mx = max(u_res.x, u_res.y);
    float t = clamp((length(px - c) - mn * 0.34) / (mx * 0.72 - mn * 0.34), 0.0, 1.0);
    col *= 1.0 - u_vig * t;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })
const grainSeed = Math.floor(rt.random(0, 65536))

// scratches persist a few frames and drift horizontally, like a hair caught in
// the gate; each has an x, a lifetime, a width and whether it's a bright or dark line.
const scratches = []
let jumpY = 0, jumpHold = 0

function frame(now) {
  rt.tick(now)
  // gate weave clock: the 2D version stepped 0.016 a frame (~0.96 / s at 60 fps)
  const weaveT = rt.phase('weave', 0.96)
  const W = gf.width, H = gf.height, minDim = Math.min(W, H)
  const pr = rt.pixelRatio
  const sh = params.shake

  // --- motion: gate weave + jitter + occasional frame jump ---
  const weaveX = (Math.sin(weaveT * 3.1) + 0.5 * Math.sin(weaveT * 7.7 + 1)) * sh * minDim * 0.006
  const weaveY = (Math.cos(weaveT * 2.3) + 0.5 * Math.sin(weaveT * 6.1 + 2)) * sh * minDim * 0.006
  const jitX = (rt.rng() - 0.5) * sh * minDim * 0.004
  const jitY = (rt.rng() - 0.5) * sh * minDim * 0.004
  // frame jump: now and then the image slips vertically and snaps back
  if (jumpHold > 0) jumpHold--
  else if (rt.rng() < params.jump * 0.03) { jumpY = (rt.rng() - 0.5) * H * 0.12 * params.jump; jumpHold = 2 + (rt.rng() * 4 | 0) }
  else jumpY *= 0.6
  const rot = (Math.sin(weaveT * 1.7) * 0.5 + jitX * 0.02 / (minDim * 0.004 || 1)) * sh * 0.01
  const over = 1 + 0.06 + sh * 0.05

  // --- exposure flicker ---
  let flA = 0, flG = 0
  if (params.flicker > 0.01) {
    const fl = (Math.sin(weaveT * 21) * 0.5 + 0.5) * (0.4 + 0.6 * rt.rng())
    flG = fl < 0.5 ? 0 : 1
    flA = params.flicker * 0.28 * Math.abs(fl - 0.5) * 2
  }

  // --- scratches: spawn and age ---
  if (params.scratches > 0.01 && scratches.length < MAX_SCR && rt.rng() < params.scratches * 0.35) {
    scratches.push({ x: rt.rng() * W, life: 3 + (rt.rng() * 20 | 0), w: rt.random(0.6, 2.4) * pr, bright: rt.rng() < 0.7, vx: rt.random(-0.4, 0.4) * pr })
  }
  const scr = []
  for (let i = scratches.length - 1; i >= 0; i--) {
    const s = scratches[i]
    s.x += s.vx; s.life--
    if (s.life <= 0) { scratches.splice(i, 1); continue }
    const a = 0.35 * Math.min(1, s.life / 6) * 0.9
    scr.push(s.x, s.w, s.bright ? a : -a)
  }
  const nScr = scr.length / 3
  while (scr.length < MAX_SCR * 3) scr.push(0, 0, 0)

  // --- dust & hair specks ---
  const dust = [], hair = []
  if (params.dust > 0.01) {
    const n = (params.dust * 14) | 0
    for (let i = 0; i < n; i++) {
      if (rt.rng() > 0.5) continue
      const x = rt.rng() * W, y = rt.rng() * H
      const bright = rt.rng() >= 0.5
      if (rt.rng() < 0.15) { // an occasional hair
        if (hair.length >= MAX_HAIR * 9) continue
        let a = rt.rng() * 6.28
        const as = []
        for (let k = 0; k < 5; k++) { a += rt.random(-0.8, 0.8); as.push(a) }
        hair.push(x, y, as[0], as[1], as[2], as[3], as[4], 0, 0)
      } else if (dust.length < MAX_DUST * 3) {
        const r = rt.random(0.6, 2) * pr
        dust.push(x, y, bright ? r : -r)
      }
    }
  }
  const nDust = dust.length / 3, nHair = hair.length / 9
  while (dust.length < MAX_DUST * 3) dust.push(0, 0, 0)
  while (hair.length < MAX_HAIR * 9) hair.push(0, 0, 0)

  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.v3('u_xf', weaveX + jitX, weaveY + jitY + jumpY, rot)
    u.f('u_over', over)
    u.v2('u_flick', flA, flG)
    const gs = Math.max(1, minDim / 340)
    u.v3('u_grain', params.grain > 0.01 ? params.grain * 0.5 : 0, gs, grainSeed)
    u.v2('u_grainOff', Math.floor(rt.rng() * 256), Math.floor(rt.rng() * 256))
    u.i('u_nScr', nScr)
    u.v3arr('u_scr', scr)
    u.i('u_nDust', nDust)
    u.v3arr('u_dust', dust)
    u.i('u_nHair', nHair)
    u.v3arr('u_hair', hair)
    u.f('u_pr', pr)
    u.f('u_vig', params.vignette > 0.01 ? params.vignette * 0.9 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
