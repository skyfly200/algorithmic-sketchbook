// Tilt Shift — the "miniature" look: a band (linear, or a radial spot) stays
// sharp while blur ramps up with distance from it, plus a saturation and
// contrast lift so scenes read as tiny painted models. The blur is a variable
// radius disc gather (golden-angle spiral), so bright spots turn into round bokeh.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const SHAPES = ['Linear', 'Radial']

const rt = createRuntime()
const params = rt.params({
  shape: { value: 'Linear', type: 'select', options: SHAPES, label: 'Focus shape' },
  focusX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Focus X' },
  focusY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Focus Y' },
  angle: { value: 0, min: -90, max: 90, step: 1, label: 'Band angle' },
  band: { value: 0.15, min: 0, max: 0.6, step: 0.01, label: 'Sharp band size' },
  falloff: { value: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Falloff' },
  blur: { value: 14, min: 0, max: 40, step: 0.5, label: 'Max blur' },
  saturation: { value: 1.3, min: 0.5, max: 2.5, step: 0.05, label: 'Saturation' },
  contrast: { value: 1.1, min: 0.7, max: 1.6, step: 0.02, label: 'Contrast' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'blur', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_focus;
uniform float u_angle;
uniform int u_shape;
uniform float u_band;
uniform float u_falloff;
uniform float u_blur;   // pixels
uniform float u_sat;
uniform float u_contrast;
out vec4 outColor;

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = (v_uv - u_focus) * vec2(aspect, 1.0);
  float d;
  if (u_shape == 0) {
    vec2 n = vec2(-sin(u_angle), cos(u_angle));   // band normal
    d = abs(dot(p, n));
  } else {
    d = length(p);
  }
  float k = smoothstep(u_band, u_band + u_falloff, d);
  float r = u_blur * k;

  vec3 col;
  if (r < 0.4) {
    col = texture(u_tex, v_uv).rgb;
  } else {
    vec2 px = 1.0 / u_res;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 32; i++) {
      float f = (float(i) + 0.5) / 32.0;
      float a = float(i) * 2.399963;
      vec3 s = texture(u_tex, v_uv + vec2(cos(a), sin(a)) * sqrt(f) * r * px).rgb;
      // favour bright samples slightly so highlights bloom into bokeh
      float w = 1.0 + 2.0 * pow(dot(s, vec3(0.333)), 4.0);
      acc += s * w;
      wsum += w;
    }
    col = acc / wsum;
  }
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(g), col, u_sat);
  col = (col - 0.5) * u_contrast + 0.5;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.v2('u_focus', params.focusX, 1 - params.focusY) // focusY 0 = top of the frame
    u.f('u_angle', (params.angle * Math.PI) / 180)
    u.i('u_shape', params.shape === 'Radial' ? 1 : 0)
    u.f('u_band', params.band)
    u.f('u_falloff', params.falloff)
    u.f('u_blur', params.blur * rt.pixelRatio * rt.detail)
    u.f('u_sat', params.saturation)
    u.f('u_contrast', params.contrast)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
