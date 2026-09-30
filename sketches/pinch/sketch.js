// Pinch — pulls the image into a point, or with a negative amount bulges it outward, within an adjustable radius and falloff curve around a movable centre. Amount follows audio.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  amount: { value: 0.6, min: -1, max: 1, step: 0.01, label: 'Amount (− bulge / + pinch)' },
  radius: { value: 0.6, min: 0.1, max: 1.5, step: 0.01, label: 'Radius' },
  falloff: { value: 2, min: 0.5, max: 6, step: 0.1, label: 'Falloff' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'amount', 0.4)

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

uniform float u_amount;
uniform float u_radius;
uniform float u_pow;
uniform vec2 u_c;

void main() {
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (v_uv - u_c) * asp;
  float r = length(p) / u_radius;
  if (r < 1.0) {
    float f = pow(1.0 - r, u_pow);
    float k = 4.0 * abs(u_amount) * f;
    p *= u_amount >= 0.0 ? 1.0 + k : 1.0 / (1.0 + k);
  }
  outColor = vec4(tex(clamp(u_c + p / asp, 0.0, 1.0)), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_amount', params.amount)
    u.f('u_radius', params.radius)
    u.f('u_pow', params.falloff)
    u.v2('u_c', params.centerX, 1 - params.centerY)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
