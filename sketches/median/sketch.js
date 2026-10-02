// Median — replaces each pixel with the per-channel median of its neighbourhood.
// It wipes out speckle and fine texture while keeping edges hard, which a blur
// can't do. 3x3 is an exact median (a 19-exchange sorting network); 5x5 is the
// median of the five row medians, a close and much cheaper approximation.
// Radius spreads the taps apart, so larger values give a chunkier, painted look.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const SIZES = ['3 x 3', '5 x 5']

const rt = createRuntime()
const params = rt.params({
  size: { value: '3 x 3', type: 'select', options: SIZES, label: 'Window' },
  radius: { value: 1, min: 0.5, max: 8, step: 0.1, label: 'Tap spacing' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'radius', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform int u_size;
uniform float u_radius;
uniform float u_amount;
out vec4 outColor;

void cs(inout vec3 a, inout vec3 b) { vec3 t = min(a, b); b = max(a, b); a = t; }

vec3 tap(vec2 o) { return texture(u_tex, v_uv + o * u_radius / u_res).rgb; }

vec3 med9(vec3 p0, vec3 p1, vec3 p2, vec3 p3, vec3 p4, vec3 p5, vec3 p6, vec3 p7, vec3 p8) {
  cs(p1, p2); cs(p4, p5); cs(p7, p8); cs(p0, p1); cs(p3, p4); cs(p6, p7);
  cs(p1, p2); cs(p4, p5); cs(p7, p8); cs(p0, p3); cs(p5, p8); cs(p4, p7);
  cs(p3, p6); cs(p1, p4); cs(p2, p5); cs(p4, p7); cs(p4, p2); cs(p6, p4); cs(p4, p2);
  return p4;
}
vec3 med5(vec3 p0, vec3 p1, vec3 p2, vec3 p3, vec3 p4) {
  cs(p0, p1); cs(p3, p4); cs(p0, p3); cs(p1, p4); cs(p1, p2); cs(p2, p3); cs(p1, p2);
  return p2;
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 m;
  if (u_size == 0) {
    m = med9(tap(vec2(-1, -1)), tap(vec2(0, -1)), tap(vec2(1, -1)),
             tap(vec2(-1, 0)), base, tap(vec2(1, 0)),
             tap(vec2(-1, 1)), tap(vec2(0, 1)), tap(vec2(1, 1)));
  } else {
    vec3 r[5];
    for (int j = 0; j < 5; j++) {
      float y = float(j) - 2.0;
      r[j] = med5(tap(vec2(-2, y)), tap(vec2(-1, y)), tap(vec2(0, y)), tap(vec2(1, y)), tap(vec2(2, y)));
    }
    m = med5(r[0], r[1], r[2], r[3], r[4]);
  }
  outColor = vec4(mix(base, m, u_amount), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_size', Math.max(0, SIZES.indexOf(params.size)))
    u.f('u_radius', params.radius * rt.pixelRatio)
    u.f('u_amount', params.amount)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
