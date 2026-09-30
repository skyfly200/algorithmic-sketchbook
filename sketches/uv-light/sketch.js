// UV Light — a blacklight over a live source: the scene sinks into a deep
// violet murk while bright, saturated regions fluoresce in electric colours
// and bloom, the way fluorescent pigments glow under ultraviolet. A slow
// "lamp" sweep brightens whatever it passes over. One fragment shader: the
// fluorescence is evaluated per pixel and the bloom gathers it from a spiral of
// neighbours.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const k = (n) => (n + h / 30) % 12
  const f = (n) => l - (c / 2) * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))
  return [f(0), f(8), f(4)]
}

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  darkness: { value: 0.7, min: 0, max: 1, step: 0.02, label: 'Room darkness' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Fluoresce' },
  threshold: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Glow threshold' },
  shift: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Colour shift' },
  lamp: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Lamp sweep' },
  tint: { value: 265, min: 200, max: 320, step: 1, label: 'UV tint' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'glow', 0.5)

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

uniform float u_dark;
uniform float u_glow;
uniform float u_thr;
uniform float u_shift;
uniform float u_lamp;
uniform vec3 u_tintRgb;
uniform vec2 u_lampPos;    // uv
uniform float u_lampR;     // px
uniform float u_bloomR;    // px

// the blacklight look for one pixel
vec3 fx(vec2 uv) {
  vec3 c = tex(uv);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = mx == 0.0 ? 0.0 : (mx - mn) / mx;
  float lum = dot(c, LUMA);
  float fl = max(0.0, sat * 0.7 + lum * 0.5 - u_thr) * u_glow;
  if (fl > 0.02) {
    // rotate hue toward acid green / magenta / cyan
    return min(vec3(1.0), vec3(c.g * u_shift + c.r * (1.0 - u_shift),
                               c.b * u_shift + c.g * (1.0 - u_shift),
                               c.r * u_shift + c.b * (1.0 - u_shift)) * (1.0 + fl) * vec3(1.4, 1.5, 1.4));
  }
  float k = 1.0 - u_dark * 0.92;   // sink into violet murk
  return vec3(c.r * k + 20.0 / 255.0 * u_dark, c.g * k * 0.6, c.b * k + 40.0 / 255.0 * u_dark);
}

void main() {
  vec3 col = fx(v_uv);
  // bloom the fluorescing bits: brightness(1.5) contrast(1.6), blurred
  vec3 bloom = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0;
    float a = float(i) * 2.399963;
    float w = exp(-2.0 * f);
    vec3 s = clamp(fx(v_uv + vec2(cos(a), sin(a)) * sqrt(f) * u_bloomR / u_res) * 1.5, 0.0, 1.0);
    bloom += clamp((s - 0.5) * 1.6 + 0.5, 0.0, 1.0) * w;
    ws += w;
  }
  col += bloom / ws * min(1.0, 0.7 * u_glow);
  // moving lamp glow
  if (u_lamp > 0.01) {
    float r = length((v_uv - u_lampPos) * u_res) / u_lampR;
    col += u_tintRgb * u_lamp * 0.12 * max(0.0, 1.0 - r);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const t = now * 0.001
    u.f('u_dark', params.darkness)
    u.f('u_glow', params.glow)
    u.f('u_thr', params.threshold)
    u.f('u_shift', params.shift)
    u.f('u_lamp', params.lamp)
    u.v3('u_tintRgb', ...hsl(params.tint, 0.9, 0.6))
    u.v2('u_lampPos', 0.5 + 0.42 * Math.sin(t * 0.4), 1 - (0.5 + 0.3 * Math.cos(t * 0.33)))
    u.f('u_lampR', Math.max(gf.width, gf.height) * 0.4)
    u.f('u_bloomR', 12 * rt.pixelRatio)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
