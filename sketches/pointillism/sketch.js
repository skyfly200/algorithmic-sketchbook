/**
 * Pointillism: repaint a live source (camera, a dropped photo/video, the demo
 * scene, or — inside the Mixer/Patch — the layers below) as a field of little
 * colour dots. A stable jittered brick grid of dots reads the source and paints
 * a dot in the colour it finds there; short strokes can be oriented along image
 * contours for an impressionist, brushed feel. The eye blends the dots the way
 * it does a Seurat or Signac canvas.
 *
 * This runs entirely on the GPU in one fragment shader: each pixel looks at the
 * few grid dots that could cover it, works out each dot's colour / size / stroke
 * direction from a mipmapped copy of the source, and composites them in painter's
 * order. No pixel readback, no per-dot draw calls.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()

const params = rt.params({
  size: { value: 1.0, min: 0.4, max: 2.5, step: 0.05, label: 'Dot size' },
  spacing: { value: +rt.random(0.8, 1.4).toFixed(2), min: 0.5, max: 2.5, step: 0.05, label: 'Spacing' },
  jitter: { value: 0.6, min: 0, max: 1.2, step: 0.05, label: 'Jitter' },
  stroke: { value: +rt.random(0.2, 0.7).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Brush strokes' },
  saturation: { value: +rt.random(1.1, 1.6).toFixed(2), min: 0.5, max: 2.2, step: 0.05, label: 'Saturation' },
  variation: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Size variation' },
  opacity: { value: 0.92, min: 0.3, max: 1, step: 0.02, label: 'Dot opacity' },
  texture: { value: true, type: 'bool', label: 'Textured brush' },
  paper: { value: false, type: 'bool', label: 'Paper (light) ground' },
})
// A little audio life by default: loudness fattens the dots, beats jostle them.
rt.mapInput('audio.volume', 'size', 0.4)
rt.mapInput('audio.pulse', 'jitter', 0.4)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_gap;      // grid spacing (px)
uniform float u_baseR;    // base dot radius (px)
uniform float u_jit;      // max jitter (px)
uniform float u_sat;
uniform float u_elong;
uniform float u_alpha;
uniform float u_var;
uniform bool u_tex_on;
uniform bool u_paper;
uniform int u_R;          // neighbourhood radius in grid cells
out vec4 outColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
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
float lumaAt(vec2 uv, float lod) { return dot(textureLod(u_tex, uv, lod).rgb, LUMA); }

void main() {
  vec2 px = v_uv * u_res;
  vec3 col = u_paper ? vec3(0.937, 0.906, 0.839) : vec3(0.027, 0.027, 0.043);
  float lod = max(log2(u_gap * 0.5), 0.0);

  // no dot reaches further than this from its centre — used to skip most cells
  float ext = u_baseR * 1.5 * (1.0 + 0.5 * u_var) * (1.0 + u_elong * 1.7) * 1.25;

  float row0 = floor(px.y / u_gap - 0.5);
  for (int dj = -3; dj <= 3; dj++) {
    if (abs(dj) > u_R) continue;
    float k = row0 + float(dj);
    // brick-offset alternate rows so the grid doesn't read as rows/columns
    float shift = mod(k + 1.0, 2.0) * u_gap * 0.5;
    float x0 = u_gap * 0.5 - shift;
    float i0 = floor((px.x - x0) / u_gap + 0.5);
    for (int di = -3; di <= 3; di++) {
      if (abs(di) > u_R) continue;
      float i = i0 + float(di);
      vec2 id = vec2(i, k);
      vec2 h1 = hash22(id);
      vec2 pos = vec2(x0 + i * u_gap, (k + 0.5) * u_gap) + (h1 * 2.0 - 1.0) * u_jit;
      vec2 d = px - pos;
      if (dot(d, d) > ext * ext) continue;

      vec2 h2 = hash22(id + 7.7);
      float h3 = hash21(id + 3.3);
      float sz = 0.6 + h2.x * 0.9;
      float si = floor(h2.y * 8.0);

      vec2 uvc = pos / u_res;
      vec3 c = textureLod(u_tex, uvc, lod).rgb;
      float lum = dot(c, LUMA);
      c = clamp(lum + (c - lum) * u_sat, 0.0, 1.0);   // saturation boost around own luma
      float rad = u_baseR * sz * (1.0 + (lum - 0.5) * u_var);
      if (rad < 0.3) continue;

      // stretch into strokes along real contours, stay round in smooth areas
      float e = 0.0;
      float rot = h3 * 6.2832;
      if (u_elong > 0.02) {
        vec2 o = vec2(u_gap * 0.35) / u_res;
        float gx = lumaAt(uvc + vec2(o.x, 0.0), lod) - lumaAt(uvc - vec2(o.x, 0.0), lod);
        float gy = lumaAt(uvc + vec2(0.0, o.y), lod) - lumaAt(uvc - vec2(0.0, o.y), lod);
        e = u_elong * clamp(length(vec2(gx, gy)) * 255.0 / 26.0, 0.0, 1.0);
        if (e > 0.02) rot = atan(gy, gx) + 1.5708;
      }
      float rx = rad * (1.0 + e * 1.7);
      float cs = cos(rot), sn = sin(rot);
      vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
      float n = length(q / vec2(rx, rad));

      float blob = 1.0;
      float soft = clamp(1.5 / min(rx, rad), 0.05, 1.0);
      if (u_tex_on) {
        // wobbly blob outline + translucent halo edge, like a loaded round brush
        float a = atan(q.y, q.x);
        blob = 1.0 + 0.13 * sin(a * (7.0 + mod(si, 3.0)) + si * 1.7) + 0.07 * sin(a * 3.0 + si);
        soft = max(soft, 0.3);
      }
      float cov = smoothstep(1.0, 1.0 - soft, n / blob);
      if (u_tex_on) {
        // paper-tooth grain: little bites out of the pigment
        float bite = vnoise(q / rad * 14.0 + si * 13.0);
        cov *= 1.0 - 0.45 * smoothstep(0.62, 0.82, bite);
      }
      col = mix(col, c, cov * u_alpha);
    }
  }
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  const pr = rt.pixelRatio
  const gap = 9 * pr * params.spacing
  const baseR = gap * 0.62 * params.size
  // big dots overlap many neighbours, so look further out for them
  const reach = baseR * 1.5 * (1 + 0.5 * params.variation) * (1 + params.stroke * 1.7) * 1.25 + params.jitter * gap * 0.5
  gf.render({ time: now * 0.001 }, (u) => {
    u.f('u_gap', gap)
    u.f('u_baseR', baseR)
    u.f('u_jit', params.jitter * gap * 0.5)
    u.f('u_sat', params.saturation)
    u.f('u_elong', params.stroke)
    u.f('u_alpha', params.opacity)
    u.f('u_var', params.variation)
    u.i('u_tex_on', params.texture ? 1 : 0)
    u.i('u_paper', params.paper ? 1 : 0)
    u.i('u_R', Math.max(1, Math.min(3, Math.ceil(reach / gap))))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
