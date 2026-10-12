// Blur — a family of blurs for a live source: a plain Gaussian, a directional
// motion blur, a radial zoom blur streaking out from a centre, and a spin blur
// smearing around it. Motion/zoom/spin average many offset/scaled/rotated taps
// of the picture; the centre is mappable so the zoom/spin origin can be driven
// live. The Gaussian has four algorithms (native disc, fast downsample, smooth
// mip pyramid, bokeh). A fragment shader: they all read the source's mip
// chain, so a large radius costs the same as a small one, and the whole filter
// can run inside a Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Gaussian', type: 'select', options: ['Gaussian', 'Motion', 'Zoom', 'Spin'], label: 'Blur type' },
  algorithm: {
    value: 'Native (gaussian)',
    type: 'select',
    options: ['Native (gaussian)', 'Fast (downsample)', 'Smooth (pyramid)', 'Bokeh (disc)'],
    label: 'Blur algorithm',
  },
  amount: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Amount' },
  angle: { value: 0, min: 0, max: 360, step: 1, label: 'Motion angle' },
  samples: { value: 16, min: 4, max: 40, step: 1, label: 'Quality (samples)' },
  centerX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre X' },
  centerY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Centre Y' },
  highlights: { value: 0, min: 0, max: 1, step: 0.01, label: 'Bokeh highlight boost' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'amount', 0.5)

const MODES = ['Gaussian', 'Motion', 'Zoom', 'Spin']
const ALGOS = ['Native (gaussian)', 'Fast (downsample)', 'Smooth (pyramid)', 'Bokeh (disc)']

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_mode;     // 0 gaussian, 1 motion, 2 zoom, 3 spin
uniform int u_algo;     // 0 native, 1 fast, 2 smooth, 3 bokeh
uniform float u_amt;
uniform float u_r;      // gaussian radius, px
uniform float u_ang;    // motion angle, radians
uniform float u_motion; // motion smear length, px
uniform int u_n;        // accumulation taps
uniform vec2 u_c;       // zoom / spin centre, uv (y up)
uniform float u_hi;     // bokeh highlight boost, 0..1
out vec4 outColor;

const float GOLDEN = 2.399963;

// Gaussian / bokeh blur: taps spread over a disc, read from the mip level whose
// texels are about as wide as the tap spacing.
vec3 discBlur(float r, bool bokeh) {
  vec2 px = 1.0 / u_res;
  const int N = 32;
  float lod = max(0.0, log2(r * 0.45));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N);
    float d = (bokeh ? 1.0 : 2.0) * r * sqrt(f);
    float a = float(i) * GOLDEN;
    float w = bokeh ? 1.0 : exp(-0.5 * (d * d) / (r * r));
    vec3 s = textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * d * px, lod).rgb;
    // lens blur: bright taps count for more, so highlights bloom into discs
    if (bokeh && u_hi > 0.0) { float l = dot(s, vec3(0.299, 0.587, 0.114)); w *= 1.0 + u_hi * 24.0 * l * l * l * l; }
    acc += s * w;
    wsum += w;
  }
  return acc / wsum;
}

// Fast: a dozen taps from a much smaller mip level (the picture downsampled about
// r times), so it costs a third of Native and reads slightly softer and blockier.
vec3 fastBlur(float r) {
  vec2 px = 1.0 / u_res;
  const int N = 12;
  float lod = max(0.0, log2(r * 1.1));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N);
    float a = float(i) * GOLDEN;
    acc += textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * 1.2 * r * sqrt(f) * px, lod).rgb;
  }
  return acc / float(N);
}

// Smooth: a Kawase-style pyramid. Three neighbouring mip levels, each read with four
// diagonal half-texel taps (a tent), blended with the middle level weighted most.
// No disc of taps, so there is no ring pattern at any radius: the smoothest falloff.
vec3 pyramidBlur(float r) {
  vec2 px = 1.0 / u_res;
  float L = max(1.0, log2(r) + 0.3);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 3; k++) {
    float lod = L - 1.0 + float(k);
    float w = k == 1 ? 2.0 : 1.0;
    vec2 o = exp2(lod) * 0.75 * px;
    vec3 s = textureLod(u_tex, v_uv + vec2(o.x, o.y), lod).rgb + textureLod(u_tex, v_uv + vec2(-o.x, o.y), lod).rgb
           + textureLod(u_tex, v_uv + vec2(o.x, -o.y), lod).rgb + textureLod(u_tex, v_uv - o, lod).rgb;
    acc += s * 0.25 * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 col;
  if (u_mode == 0 || u_amt < 0.002) {
    if (u_r < 0.5) col = texture(u_tex, v_uv).rgb;
    else if (u_algo == 1) col = fastBlur(u_r);
    else if (u_algo == 2) col = pyramidBlur(u_r);
    else col = discBlur(u_r, u_algo == 3);
  } else {
    vec3 acc = vec3(0.0);
    float aspect = u_res.x / u_res.y;
    for (int i = 0; i < 40; i++) {
      if (i >= u_n) break;
      float f = float(i) / float(max(1, u_n - 1)); // 0..1 across the smear
      vec2 uv = v_uv;
      if (u_mode == 1) {
        float d = (f - 0.5) * u_motion;
        uv = v_uv - vec2(cos(u_ang), -sin(u_ang)) * d / u_res; // y up
      } else if (u_mode == 2) {
        float s = 1.0 + f * u_amt * 0.5;
        uv = u_c + (v_uv - u_c) / s;
      } else {
        float ang = (f - 0.5) * u_amt * 0.9;
        vec2 d = (v_uv - u_c) * vec2(aspect, 1.0); // rotate in square space
        float cs = cos(ang), sn = sin(ang);
        d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
        uv = u_c + d / vec2(aspect, 1.0);
      }
      acc += texture(u_tex, uv).rgb;
    }
    col = acc / float(u_n);
  }
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_mode', Math.max(0, MODES.indexOf(params.mode)))
    u.i('u_algo', Math.max(0, ALGOS.indexOf(params.algorithm)))
    u.f('u_amt', params.amount)
    u.f('u_r', params.amount * 40 * rt.pixelRatio)
    u.f('u_ang', (params.angle * Math.PI) / 180)
    u.f('u_motion', params.amount * 90 * rt.pixelRatio)
    u.i('u_n', Math.max(2, Math.min(40, Math.round(params.samples))))
    u.v2('u_c', params.centerX, 1 - params.centerY)
    u.f('u_hi', params.highlights)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
