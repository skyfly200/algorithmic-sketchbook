// Haunted Static — a dead channel with something in it. Grainy snow drifts over
// the picture, thickens into cold patches that wander across the screen, and
// inside those patches a pale wraith of the real picture (drained, bluish,
// slightly displaced) surfaces and fades. Whispers of horizontal interference
// ride along. One pass, stateless, chain-friendly.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  snow: { value: 0.1, min: 0.002, max: 1.5, step: 0.001, scale: 'log', label: 'Static' },
  grain: { value: 1.5, min: 1, max: 12, step: 0.1, scale: 'log', label: 'Grain size' },
  drift: { value: 0.35, min: 0.02, max: 6, step: 0.01, scale: 'log', label: 'Haunt drift' },
  haunt: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Apparitions' },
  cold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Cold tint' },
  hiss: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Interference' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'snow', 0.25)
rt.mapInput('beat.pulse', 'haunt', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_ph;        // drift clock (integral of rate)
uniform float u_snow;
uniform float u_grain;     // device px per grain
uniform float u_haunt;
uniform float u_cold;
uniform float u_hiss;
out vec4 outColor;

float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.7) + 0.15 * vnoise(p * 4.3 + 3.1); }

void main() {
  vec2 uv = v_uv;
  vec2 px = uv * u_res;
  float fr = floor(u_time * 24.0);                    // static refreshes at 24 Hz

  // horizontal interference: occasional bands that shove the line sideways
  float row = floor(px.y / u_grain);
  float hb = step(0.985 - u_hiss * 0.06, h21(vec2(floor(uv.y * 24.0), fr * 0.37)));
  uv.x += (h21(vec2(row, fr)) - 0.5) * 0.02 * u_hiss + hb * (h21(vec2(floor(uv.y * 24.0), fr)) - 0.5) * 0.08 * u_hiss;

  vec3 c = texture(u_tex, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));

  // cold patches wander slowly; the wraith lives inside them
  vec2 q = uv * vec2(u_res.x / u_res.y, 1.0) * 2.2;
  float field = fbm(q + vec2(u_ph * 0.7, -u_ph * 0.45)) + 0.25 * sin(u_ph * 1.3 + q.x);
  float chill = smoothstep(0.45, 0.78, field) * u_haunt;

  // wraith: drained, bluish, displaced and breathing
  vec2 wu = vec2(0.5 + (uv.x - 0.5) * 1.04, uv.y) + vec2(0.012, 0.0) * sin(u_ph * 2.0 + uv.y * 5.0);
  vec3 w = texture(u_tex, wu).rgb;
  float wl = dot(w, vec3(0.299, 0.587, 0.114));
  vec3 wraith = vec3(wl) * vec3(0.72, 0.92, 1.1) + 0.04;
  float breathe = 0.65 + 0.35 * sin(u_ph * 3.1);

  // base picture sinks into the dark and cools; the wraith takes over in the patches
  vec3 base = mix(c, vec3(l) * vec3(0.75, 0.9, 1.05), u_cold * 0.8) * (1.0 - 0.35 * u_cold);
  vec3 col = mix(base, wraith, chill * breathe);

  // snow: grain thickens inside cold patches
  vec2 gp = floor(px / u_grain);
  float n = h21(gp + fr * 17.31);
  float n2 = h21(gp * 1.37 + fr * 5.7 + 41.0);
  float density = clamp(u_snow * (1.0 + 2.5 * chill), 0.0, 1.0);
  float snowMask = smoothstep(1.0 - density, 1.0, n + (n2 - 0.5) * 0.15);
  float flake = mix(n2, 1.0, 0.4);
  col = mix(col, vec3(flake) * vec3(0.9, 0.97, 1.0), snowMask * clamp(0.55 + u_snow * 0.5, 0.0, 1.0));
  // fine grey fizz everywhere
  col += (n - 0.5) * u_snow * 0.22;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.f('u_ph', rt.phase('drift', params.drift))
    u.f('u_snow', params.snow)
    u.f('u_grain', params.grain * rt.pixelRatio)
    u.f('u_haunt', params.haunt)
    u.f('u_cold', params.cold)
    u.f('u_hiss', params.hiss)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
