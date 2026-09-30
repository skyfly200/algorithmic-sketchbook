// Pixelate — chunky low-resolution blocks. Square, round (LED-like) or diamond pixels with a gap between them, adjustable aspect, optional smoothing by averaging, and colour-level reduction for a retro palette.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const SHAPES = ['Square', 'Round', 'Diamond']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  shape: { value: 'Square', type: 'select', options: SHAPES, label: 'Pixel shape' },
  size: { value: 14, min: 2, max: 96, step: 1, label: 'Pixel size' },
  aspect: { value: 1, min: 0.25, max: 4, step: 0.05, label: 'Pixel aspect (w/h)' },
  gap: { value: 0, min: 0, max: 0.8, step: 0.01, label: 'Gap' },
  levels: { value: 0, min: 0, max: 16, step: 1, label: 'Colour levels (0 = off)' },
  average: { value: true, type: 'bool', label: 'Average the block' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'size', 0.3)

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
uniform float u_size;
uniform float u_aspect;
uniform float u_gap;
uniform float u_levels;
uniform bool u_avg;

void main() {
  vec2 cell = vec2(u_size * u_aspect, u_size);
  vec2 g = v_uv * u_res / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 c = (id + 0.5) * cell / u_res;
  vec3 col;
  if (u_avg) {
    vec2 o = cell * 0.25 / u_res;
    col = (tex(c + vec2(o.x, o.y)) + tex(c + vec2(-o.x, o.y)) + tex(c + vec2(o.x, -o.y)) + tex(c + vec2(-o.x, -o.y))) * 0.25;
  } else {
    col = tex(clamp(c, 0.0, 1.0));
  }
  if (u_levels > 1.5) col = floor(col * (u_levels - 1.0) + 0.5) / (u_levels - 1.0);

  float aa = 1.5 / u_size;
  float m;
  if (u_shape == 0) {
    float k = 0.5 - u_gap * 0.5;
    m = 1.0 - smoothstep(k - aa, k, max(abs(f.x), abs(f.y)));
  } else if (u_shape == 1) {
    float k = 0.5 - u_gap * 0.25;
    m = 1.0 - smoothstep(k - aa, k, length(f));
  } else {
    float k = 0.5 * (1.0 - u_gap * 0.5) * 1.15;
    m = 1.0 - smoothstep(k - aa, k, abs(f.x) + abs(f.y));
  }
  outColor = vec4(col * m, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_shape', idx(SHAPES, params.shape))
    u.f('u_size', params.size * rt.pixelRatio)
    u.f('u_aspect', params.aspect)
    u.f('u_gap', params.gap)
    u.f('u_levels', Math.round(params.levels))
    u.i('u_avg', params.average ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
