// Ink Bleed — read a live source as ink laid on wet paper and let the water run
// it. A persistent ink field is re-inked from the source each frame, then the
// water advects it along a chosen direction, spreads it sideways by capillary
// blur and breaks the leading edge into feathered fingers, so darks bloom and
// drip while the drawing keeps redrawing itself underneath. Carries the source
// colour into the runs, or bleeds mono black on paper.
//
// The ink field lives in a pair of ping-pong float textures (colour + ink
// amount); one shader pass advances it a step and another composites it over
// the paper, so the whole simulation runs on the GPU.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')

const DIRS = { Down: [0, 1], Up: [0, -1], Left: [-1, 0], Right: [1, 0] }
const params = rt.params({
  direction: { value: 'Down', type: 'select', options: Object.keys(DIRS), label: 'Water runs' },
  flow: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Flow speed' },
  bleed: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Capillary spread' },
  wetness: { value: 0.7, min: 0, max: 0.98, step: 0.01, label: 'Wetness (dwell)' },
  inkiness: { value: 0.5, min: 0.05, max: 1, step: 0.02, label: 'Inkiness' },
  feather: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Edge feather' },
  mono: { value: false, type: 'bool', label: 'Mono (black ink)' },
  paper: { value: '#f4efe3', type: 'color', label: 'Paper' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'flow', 0.3)

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
`
// advance the field one step. state.rgb = ink colour, state.a = ink amount
const STEP = HEAD + `
uniform sampler2D u_state;
uniform sampler2D u_src;
uniform vec2 u_dir;          // water direction, y up
uniform float u_step, u_spread, u_retain, u_feather, u_inkGain, u_mono, u_lod;
float hn(float x, float y) { return fract(sin(x * 12.9898 + y * 78.233) * 43758.5453); }

void main() {
  ivec2 sz = textureSize(u_state, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = textureLod(u_src, (vec2(p) + 0.5) / vec2(sz), u_lod).rgb;
  float lum = dot(c, LUMA);
  // source ink: darkness becomes wet ink
  float sInk = min(1.0, max(0.0, (1.0 - lum) - (1.0 - u_inkGain) * 0.4) * (0.6 + u_inkGain));

  // pull ink from upstream with a lateral blur (capillary spread)
  ivec2 up = p - ivec2(u_dir) * int(u_step);
  float a = 0.0, wsum = 0.0;
  vec3 col = vec3(0.0);
  for (int k = -1; k <= 1; k++) {
    ivec2 q = up + (u_dir.y != 0.0 ? ivec2(k, 0) : ivec2(0, k));
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    float w = k == 0 ? 1.0 : u_spread * 0.6;
    vec4 s = texelFetch(u_state, q, 0);
    a += s.a * w;
    col += s.rgb * w;
    wsum += w;
  }
  if (wsum > 0.0) { a /= wsum; col /= wsum; }
  // feather the leading edge: randomly starve thin runs so they finger out
  float edge = 1.0 - u_feather * 0.9 * hn(float(p.x) * 0.7 + u_time * 3.0, float(sz.y - 1 - p.y) * 0.7);
  float run = a * u_retain * edge;

  // freshly inked source wins where it is drawn
  vec4 o = sInk >= run
    ? vec4(u_mono > 0.5 ? vec3(20.0, 16.0, 14.0) / 255.0 : c, sInk)
    : vec4(col, run);
  outColor = o;
}`
const SHOW = HEAD + `
uniform sampler2D u_state;
uniform vec3 u_paper;
void main() {
  vec4 s = texture(u_state, v_uv);
  float a = clamp(s.a, 0.0, 1.0);
  float av = a * a * (3.0 - 2.0 * a);   // pools read dark, thin runs stay pale
  outColor = vec4(mix(u_paper, s.rgb, av), 1.0);
}`

const pipe = createGLPipe({ rt, src: createSource(), canvas, mipmaps: true })
const pStep = pipe.program(STEP)
const pShow = pipe.program(SHOW)

// the simulation grid is small (as before) and scaled up when shown
const CAP = 440
let S = null // ping-pong pair
let gridW = 0
let gridH = 0
function ensureGrid() {
  const s = Math.min(1, CAP / Math.max(pipe.width, pipe.height))
  const w = Math.max(2, Math.round(pipe.width * s))
  const h = Math.max(2, Math.round(pipe.height * s))
  if (S && w === gridW && h === gridH) return
  gridW = w
  gridH = h
  S?.forEach((t) => pipe.release(t))
  S = [0, 1].map(() => pipe.target({ width: w, height: h, float: true, filter: 'LINEAR' }))
}
const hexRgb = (h) => {
  const v = parseInt(h.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  if (!pipe.begin({ mirror: params.mirror, time: t })) { requestAnimationFrame(frame); return }
  ensureGrid()
  const [dx, dy] = DIRS[params.direction]
  pipe.run(pStep, { u_state: S[0], u_src: pipe.source }, S[1], (u) => {
    u.v2('u_dir', dx, -dy) // the field is y-up; the old version's "down" is +y
    u.f('u_step', 1 + Math.round(params.flow * 2))
    u.f('u_spread', params.bleed)
    u.f('u_retain', params.wetness)
    u.f('u_feather', params.feather)
    u.f('u_inkGain', params.inkiness)
    u.f('u_mono', params.mono ? 1 : 0)
    u.f('u_lod', Math.max(0, Math.log2(pipe.width / gridW)))
  })
  S.reverse() // S[0] is now the newest field
  pipe.run(pShow, { u_state: S[0] }, null, (u) => u.v3('u_paper', ...hexRgb(params.paper)))
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
