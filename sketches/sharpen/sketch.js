// Sharpen — three ways to crisp up a source. Unsharp mask subtracts a blurred
// copy (sampled on two spiral rings) to boost local contrast; Laplacian adds the
// second derivative for a tight, fine-grained edge lift; High-pass shows/boosts
// the detail layer itself. A threshold protects flat areas from noise, and
// "Luminance only" sharpens brightness without colour fringing.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const METHODS = ['Unsharp mask', 'Laplacian', 'High-pass']

const rt = createRuntime()
const params = rt.params({
  method: { value: 'Unsharp mask', type: 'select', options: METHODS, label: 'Method' },
  amount: { value: 1.2, min: 0, max: 5, step: 0.05, label: 'Amount' },
  radius: { value: 2, min: 0.5, max: 10, step: 0.1, label: 'Radius' },
  threshold: { value: 0.02, min: 0, max: 0.3, step: 0.005, label: 'Threshold' },
  lumaOnly: { value: true, type: 'bool', label: 'Luminance only' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'amount', 0.5)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_method;
uniform float u_amount;
uniform float u_radius;
uniform float u_threshold;
uniform bool u_luma;
out vec4 outColor;

const vec3 L = vec3(0.299, 0.587, 0.114);

// soft blur: centre + two golden-angle rings
vec3 blur(float r) {
  vec2 px = 1.0 / u_res;
  vec3 acc = texture(u_tex, v_uv).rgb;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++) {
    float f = (float(i) + 0.5) / 16.0;
    float a = float(i) * 2.399963;
    float d = r * sqrt(f);
    float w = exp(-2.0 * f);
    acc += texture(u_tex, v_uv + vec2(cos(a), sin(a)) * d * px).rgb * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 detail;
  if (u_method == 1) {
    vec2 px = u_radius / u_res;
    vec3 n = texture(u_tex, v_uv + vec2(px.x, 0.0)).rgb + texture(u_tex, v_uv - vec2(px.x, 0.0)).rgb
           + texture(u_tex, v_uv + vec2(0.0, px.y)).rgb + texture(u_tex, v_uv - vec2(0.0, px.y)).rgb;
    detail = base - n * 0.25;
  } else {
    detail = base - blur(u_radius);
  }
  if (u_luma) detail = vec3(dot(detail, L));
  // ignore tiny differences (noise), keep the rest continuous
  float m = length(detail);
  detail *= smoothstep(u_threshold, u_threshold * 2.0 + 0.001, m);

  vec3 col = (u_method == 2) ? vec3(0.5) + detail * u_amount * 2.0 : base + detail * u_amount;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_method', Math.max(0, METHODS.indexOf(params.method)))
    u.f('u_amount', params.amount)
    u.f('u_radius', params.radius * rt.pixelRatio)
    u.f('u_threshold', params.threshold)
    u.i('u_luma', params.lumaOnly ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
