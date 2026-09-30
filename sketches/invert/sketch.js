// Invert — a negative of the source. Invert all channels, only the luminance (keeping hue), flip to the luminance-complement colours, or invert a single channel. Amount blends it in, and it can flash on every beat.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MODES = ['RGB', 'Luminance only', 'Complement', 'Red', 'Green', 'Blue']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'RGB', type: 'select', options: MODES, label: 'Mode' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  beatFlash: { value: false, type: 'bool', label: 'Flash on beat' },
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
uniform float u_amount;

void main() {
  vec3 c = tex(v_uv);
  vec3 t;
  if (u_mode == 0) {
    t = 1.0 - c;
  } else if (u_mode == 1) {
    // invert luma only, keep chroma (YIQ)
    float y = dot(c, LUMA);
    t = clamp(c + (1.0 - 2.0 * y), 0.0, 1.0);
  } else if (u_mode == 2) {
    // complementary colour at the same brightness
    t = clamp(2.0 * dot(c, LUMA) - c, 0.0, 1.0);
  } else {
    t = c;
    if (u_mode == 3) t.r = 1.0 - c.r;
    else if (u_mode == 4) t.g = 1.0 - c.g;
    else t.b = 1.0 - c.b;
  }
  outColor = vec4(mix(c, t, u_amount), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const a = params.beatFlash ? Math.min(1, params.amount * rt.beat.state.pulse * 1.4) : params.amount
    u.i('u_mode', idx(MODES, params.mode))
    u.f('u_amount', a)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
