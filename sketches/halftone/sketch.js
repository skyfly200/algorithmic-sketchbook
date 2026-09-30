/**
 * Halftone: print a live source (camera / dropped photo or video / demo / the
 * Mixer layers below) the way newspapers and comics do — rotated screens of
 * dots whose size carries the tone. Mono mode is one ink screen at 45°; CMYK
 * mode lays four multiply-blended screens at the classic press angles
 * (C 15°, M 75°, Y 0°, K 45°), and the rosette pattern emerges on its own.
 *
 * Each dot screen is evaluated per pixel in a fragment shader: a pixel finds
 * the nearest lattice points of the rotated grid, reads the tone at each from a
 * mipmapped copy of the source and tests its distance against that dot's radius.
 * No pixel readback, no per-dot draw calls.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  cell: { value: +rt.random(5, 10).toFixed(1), min: 3, max: 24, step: 0.5, label: 'Dot pitch' },
  cmyk: { value: rt.rng() < 0.7, type: 'bool', label: 'CMYK (off = ink mono)' },
  contrast: { value: 1.15, min: 0.5, max: 2.2, step: 0.05, label: 'Contrast' },
  angle: { value: Math.round(rt.random(-15, 15)), min: -45, max: 45, step: 1, label: 'Screen angle' },
  scale: { value: 1.0, min: 0.5, max: 1.6, step: 0.02, label: 'Dot gain' },
  paper: { value: true, type: 'bool', label: 'Paper white (off = black)' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats fatten the dots a touch — the page "breathes" with the music.
rt.mapInput('audio.pulse', 'scale', 0.25)

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

uniform float u_cell;      // dot pitch (px)
uniform float u_contrast;
uniform float u_scale;
uniform float u_lod;
uniform float u_ang[4];    // screen angles (radians) for plates 0..3
uniform bool u_cmyk;
uniform bool u_paper;

// ink coverage 0..1 that plate 'kind' wants for colour c
float ink(vec3 c, int kind) {
  if (u_paper) {
    if (u_cmyk) {
      if (kind == 0) return 1.0 - c.r;          // cyan
      if (kind == 1) return 1.0 - c.g;          // magenta
      if (kind == 2) return 1.0 - c.b;          // yellow
      float k = 1.0 - max(c.r, max(c.g, c.b));  // black only where genuinely dark
      return k * k;
    }
    return 1.0 - dot(c, LUMA);
  }
  if (u_cmyk) return kind == 0 ? c.r : (kind == 1 ? c.g : c.b);
  return dot(c, LUMA);
}

// dot coverage of one rotated screen at pixel px (y-down)
float plate(vec2 px, float ang, int kind) {
  float cs = cos(ang), sn = sin(ang);
  vec2 cen = u_res * 0.5;
  vec2 d = px - cen;
  vec2 loc = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);   // into grid space
  vec2 g0 = floor(loc / u_cell + 0.5);
  float maxR = u_cell * 0.7 * u_scale;
  float cov = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 u = (g0 + vec2(float(i), float(j))) * u_cell;
      vec2 pos = cen + vec2(u.x * cs - u.y * sn, u.x * sn + u.y * cs);
      vec3 c = textureLod(u_tex, clamp(vec2(pos.x / u_res.x, 1.0 - pos.y / u_res.y), 0.0, 1.0), u_lod).rgb;
      float v = clamp((ink(c, kind) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
      float r = sqrt(v) * maxR;
      if (r < 0.25) continue;
      cov = max(cov, 1.0 - smoothstep(r - 0.75, r + 0.75, length(px - pos)));
    }
  }
  return cov;
}

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  vec3 col;
  if (u_paper) {
    col = vec3(244.0, 241.0, 232.0) / 255.0;
    if (u_cmyk) {
      col *= mix(vec3(1.0), vec3(0.0, 174.0, 239.0) / 255.0, plate(px, u_ang[0], 0));
      col *= mix(vec3(1.0), vec3(236.0, 0.0, 140.0) / 255.0, plate(px, u_ang[1], 1));
      col *= mix(vec3(1.0), vec3(255.0, 242.0, 0.0) / 255.0, plate(px, u_ang[2], 2));
      col *= mix(vec3(1.0), vec3(20.0, 18.0, 16.0) / 255.0, plate(px, u_ang[3], 3));
    } else {
      col *= mix(vec3(1.0), vec3(24.0, 22.0, 26.0) / 255.0, plate(px, u_ang[3], 3));
    }
  } else {
    col = vec3(6.0, 6.0, 8.0) / 255.0;   // glowing dots on black: additive screens
    if (u_cmyk) {
      col += vec3(255.0, 40.0, 40.0) / 255.0 * plate(px, u_ang[0], 0);
      col += vec3(40.0, 255.0, 40.0) / 255.0 * plate(px, u_ang[1], 1);
      col += vec3(60.0, 60.0, 255.0) / 255.0 * plate(px, u_ang[2], 2);
    } else {
      col += vec3(235.0, 235.0, 240.0) / 255.0 * plate(px, u_ang[3], 3);
    }
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const base = params.angle
    const rad = (d) => ((base + d) * Math.PI) / 180
    // plates 0..3 = C, M, Y at the press angles and K at 45°; mono uses plate 3
    u.f('u_ang[0]', rad(15))
    u.f('u_ang[1]', rad(75))
    u.f('u_ang[2]', rad(0))
    u.f('u_ang[3]', rad(45))
    u.f('u_cell', params.cell * rt.pixelRatio)
    u.f('u_contrast', params.contrast)
    u.f('u_scale', params.scale)
    u.f('u_lod', Math.max(0, Math.log2(Math.max(gf.width, gf.height) / 480)))
    u.i('u_cmyk', params.cmyk ? 1 : 0)
    u.i('u_paper', params.paper ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
