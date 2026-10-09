// Glow — a bloom pass for any live source: bright regions are isolated
// (contrast crush), blurred at two radii, and added back over the image, so
// lights, screens and skies flare the way they do on a dreamy lens. Beats
// kick the bloom brighter. A fragment shader: the blurs are taps of the
// source's mip chain, so it needs no extra passes and can run in a Patch
// filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  intensity: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'Intensity' },
  radius: { value: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Radius' },
  threshold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Threshold' },
  saturate: { value: 1.25, min: 0.5, max: 2.5, step: 0.05, label: 'Bloom color' },
  dim: { value: 0.15, min: 0, max: 0.7, step: 0.01, label: 'Dim scene' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'intensity', 0.6)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_dim;
uniform float u_crush;   // contrast applied to the bright pass
uniform float u_lift;    // brightness applied to the bright pass
uniform float u_sat;
uniform float u_sigma1;  // bloom blur, full-resolution px
uniform float u_sigma2;  // wide tail blur, full-resolution px
uniform float u_a1;
uniform float u_a2;
out vec4 outColor;

vec3 scene(vec3 c) { return c * (1.0 - u_dim); }

// bright pass: contrast crush, brightness, saturation (the order of the CSS filter chain)
vec3 bright(vec3 c) {
  c = (scene(c) - 0.5) * u_crush + 0.5;
  c *= u_lift;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, u_sat), 0.0);
}

// Gaussian blur of the bright pass: golden-angle taps of the mip level whose
// texels are about as wide as the blur is, so a big radius stays cheap.
vec3 bloom(float sigma) {
  float lod = max(0.0, log2(sigma * 0.5));
  vec2 px = 1.0 / u_res;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int N = 20;
  for (int i = 0; i < N; i++) {
    float r = sigma * 1.8 * sqrt((float(i) + 0.5) / float(N));
    float a = float(i) * 2.39996;
    float w = exp(-0.5 * (r * r) / (sigma * sigma));
    vec2 uv = v_uv + vec2(cos(a), sin(a)) * r * px;
    acc += bright(textureLod(u_tex, uv, lod).rgb) * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 col = scene(texture(u_tex, v_uv).rgb);
  if (u_a1 > 0.0) {
    col += bloom(u_sigma1) * u_a1;
    col += bloom(u_sigma2) * u_a2;
  }
  outColor = vec4(min(col, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  const boost = params.intensity * (1 + rt.beat.state.pulse * 0.8)
  const on = boost > 0.01
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    // radii were set at quarter resolution in the 2D version, so scale them up
    const r1 = (2 + params.radius * 8) * 4 * rt.pixelRatio // device px, like r2
    const r2 = params.radius * 24 * rt.pixelRatio
    u.f('u_dim', params.dim)
    u.f('u_crush', 1 + params.threshold * 3)
    u.f('u_lift', 1 - params.threshold * 0.55)
    u.f('u_sat', params.saturate)
    u.f('u_sigma1', r1)
    u.f('u_sigma2', Math.hypot(r1, r2)) // the tail is the bloom blurred again
    u.f('u_a1', on ? Math.min(1, boost * 0.7) : 0)
    u.f('u_a2', on ? Math.min(1, boost * 0.45) : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
