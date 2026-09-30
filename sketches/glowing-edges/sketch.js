// Glowing Edges — Photoshop's neon outline filter: edges are picked out in the source's own colours on black, then blurred into a soft glow. Edge gain, width, glow amount and radius, colour boost, and an optional faint underlay of the original.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  gain: { value: 4, min: 0.5, max: 16, step: 0.1, label: 'Edge gain' },
  width: { value: 1.5, min: 0.5, max: 6, step: 0.1, label: 'Edge width' },
  glow: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Glow' },
  glowRadius: { value: 10, min: 1, max: 40, step: 0.5, label: 'Glow radius' },
  boost: { value: 1.6, min: 0.5, max: 3, step: 0.05, label: 'Colour boost' },
  underlay: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Original underlay' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'glow', 0.5)

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

uniform float u_gain;
uniform float u_w;
uniform float u_glow;
uniform float u_gr;
uniform float u_boost;
uniform float u_under;

vec3 edge(vec2 uv) {
  vec2 o = vec2(u_w) / u_res;
  vec3 gx = tex(uv + vec2(o.x, 0.0)) - tex(uv - vec2(o.x, 0.0));
  vec3 gy = tex(uv + vec2(0.0, o.y)) - tex(uv - vec2(0.0, o.y));
  return sqrt(gx * gx + gy * gy) * u_gain;
}

void main() {
  vec3 e = edge(v_uv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0;
    float a = float(i) * 2.399963;
    float w = exp(-2.0 * f);
    acc += edge(v_uv + vec2(cos(a), sin(a)) * u_gr * sqrt(f) / u_res) * w;
    wsum += w;
  }
  vec3 col = e + acc / wsum * u_glow;
  float g = dot(col, LUMA);
  col = mix(vec3(g), col, u_boost);
  col = 1.0 - exp(-col * 1.3);          // soft shoulder so bright edges don't clip flat
  col += tex(v_uv) * u_under;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_gain', params.gain)
    u.f('u_w', params.width * rt.pixelRatio)
    u.f('u_glow', params.glow)
    u.f('u_gr', params.glowRadius * rt.pixelRatio)
    u.f('u_boost', params.boost)
    u.f('u_under', params.underlay)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
