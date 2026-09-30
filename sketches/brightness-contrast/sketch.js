// Brightness & Contrast — the basic tonal controls for a live source, plus
// exposure, gamma and saturation. The exposure / contrast / brightness / gamma
// curve and the saturation mix are applied per pixel in a fragment shader.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  brightness: { value: 0, min: -1, max: 1, step: 0.01, label: 'Brightness' },
  contrast: { value: 1, min: 0, max: 2, step: 0.02, label: 'Contrast' },
  exposure: { value: 0, min: -1.5, max: 1.5, step: 0.02, label: 'Exposure (stops)' },
  gamma: { value: 1, min: 0.4, max: 2.6, step: 0.02, label: 'Gamma' },
  saturation: { value: 1, min: 0, max: 2.5, step: 0.02, label: 'Saturation' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'brightness', 0.12)

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

uniform float u_expo;
uniform float u_con;
uniform float u_bri;
uniform float u_invG;
uniform float u_sat;

void main() {
  vec3 x = tex(v_uv) * u_expo;           // exposure (linear-ish gain)
  x = (x - 0.5) * u_con + 0.5;           // contrast around mid grey
  x += u_bri * 0.6;                      // brightness lift/drop, gentled
  x = pow(clamp(x, 0.0, 1.0), vec3(u_invG));
  float y = dot(x, LUMA);
  x = y + (x - y) * u_sat;
  outColor = vec4(clamp(x, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_expo', Math.pow(2, params.exposure))
    u.f('u_con', params.contrast)
    u.f('u_bri', params.brightness)
    u.f('u_invG', 1 / params.gamma)
    u.f('u_sat', params.saturation)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
