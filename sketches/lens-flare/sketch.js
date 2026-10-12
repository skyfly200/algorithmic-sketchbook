/**
 * Lens Flare over a live source (camera / dropped photo or video / demo / the
 * Mixer layers below). The flare anchors to the brightest point of the image
 * or to a click-and-drag position. It's built from the classic anamorphic kit:
 * a hot core with chromatic halo, a horizontal cyan streak, a ring, and a chain
 * of polygonal ghosts spaced along the line from the light through the frame
 * centre — all additive, all scaled by how bright the found light actually is.
 *
 * One fragment shader, so it can run inside a Patch filter chain. The light is
 * found in the shader too (no pixel readback): a coarse-to-fine search down the
 * source's mip chain (an ~8-cell scan of a top mip, then three 4x4 refinements),
 * finished with a soft arg-max so the anchor moves continuously as the picture
 * changes. That keeps the output a pure function of the input picture.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  intensity: { value: 0.8, min: 0, max: 2, step: 0.05, label: 'Intensity' },
  burst: { value: +rt.random(0.6, 1.0).toFixed(2), min: 0, max: 1.5, step: 0.05, label: 'Radial burst' },
  spikes: { value: 2 * Math.round(rt.random(5, 9)), min: 4, max: 24, step: 1, label: 'Burst spikes' },
  streak: { value: +rt.random(0.1, 0.35).toFixed(2), min: 0, max: 1.5, step: 0.05, label: 'Anamorphic streak' },
  ghosts: { value: Math.round(rt.random(4, 9)), min: 0, max: 12, step: 1, label: 'Ghosts' },
  halo: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Halo ring' },
  chroma: { value: +rt.random(0.3, 0.9).toFixed(2), min: 0, max: 1, step: 0.05, label: 'Chromatic fringe' },
  threshold: { value: 0.55, min: 0.1, max: 0.95, step: 0.01, label: 'Light threshold' },
  auto: { value: true, type: 'bool', label: 'Track brightest point' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// The flare surges with the music.
rt.mapInput('audio.volume', 'intensity', 0.6)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform int u_auto;        // 1: anchor to the brightest point, 0: to u_manual
uniform vec2 u_manual;     // manual light position, 0..1, y down
uniform float u_intensity;
uniform float u_burst;
uniform float u_spikes;
uniform float u_streak;
uniform float u_ghosts;
uniform float u_halo;
uniform float u_chroma;
uniform float u_thresh;
out vec4 outColor;

const float TAU = 6.28318530718;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float lumAt(ivec2 p, int lod) { return luma(texelFetch(u_tex, p, lod).rgb); }

// Brightest point of the picture: xy = uv (y up), z = its brightness.
// Every fragment runs the same fetches, so they all agree (and hit the cache).
vec3 findLight() {
  ivec2 s0 = textureSize(u_tex, 0);
  float mx = float(max(s0.x, s0.y));
  int top = int(floor(log2(mx)));
  int c = clamp(int(ceil(log2(mx / 8.0))), 0, top);
  ivec2 s = textureSize(u_tex, c);
  ivec2 best = ivec2(0);
  float bl = -1.0;
  for (int j = 0; j < 8; j++) {
    if (j >= s.y) break;
    for (int i = 0; i < 8; i++) {
      if (i >= s.x) break;
      float l = lumAt(ivec2(i, j), c);
      if (l > bl) { bl = l; best = ivec2(i, j); }
    }
  }
  for (int k = 0; k < 3; k++) {
    if (c == 0) break;
    c--;
    s = textureSize(u_tex, c);
    ivec2 base = best * 2 - 1;
    ivec2 nb = clamp(best * 2, ivec2(0), s - 1);
    float nbl = -1.0;
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      ivec2 p = base + ivec2(i, j);
      if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, s))) continue;
      float l = lumAt(p, c);
      if (l > nbl) { nbl = l; nb = p; }
    }
    best = nb;
    bl = nbl;
  }
  // soft arg-max over the winner's neighbourhood: sub-cell, continuous position
  vec2 acc = vec2(0.0);
  float ws = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 p = best + ivec2(i, j);
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, s))) continue;
    float w = exp((lumAt(p, c) - bl) * 30.0);
    acc += (vec2(p) + 0.5) * w;
    ws += w;
  }
  return vec3(acc / ws / vec2(s), bl);
}

// one additive radial-gradient blob: alpha a at the centre, 0 at radius r
vec3 glow(vec2 p, vec2 c, float r, vec3 rgb, float a) {
  if (r < 0.5 || a <= 0.003) return vec3(0.0);
  return rgb * a * max(0.0, 1.0 - length(p - c) / r);
}
// antialiased ring stroke
float ring(float d, float r, float w) { return clamp(w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0); }

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;   // y-down px

  vec2 L;
  float I = u_intensity;
  if (u_auto == 1) {
    vec3 f = findLight();
    L = vec2(f.x, 1.0 - f.y) * u_res;
    // below threshold the flare fades out rather than popping
    I *= clamp((f.z - u_thresh) / (1.0 - u_thresh), 0.0, 1.0);
  } else {
    L = u_manual * u_res;
  }
  if (I <= 0.01) { outColor = vec4(base, 1.0); return; }

  vec2 C = u_res * 0.5;
  float m = min(u_res.x, u_res.y);
  float t = u_time;
  float flicker = 1.0 + 0.06 * sin(t * 13.7) + 0.04 * sin(t * 7.1);
  vec2 d = px - L;
  float dist = length(d);
  vec3 add = vec3(0.0);

  // hot core
  add += glow(px, L, m * 0.05 * flicker, vec3(1.0), 0.9 * I);
  add += glow(px, L, m * 0.16 * flicker, vec3(255.0, 235.0, 200.0) / 255.0, 0.45 * I);

  // radial starburst: alternating long / short diffraction spikes
  if (u_burst > 0.01) {
    float n = floor(u_spikes + 0.5);
    float len = m * (0.22 + 0.55 * u_burst) * flicker;
    if (dist < len * 1.31) {
      float k = I * u_burst;
      for (int i = 0; i < 24; i++) {
        float fi = float(i);
        if (fi >= n) break;
        float a = fi / n * TAU;
        float lng = mod(fi, 2.0) < 0.5 ? 1.0 : 0.5;
        float ll = len * lng * (0.7 + 0.6 * abs(sin(fi * 1.3 + t)));
        vec2 dir = vec2(cos(a), sin(a));
        float along = dot(d, dir);
        if (along < 0.0 || along > ll) continue;
        float lw = max(1.0, m * 0.004 * lng);
        float cov = clamp(lw * 0.5 + 0.5 - abs(d.x * dir.y - d.y * dir.x), 0.0, 1.0);
        if (cov <= 0.0) continue;
        float f = along / ll;
        vec3 col = f < 0.5 ? mix(vec3(255.0, 240.0, 210.0), vec3(255.0, 210.0, 170.0), f * 2.0)
                           : mix(vec3(255.0, 210.0, 170.0), vec3(255.0, 200.0, 160.0), f * 2.0 - 1.0);
        float al = f < 0.5 ? mix(0.5, 0.12, f * 2.0) : mix(0.12, 0.0, f * 2.0 - 1.0);
        add += col / 255.0 * al * k * cov;
      }
    }
  }

  // chromatic fringe
  if (u_chroma > 0.01) {
    add += glow(px, L - vec2(m * 0.01, 0.0), m * 0.2, vec3(255.0, 80.0, 60.0) / 255.0, 0.12 * I * u_chroma);
    add += glow(px, L + vec2(m * 0.01, 0.0), m * 0.23, vec3(80.0, 120.0, 255.0) / 255.0, 0.12 * I * u_chroma);
  }

  // anamorphic streak: a long thin horizontal cyan blur
  if (u_streak > 0.01) {
    float sw = u_res.x * 0.9 * u_streak;
    float sh = m * 0.006 * (1.0 + u_streak);
    float u = abs(d.x) / sw;
    if (u < 1.0) {
      float cov = clamp(sh + 0.5 - abs(d.y), 0.0, 1.0);
      vec3 col = mix(vec3(80.0, 160.0, 255.0), vec3(150.0, 210.0, 255.0), 1.0 - u) / 255.0;
      add += col * 0.5 * I * (1.0 - u) * cov;
    }
    add += glow(px, L, m * 0.02, vec3(200.0, 235.0, 255.0) / 255.0, 0.8 * I);
  }

  // halo rings around the light
  if (u_halo > 0.01) {
    float hr = m * 0.28;
    add += vec3(255.0, 190.0, 140.0) / 255.0 * 0.22 * I * u_halo * ring(dist, hr, m * 0.02);
    add += vec3(140.0, 180.0, 255.0) / 255.0 * 0.14 * I * u_halo * ring(dist, hr * 1.06, m * 0.012);
  }

  // ghost chain along the light -> centre line, mirrored past the centre
  float gn = floor(u_ghosts + 0.5);
  for (int i = 1; i <= 12; i++) {
    float fi = float(i);
    if (fi > gn) break;
    float f = fi / gn * 2.2 - 0.2;
    vec2 G = L + (C - L) * 2.0 * f;
    int h = i - (i / 6) * 6;
    vec3 hue = h == 0 ? vec3(120.0, 220.0, 160.0) : h == 1 ? vec3(255.0, 160.0, 120.0) : h == 2 ? vec3(160.0, 140.0, 255.0)
             : h == 3 ? vec3(255.0, 220.0, 140.0) : h == 4 ? vec3(120.0, 180.0, 255.0) : vec3(240.0, 140.0, 200.0);
    hue /= 255.0;
    float r = m * (0.02 + 0.05 * abs(sin(fi * 2.4))) * (0.6 + 0.8 * abs(f - 0.5));
    if (r < 0.5) continue;
    if (i - (i / 3) * 3 == 0) { // hexagonal aperture ghost, rotated by i radians
      vec2 q = px - G;
      float seg = TAU / 6.0;
      float ang = mod(atan(q.y, q.x) - fi, seg) - seg * 0.5;
      float sd = length(q) * cos(ang) - r * cos(seg * 0.5);
      add += hue * 0.14 * I * clamp(0.5 - sd, 0.0, 1.0);
    } else {
      add += glow(px, G, r, hue, 0.16 * I);
    }
  }

  outColor = vec4(clamp(base + add, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

// Manual light position (drag), smoothed so it glides.
const light = { x: 0.7, y: 0.3 }
const manual = { x: 0.7, y: 0.3, active: false }
canvas.addEventListener('pointerdown', (e) => {
  manual.active = true
  manual.x = e.clientX / window.innerWidth
  manual.y = e.clientY / window.innerHeight
})
window.addEventListener('pointermove', (e) => {
  if (e.buttons) {
    manual.x = e.clientX / window.innerWidth
    manual.y = e.clientY / window.innerHeight
    manual.active = true
  }
})
// Double-click hands the light back to brightest-point tracking.
canvas.addEventListener('dblclick', () => { manual.active = false })
let lastAuto = params.auto

function frame(now) {
  rt.tick(now)
  // switching tracking back on also drops a pinned (clicked) light
  if (params.auto && !lastAuto) manual.active = false
  lastAuto = params.auto
  const useAuto = params.auto && !manual.active
  if (!useAuto) {
    light.x += (manual.x - light.x) * 0.12
    light.y += (manual.y - light.y) * 0.12
  }
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_auto', useAuto ? 1 : 0)
    u.v2('u_manual', +light.x.toFixed(5), +light.y.toFixed(5))
    u.f('u_intensity', params.intensity)
    u.f('u_burst', params.burst)
    u.f('u_spikes', params.spikes)
    u.f('u_streak', params.streak)
    u.f('u_ghosts', params.ghosts)
    u.f('u_halo', params.halo)
    u.f('u_chroma', params.chroma)
    u.f('u_thresh', params.threshold)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
