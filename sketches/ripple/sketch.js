// Ripple — water rings radiating from a point. Continuous concentric waves with distance decay, or expanding "pond drop" rings, with adjustable frequency, amplitude, speed and a lighting term from the wave slope. Amplitude can kick on every beat.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const MODES = ['Concentric', 'Pond drop']

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Concentric', type: 'select', options: MODES, label: 'Mode' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  frequency: { value: 14, min: 2, max: 60, step: 0.5, label: 'Frequency' },
  amplitude: { value: 0.02, min: 0, max: 0.12, step: 0.001, label: 'Amplitude' },
  speed: { value: 2, min: 0, max: 8, step: 0.05, label: 'Speed' },
  decay: { value: 1.4, min: 0, max: 6, step: 0.05, label: 'Distance decay' },
  width: { value: 0.18, min: 0.03, max: 0.6, step: 0.01, label: 'Ring width (drop)' },
  shade: { value: 0.5, min: 0, max: 2, step: 0.02, label: 'Shading' },
  beatKick: { value: true, type: 'bool', label: 'Kick on beat' },
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
uniform vec2 u_c;
uniform float u_freq;
uniform float u_amp;
uniform float u_speed;
uniform float u_decay;
uniform float u_width;
uniform float u_shade;

void main() {
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (v_uv - u_c) * asp;
  float r = length(p);
  vec2 dir = p / (r + 1e-4);
  float phase = r * u_freq * 6.2832 - u_time * u_speed;
  float env;
  if (u_mode == 0) {
    env = exp(-r * u_decay);
  } else {
    float R = fract(u_time * u_speed * 0.08) * 1.6;
    float x = (r - R) / u_width;
    env = exp(-x * x) * (1.0 - R / 1.7);
  }
  float w = sin(phase) * env;
  float slope = cos(phase) * env;
  vec2 uv = v_uv + dir / asp * w * u_amp;
  vec3 col = tex(clamp(uv, 0.0, 1.0));
  col *= 1.0 + u_shade * slope * 0.35;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const kick = params.beatKick ? 1 + rt.beat.state.pulse * 1.5 : 1
    u.i('u_mode', idx(MODES, params.mode))
    u.v2('u_c', params.centerX, 1 - params.centerY)
    u.f('u_freq', params.frequency)
    u.f('u_amp', params.amplitude * kick)
    u.f('u_speed', params.speed)
    u.f('u_decay', params.decay)
    u.f('u_width', params.width)
    u.f('u_shade', params.shade)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
