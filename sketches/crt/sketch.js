// CRT — an old cathode-ray television look over a live source: barrel
// curvature with a rounded bezel mask, RGB shadow-mask phosphor stripes,
// rolling scanlines, a soft bloom, vignette, and occasional roll/interference.
// One fragment shader does the whole tube: the barrel warp is a coordinate
// remap, and the bloom gathers the warped picture from a ring of neighbours.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  curve: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Screen curve' },
  scan: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Scanlines' },
  mask: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Phosphor mask' },
  bloom: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Bloom' },
  roll: { value: 0.25, min: 0, max: 1, step: 0.02, label: 'Roll / hum' },
  chroma: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Chroma bleed' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'bloom', 0.4)

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

uniform float u_k;         // barrel strength
uniform float u_scan;
uniform float u_mask;
uniform float u_bloom;
uniform float u_sat;
uniform float u_pr;
uniform float u_humY;      // px, y down
uniform float u_humA;
uniform float u_curve;

// the tube picture at an output position (uv): barrel warp + slight saturation
vec3 tube(vec2 uv) {
  float ny = (1.0 - uv.y) - 0.5;                       // -0.5 top .. 0.5 bottom
  float bow = 1.0 - u_k * (ny * ny) * 4.0;
  float u = (uv.x - 0.5) / bow + 0.5;
  if (u < 0.0 || u > 1.0) return vec3(0.0);
  vec3 c = tex(vec2(u, uv.y));
  float l = dot(c, LUMA);
  return clamp(l + (c - l) * u_sat, 0.0, 1.0);
}

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;       // y-down px
  vec3 col = tube(v_uv);

  // bloom: blurred bright copy added back (brightness 1.3, contrast 1.4)
  if (u_bloom > 0.01) {
    vec3 b = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < 12; i++) {
      float f = (float(i) + 0.5) / 12.0;
      float a = float(i) * 2.399963;
      float w = exp(-2.0 * f);
      vec3 s = clamp(tube(v_uv + vec2(cos(a), sin(a)) * sqrt(f) * 7.0 * u_pr / u_res) * 1.3, 0.0, 1.0);
      b += clamp((s - 0.5) * 1.4 + 0.5, 0.0, 1.0) * w;
      ws += w;
    }
    col += b / ws * u_bloom * 0.6;
  }

  // phosphor mask: RGB stripes, each 2 device px wide
  if (u_mask > 0.01) {
    int ph = int(mod(floor(px.x / (2.0 * u_pr)), 3.0));
    vec3 stripe = ph == 0 ? vec3(255.0, 60.0, 60.0) : (ph == 1 ? vec3(60.0, 255.0, 90.0) : vec3(80.0, 120.0, 255.0));
    col *= mix(vec3(1.0), stripe / 255.0, u_mask);
  }

  // scanlines
  if (u_scan > 0.01) {
    float step_ = 3.0 * u_pr;
    if (mod(px.y, step_) < max(1.0, step_ * 0.5)) col *= 1.0 - u_scan * 0.55;
  }

  // hum bar
  float hd = abs(px.y - u_humY);
  if (hd < 60.0) col = mix(col, vec3(1.0), u_humA * (1.0 - hd / 60.0));

  // vignette + rounded bezel
  float t = clamp((length(px - u_res * 0.5) - min(u_res.x, u_res.y) * 0.3) / (max(u_res.x, u_res.y) * 0.62 - min(u_res.x, u_res.y) * 0.3), 0.0, 1.0);
  col *= 1.0 - t * (0.4 + u_curve * 0.4);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const t = now * 0.001
    const H = gf.height
    const roll = params.roll * (Math.sin(t * 0.7) * 0.5 + 0.5)
    u.f('u_k', params.curve * 0.16)
    u.f('u_scan', params.scan)
    u.f('u_mask', params.mask)
    u.f('u_bloom', params.bloom)
    // chroma bleed in the old version only ever applied a saturation lift
    u.f('u_sat', params.chroma * 3 * rt.pixelRatio > 0.3 ? 1.2 : 1)
    u.f('u_pr', rt.pixelRatio)
    u.f('u_humY', params.roll > 0.01 ? (t * 40 * params.roll) % H : -1000)
    u.f('u_humA', params.roll > 0.01 ? roll * 0.12 : 0)
    u.f('u_curve', params.curve)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
