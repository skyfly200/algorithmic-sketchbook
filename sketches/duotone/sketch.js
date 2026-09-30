// Duotone — maps the image onto two (or three) tones: shadows take one colour, highlights another, optionally a third for the midtones. The classic poster / Spotify look, with hue and saturation per tone, contrast and balance.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MODES = ['Duotone', 'Tritone']
function hsv(h, s, v) {
  const k = (n) => Math.min(Math.max(Math.abs(((h * 6 + n) % 6) - 3) - 1, 0), 1)
  return [v * (1 - s + s * k(0)), v * (1 - s + s * k(4)), v * (1 - s + s * k(2))]
}

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Duotone', type: 'select', options: MODES, label: 'Mode' },
  shadowHue: { value: 0.72, min: 0, max: 1, step: 0.01, label: 'Shadow hue' },
  shadowSat: { value: 0.85, min: 0, max: 1, step: 0.01, label: 'Shadow saturation' },
  midHue: { value: 0.9, min: 0, max: 1, step: 0.01, label: 'Mid hue (tritone)' },
  midSat: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Mid saturation' },
  highHue: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Highlight hue' },
  highSat: { value: 0.75, min: 0, max: 1, step: 0.01, label: 'Highlight saturation' },
  contrast: { value: 1.1, min: 0.4, max: 3, step: 0.02, label: 'Contrast' },
  balance: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Balance' },
  mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix with original' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
vec3 hsv2rgb(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.3));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tex(vec2 uv) { return texture(u_tex, uv).rgb; }

uniform bool u_tri;
uniform vec3 u_lo;
uniform vec3 u_mid;
uniform vec3 u_hi;
uniform float u_contrast;
uniform float u_balance;
uniform float u_mix;

void main() {
  vec3 c = tex(v_uv);
  float l = clamp((dot(c, LUMA) - 0.5) * u_contrast + 0.5 + u_balance, 0.0, 1.0);
  vec3 t;
  if (u_tri) t = l < 0.5 ? mix(u_lo, u_mid, l * 2.0) : mix(u_mid, u_hi, (l - 0.5) * 2.0);
  else t = mix(u_lo, u_hi, l);
  outColor = vec4(mix(c, t, u_mix), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const lo = hsv(params.shadowHue, params.shadowSat, 0.18)
    const mid = hsv(params.midHue, params.midSat, 0.75)
    const hi = hsv(params.highHue, params.highSat, 1)
    u.i('u_tri', params.mode === 'Tritone' ? 1 : 0)
    u.v3('u_lo', ...lo)
    u.v3('u_mid', ...mid)
    u.v3('u_hi', ...hi)
    u.f('u_contrast', params.contrast)
    u.f('u_balance', params.balance)
    u.f('u_mix', params.mix)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
