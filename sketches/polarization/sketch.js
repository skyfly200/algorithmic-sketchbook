// Polarization — a live source seen through crossed polarizers over a stressed
// birefringent film: luminance is read as an optical retardation and mapped
// through an approximate Michel-Lévy interference-colour chart, so the image
// dissolves into shimmering bands of spectral colour. A rotating analyzer sweeps
// the whole palette; thickness sets how many orders of colour appear. The colour
// chart is evaluated analytically in the fragment shader.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  retardation: { value: 1.2, min: 0.2, max: 4, step: 0.05, label: 'Retardation' },
  analyzer: { value: 0, min: 0, max: 180, step: 1, label: 'Analyzer angle' },
  spin: { value: 0.2, min: -1, max: 1, step: 0.02, label: 'Analyzer spin' },
  stress: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Stress bands' },
  mix: { value: 0.9, min: 0, max: 1, step: 0.02, label: 'Effect mix' },
  brightness: { value: 1.1, min: 0.4, max: 2, step: 0.05, label: 'Brightness' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.mid', 'analyzer', 90)
rt.mapInput('audio.pulse', 'retardation', 0.5)

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

uniform float u_ret;
uniform float u_analyzer;  // radians
uniform float u_stress;
uniform float u_mix;
uniform float u_bright;
uniform vec2 u_buf;        // the old effect's working resolution (stress bands are in those pixels)

void main() {
  vec3 c = tex(v_uv);
  float lum = dot(c, LUMA);
  vec2 bp = vec2(v_uv.x, 1.0 - v_uv.y) * u_buf;
  float stress = u_stress * (sin(bp.x * 0.05) + cos(bp.y * 0.05)) * 0.15;
  float ret = clamp(lum + stress, 0.0, 1.0) * 3000.0 * u_ret;
  const vec3 lam = vec3(650.0, 550.0, 450.0);
  vec3 s = sin(3.14159265 * ret * 1000.0 / lam);
  vec3 crossed = s * s;
  float m = cos(u_analyzer);
  m *= m;
  vec3 pol = crossed * m + (1.0 - crossed) * (1.0 - m);   // crossed <-> parallel polarizers
  outColor = vec4(clamp(mix(c, pol * u_bright, u_mix), 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const a = ((params.analyzer + now * 0.001 * params.spin * 60) % 180 + 180) % 180
    const s = Math.min(1, 700 / Math.max(gf.width, gf.height))
    u.f('u_ret', params.retardation)
    u.f('u_analyzer', (a * Math.PI) / 180)
    u.f('u_stress', params.stress)
    u.f('u_mix', params.mix)
    u.f('u_bright', params.brightness)
    u.v2('u_buf', Math.max(2, Math.round(gf.width * s)), Math.max(2, Math.round(gf.height * s)))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
