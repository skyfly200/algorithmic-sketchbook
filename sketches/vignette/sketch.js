// Vignette — darkens, lightens or tints the frame edges to pull focus toward a chosen spot. Adjustable size, softness, roundness vs. squareness, and an offset centre; can pulse on the beat.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const STYLES = ['Darken', 'Lighten', 'Tint']
function hsv(h, s, v) {
  const k = (n) => Math.min(Math.max(Math.abs(((h * 6 + n) % 6) - 3) - 1, 0), 1)
  return [v * (1 - s + s * k(0)), v * (1 - s + s * k(4)), v * (1 - s + s * k(2))]
}

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  style: { value: 'Darken', type: 'select', options: STYLES, label: 'Style' },
  amount: { value: 0.8, min: 0, max: 1, step: 0.01, label: 'Amount' },
  size: { value: 0.7, min: 0.1, max: 2, step: 0.01, label: 'Size' },
  softness: { value: 0.8, min: 0.05, max: 2, step: 0.01, label: 'Softness' },
  roundness: { value: 1, min: 0, max: 1, step: 0.01, label: 'Roundness' },
  squareness: { value: 0, min: 0, max: 1, step: 0.01, label: 'Squareness' },
  offsetX: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Offset X' },
  offsetY: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Offset Y' },
  hue: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'Tint hue' },
  beatPulse: { value: false, type: 'bool', label: 'Pulse on beat' },
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

uniform int u_style;
uniform float u_amount;
uniform float u_size;
uniform float u_soft;
uniform float u_round;
uniform float u_square;
uniform vec2 u_off;
uniform vec3 u_tint;

void main() {
  vec3 c = tex(v_uv);
  float aspect = u_res.x / u_res.y;
  vec2 p = (v_uv - 0.5 - u_off) * 2.0;
  p.x *= mix(1.0, aspect, u_round);
  float circle = length(p);
  float box = pow(pow(abs(p.x), 4.0) + pow(abs(p.y), 4.0), 0.25);
  float d = mix(circle, box, u_square);
  float v = smoothstep(u_size, u_size + u_soft, d) * u_amount;
  vec3 col;
  if (u_style == 0) col = c * (1.0 - v);
  else if (u_style == 1) col = mix(c, vec3(1.0), v);
  else col = mix(c, u_tint, v);
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const a = params.beatPulse ? Math.min(1, params.amount * (0.6 + rt.beat.state.pulse * 0.8)) : params.amount
    const t = hsv(params.hue, 0.8, 0.9)
    u.i('u_style', idx(STYLES, params.style))
    u.f('u_amount', a)
    u.f('u_size', params.size)
    u.f('u_soft', params.softness)
    u.f('u_round', params.roundness)
    u.f('u_square', params.squareness)
    u.v2('u_off', params.offsetX, -params.offsetY)
    u.v3('u_tint', ...t)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
