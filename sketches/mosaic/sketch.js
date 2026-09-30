// Mosaic — rebuilds the image from tiles with grout lines. Square or brick layouts, rounded and bevelled tiles, per-tile brightness variation, and adjustable grout colour and width.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const LAYOUTS = ['Square', 'Brick']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  layout: { value: 'Square', type: 'select', options: LAYOUTS, label: 'Layout' },
  tile: { value: 26, min: 6, max: 120, step: 1, label: 'Tile size' },
  grout: { value: 0.14, min: 0, max: 0.6, step: 0.01, label: 'Grout width' },
  rounded: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Rounded corners' },
  bevel: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Bevel' },
  variation: { value: 0.18, min: 0, max: 0.8, step: 0.01, label: 'Tile variation' },
  groutTone: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Grout brightness' },
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

uniform int u_layout;
uniform float u_tile;
uniform float u_grout;
uniform float u_round;
uniform float u_bevel;
uniform float u_var;
uniform float u_gtone;

void main() {
  vec2 g = v_uv * u_res / u_tile;
  float shift = 0.0;
  if (u_layout == 1) { shift = 0.5 * mod(floor(g.y), 2.0); g.x += shift; }
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 centre = (id + 0.5 - vec2(shift, 0.0)) * u_tile / u_res;
  vec3 col = tex(clamp(centre, 0.0, 1.0));
  col *= 1.0 + u_var * (hash21(id) - 0.5) * 2.0;

  float half_ = 0.5 - u_grout * 0.5;
  float r = u_round * half_;
  vec2 q = abs(f) - vec2(half_ - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;   // <0 inside the tile
  float aa = 1.5 / u_tile;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  // light from the top-left: lit edges up there, shaded edges bottom-right
  float rim = smoothstep(-0.22, 0.0, d);
  float lit = dot(normalize(f + 1e-4), vec2(-0.7, 0.7));
  col *= 1.0 + u_bevel * rim * lit * 0.6;
  outColor = vec4(clamp(mix(vec3(u_gtone), col, inside), 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_layout', idx(LAYOUTS, params.layout))
    u.f('u_tile', params.tile * rt.pixelRatio)
    u.f('u_grout', params.grout)
    u.f('u_round', params.rounded)
    u.f('u_bevel', params.bevel)
    u.f('u_var', params.variation)
    u.f('u_gtone', params.groutTone)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
