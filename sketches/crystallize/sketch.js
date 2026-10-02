// Crystallize — breaks the image into flat-coloured Voronoi facets, like stained crystal shards. Cell size, jitter, edge lines, per-facet shading, and optional slow drift of the crystal seeds.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  cell: { value: 36, min: 6, max: 160, step: 1, label: 'Cell size' },
  jitter: { value: 0.95, min: 0, max: 1, step: 0.01, label: 'Irregularity' },
  edges: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Edge darkness' },
  edgeWidth: { value: 2, min: 0.5, max: 8, step: 0.1, label: 'Edge width' },
  shade: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Facet shading' },
  bevel: { value: 0, min: 0, max: 1, step: 0.01, label: 'Facet bevel' },
  drift: { value: 0.4, min: 0, max: 3, step: 0.05, label: 'Drift speed' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'cell', 0.2)

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

uniform float u_cell;
uniform float u_jit;
uniform float u_edge;
uniform float u_ew;
uniform float u_shade;
uniform float u_drift;
uniform float u_bevel;

void main() {
  vec2 px = v_uv * u_res;
  vec2 ip = floor(px / u_cell);
  float d1 = 1e9, d2 = 1e9;
  vec2 site = vec2(0.0), bestId = vec2(0.0);
  float wob = clamp(u_drift * 10.0, 0.0, 1.0) * 0.2;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = ip + vec2(float(i), float(j));
      vec2 h = hash22(id);
      vec2 o = 0.5 + (h - 0.5) * u_jit + wob * vec2(sin(u_time * u_drift + h.x * 6.283), cos(u_time * u_drift + h.y * 6.283));
      vec2 s = (id + o) * u_cell;
      float d = length(px - s);
      if (d < d1) { d2 = d1; d1 = d; site = s; bestId = id; }
      else if (d < d2) { d2 = d; }
    }
  }
  vec3 col = tex(clamp(site / u_res, 0.0, 1.0));
  col *= 1.0 + u_shade * (hash21(bestId) - 0.5);
  // facet bevel: each shard is lit as a tilted plane, brighter toward its lit rim
  if (u_bevel > 0.0) {
    vec2 h = hash22(bestId + 3.7);
    vec2 tilt = (h - 0.5) * 2.0;
    vec2 rel = (px - site) / u_cell;
    float lit = dot(tilt, vec2(0.6, 0.8)) * 0.5 + dot(rel, tilt) * 0.9;
    float rim = 1.0 - smoothstep(0.0, u_cell * 0.35, d2 - d1);
    col *= 1.0 + u_bevel * (lit * 0.8 + rim * 0.25 * sign(lit));
  }
  float e = smoothstep(0.0, u_ew, d2 - d1);
  col = mix(col * (1.0 - u_edge), col, e);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_cell', params.cell * rt.pixelRatio)
    u.f('u_jit', params.jitter)
    u.f('u_edge', params.edges)
    u.f('u_ew', params.edgeWidth * rt.pixelRatio)
    u.f('u_shade', params.shade)
    u.f('u_drift', params.drift)
    u.f('u_bevel', params.bevel)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
