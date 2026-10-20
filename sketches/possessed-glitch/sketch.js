// Possessed Glitch — a picture being taken over. Horizontal blocks tear sideways,
// colour channels split apart, the image flickers to a ghostly inverted negative
// for a frame, and a dim doubled "other self" drifts behind it. Bursts come in
// clusters: calm stretches punctuated by violent seizures. One pass, no history,
// so it can run inside a shared Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  tear: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Tearing' },
  split: { value: 0.012, min: 0.0005, max: 0.15, step: 0.0005, scale: 'log', label: 'Channel split' },
  rate: { value: 6, min: 0.5, max: 60, step: 0.1, scale: 'log', label: 'Glitch rate' },
  seize: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Seizures' },
  neg: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Negative flashes' },
  ghost: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Doppelgänger' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('beat.pulse', 'seize', 0.5)
rt.mapInput('beat.pulse', 'tear', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_ph;       // glitch clock (integral of rate)
uniform float u_tear;
uniform float u_split;
uniform float u_seize;
uniform float u_neg;
uniform float u_ghost;
out vec4 outColor;

float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

void main() {
  vec2 uv = v_uv;
  float tick = floor(u_ph);
  float sub = fract(u_ph);

  // seizure level for this tick: mostly 0, sometimes a violent burst
  float burstGate = step(1.0 - u_seize * 0.55, h11(floor(u_ph / 4.0) + 91.7));
  float flicker = step(0.35, h11(tick + 3.1));
  float s = burstGate * flicker;
  float amp = u_tear * (0.12 + 0.88 * s);

  // tearing: a handful of horizontal bands slide sideways
  float bandCount = mix(6.0, 40.0, s);
  float band = floor(uv.y * bandCount + h11(tick) * 7.0);
  float bandR = h21(vec2(band, tick));
  float slide = (bandR - 0.5) * 2.0;
  float lit = step(1.0 - amp * (0.25 + 0.75 * s), h21(vec2(band * 1.7, tick + 11.0)));
  uv.x += slide * lit * amp * 0.35;
  // fine line jitter that only wakes during a seizure
  uv.x += (h21(vec2(floor(uv.y * u_res.y * 0.5), tick)) - 0.5) * s * u_tear * 0.04;
  // vertical hold slip
  uv.y = fract(uv.y + s * step(0.8, h11(tick + 5.5)) * (h11(tick + 9.0) - 0.5) * 0.25);

  // channel split follows the tear, wobbling with time
  float sp = u_split * (0.4 + 2.6 * s) * (1.0 + 0.3 * sin(u_time * 31.0));
  vec2 dir = vec2(cos(h11(tick + 20.0) * 6.2832), sin(h11(tick + 20.0) * 6.2832) * 0.25);
  vec3 c;
  c.r = texture(u_tex, uv + dir * sp).r;
  c.g = texture(u_tex, uv).g;
  c.b = texture(u_tex, uv - dir * sp).b;

  // doppelganger: a dim, offset, desaturated second self that slowly swims
  if (u_ghost > 0.01) {
    vec2 gu = vec2(0.5 + (uv.x - 0.5) * -0.97 + 0.03 * sin(u_time * 0.6), uv.y + 0.012 * sin(u_time * 0.9 + uv.x * 3.0));
    vec3 g = texture(u_tex, gu).rgb;
    float gl = dot(g, vec3(0.299, 0.587, 0.114));
    c = mix(c, max(c, vec3(gl) * vec3(0.8, 0.95, 1.0)), u_ghost * (0.35 + 0.35 * s));
  }

  // negative flash: the possession shows through for a frame
  float flash = step(1.0 - u_neg * 0.5 * (0.2 + s), h11(tick * 1.3 + 40.0)) * step(sub, 0.55);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(1.0) - c * vec3(0.9, 1.0, 1.0), flash);
  // seizure blocks drop to crushed contrast
  c = mix(c, (c - 0.5) * 1.6 + 0.5, s * 0.5);

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_ph', rt.phase('glitch', params.rate))
    u.f('u_tear', params.tear)
    u.f('u_split', params.split)
    u.f('u_seize', params.seize)
    u.f('u_neg', params.neg)
    u.f('u_ghost', params.ghost)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
