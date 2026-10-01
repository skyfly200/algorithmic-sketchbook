/**
 * Birefringence — double refraction, the way a clear rhomb of calcite splits
 * whatever you lay it over into two offset images. The upstream frame is drawn
 * twice: the ordinary ray straight through, and the extraordinary ray sheared
 * sideways by an amount and direction set like the crystal's optic axis, so
 * text and edges ghost into doubles. Turn up interference and the field breaks
 * into the shifting spectral bands you get viewing a birefringent crystal
 * between crossed polarisers. A filter: it doubles whatever feeds it (camera,
 * a dropped clip, the demo, or the layers below).
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')

const params = rt.params({
  split: { value: 0.06, min: 0, max: 0.25, step: 0.005, label: 'Double split' },
  angle: { value: 30, min: 0, max: 360, step: 1, label: 'Optic axis' },
  spin: { value: 0, min: -1, max: 1, step: 0.02, label: 'Rotate crystal' },
  balance: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Ray balance' },
  interference: { value: 0.28, min: 0, max: 1, step: 0.02, label: 'Interference colour' },
  bands: { value: 4, min: 1, max: 12, step: 0.5, label: 'Colour bands' },
  drift: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Band drift' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'interference', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_shift;   // extraordinary-ray offset, px (y down)
uniform vec2 u_axis;    // optic axis direction (y down)
uniform float u_ordW;
uniform float u_extW;
uniform float u_inter;
uniform float u_bands;
uniform float u_phase;
out vec4 outColor;

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);           // y down, 0..1
  vec3 ord = texture(u_tex, v_uv).rgb;
  vec2 pe = p - u_shift / u_res;                   // where the sheared copy comes from
  float inside = (pe.x >= 0.0 && pe.x <= 1.0 && pe.y >= 0.0 && pe.y <= 1.0) ? 1.0 : 0.0;
  vec3 ext = texture(u_tex, vec2(pe.x, 1.0 - pe.y)).rgb;

  // ordinary ray over black, then the extraordinary ray over that
  vec3 col = ord * u_ordW;
  col = mix(col, ext, u_extW * inside);

  if (u_inter > 0.01) {
    // spectral bands along the optic axis, 'color' blended (hue + saturation of the
    // bands, luminosity of the picture), then a faint overlay ripple for retardation contrast
    float R = length(u_res) * 0.5;
    float u = clamp(dot((p - 0.5) * u_res, u_axis) / (2.0 * R) + 0.5, 0.0, 1.0);
    float x = u * u_bands + u_phase;
    vec3 band = hsl2rgb(fract(x), 0.9, 0.55);
    col = mix(col, setLum(band, lum(col)), u_inter);
    float b = 0.5 + 0.5 * sin(x * 6.28318530718);
    vec3 ov = vec3(b);
    vec3 ovl = mix(2.0 * col * ov, 1.0 - 2.0 * (1.0 - col) * (1.0 - ov), step(0.5, col));
    col = mix(col, ovl, u_inter * 0.35);
  }
  outColor = vec4(col, 1.0);
}`

const src = createSource()
const gf = createGLFilter({ rt, src, canvas, frag: FRAG })
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    const W = gf.width, H = gf.height
    const ang = ((params.angle + t * params.spin * 40) * Math.PI) / 180
    const shift = params.split * Math.min(W, H)
    const bal = params.balance
    u.v2('u_shift', Math.cos(ang) * shift, Math.sin(ang) * shift)
    u.v2('u_axis', Math.cos(ang), Math.sin(ang))
    u.f('u_ordW', clamp(1 - 0.55 * bal, 0.25, 1)) // ordinary (undeviated) ray
    u.f('u_extW', clamp(0.45 + 0.55 * bal, 0.25, 1)) // extraordinary (sheared) ray
    u.f('u_inter', params.interference)
    u.f('u_bands', params.bands)
    u.f('u_phase', t * params.drift)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
