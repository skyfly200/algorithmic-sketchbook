// Blur — a family of blurs for a live source: a plain Gaussian, a directional
// motion blur, a radial zoom blur streaking out from a centre, and a spin blur
// smearing around it. Motion/zoom/spin average many offset/scaled/rotated taps
// of the picture; the centre is mappable so the zoom/spin origin can be driven
// live. A fragment shader: the Gaussian and bokeh blurs read the source's mip
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
    acc += textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * d * px, lod).rgb * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 col;
  if (u_mode == 0 || u_amt < 0.002) {
    col = u_r < 0.5 ? texture(u_tex, v_uv).rgb : discBlur(u_r, u_algo == 3);
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
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
