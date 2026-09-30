// Channel Offset: split a live source (camera / dropped photo or video / demo /
// the Mixer layers below) into its red, green and blue channels and push them
// apart — chromatic aberration, anaglyph ghosting, glitch fringing. The three
// channels are re-sampled with independent offsets in one fragment shader; a
// wobble animates them in slow circles and a glitch mode slices horizontal
// bands sideways.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  amount: { value: Math.round(rt.random(6, 24)), min: 0, max: 80, step: 1, label: 'Offset (px)' },
  angle: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Angle' },
  spread: { value: 120, min: 0, max: 180, step: 1, label: 'Channel spread' },
  wobble: { value: +rt.random(0.15, 0.5).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Wobble' },
  glitch: { value: 0, min: 0, max: 1, step: 0.02, label: 'Band glitch' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats kick the channels apart; loudness shears the glitch bands.
rt.mapInput('audio.pulse', 'amount', 0.4)
rt.mapInput('audio.high', 'glitch', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
vec3 hsv2rgb(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.3));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tex(vec2 uv) { return texture(u_tex, uv).rgb; }

uniform vec2 u_off[3];     // per-channel offset in pixels (y down, like the old canvas version)
uniform float u_glitch;
uniform float u_pr;
uniform float u_t7;        // floor(time * 7): glitch bands re-roll 7x a second

float bandShear(float b, float ch) {
  float seed = sin(b * 37.7 + u_t7 * 13.1 + ch * 5.0) * 43758.5453;
  return (fract(seed) - 0.5) * u_glitch * 90.0 * u_pr;
}
float chan(vec2 uv, int c) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec3 s = tex(uv);
  return c == 0 ? s.r : (c == 1 ? s.g : s.b);
}

void main() {
  float y = 1.0 - v_uv.y;                       // 0 at the top
  float band = floor(y * 14.0);
  vec3 col;
  for (int c = 0; c < 3; c++) {
    vec2 o = u_off[c];
    if (u_glitch > 0.01) o.x += bandShear(band, float(c));
    vec2 uv = v_uv - vec2(o.x / u_res.x, -o.y / u_res.y);
    col[c] = chan(uv, c);
  }
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const t = now * 0.001
    const amt = params.amount * rt.pixelRatio
    const base = (params.angle * Math.PI) / 180
    const spread = (params.spread * Math.PI) / 180
    const off = []
    for (let i = 0; i < 3; i++) {
      // channels fan out around the base angle; wobble swings each in its own slow circle
      const a = base + (i - 1) * spread + params.wobble * Math.sin(t * (0.7 + i * 0.31) + i * 2.1) * 0.9
      const d = amt * (i === 1 ? 0.35 : 1) // green stays closest to true
      off.push(Math.cos(a) * d, Math.sin(a) * d)
    }
    u.v2('u_off[0]', off[0], off[1])
    u.v2('u_off[1]', off[2], off[3])
    u.v2('u_off[2]', off[4], off[5])
    u.f('u_glitch', params.glitch)
    u.f('u_pr', rt.pixelRatio)
    u.f('u_t7', Math.floor(t * 7))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
