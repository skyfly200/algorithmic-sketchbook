// Displace — pushes pixels around with a displacement map: the image's own luminance or colour (self-displacement), animated noise, or travelling sine waves. Direction, scale, speed and an RGB chromatic split make anything from heat haze to glitchy warps.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MAPS = ['Self luminance', 'Self colour', 'Noise', 'Waves']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  map: { value: 'Noise', type: 'select', options: MAPS, label: 'Displacement map' },
  amount: { value: 0.04, min: 0, max: 0.3, step: 0.005, label: 'Amount' },
  scale: { value: 3, min: 0.5, max: 16, step: 0.1, label: 'Scale' },
  speed: { value: 0.3, min: 0, max: 3, step: 0.05, label: 'Speed' },
  angle: { value: 45, min: 0, max: 360, step: 1, label: 'Direction (luminance)' },
  mapBlur: { value: 3, min: 0, max: 20, step: 0.5, label: 'Map smoothing' },
  chroma: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'RGB split' },
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

uniform int u_map;
uniform float u_amount;
uniform float u_scale;
uniform float u_speed;
uniform float u_angle;
uniform float u_blur;
uniform float u_chroma;

vec3 mapTex(vec2 uv) {
  if (u_blur < 0.5) return tex(uv);
  vec2 o = u_blur / u_res;
  return (tex(uv) * 2.0 + tex(uv + vec2(o.x, 0.0)) + tex(uv - vec2(o.x, 0.0)) + tex(uv + vec2(0.0, o.y)) + tex(uv - vec2(0.0, o.y))) / 6.0;
}

vec2 disp(vec2 uv) {
  float aspect = u_res.x / u_res.y;
  float t = u_time * u_speed;
  if (u_map == 0) {
    float l = dot(mapTex(uv), LUMA);
    return vec2(cos(u_angle), sin(u_angle)) * (l - 0.5) * 2.0;
  } else if (u_map == 1) {
    return (mapTex(uv).rg - 0.5) * 2.0;
  } else if (u_map == 2) {
    vec2 p = uv * vec2(aspect, 1.0) * u_scale;
    return vec2(vnoise(p + t) + 0.5 * vnoise(p * 2.1 - t) , vnoise(p + 17.3 - t) + 0.5 * vnoise(p * 2.1 + 9.1 + t)) / 1.5 * 2.0 - 1.0;
  }
  return vec2(sin(uv.y * u_scale * 6.2832 + t * 3.0), sin(uv.x * u_scale * 6.2832 + t * 2.3));
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 off = disp(v_uv) * u_amount * vec2(1.0 / aspect, 1.0);
  vec3 col;
  col.r = tex(v_uv + off * (1.0 + u_chroma)).r;
  col.g = tex(v_uv + off).g;
  col.b = tex(v_uv + off * (1.0 - u_chroma)).b;
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_map', idx(MAPS, params.map))
    u.f('u_amount', params.amount)
    u.f('u_scale', params.scale)
    u.f('u_speed', params.speed)
    u.f('u_angle', (params.angle * Math.PI) / 180)
    u.f('u_blur', params.mapBlur * rt.pixelRatio)
    u.f('u_chroma', params.chroma)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
