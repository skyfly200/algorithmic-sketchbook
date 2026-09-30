// Liquid Metal — remap a live source into rippling chrome/mercury. Luminance is
// pushed through a metallic light→dark→light ramp (the banded highlights that
// make a surface read as polished metal), domain-warped by a slow noise so the
// sheen flows like liquid, with a sharp specular glint riding the brightest
// ridges. Tint from steel to gold to copper. Runs per pixel in a fragment shader.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const TINTS = {
  Chrome: [[0.10, 0.11, 0.14], [0.72, 0.78, 0.90], [0.97, 0.99, 1.03]],
  Steel: [[0.08, 0.09, 0.11], [0.55, 0.60, 0.68], [0.90, 0.94, 1.00]],
  Gold: [[0.12, 0.07, 0.01], [0.85, 0.62, 0.16], [1.05, 0.95, 0.65]],
  Copper: [[0.12, 0.05, 0.03], [0.80, 0.42, 0.26], [1.05, 0.80, 0.62]],
  Mercury: [[0.09, 0.10, 0.12], [0.62, 0.66, 0.72], [1.02, 1.04, 1.08]],
}

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  tint: { value: 'Chrome', type: 'select', options: Object.keys(TINTS), label: 'Metal' },
  bands: { value: 3.5, min: 1, max: 9, step: 0.1, label: 'Sheen bands' },
  flow: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Flow warp' },
  speed: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Flow speed' },
  specular: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Glint' },
  contrast: { value: 1.1, min: 0.4, max: 2.5, step: 0.05, label: 'Contrast' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'specular', 0.4)

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

uniform vec3 u_lo;
uniform vec3 u_mid;
uniform vec3 u_hi;
uniform float u_bands;
uniform float u_flow;
uniform float u_ph;        // flow phase (time * speed)
uniform float u_spec;
uniform float u_con;
uniform vec2 u_buf;        // the old effect's working resolution: the noise is in those pixels

float nz(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(i.x * 127.1 + i.y * 311.7) * 43758.5453);
  float b = fract(sin((i.x + 1.0) * 127.1 + i.y * 311.7) * 43758.5453);
  float c = fract(sin(i.x * 127.1 + (i.y + 1.0) * 311.7) * 43758.5453);
  float d = fract(sin((i.x + 1.0) * 127.1 + (i.y + 1.0) * 311.7) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  float l = clamp((dot(tex(v_uv), LUMA) - 0.5) * u_con + 0.5, 0.0, 1.0);
  vec2 bp = vec2(v_uv.x, 1.0 - v_uv.y) * u_buf;
  // warp the luminance coordinate by flowing noise so the sheen slides
  float w = u_flow * (nz(bp * 0.02 + vec2(u_ph, -u_ph * 0.6)) - 0.5) * 2.0;
  float s = mod(l * u_bands + w + u_ph * 0.15, 1.0);
  float tri = 1.0 - abs(s * 2.0 - 1.0);                  // 0..1..0 sheen band
  float a = tri < 0.5 ? tri * 2.0 : 1.0;
  float b = tri < 0.5 ? 0.0 : (tri - 0.5) * 2.0;
  vec3 col = mix(mix(u_lo, u_mid, a), u_hi, b);
  col += pow(tri, 18.0) * u_spec * (0.3 + 0.7 * l);      // sharp glint on each band's crest
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const [lo, mid, hi] = TINTS[params.tint]
    const s = Math.min(1, 820 / Math.max(gf.width, gf.height))
    u.v3('u_lo', ...lo)
    u.v3('u_mid', ...mid)
    u.v3('u_hi', ...hi)
    u.f('u_bands', params.bands)
    u.f('u_flow', params.flow)
    u.f('u_ph', now * 0.001 * params.speed)
    u.f('u_spec', params.specular)
    u.f('u_con', params.contrast)
    u.v2('u_buf', Math.max(2, Math.round(gf.width * s)), Math.max(2, Math.round(gf.height * s)))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
