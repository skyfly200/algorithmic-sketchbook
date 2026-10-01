// Edge Detect — a GPU edge filter for a live source. The source is uploaded as
// a texture each frame and a 3x3 gradient kernel (Sobel / Scharr / Prewitt) or a
// Laplacian is evaluated per pixel, then thresholded and coloured in one of
// several styles (white lines, ink on paper, neon, glow overlay, or hue-coded
// by the direction of the edge).
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const METHODS = ['Sobel', 'Scharr', 'Prewitt', 'Laplacian']
const STYLES = ['White on black', 'Ink on paper', 'Neon', 'Overlay', 'Direction hue']

const rt = createRuntime()
const params = rt.params({
  method: { value: 'Sobel', type: 'select', options: METHODS, label: 'Kernel' },
  style: { value: 'White on black', type: 'select', options: STYLES, label: 'Style' },
  strength: { value: 3, min: 0, max: 8, step: 0.05, label: 'Strength' },
  threshold: { value: 0.04, min: 0, max: 1, step: 0.01, label: 'Threshold' },
  softness: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Softness' },
  thickness: { value: 1, min: 0.5, max: 6, step: 0.1, label: 'Line thickness' },
  hue: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Line hue' },
  colorEdges: { value: false, type: 'bool', label: 'Edges per colour channel' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.volume', 'strength', 0.5)

const canvas = document.getElementById('canvas')

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;      // one source pixel in uv units, pre-scaled by thickness
uniform int u_method;      // 0 sobel, 1 scharr, 2 prewitt, 3 laplacian
uniform int u_style;
uniform float u_strength;
uniform float u_threshold;
uniform float u_softness;
uniform float u_hue;
uniform bool u_perChannel;
out vec4 outColor;

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

vec3 tap(float dx, float dy) {
  return texture(u_tex, v_uv + vec2(dx, dy) * u_texel).rgb;
}

// gradient (per channel) → x in .xyz of gx, y in gy
void gradient(out vec3 gx, out vec3 gy) {
  vec3 tl = tap(-1.0, 1.0), t = tap(0.0, 1.0), tr = tap(1.0, 1.0);
  vec3 l = tap(-1.0, 0.0), r = tap(1.0, 0.0);
  vec3 bl = tap(-1.0, -1.0), b = tap(0.0, -1.0), br = tap(1.0, -1.0);
  // kernel row weights: corner taps wo, centre taps wc, normalised by n
  float wo = 1.0, wc = 2.0, n = 0.25;                       // Sobel (1,2,1)
  if (u_method == 1) { wo = 3.0; wc = 10.0; n = 1.0 / 16.0; } // Scharr (3,10,3)
  if (u_method == 2) { wo = 1.0; wc = 1.0; n = 1.0 / 3.0; }   // Prewitt (1,1,1)
  gx = ((tr - tl) * wo + (r - l) * wc + (br - bl) * wo) * n;
  gy = ((tl - bl) * wo + (t - b) * wc + (tr - br) * wo) * n;
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 gx, gy;
  vec3 mag3;
  float ang = 0.0;

  if (u_method == 3) {
    vec3 lap = tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, 1.0) + tap(0.0, -1.0) - 4.0 * base;
    mag3 = abs(lap);
  } else {
    gradient(gx, gy);
    mag3 = sqrt(gx * gx + gy * gy);
    const vec3 L = vec3(0.299, 0.587, 0.114);
    ang = atan(dot(gy, L), dot(gx, L));
  }

  vec3 e3 = mag3 * u_strength;
  float e = dot(e3, vec3(0.299, 0.587, 0.114)) * 1.0;
  e3 = smoothstep(vec3(u_threshold), vec3(u_threshold + u_softness + 0.001), e3);
  e = smoothstep(u_threshold, u_threshold + u_softness + 0.001, e);
  vec3 edge = u_perChannel ? e3 : vec3(e);

  vec3 lineCol = hsv(u_hue, 0.85, 1.0);
  vec3 col;
  if (u_style == 0) {
    col = edge;
  } else if (u_style == 1) {
    col = vec3(0.96, 0.94, 0.89) * (1.0 - edge * 0.95);
  } else if (u_style == 2) {
    float m = max(edge.r, max(edge.g, edge.b));
    vec3 tint = normalize(base + 0.05) * 1.7;
    col = (u_perChannel ? edge : vec3(m)) * clamp(tint, 0.0, 1.5);
  } else if (u_style == 3) {
    col = base * 0.55 + edge * lineCol * 1.4;
  } else {
    float h = ang / 6.2831853 + 0.5;
    col = hsv(h, 0.9, 1.0) * (u_perChannel ? edge : vec3(e));
  }
  outColor = vec4(col, 1.0);
}`

const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const th = params.thickness * rt.pixelRatio
    u.v2('u_texel', th / gf.width, th / gf.height)
    u.i('u_method', Math.max(0, METHODS.indexOf(params.method)))
    u.i('u_style', Math.max(0, STYLES.indexOf(params.style)))
    u.f('u_strength', params.strength)
    u.f('u_threshold', params.threshold)
    u.f('u_softness', params.softness)
    u.f('u_hue', params.hue)
    u.i('u_perChannel', params.colorEdges ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
