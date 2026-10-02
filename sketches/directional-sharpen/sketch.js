// Directional Sharpen — unsharp mask along one direction instead of in a disc.
// Set an angle to undo motion blur or a camera shake along that line, or pick
// "Across edges" and each pixel sharpens along its own local brightness gradient:
// edges get crisper while the noise running along them isn't amplified.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const DIRS = ['Across edges', 'Fixed angle']

const rt = createRuntime()
const params = rt.params({
  direction: { value: 'Across edges', type: 'select', options: DIRS, label: 'Direction' },
  angle: { value: 0, min: 0, max: 360, step: 1, label: 'Angle' },
  amount: { value: 1.5, min: 0, max: 5, step: 0.05, label: 'Amount' },
  length: { value: 4, min: 1, max: 24, step: 0.5, label: 'Length' },
  threshold: { value: 0.01, min: 0, max: 0.2, step: 0.005, label: 'Threshold' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'amount', 0.5)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_auto;
uniform float u_ang;
uniform float u_amount;
uniform float u_len;
uniform float u_threshold;
out vec4 outColor;

const vec3 L = vec3(0.299, 0.587, 0.114);

float luma(vec2 uv) { return dot(texture(u_tex, uv).rgb, L); }

void main() {
  vec2 px = 1.0 / u_res;
  vec3 base = texture(u_tex, v_uv).rgb;
  vec2 dir = vec2(cos(u_ang), -sin(u_ang)); // y up on screen
  if (u_auto == 1) {
    vec2 s = px * max(1.0, u_len * 0.5);
    vec2 g = vec2(luma(v_uv + vec2(s.x, 0.0)) - luma(v_uv - vec2(s.x, 0.0)),
                  luma(v_uv + vec2(0.0, s.y)) - luma(v_uv - vec2(0.0, s.y)));
    float m = length(g);
    dir = m > 1e-4 ? g / m : dir;
  }
  // 1D gaussian blur along dir
  vec3 acc = base;
  float wsum = 1.0;
  for (int i = 1; i <= 6; i++) {
    float f = float(i) / 6.0;
    float w = exp(-2.0 * f * f);
    vec2 o = dir * u_len * f * px;
    acc += (texture(u_tex, v_uv + o).rgb + texture(u_tex, v_uv - o).rgb) * w;
    wsum += 2.0 * w;
  }
  vec3 detail = base - acc / wsum;
  float m = length(detail);
  detail *= smoothstep(u_threshold, u_threshold * 2.0 + 0.001, m);
  outColor = vec4(clamp(base + detail * u_amount, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_auto', params.direction === 'Across edges' ? 1 : 0)
    u.f('u_ang', (params.angle * Math.PI) / 180)
    u.f('u_amount', params.amount)
    u.f('u_len', params.length * rt.pixelRatio)
    u.f('u_threshold', params.threshold)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
