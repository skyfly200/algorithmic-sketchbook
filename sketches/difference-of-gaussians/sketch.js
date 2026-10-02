// Difference of Gaussians — blur the picture twice at two radii and subtract. The
// result is a band-pass: it keeps detail near the chosen scale and drops both the
// flat areas and the finest noise. Three looks: Band-pass (grey relief), Ink lines
// (the XDoG sketch operator: thresholded to black linework on paper) and
// Add detail (the band added back onto the colour picture).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const LOOKS = ['Band-pass', 'Ink lines', 'Add detail']

const rt = createRuntime()
const params = rt.params({
  look: { value: 'Ink lines', type: 'select', options: LOOKS, label: 'Look' },
  radius: { value: 2, min: 0.5, max: 12, step: 0.1, label: 'Radius' },
  ratio: { value: 1.6, min: 1.1, max: 4, step: 0.05, label: 'Wide / narrow ratio' },
  gain: { value: 4, min: 0.5, max: 16, step: 0.1, label: 'Gain' },
  threshold: { value: 0.02, min: -0.1, max: 0.2, step: 0.005, label: 'Line threshold' },
  softness: { value: 8, min: 1, max: 40, step: 0.5, label: 'Line sharpness' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'gain', 0.4)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_look;
uniform float u_r;
uniform float u_ratio;
uniform float u_gain;
uniform float u_eps;
uniform float u_phi;
out vec4 outColor;

const vec3 L = vec3(0.299, 0.587, 0.114);
const float GOLDEN = 2.399963;

// Gaussian-weighted taps over a disc, read from the mip level matching the radius
vec3 blur(float r) {
  vec2 px = 1.0 / u_res;
  float lod = max(0.0, log2(r * 0.45));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 20; i++) {
    float f = (float(i) + 0.5) / 20.0;
    float d = 2.0 * r * sqrt(f);
    float a = float(i) * GOLDEN;
    float w = exp(-0.5 * (d * d) / (r * r));
    acc += textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * d * px, lod).rgb * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 a = blur(u_r);
  vec3 b = blur(u_r * u_ratio);
  vec3 col;
  if (u_look == 0) {
    col = vec3(0.5) + (a - b) * u_gain;
  } else if (u_look == 1) {
    // XDoG: sharpened difference, soft threshold, black ink on white paper
    float d = dot(a - b, L) * u_gain;
    float e = d >= u_eps ? 1.0 : 1.0 + tanh(u_phi * (d - u_eps));
    col = vec3(clamp(e, 0.0, 1.0));
  } else {
    col = base + (a - b) * u_gain;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_look', Math.max(0, LOOKS.indexOf(params.look)))
    u.f('u_r', params.radius * rt.pixelRatio)
    u.f('u_ratio', params.ratio)
    u.f('u_gain', params.gain)
    u.f('u_eps', params.threshold)
    u.f('u_phi', params.softness)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
