// Oil Paint — the classic intensity-bin oil filter. Every pixel looks at a disc of
// neighbours, sorts them into brightness bins, and takes the average colour of the
// most populated bin. That gives flat, slightly smeared strokes of paint whose
// edges follow the picture. Fewer levels = bolder, flatter paint. "Relief" adds
// a little lit canvas texture from the source's brightness gradient.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  radius: { value: 4, min: 1, max: 12, step: 0.1, label: 'Brush radius' },
  levels: { value: 8, min: 3, max: 16, step: 1, label: 'Paint levels' },
  relief: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Relief' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'radius', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_radius;
uniform int u_levels;
uniform float u_relief;
out vec4 outColor;

const vec3 L = vec3(0.299, 0.587, 0.114);
const float GOLDEN = 2.399963;

void main() {
  vec4 bins[16]; // rgb sum, count
  for (int b = 0; b < 16; b++) bins[b] = vec4(0.0);
  float lv = float(u_levels);
  vec2 px = 1.0 / u_res;
  // 48 taps on a golden-angle disc, centre included
  for (int i = -1; i < 48; i++) {
    vec2 o = vec2(0.0);
    if (i >= 0) {
      float f = (float(i) + 0.5) / 48.0;
      float a = float(i) * GOLDEN;
      o = vec2(cos(a), sin(a)) * u_radius * sqrt(f);
    }
    vec3 c = texture(u_tex, v_uv + o * px).rgb;
    int b = min(int(dot(c, L) * lv), u_levels - 1);
    bins[b] += vec4(c, 1.0);
  }
  vec4 best = vec4(0.0);
  for (int b = 0; b < 16; b++) {
    if (b >= u_levels) break;
    if (bins[b].w > best.w) best = bins[b];
  }
  vec3 col = best.rgb / max(best.w, 1.0);
  if (u_relief > 0.0) {
    vec2 s = px * max(1.0, u_radius * 0.5);
    float gx = dot(texture(u_tex, v_uv + vec2(s.x, 0.0)).rgb - texture(u_tex, v_uv - vec2(s.x, 0.0)).rgb, L);
    float gy = dot(texture(u_tex, v_uv + vec2(0.0, s.y)).rgb - texture(u_tex, v_uv - vec2(0.0, s.y)).rgb, L);
    col *= 1.0 + u_relief * (gx * 0.7 + gy * 0.7) * 2.0;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_radius', params.radius * rt.pixelRatio)
    u.i('u_levels', Math.max(3, Math.min(16, Math.round(params.levels))))
    u.f('u_relief', params.relief)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
