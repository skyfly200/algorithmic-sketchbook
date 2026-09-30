// Kuwahara — an edge-preserving painterly smoother. Around every pixel four
// overlapping sectors are averaged; the pixel takes the mean of the sector with
// the lowest variance, so flat regions melt into brush-like patches while edges
// stay crisp. Sharpness blends the sectors by inverse variance (a generalised
// Kuwahara) for softer, less blocky results.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  radius: { value: 4, min: 1, max: 8, step: 1, label: 'Brush radius' },
  sharpness: { value: 8, min: 1, max: 24, step: 0.5, label: 'Sector sharpness' },
  saturation: { value: 1.15, min: 0, max: 2, step: 0.01, label: 'Saturation' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'radius', 0.4)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_radius;
uniform float u_sharp;
uniform float u_sat;
out vec4 outColor;

void main() {
  vec2 px = 1.0 / u_res;
  // mean (rgb) and luma variance for each of the four quadrants
  vec3 m[4];
  float s[4];
  float cnt[4];
  for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = 0.0; cnt[k] = 0.0; }

  for (int j = -8; j <= 8; j++) {
    for (int i = -8; i <= 8; i++) {
      if (abs(i) > u_radius || abs(j) > u_radius) continue;
      vec3 c = texture(u_tex, v_uv + vec2(float(i), float(j)) * px).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // quadrants overlap on the axes so every tap lands in at least one
      for (int k = 0; k < 4; k++) {
        bool inX = (k == 0 || k == 3) ? (i <= 0) : (i >= 0);
        bool inY = (k < 2) ? (j <= 0) : (j >= 0);
        if (inX && inY) { m[k] += c; s[k] += l * l; cnt[k] += 1.0; }
      }
    }
  }

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec3 mean = m[k] / cnt[k];
    float ml = dot(mean, vec3(0.299, 0.587, 0.114));
    float var = max(s[k] / cnt[k] - ml * ml, 0.0);
    float w = 1.0 / (1.0 + pow(var * 1000.0, 0.5 * u_sharp));
    acc += mean * w;
    wsum += w;
  }
  vec3 col = acc / max(wsum, 1e-6);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  outColor = vec4(mix(vec3(g), col, u_sat), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_radius', Math.max(1, Math.min(8, Math.round(params.radius))))
    u.f('u_sharp', params.sharpness)
    u.f('u_sat', params.saturation)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
