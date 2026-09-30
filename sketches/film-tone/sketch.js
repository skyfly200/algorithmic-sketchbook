// Film Tone — a darkroom grade for a live source: sepia, black & white,
// negative or cyanotype, with filmic contrast, grain and a vignette. A per-pixel
// tone map run as a fragment shader over the shared source pipeline (camera, a
// dropped clip/photo, the demo, or the layers below in the Mixer/Patch).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MODES = ['Sepia', 'Black & White', 'Negative', 'Cyanotype']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Sepia', type: 'select', options: MODES, label: 'Tone' },
  strength: { value: 1, min: 0, max: 1, step: 0.02, label: 'Strength' },
  contrast: { value: 1.15, min: 0.5, max: 2.2, step: 0.05, label: 'Contrast' },
  brightness: { value: 0, min: -0.4, max: 0.4, step: 0.02, label: 'Brightness' },
  grain: { value: 0.12, min: 0, max: 0.6, step: 0.02, label: 'Film grain' },
  vignette: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'grain', 0.3)

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

uniform int u_mode;        // 0 sepia, 1 b&w, 2 negative, 3 cyanotype
uniform float u_mix;
uniform float u_con;
uniform float u_bright;
uniform float u_grain;
uniform float u_vig;
uniform float u_seed;      // grain re-rolls ~24x a second (0 = static)

void main() {
  vec3 c0 = tex(v_uv);
  float n = u_grain > 0.001 ? hash21(v_uv * u_res + u_seed) - 0.5 : 0.0;
  vec3 c;
  if (u_mode == 2) {
    c = (1.0 - c0 - 0.5) * u_con + 0.5 + u_bright + n * u_grain * 90.0 / 255.0;
  } else {
    float l = dot(c0, LUMA);
    l = (l - 0.5) * u_con + 0.5 + u_bright + n * u_grain * 110.0 / 255.0;
    l = clamp(l, 0.0, 1.0);
    if (u_mode == 1) c = vec3(l);
    else if (u_mode == 3) c = mix(vec3(8.0, 22.0, 54.0), vec3(214.0, 236.0, 255.0), l) / 255.0;
    else c = mix(vec3(42.0, 26.0, 12.0), vec3(255.0, 240.0, 200.0), l) / 255.0;
  }
  vec3 col = mix(c0, c, u_mix);
  // vignette: transparent until 0.33 of the short side, full strength by 0.72 of the long side
  float r0 = min(u_res.x, u_res.y) * 0.33;
  float r1 = max(u_res.x, u_res.y) * 0.72;
  float t = clamp((length(v_uv * u_res - u_res * 0.5) - r0) / (r1 - r0), 0.0, 1.0);
  col *= 1.0 - u_vig * 0.9 * t;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_mode', idx(MODES, params.mode))
    u.f('u_mix', params.strength)
    u.f('u_con', params.contrast)
    u.f('u_bright', params.brightness)
    u.f('u_grain', params.grain)
    u.f('u_vig', params.vignette)
    u.f('u_seed', params.grain > 0.001 ? Math.floor(now * 0.024) * 7.31 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
