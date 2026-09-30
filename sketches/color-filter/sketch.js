// Color Filter — cinematic colour grading for a live source: hue rotate,
// saturation/contrast, temperature (warm↔cool), a duotone map from shadows
// to highlights, and posterize. A one-stop grade node, run as a fragment shader.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
// hue (deg) -> rgb at full saturation, mid lightness
function hue(h) {
  h = (((h % 360) + 360) % 360) / 360
  const k = (n) => (n + h * 12) % 12
  const f = (n) => 0.5 - 0.5 * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))
  return [f(0), f(8), f(4)]
}

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  hue: { value: 0, min: 0, max: 360, step: 1, label: 'Hue rotate' },
  sat: { value: 1.15, min: 0, max: 2.5, step: 0.05, label: 'Saturation' },
  contrast: { value: 1.1, min: 0.4, max: 2.2, step: 0.05, label: 'Contrast' },
  temp: { value: 0, min: -1, max: 1, step: 0.02, label: 'Temperature' },
  duotone: { value: 0, min: 0, max: 1, step: 0.02, label: 'Duotone mix' },
  shadowHue: { value: 230, min: 0, max: 360, step: 1, label: 'Duotone shadow' },
  hiHue: { value: 40, min: 0, max: 360, step: 1, label: 'Duotone highlight' },
  posterize: { value: 0, min: 0, max: 1, step: 0.02, label: 'Posterize' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.mid', 'hue', 60)

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

uniform vec2 u_hue;        // cos, sin of the hue rotation
uniform float u_sat;
uniform float u_con;
uniform float u_temp;
uniform float u_duo;
uniform vec3 u_shadow;
uniform vec3 u_hi;
uniform float u_levels;    // 0 = off

void main() {
  vec3 c = tex(v_uv);
  // hue rotate via YIQ
  float y = dot(c, LUMA);
  float I = 0.596 * c.r - 0.274 * c.g - 0.322 * c.b;
  float Q = 0.211 * c.r - 0.523 * c.g + 0.312 * c.b;
  float nI = I * u_hue.x - Q * u_hue.y;
  float nQ = I * u_hue.y + Q * u_hue.x;
  c = vec3(y + 0.956 * nI + 0.621 * nQ, y - 0.272 * nI - 0.647 * nQ, y - 1.106 * nI + 1.703 * nQ);
  // saturation + contrast around mid grey
  float yy = dot(c, LUMA);
  c = yy + (c - yy) * u_sat;
  c = (c - 0.5) * u_con + 0.5;
  // temperature: warm lifts R, cools B
  c.r += u_temp * 40.0 / 255.0;
  c.b -= u_temp * 40.0 / 255.0;
  if (u_duo > 0.01) {
    float l = clamp(dot(c, LUMA), 0.0, 1.0);
    c = mix(c, mix(u_shadow, u_hi, l), u_duo);
  }
  if (u_levels > 0.5) c = floor(c * u_levels + 0.5) / u_levels;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const h = (params.hue * Math.PI) / 180
    u.v2('u_hue', Math.cos(h), Math.sin(h))
    u.f('u_sat', params.sat)
    u.f('u_con', params.contrast)
    u.f('u_temp', params.temp)
    u.f('u_duo', params.duotone)
    u.v3('u_shadow', ...hue(params.shadowHue))
    u.v3('u_hi', ...hue(params.hiHue))
    u.f('u_levels', params.posterize > 0.01 ? Math.round(2 + (1 - params.posterize) * 30) : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
