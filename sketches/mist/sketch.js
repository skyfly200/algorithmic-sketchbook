// Mist — a fine bright haze over a live source: highlights diffuse into a
// soft pearly bloom, contrast lifts toward white in the distance, and slow
// translucent veils breathe across the frame. Where Fog swallows the scene,
// Mist makes it glow like early morning light. A fragment shader (the
// diffusion is taps of the source's mip chain), so it can also run inside a
// Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  haze: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Haze' },
  diffusion: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Diffusion' },
  veil: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Moving veils' },
  pearl: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Pearl (warm→cool)' },
  breathe: { value: 1, min: 0, max: 3, step: 0.05, label: 'Breath speed' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'diffusion', 0.3)
rt.mapInput('time.sin', 'haze', 0.12)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec3 u_mist;     // haze colour, 0..1
uniform float u_haze;    // alpha of the milky lift
uniform float u_diff;    // diffusion strength
uniform float u_sigma;   // diffusion blur, full-resolution px
uniform vec3 u_vc[3];    // veil centre (uv, y down) + radius (as a fraction of the long side)
uniform vec3 u_va;       // veil alpha
out vec4 outColor;

vec3 lifted(vec3 c) { return mix(c, u_mist, u_haze); }
vec3 screenBlend(vec3 b, vec3 s, float a) { return mix(b, b + s - b * s, a); }

void main() {
  vec3 col = lifted(texture(u_tex, v_uv).rgb);

  // diffusion: a blurred copy of the lifted scene screened back on top
  if (u_diff > 0.01) {
    float lod = max(0.0, log2(u_sigma * 0.5));
    vec2 px = 1.0 / u_res;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    const int N = 20;
    for (int i = 0; i < N; i++) {
      float r = u_sigma * 1.8 * sqrt((float(i) + 0.5) / float(N));
      float a = float(i) * 2.39996;
      float w = exp(-0.5 * (r * r) / (u_sigma * u_sigma));
      acc += lifted(textureLod(u_tex, v_uv + vec2(cos(a), sin(a)) * r * px, lod).rgb) * w;
      wsum += w;
    }
    vec3 soft = min(acc / wsum * 1.12, 1.0);
    col = screenBlend(col, soft, u_diff * 0.75);
  }

  // slow breathing veils: broad soft bands, each a radial gradient that fades to white
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  float longSide = max(u_res.x, u_res.y);
  for (int i = 0; i < 3; i++) {
    vec3 v = u_vc[i];
    float d = length((p - v.xy) * u_res) / (v.z * longSide);
    if (d >= 1.0) continue;
    float al = (i == 0 ? u_va.x : i == 1 ? u_va.y : u_va.z) * (1.0 - d);
    vec3 vcol = mix(u_mist, vec3(1.0), d);
    col = screenBlend(col, vcol, al);
  }
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const b = params.breathe
  const pulse = rt.beat.state.pulse
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    const warm = 1 - params.pearl
    u.v3('u_mist', (235 * warm + 215 * params.pearl) / 255, (232 * warm + 226 * params.pearl) / 255, (222 * warm + 240 * params.pearl) / 255)
    u.f('u_haze', params.haze * 0.38)
    u.f('u_diff', params.diffusion)
    u.f('u_sigma', (3 + params.diffusion * 9) * 4) // set at quarter resolution in the 2D version
    const vc = []
    const va = []
    for (let i = 0; i < 3; i++) {
      const ph = t * 0.07 * b + i * 2.1
      vc.push(0.5 + 0.45 * Math.sin(ph + i), 0.5 + 0.4 * Math.cos(ph * 0.8 + i * 1.7), 0.5 + 0.18 * Math.sin(ph * 1.3))
      va.push(params.veil > 0.01 ? Math.max(0, params.veil * (0.1 + 0.05 * Math.sin(t * 0.23 * b + i)) * (1 + pulse * 0.4)) : 0)
    }
    u.v3arr('u_vc', vc)
    u.v3('u_va', va[0], va[1], va[2])
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
