// Spherize — wraps the image around a sphere or a cylinder (horizontal or vertical) inside a movable circle, bulging it out or, with a negative strength, sucking it in. Optional specular shine and edge darkening sell the 3D look.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const SHAPES = ['Sphere', 'Horizontal cylinder', 'Vertical cylinder']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  shape: { value: 'Sphere', type: 'select', options: SHAPES, label: 'Shape' },
  strength: { value: 0.85, min: -1, max: 1, step: 0.01, label: 'Strength (− pucker / + bulge)' },
  radius: { value: 0.5, min: 0.1, max: 1.5, step: 0.01, label: 'Radius' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  shine: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Shine' },
  edgeDark: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Edge darkening' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'strength', 0.3)

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

uniform int u_shape;
uniform float u_strength;
uniform float u_radius;
uniform vec2 u_c;
uniform float u_shine;
uniform float u_edge;

float warp1(float r) {
  float target = u_strength >= 0.0 ? asin(r) / 1.5708 : sin(r * 1.5708);
  return mix(r, target, abs(u_strength));
}

void main() {
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (v_uv - u_c) * asp / u_radius;
  vec2 q = p;
  float z = 0.0;
  bool inside = false;
  if (u_shape == 0) {
    float r = length(p);
    if (r < 1.0) {
      inside = true;
      z = sqrt(1.0 - r * r);
      if (r > 1e-4) q = p * (warp1(r) / r);
    }
  } else if (u_shape == 1) {
    if (abs(p.x) < 1.0) {
      inside = true;
      z = sqrt(1.0 - p.x * p.x);
      q.x = sign(p.x) * warp1(abs(p.x));
    }
  } else {
    if (abs(p.y) < 1.0) {
      inside = true;
      z = sqrt(1.0 - p.y * p.y);
      q.y = sign(p.y) * warp1(abs(p.y));
    }
  }
  vec3 col = tex(clamp(u_c + q * u_radius / asp, 0.0, 1.0));
  if (inside) {
    vec3 n = normalize(vec3(p, z + 1e-3));
    vec3 h = normalize(normalize(vec3(-0.4, 0.5, 0.75)) + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, h), 0.0), 40.0);
    col *= 1.0 - u_edge * (1.0 - z);
    col += u_shine * spec * abs(u_strength);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_shape', idx(SHAPES, params.shape))
    u.f('u_strength', params.strength)
    u.f('u_radius', params.radius)
    u.v2('u_c', params.centerX, 1 - params.centerY)
    u.f('u_shine', params.shine)
    u.f('u_edge', params.edgeDark)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
