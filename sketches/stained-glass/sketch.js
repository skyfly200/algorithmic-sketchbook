// Stained Glass — recompose a live source as a leaded stained-glass window. A
// drifting Voronoi mosaic cuts the frame into glass panes; each pane takes a
// single saturated colour sampled from the source under it, lit with a soft
// glassy sheen, and the panes are separated by dark leaded "came" lines. A
// filter: it re-glazes whatever feeds it (camera, a clip, the demo, layers).
// The Voronoi cells are found per pixel in the fragment shader.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  cell: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Pane size' },
  lead: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Leading width' },
  saturation: { value: 1.4, min: 0.6, max: 2.2, step: 0.05, label: 'Glass saturation' },
  sheen: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Glass sheen' },
  drift: { value: 0.3, min: 0, max: 1.5, step: 0.05, label: 'Drift' },
  irregular: { value: 0.8, min: 0, max: 1, step: 0.02, label: 'Irregularity' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'sheen', 0.4)

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

uniform float u_cell;      // px
uniform float u_irr;
uniform float u_lead;      // px
uniform float u_sat;
uniform float u_sheen;
uniform float u_dr;
uniform float u_ph;        // drift phase
uniform float u_ph2;       // sheen phase
uniform float u_scale;     // px per pixel of the old low-res working grid
uniform float u_lod;

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;     // y-down px
  vec2 gi = floor(px / u_cell);
  float f1 = 1e9, f2 = 1e9;
  vec2 seed = vec2(0.0);
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 c = gi + vec2(float(ox), float(oy));
      float jx = 0.5 + (hash21(vec2(c.x, c.y * 131.0)) - 0.5) * u_irr + sin(u_ph + c.x * 1.7) * u_dr * 0.18;
      float jy = 0.5 + (hash21(vec2(c.x + 57.0, c.y * 131.0 + 9.0)) - 0.5) * u_irr + cos(u_ph + c.y * 1.3) * u_dr * 0.18;
      vec2 f = (c + vec2(jx, jy)) * u_cell;
      vec2 d = f - px;
      float dd = dot(d, d);
      if (dd < f1) { f2 = f1; f1 = dd; seed = f; } else if (dd < f2) { f2 = dd; }
    }
  }
  float edge = sqrt(f2) - sqrt(f1);                  // small = near a pane boundary
  // one flat colour per pane: the source under its seed
  vec3 col = textureLod(u_tex, clamp(vec2(seed.x / u_res.x, 1.0 - seed.y / u_res.y), 0.0, 1.0), u_lod).rgb;
  float lum = dot(col, LUMA);
  col = lum + (col - lum) * u_sat;                   // glow like coloured light
  float rc = 1.0 - min(1.0, sqrt(f1) / (u_cell * 0.9));
  float streak = 0.5 + 0.5 * sin((px.x + px.y) / u_scale * 0.06 + u_ph2);
  col *= 1.0 + u_sheen * (rc * 0.35 + streak * 0.12 - 0.12);
  float lead = 1.0 - min(1.0, edge / u_lead);       // leaded came darkens the pane boundaries
  col *= 1.0 - lead * 0.92;
  outColor = vec4(clamp(col, vec3(6.0, 6.0, 8.0) / 255.0, vec3(1.0)), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const W = gf.width, H = gf.height
    const long = Math.max(200, Math.round(340 * rt.detail))
    const RW = W >= H ? long : Math.round(long * (W / H))
    const scale = W / RW // screen px per pixel of the old low-res grid
    const t = now * 0.001
    u.f('u_cell', Math.max(6, 26 * params.cell * (RW / 340)) * scale)
    u.f('u_irr', params.irregular)
    u.f('u_lead', (params.lead * Math.max(6, 26 * params.cell * (RW / 340)) * 0.32 + 0.6) * scale)
    u.f('u_sat', params.saturation)
    u.f('u_sheen', params.sheen)
    u.f('u_dr', params.drift)
    u.f('u_ph', t * params.drift)
    u.f('u_ph2', t * 0.5)
    u.f('u_scale', scale)
    u.f('u_lod', Math.max(0, Math.log2(scale)))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
