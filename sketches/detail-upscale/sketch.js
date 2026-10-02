// Detail Upscale — makes a picture that was enlarged from a smaller one look crisper. Anything
// stretched past its source resolution is soft: edges are ramps a few pixels wide. Two passes of
// reconstruction fix that without touching flat areas or inventing texture:
//   1. Edge push — each pixel on a ramp is pulled toward the lighter or darker end of its
//      neighbourhood (a shock filter), turning blurry ramps back into steps. Good for lines,
//      text, logos and graphics.
//   2. Adaptive sharpen — a contrast-adaptive sharpen (after AMD's CAS / FSR RCAS) limited to the
//      neighbours' own min/max, so it adds crispness without halos or clipping.
// "Source scale" is how many times the picture was enlarged (a 640 px camera on a 1920 px canvas
// is 3x): it sets how far apart the neighbourhood is sampled. This is classic image processing,
// not a neural network: it can sharpen what is there but cannot add detail that was never captured.
// For that, use the AI upscale step of the Import wizard on a still image.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  scale: { value: 2, min: 1, max: 6, step: 0.1, label: 'Source scale' },
  push: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Edge push' },
  sharpen: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Adaptive sharpen' },
  threshold: { value: 0.04, min: 0, max: 0.3, step: 0.005, label: 'Edge threshold' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'sharpen', 0.2)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_r;          // source pixel size in render pixels
uniform float u_push;
uniform float u_sharp;
uniform float u_gate;
out vec4 outColor;

const vec3 L = vec3(0.299, 0.587, 0.114);
vec3 T(vec2 o) { return texture(u_tex, v_uv + o * u_r / u_res).rgb; }

void main() {
  vec3 a = T(vec2(-1, -1)), b = T(vec2(0, -1)), c = T(vec2(1, -1));
  vec3 d = T(vec2(-1, 0)),  e = T(vec2(0, 0)),  f = T(vec2(1, 0));
  vec3 g = T(vec2(-1, 1)),  h = T(vec2(0, 1)),  i = T(vec2(1, 1));

  // 1) edge push: on a ramp, move toward the nearer extreme of the neighbourhood
  vec3 mn = min(min(min(a, b), min(c, d)), min(min(e, f), min(g, min(h, i))));
  vec3 mx = max(max(max(a, b), max(c, d)), max(max(e, f), max(g, max(h, i))));
  vec3 mean = (a + b + c + d + e + f + g + h + i) / 9.0;
  float lc = dot(e, L);
  float lm = dot(mean, L);
  float range = dot(mx, L) - dot(mn, L);
  float gate = smoothstep(u_gate, u_gate * 2.0 + 0.002, range);     // leave flat areas and noise alone
  float side = clamp(abs(lc - lm) / max(range, 1e-3) * 2.0, 0.0, 1.0); // ramp middle stays, ends snap
  vec3 target = lc >= lm ? mx : mn;
  vec3 p = mix(e, target, u_push * 0.9 * gate * side);

  // 2) contrast-adaptive sharpen, limited to the local min / max (no halos, no clipping)
  vec3 nb = T(vec2(0, -0.75)) + T(vec2(-0.75, 0)) + T(vec2(0.75, 0)) + T(vec2(0, 0.75));
  vec3 lo = min(min(T(vec2(0, -0.75)), T(vec2(-0.75, 0))), min(min(T(vec2(0.75, 0)), T(vec2(0, 0.75))), p));
  vec3 hi = max(max(T(vec2(0, -0.75)), T(vec2(-0.75, 0))), max(max(T(vec2(0.75, 0)), T(vec2(0, 0.75))), p));
  vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, vec3(1e-3)), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, u_sharp));
  vec3 sharp = (w * nb + p) / (1.0 + 4.0 * w);
  p = mix(p, clamp(sharp, lo, hi), smoothstep(0.0, 0.15, u_sharp));

  outColor = vec4(clamp(p, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_r', params.scale) // render pixels per source pixel: not scaled by pixel ratio
    u.f('u_push', params.push)
    u.f('u_sharp', params.sharpen)
    u.f('u_gate', params.threshold)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
