// Gradient Map — remaps brightness onto a colour ramp, like Photoshop's
// Gradient Map adjustment: shadows take the first stop, highlights the last.
// Pick a preset palette or build a three-stop one from hues, then contrast,
// posterize into bands, invert, blend with the original, or let the ramp cycle.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const PALETTES = {
  Sunset: ['#0b0620', '#5b1a6b', '#e2456b', '#ff9f43', '#fff1c9'],
  Ocean: ['#01101f', '#03396c', '#0a7ea4', '#5fd0c4', '#effff6'],
  Inferno: ['#000004', '#420a68', '#932667', '#f1731d', '#fcffa4'],
  Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  'Ice & fire': ['#0a2a66', '#3ea0ff', '#f4f4f4', '#ff8a3d', '#8a0a0a'],
  Cyberpunk: ['#0d0221', '#2b1055', '#ff2a9d', '#00e5ff', '#f6fff8'],
  Sepia: ['#140c06', '#3d2a17', '#8a6238', '#d2b48c', '#fff4dc'],
  Mono: ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'],
}
const NAMES = [...Object.keys(PALETTES), 'Custom']

function hsvHex(h) {
  const k = (n) => Math.min(Math.max(Math.abs(((h * 6 + n) % 6) - 3) - 1, 0), 1)
  return [k(0), k(4), k(2)]
}

const rt = createRuntime()
const params = rt.params({
  palette: { value: 'Sunset', type: 'select', options: NAMES, label: 'Palette' },
  hueA: { value: 0.65, min: 0, max: 1, step: 0.01, label: 'Custom shadows hue' },
  hueB: { value: 0.9, min: 0, max: 1, step: 0.01, label: 'Custom mids hue' },
  hueC: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'Custom highlights hue' },
  contrast: { value: 1, min: 0.4, max: 3, step: 0.02, label: 'Contrast' },
  shift: { value: 0, min: -1, max: 1, step: 0.01, label: 'Brightness shift' },
  bands: { value: 0, min: 0, max: 12, step: 1, label: 'Posterize bands (0 = off)' },
  cycle: { value: 0, min: 0, max: 1, step: 0.01, label: 'Cycle ramp' },
  mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix with original' },
  invert: { value: false, type: 'bool', label: 'Invert' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'shift', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_stops[5];
uniform float u_contrast;
uniform float u_shift;
uniform float u_bands;
uniform float u_cycle;
uniform float u_mix;
uniform bool u_invert;
out vec4 outColor;

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(x), 3.0));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);   // smooth between stops
  return mix(u_stops[i], u_stops[i + 1], f);
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  float l = dot(base, vec3(0.299, 0.587, 0.114));
  l = (l - 0.5) * u_contrast + 0.5 + u_shift;
  if (u_invert) l = 1.0 - l;
  if (u_bands > 0.5) l = floor(clamp(l, 0.0, 0.999) * u_bands) / (u_bands - 1.0 + 1e-4);
  l += u_cycle * u_time * 0.2;
  // cycling wraps around the ramp; otherwise clamp
  l = (u_cycle > 0.001) ? fract(l) : clamp(l, 0.0, 1.0);
  outColor = vec4(mix(base, ramp(l), u_mix), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function stops() {
  if (params.palette === 'Custom') {
    const a = hsvHex(params.hueA).map((v) => v * 0.25)
    const b = hsvHex(params.hueB)
    const c = hsvHex(params.hueC).map((v) => 0.4 + v * 0.6)
    const mix = (x, y, t) => x.map((v, i) => v + (y[i] - v) * t)
    return [a, mix(a, b, 0.5), b, mix(b, c, 0.5), c].flat()
  }
  return PALETTES[params.palette].flatMap(hex)
}

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.v3arr('u_stops', new Float32Array(stops()))
    u.f('u_contrast', params.contrast)
    u.f('u_shift', params.shift)
    u.f('u_bands', Math.round(params.bands))
    u.f('u_cycle', params.cycle)
    u.f('u_mix', params.mix)
    u.i('u_invert', params.invert ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
