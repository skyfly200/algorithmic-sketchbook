// Funhouse Mirror — the carnival hall of warped mirrors over a live source.
// The picture is stretched or squeezed row by row, then column by column, by a
// distortion profile, so the image bulges, pinches, ripples and wobbles like a
// sheet of curved silvered glass. A filter: it warps whatever feeds it (camera,
// a dropped clip, the demo, or the layers below). One fragment shader, so it can
// also run inside a Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Carnival', type: 'select', options: ['Wavy', 'Bulge', 'Pinch', 'Carnival'], label: 'Mirror' },
  amount: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Distortion' },
  frequency: { value: 3, min: 0.5, max: 10, step: 0.1, label: 'Ripples' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.05, label: 'Wobble speed' },
  vertical: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Vertical warp' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'amount', 0.4)

const MODES = ['Wavy', 'Bulge', 'Pinch', 'Carnival']

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_mode;
uniform float u_amp;
uniform float u_freq;
uniform float u_speed;
uniform float u_vert;
uniform float u_time;
out vec4 outColor;

const float PI = 3.14159265;

// scale + lateral shift for a strip at normalised position f in 0..1
vec2 profile(float f, float t) {
  float wave = sin(f * PI * 2.0 * u_freq + t * u_speed * 2.0);
  float bulge = cos((f - 0.5) * PI);
  float scale = 1.0;
  float shift = 0.0;
  if (u_mode == 0) { scale = 1.0 + u_amp * 0.5 * wave; shift = u_amp * 0.12 * wave; }
  else if (u_mode == 1) scale = 1.0 + u_amp * 0.9 * bulge;
  else if (u_mode == 2) scale = 1.0 - u_amp * 0.7 * bulge;
  else {
    scale = 1.0 + u_amp * (0.6 * bulge + 0.35 * wave);
    shift = u_amp * 0.08 * sin(f * PI * 2.0 * u_freq * 0.5 + t * u_speed);
  }
  return vec2(max(0.15, scale), shift);
}

// the source, addressed with y pointing down like a canvas
vec3 src(vec2 p) { return texture(u_tex, vec2(p.x, 1.0 - p.y)).rgb; }

// after the horizontal warp: each row is stretched about the centre by scale(y);
// where a squeezed row leaves a gap the unwarped picture shows through
vec3 rows(vec2 p) {
  vec2 pr = profile(p.y, u_time);
  float xs = (p.x - ((1.0 - pr.x) * 0.5 + pr.y)) / pr.x;
  return src(xs < 0.0 || xs > 1.0 ? p : vec2(xs, p.y));
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y); // y down
  // vertical warp: each column stretched about the centre by scale(x)
  vec2 pc = u_vert > 0.01 ? profile(p.x + 0.37, u_time * 0.8 + 1.3) : vec2(1.0, 0.0);
  float sc = 1.0 + (pc.x - 1.0) * u_vert;
  float ys = (p.y - ((1.0 - sc) * 0.5 + pc.y * u_vert)) / sc;
  vec3 col = (ys < 0.0 || ys > 1.0) ? rows(p) : rows(vec2(p.x, ys));
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    u.i('u_mode', Math.max(0, MODES.indexOf(params.mode)))
    u.f('u_amp', params.amount)
    u.f('u_freq', params.frequency)
    u.f('u_speed', params.speed)
    u.f('u_vert', params.vertical)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
