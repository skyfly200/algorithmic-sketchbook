// Wind — Photoshop's Wind for a live source: catch the bright edges and smear
// them into fine horizontal streaks blown across the frame. Edges (rising
// brightness) seed a coloured streak that decays as it travels downwind, broken
// up with grain so it reads as wind-blown lines rather than a motion blur.
//
// GPU version: a seed pass marks the rising edges, then a log-step prefix scan
// (offsets 1, 2, 4, …) carries each streak downwind with exponential decay —
// log2(length) cheap passes instead of a serial loop along every row — and a
// final pass lightens the source with the streaks and grain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLPipe } from '../_lib/glpipe.js'

const DIRS = ['Right', 'Left', 'Both']

const rt = createRuntime()
const canvas = document.getElementById('canvas')

const params = rt.params({
  direction: { value: 'Right', type: 'select', options: DIRS, label: 'Direction' },
  strength: { value: 0.75, min: 0.1, max: 1, step: 0.02, label: 'Gust length' },
  threshold: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Edge sensitivity' },
  grain: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Grain' },
  amount: { value: 0.85, min: 0, max: 1, step: 0.02, label: 'Amount' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'strength', 0.3)

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`
// 1. seed: a streak starts at every rising edge (in the scan direction)
const SEED = HEAD + `
uniform sampler2D u_src;
uniform float u_dir, u_thr, u_seedMul, u_seed;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  vec3 p = texture(u_src, v_uv - vec2(u_dir / u_res.x, 0.0)).rgb;
  bool on = dot(c, LUMA) - dot(p, LUMA) > u_thr && hash21(v_uv * u_res + u_seed) < u_seedMul;
  outColor = vec4(on ? c : vec3(0.0), 1.0);
}`
// 2. scan step: carry streaks 'off' pixels downwind, decayed
const SCAN = HEAD + `
uniform sampler2D u_in;
uniform float u_dir, u_off, u_dec;
void main() {
  vec3 a = texture(u_in, v_uv).rgb;
  vec2 uv = v_uv - vec2(u_dir * u_off / u_res.x, 0.0);
  vec3 b = (uv.x < 0.0 || uv.x > 1.0) ? vec3(0.0) : texture(u_in, uv).rgb * u_dec;
  outColor = vec4(max(a, b), 1.0);
}`
// 3. composite: lighten the source with the streaks, broken up by grain
const FINAL = HEAD + `
uniform sampler2D u_src, u_a, u_b;
uniform float u_grain, u_amount, u_seed;
void main() {
  vec3 s = texture(u_src, v_uv).rgb;
  vec3 streak = max(texture(u_a, v_uv).rgb, texture(u_b, v_uv).rgb);
  float g = 1.0 - u_grain * hash21(v_uv * u_res * 1.37 + u_seed + 11.0);
  outColor = vec4(max(s, streak * g * u_amount), 1.0);
}`

const pipe = createGLPipe({ rt, src: createSource(), canvas })
const pSeed = pipe.program(SEED)
const pScan = pipe.program(SCAN)
const pFinal = pipe.program(FINAL)
const mk = () => pipe.target({ float: true })
const chains = [{ a: mk(), b: mk() }, { a: mk(), b: mk() }] // [right-going, left-going]
const blank = pipe.target({ width: 2, height: 2 }) // all zero: stands in for the unused direction

let lastSig = ''
function frame(now) {
  rt.tick(now)
  if (!pipe.begin({ mirror: params.mirror, time: now * 0.001 })) { requestAnimationFrame(frame); return }

  const seedBucket = params.grain > 0.001 ? Math.floor(now * 0.024) * 3.17 : 0
  const sig = [params.direction, params.strength, params.threshold, params.grain, params.amount, seedBucket, pipe.width, pipe.height].join('|')
  // nothing new to show: same picture, same params, same grain frame
  if (!pipe.changed && sig === lastSig) { requestAnimationFrame(frame); return }
  lastSig = sig

  const W = pipe.width, H = pipe.height
  // the original walked a <=900px buffer; keep the streak length in screen terms
  const bufScale = Math.min(1, 900 / Math.max(W, H))
  const decayBuf = 0.9 + params.strength * 0.095
  const decay = Math.pow(decayBuf, bufScale) // per screen pixel
  const reach = Math.min(1024, Math.ceil(Math.log(0.01) / Math.log(decay)))
  const passes = Math.max(1, Math.ceil(Math.log2(reach)))
  const seedMul = 0.5 + params.grain * 0.5
  const dirs = params.direction === 'Both' ? [1, -1] : params.direction === 'Left' ? [-1] : [1]

  const results = [blank, blank]
  dirs.forEach((dir, n) => {
    const ch = chains[n]
    pipe.run(pSeed, { u_src: pipe.source }, ch.a, (u) => {
      u.f('u_dir', dir)
      u.f('u_thr', params.threshold)
      u.f('u_seedMul', seedMul)
      u.f('u_seed', seedBucket)
    })
    let from = ch.a
    let to = ch.b
    for (let j = 0; j < passes; j++) {
      const off = 2 ** j
      pipe.run(pScan, { u_in: from }, to, (u) => {
        u.f('u_dir', dir)
        u.f('u_off', off)
        u.f('u_dec', Math.pow(decay, off))
      })
      ;[from, to] = [to, from]
    }
    results[n] = from
  })
  pipe.run(pFinal, { u_src: pipe.source, u_a: results[0], u_b: results[1] }, null, (u) => {
    u.f('u_grain', params.grain)
    u.f('u_amount', params.amount)
    u.f('u_seed', seedBucket)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
