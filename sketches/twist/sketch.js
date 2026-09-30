// Twist — Photoshop's Twirl for a live source: rotate the image around a centre
// by an angle that falls off with radius, so the middle spins hard and the edges
// stay put. Positive and negative angles wind opposite ways; the centre and
// radius are placeable, and a gentle live sway makes it churn. A single
// fragment-shader warp with hardware bilinear sampling.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  angle: { value: 220, min: -720, max: 720, step: 5, label: 'Twist angle°' },
  radius: { value: 0.8, min: 0.1, max: 1.5, step: 0.02, label: 'Radius' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  falloff: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Falloff' },
  swirl: { value: 0.2, min: 0, max: 1.5, step: 0.05, label: 'Live swirl' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'angle', 0.3)

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

uniform vec2 u_c;          // centre in px, y down
uniform float u_R;         // radius in px
uniform float u_ang;       // radians
uniform float u_fall;

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;       // y-down px
  vec2 d = p - u_c;
  float r = length(d);
  vec2 s = p;
  if (r < u_R) {
    float a = u_ang * pow(1.0 - r / u_R, u_fall);      // twist inversely from the source pixel
    float cs = cos(a), sn = sin(a);
    s = u_c + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  }
  outColor = vec4(tex(clamp(vec2(s.x / u_res.x, 1.0 - s.y / u_res.y), 0.0, 1.0)), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const W = gf.width, H = gf.height
    u.v2('u_c', params.centerX * W, params.centerY * H)
    u.f('u_R', params.radius * Math.max(W, H) * 0.5)
    u.f('u_ang', (params.angle * Math.PI) / 180 + Math.sin(now * 0.001 * 0.6) * params.swirl)
    u.f('u_fall', params.falloff)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
