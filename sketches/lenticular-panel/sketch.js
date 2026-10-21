// Lenticular panel — a sheet of cylindrical lenses over the picture. Tilt X (across the lenses) slides each lens's view sideways and Tilt Y (along them) defocuses it; 0.5 is the sweet spot where the panel reads as a gentle, sharp magnifier.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  lenses: { value: 48, min: 6, max: 200, step: 1, label: 'Lens count', scale: 'log' },
  angle: { value: 0, min: -90, max: 90, step: 1, label: 'Sheet angle (°)' },
  tiltX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Tilt X (across lenses, 0.5 = flat)' },
  tiltY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Tilt Y (along lenses, 0.5 = flat)' },
  power: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Lens power' },
  blur: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Defocus with tilt' },
  split: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Colour split' },
  gloss: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Gloss' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('mouse.x', 'tiltX', 0.8, { center: true })
rt.mapInput('mouse.y', 'tiltY', 0.8, { center: true })

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;

uniform float u_lenses;
uniform float u_angle;
uniform vec2 u_tilt;
uniform float u_power;
uniform float u_blur;
uniform float u_split;
uniform float u_gloss;

vec3 tex(vec2 uv) { return texture(u_tex, clamp(uv, 0.0, 1.0)).rgb; }

void main() {
  float asp = u_res.x / u_res.y;
  vec2 p = (v_uv - 0.5) * vec2(asp, 1.0);
  float ca = cos(u_angle), sa = sin(u_angle);
  vec2 across = vec2(ca, sa);    // direction the lenses repeat in
  vec2 along = vec2(-sa, ca);    // direction each lens runs in
  float w = 1.0 / u_lenses;      // lens pitch in picture heights
  float s = dot(p, across) / w;
  float cell = floor(s);
  float u = fract(s) * 2.0 - 1.0;          // -1..1 across one lens
  float lensC = (cell + 0.5) * w;

  // Each lens magnifies its own strip (u scaled down) and the tilt walks the view across it.
  float shift = u_tilt.x * 1.6;
  float view = clamp(u * (1.0 - 0.8 * u_power) + shift, -1.6, 1.6);
  float acrossPos = lensC + view * 0.5 * w;
  float alongPos = dot(p, along) + u_tilt.y * w * 4.0;

  float defocus = length(u_tilt) * u_blur * w * 3.0;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    float k = float(i) / 3.0;
    float wt = 1.0 - 0.5 * abs(k);
    vec2 q = across * (acrossPos + k * defocus * 0.35) + along * (alongPos + k * defocus);
    vec2 uv = q / vec2(asp, 1.0) + 0.5;
    vec2 d = across * (u_split * 0.5 * w * u_tilt.x) / vec2(asp, 1.0);
    vec3 c = vec3(tex(uv + d).r, tex(uv).g, tex(uv - d).b);
    col += c * wt;
    wsum += wt;
  }
  col /= wsum;

  float ridge = 1.0 - u * u;
  col *= 0.88 + 0.12 * ridge;
  float hl = pow(max(1.0 - abs(u - clamp(-u_tilt.x * 1.2, -0.9, 0.9)), 0.0), 8.0);
  col += u_gloss * 0.35 * hl;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_lenses', params.lenses)
    u.f('u_angle', (params.angle * Math.PI) / 180)
    u.v2('u_tilt', params.tiltX * 2 - 1, params.tiltY * 2 - 1)
    u.f('u_power', params.power)
    u.f('u_blur', params.blur)
    u.f('u_split', params.split)
    u.f('u_gloss', params.gloss)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
