// Polar Coordinates — remaps the image between rectangular and polar space: wrap it into a circle, unwrap a circle into a strip, fly down an infinite tunnel, or fold a panorama into a "little planet". Adjustable centre, zoom, rotation, spin, angular repeats and a seamless mirror option.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MODES = ['Rect → Polar', 'Polar → Rect', 'Tunnel', 'Little planet']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Rect → Polar', type: 'select', options: MODES, label: 'Mode' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  zoom: { value: 1, min: 0.2, max: 4, step: 0.02, label: 'Zoom' },
  rotation: { value: 0, min: 0, max: 1, step: 0.005, label: 'Rotation' },
  spin: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Spin speed' },
  repeat: { value: 1, min: 1, max: 8, step: 1, label: 'Angular repeats' },
  tunnelSpeed: { value: 0.25, min: -2, max: 2, step: 0.01, label: 'Tunnel speed' },
  seamless: { value: true, type: 'bool', label: 'Seamless (mirror)' },
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

uniform int u_mode;
uniform vec2 u_c;
uniform float u_zoom;
uniform float u_rot;
uniform float u_rep;
uniform float u_tspeed;
uniform bool u_seam;

float wrap(float x) {
  float f = fract(x);
  return u_seam ? 1.0 - abs(2.0 * f - 1.0) : f;
}

void main() {
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (v_uv - u_c) * asp;
  float a = atan(p.y, p.x) / 6.28318 + u_rot;
  float r = length(p);
  vec2 uv;
  float fog = 1.0;
  if (u_mode == 0) {                       // rectangular -> polar
    uv = vec2(wrap(a * u_rep), clamp(r * 2.0 * u_zoom, 0.0, 1.0));
  } else if (u_mode == 1) {                // polar -> rectangular
    float ang = (v_uv.x * u_rep + u_rot) * 6.28318;
    float rad = v_uv.y * 0.5 / u_zoom;
    uv = u_c + vec2(cos(ang), sin(ang)) * rad / asp;
  } else if (u_mode == 2) {                // tunnel
    float depth = 0.12 / (r * u_zoom + 1e-3) + u_time * u_tspeed;
    uv = vec2(wrap(a * u_rep), fract(depth));
    fog = smoothstep(0.0, 0.2, r * u_zoom);
  } else {                                 // little planet (stereographic)
    vec2 q = p * 2.0 / u_zoom;
    float th = atan(q.y, q.x) / 6.28318 + u_rot;
    uv = vec2(wrap(th * u_rep), 2.0 * atan(length(q)) / 3.14159);
  }
  outColor = vec4(tex(clamp(uv, 0.0, 1.0)) * fog, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_mode', idx(MODES, params.mode))
    u.v2('u_c', params.centerX, 1 - params.centerY)
    u.f('u_zoom', params.zoom)
    u.f('u_rot', params.rotation + params.spin * now * 0.001)
    u.f('u_rep', Math.round(params.repeat))
    u.f('u_tspeed', params.tunnelSpeed)
    u.i('u_seam', params.seamless ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
