// Painterly — repaint any source with oriented brush strokes. Strokes are laid
// perpendicular to the image gradient (i.e. along contours) so they flow around
// forms, exactly how a painter follows edges. The medium (watercolour / oil /
// charcoal / ink / pastel / spray) changes the stroke shape, opacity, colour
// treatment and paper — spray swaps the bristle strokes for soft airbrushed
// clouds with overspray grain, graffiti-on-a-wall style.
//
// Two kinds of pass, all on the GPU. A small bake pass reads each jittered
// stroke cell's colour and contour direction once from a mipmapped copy of the
// source (cheap, pre-blurred taps) and stores them in a per-layer cell texture.
// The main pass checks the cells around every pixel, fetches that baked data
// with one texelFetch each, and composites the strokes in painter's order: a
// coarse layer, then a finer layer that re-inks the edges. Nothing is read back
// to the CPU and there are no per-stroke draw calls.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLPipe } from '../_lib/glpipe.js'

const STYLES = ['Watercolour', 'Oil', 'Charcoal', 'Ink', 'Pastel', 'Spray']

const rt = createRuntime()
const params = rt.params({
  style: { value: 'Watercolour', type: 'select', options: STYLES, label: 'Medium' },
  brush: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Brush size' },
  sizeVary: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Brush size variation' },
  lengthVary: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Stroke length variation' },
  texture: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Bristle texture' },
  density: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Density' },
  length: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'Stroke length' },
  edges: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Edge strength' },
  paper: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Paper texture' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'density', 0.3)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bake0;   // baked cells, coarse layer
uniform sampler2D u_bake1;   // baked cells, fine layer
uniform vec2 u_res;
uniform float u_cell0;
uniform float u_cell1;
uniform int u_style;     // 0 watercolour, 1 oil, 2 charcoal, 3 ink, 4 pastel, 5 spray
uniform float u_base;     // base brush size (px)
uniform float u_sizeVary;
uniform float u_lenVary;
uniform float u_texAmt;
uniform float u_density;
uniform float u_length;
uniform float u_edges;
uniform float u_paper;
uniform float u_pr;
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

// One layer of strokes. 'base' is the brush size, 'seed' decorrelates layers,
// 'minGrad' skips strokes on flat areas (used by the fine edge pass).
void layer(inout vec3 col, vec2 px, float base, float cell, float seed, float minGrad, sampler2D bake) {
  vec2 cid0 = floor(px / cell);

  float wMax = base * 0.5 * (1.0 + 0.8 * u_sizeVary) * (u_style == 0 ? 1.6 : 1.2);
  float halfLenMax = 1.6 * cell;
  float bound = (u_style == 5) ? base * 2.6 : halfLenMax + wMax;

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 id = cid0 + vec2(float(i), float(j));
      // baked per cell: contour angle, jitter (h) and a per-stroke random in the right texel
      ivec2 ti = ivec2(id) + 2;
      vec4 ah = texelFetch(bake, ivec2(ti.x * 2 + 1, ti.y), 0);
      vec2 h = ah.gb;
      vec2 centre = (id + 0.5 + (h - 0.5)) * cell;
      vec2 d = px - centre;
      if (dot(d, d) > bound * bound) continue;

      vec2 h2 = hash22(id + seed + 5.3);
      float h3 = ah.a;
      // colour + gradient sit in the left texel
      vec4 cg = texelFetch(bake, ivec2(ti.x * 2, ti.y), 0);
      vec3 c = cg.rgb;
      float lum = dot(c, LUMA);
      float grad = cg.a * 2.0;
      if (grad < minGrad) continue;

      float svar = 1.0 + (h2.x * 2.0 - 1.0) * u_sizeVary * 0.8;
      float lvar = 1.0 + (h2.y * 2.0 - 1.0) * u_lenVary;
      float dark = 1.0 - lum;

      if (u_style == 5) {
        // soft airbrushed dab with a grainy overspray halo
        float rad = base * 1.3 * (0.8 + grad * 0.7) * svar;
        float a = (0.14 + u_texAmt * 0.13) * 1.7;
        float r = length(d) / rad;
        float core = (1.0 - smoothstep(0.0, 1.0, r)) * a;
        float halo = smoothstep(0.35, 0.6, r) * (1.0 - smoothstep(1.0, 1.5, r));
        float grain = step(1.0 - 0.3 * u_texAmt, hash21(floor(px / max(u_pr, 1.0)) + id));
        vec3 sc = c + (hash21(floor(px) + id) - 0.5) * 0.2 * u_texAmt;
        col = mix(col, sc, clamp(core + halo * grain * a * 1.6, 0.0, 1.0));
        continue;
      }

      float ang = ah.r * 6.2831853 - 1.5707963 + (h3 - 0.5) * 0.4 * u_texAmt;
      float len = max(base * 0.4, base * (1.2 + grad * 2.0) * u_length * lvar);
      float halfLen = min(len * 0.5, halfLenMax);
      float wdt = base * 0.5 * svar;

      vec3 sc = c;
      float a = 0.9;
      float lw = wdt;
      if (u_style == 0) { a = 0.22; lw = wdt * 1.6; sc = c * 0.7 + 0.3; }
      else if (u_style == 4) { a = 0.5; lw = wdt * 1.2; sc = c * 0.75 + vec3(0.92, 0.90, 0.88) * 0.25; }
      else if (u_style == 1) { a = 0.92; lw = wdt; }
      else if (u_style == 2) { sc = vec3(30.0, 28.0, 32.0) / 255.0; a = min(0.7, dark * 0.7 + grad * u_edges); }
      else {   // ink: linework only where there is an edge or a deep shadow
        float on = grad * 3.0 * u_edges + max(0.0, dark - 0.55) * 1.5;
        if (on < 0.12) continue;
        sc = vec3(20.0, 18.0, 24.0) / 255.0;
        a = min(0.9, on);
        lw = wdt * 0.5;
      }

      float cs = cos(ang), sn = sin(ang);
      vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);   // u along the stroke, v across
      float halfW = max(lw * 0.5, 0.75);
      float t = clamp(abs(q.x) / max(halfLen, 1.0), 0.0, 1.0);
      float wEff = halfW * (1.0 - 0.3 * t * t);                    // tapered ends
      float distBody = length(vec2(max(abs(q.x) - max(halfLen - halfW, 0.0), 0.0), q.y));
      float body = 1.0 - smoothstep(wEff - 1.0, wEff, distBody);
      float coreLen = halfLen * 0.7;
      float coreW = wEff * 0.6;
      float distCore = length(vec2(max(abs(q.x) - max(coreLen - coreW, 0.0), 0.0), q.y));
      float core = 1.0 - smoothstep(coreW - 1.0, coreW, distCore);
      float alpha = a * (0.55 * body + 0.45 * core);

      if (u_texAmt > 0.02) {
        // bristle streaks along the stroke: colour pickup + dry-brush gaps
        float streak = vnoise(vec2(q.y / halfW * 3.0 + h3 * 40.0, q.x * 0.03));
        sc += (streak - 0.5) * 0.27 * u_texAmt;
        float dry = vnoise(vec2(q.y / halfW * 2.2 + h.x * 30.0, q.x / max(halfW, 1.0) * 0.5 + h.y * 20.0));
        alpha *= 1.0 - u_texAmt * 0.55 * smoothstep(0.6, 0.88, dry);
        // the odd dash break
        alpha *= 1.0 - u_texAmt * 0.6 * step(0.8, vnoise(vec2(q.x / max(halfW, 1.0) * 0.4 + h.y * 50.0, h3 * 9.0))) * step(0.55, h3);
      }
      col = mix(col, clamp(sc, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
    }
  }
}

void main() {
  vec2 px = v_uv * u_res;
  vec3 ground;
  if (u_style == 3) ground = vec3(0.965, 0.953, 0.925);
  else if (u_style == 2) ground = vec3(0.851, 0.827, 0.776);
  else if (u_style == 5) ground = vec3(0.235, 0.251, 0.282);
  else ground = vec3(0.953, 0.925, 0.867);
  // paper tooth
  float tooth = vnoise(px / (1.5 * u_pr)) * 0.6 + vnoise(px / (4.0 * u_pr)) * 0.4;
  vec3 paperGround = ground * (0.955 + 0.09 * tooth);
  vec3 col = paperGround;

  layer(col, px, u_base, u_cell0, 0.0, -1.0, u_bake0);
  if (u_style != 5) layer(col, px, u_base * 0.5, u_cell1, 17.0, 0.05, u_bake1);   // finer pass re-inks the edges

  // wet media pick up the paper grain on top
  if ((u_style == 0 || u_style == 4) && u_paper > 0.01) {
    col *= mix(vec3(1.0), vec3(0.9 + 0.1 * tooth), u_paper * 0.5);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

// Bake pass: one cell per texel pair. Texel 2i holds colour + gradient, texel
// 2i+1 the contour angle, stroke jitter and a stroke random, all scaled into 0..1 so an RGBA8 fallback still works.
// Cell ids start at -2 so the main pass can read two cells past each edge.
const BAKE = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_full;     // output size in pixels (u_res is the bake target here)
uniform float u_cell;
uniform float u_seed;
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
void main() {
  ivec2 f = ivec2(gl_FragCoord.xy);
  vec2 id = vec2(float(f.x >> 1) - 2.0, float(f.y) - 2.0);
  vec2 h = hash22(id + u_seed);
  vec2 uvc = (id + 0.5 + (h - 0.5)) * u_cell / u_full;
  // analysis taps read a blurred mip, like the reduced field buffer of the CPU version
  float L = max(u_full.x, u_full.y);
  float lod = max(log2(L / 300.0), 0.0);
  vec2 o = vec2(L / 300.0) / u_full;
  vec3 c = textureLod(u_src, uvc, lod).rgb;
  float gx = dot(textureLod(u_src, uvc + vec2(o.x, 0.0), lod).rgb - textureLod(u_src, uvc - vec2(o.x, 0.0), lod).rgb, LUMA);
  float gy = dot(textureLod(u_src, uvc + vec2(0.0, o.y), lod).rgb - textureLod(u_src, uvc - vec2(0.0, o.y), lod).rgb, LUMA);
  if ((f.x & 1) == 0) outColor = vec4(c, min(length(vec2(gx, gy)) * 0.5, 1.0));
  else outColor = vec4((atan(gy, gx) + 3.1415927) / 6.2831853, h, hash21(id + u_seed + 9.1));
}`

const canvas = document.getElementById('canvas')
const pipe = createGLPipe({ rt, src: createSource(), canvas, mipmaps: true })
const pBake = pipe.program(BAKE)
const pMain = pipe.program(FRAG)

// One bake target per layer. It only grows, so audio-driven density changes do
// not reallocate it every frame.
const layers = [0, 17].map((seed) => ({ seed, target: null, cap: [0, 0], cell: 0 }))
function bakeLayer(L, cell) {
  const nx = Math.ceil(pipe.width / cell) + 6
  const ny = Math.ceil(pipe.height / cell) + 6
  let grew = false
  if (!L.target || L.cap[0] < nx || L.cap[1] < ny) {
    pipe.release(L.target)
    L.cap = [Math.ceil(nx * 1.25), Math.ceil(ny * 1.25)]
    L.target = pipe.target({ width: L.cap[0] * 2, height: L.cap[1], float: true, filter: 'NEAREST' })
    grew = true
  }
  if (!pipe.changed && !grew && L.cell === cell) return
  L.cell = cell
  pipe.run(pBake, { u_src: pipe.source }, L.target, (u) => {
    u.v2('u_full', pipe.width, pipe.height)
    u.f('u_cell', cell)
    u.f('u_seed', L.seed)
  })
}

// Frames are skipped when the source picture and every parameter are unchanged.
let lastSig = null
function frame(now) {
  rt.tick(now)
  if (pipe.begin({ mirror: params.mirror, time: now * 0.001 })) {
    const pr = rt.pixelRatio
    const base = 18 * params.brush * pr
    const sig = [params.style, params.brush, params.sizeVary, params.lengthVary, params.texture, params.density,
      params.length, params.edges, params.paper, pr, pipe.width, pipe.height].join(',')
    if (pipe.changed || sig !== lastSig) {
      const cell0 = base / Math.sqrt(1.6 * params.density)
      const cell1 = (base * 0.5) / Math.sqrt(1.6 * params.density)
      bakeLayer(layers[0], cell0)
      bakeLayer(layers[1], cell1)
      pipe.run(pMain, { u_bake0: layers[0].target, u_bake1: layers[1].target }, null, (u) => {
        u.i('u_style', Math.max(0, STYLES.indexOf(params.style)))
        u.f('u_base', base)
        u.f('u_cell0', cell0)
        u.f('u_cell1', cell1)
        u.f('u_sizeVary', params.sizeVary)
        u.f('u_lenVary', params.lengthVary)
        u.f('u_texAmt', params.texture)
        u.f('u_density', params.density)
        u.f('u_length', params.length)
        u.f('u_edges', params.edges)
        u.f('u_paper', params.paper)
        u.f('u_pr', pr)
      })
      lastSig = sig
    }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
