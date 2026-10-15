// Light Through Leaves — dappled canopy light over a live source: layers of
// drifting "leaf" noise mask a warm sunlight field, so soft shadows and
// bright light-pools sway across the scene as if wind were moving branches
// overhead. The gaps flicker and the whole canopy breathes on the breeze.
//
// One fragment shader: the three focal-plane tiles are baked once into the
// channels of one small texture (1 px wrap border so they tile seamlessly) and
// the shadow softening is a gaussian-weighted disc of taps over the stacked
// mask, so it can also run inside a Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  coverage: { value: 0.55, min: 0.1, max: 0.9, step: 0.02, label: 'Canopy density' },
  wind: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind' },
  focus: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Focal-plane spread' },
  softness: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Shadow softness' },
  temp: { value: 0.65, min: 0, max: 1, step: 0.02, label: 'Colour temperature' },
  contrast: { value: 0.8, min: 0, max: 1.5, step: 0.02, label: 'Light contrast' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('time.sin', 'wind', 0.5)


// Baked leaf-gap "transmission" tiles: bright = a gap the sun shines through,
// black = a leaf blocking it. Multiplied together, several of these at different
// scales and blurs (focal planes) beat into the moiré ripple you see in real
// dappled light where the near and far foliage patterns cross.
const S = 256
function bakeLeaves(scale, blurPx, density) {
  const c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d')
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S)
  x.globalCompositeOperation = 'lighter'
  for (let i = 0; i < density; i++) {
    const cx = rt.random(0, S), cy = rt.random(0, S), r = rt.random(6, 26) * scale
    const ry = r * rt.random(0.5, 1), rot = rt.random(0, 6)
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const px = cx + ox * S, py = cy + oy * S
      const g = x.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.beginPath(); x.ellipse(px, py, r, ry, rot, 0, Math.PI * 2); x.fill()
    }
  }
  const c2 = document.createElement('canvas'); c2.width = c2.height = S
  const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.filter = `blur(${blurPx}px)`
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) x2.drawImage(c, ox * S, oy * S)
  return x2.getImageData(0, 0, S, S).data // read once at load
}
// three focal planes: a sharp near layer, then blurrier far layers
const PLANE_SCALE = [1.0, 1.5, 2.3]
const planes = [
  bakeLeaves(1.0, 2, 64),
  bakeLeaves(1.5, 5, 90),
  bakeLeaves(2.3, 9, 120),
]
// pack the planes into r, g, b of one (S+2)² texture with a 1 px wrap border
const T = S + 2
const leafData = new Uint8Array(T * T * 4)
for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
  const si = (((y - 1 + S) % S) * S + ((x - 1 + S) % S)) * 4
  const o = (y * T + x) * 4
  leafData[o] = planes[0][si]; leafData[o + 1] = planes[1][si]; leafData[o + 2] = planes[2][si]; leafData[o + 3] = 255
}

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_leaves; // r, g, b = near, mid, far planes; 258² with a wrap border
uniform vec2 u_res;
uniform vec2 u_mres;        // mask size (half resolution, as the 2D version)
uniform vec3 u_p0;          // plane: offset x, offset y (mask px), tile size
uniform vec3 u_p1;
uniform vec3 u_p2;
uniform float u_lift;       // screen the stack over itself so an open canopy reads bright
uniform float u_sigS;       // shadow blur sigma, mask px
uniform vec3 u_shade;       // shadow tint
uniform vec3 u_light;       // sunlight colour
uniform float u_contrast;
out vec4 outColor;

float plane(vec2 mp, vec3 l, int ch) {
  vec2 q = fract((mp + l.xy) / l.z);
  vec4 t = texture(u_leaves, (1.0 + q * 256.0) / 258.0);
  return ch == 0 ? t.r : ch == 1 ? t.g : t.b;
}
float maskAt(vec2 mp) {
  float m = plane(mp, u_p0, 0) * plane(mp, u_p1, 1) * plane(mp, u_p2, 2);
  return mix(m, 2.0 * m - m * m, u_lift);
}

void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 mp = vec2(v_uv.x, 1.0 - v_uv.y) * u_mres;   // y down, mask px
  float m;
  if (u_sigS < 0.3) {
    m = maskAt(mp);
  } else {
    // softening: a gaussian-weighted disc of taps out to 2 sigma
    const int N = 14;
    float R = u_sigS * 2.0;
    float s = 0.0, ws = 0.0;
    for (int i = 0; i < N; i++) {
      float r = R * sqrt((float(i) + 0.5) / float(N));
      float a = float(i) * 2.399963;
      float w = exp(-0.5 * r * r / (u_sigS * u_sigS));
      s += maskAt(mp + vec2(cos(a), sin(a)) * r) * w;
      ws += w;
    }
    m = s / ws;
  }
  // shadows: darken by the inverse of the mask, keeping light in the gaps
  col *= u_shade + m - u_shade * m;
  // the sunlight wash. (The 2D version meant to gate this by the mask, but its
  // mask was opaque, so the light was added evenly; kept as it looked.)
  col += u_light * u_contrast;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })
gf.addTexture('u_leaves', 1, { flipY: false }).upload(leafData, T, T)

function frame(now) {
  rt.tick(now)
  const sway = Math.sin(rt.phase('sway', 0.6 * params.wind)) * 30
  const v = rt.phase('drift', 12 * params.wind)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const mw = Math.max(2, gf.width >> 1), mh = Math.max(2, gf.height >> 1)
    u.v2('u_mres', mw, mh)
    for (let i = 0; i < 3; i++) {
      const sc = PLANE_SCALE[i] * (1 + i * params.focus * 0.3) // focus spreads the planes apart → stronger beat
      const spd = 0.55 - i * 0.13 // parallax: near planes slide faster than far
      const ts = S * sc
      const ox = v * spd + sway * (1 - i * 0.2), oy = v * 0.14 * spd + sway * 0.3
      u.v3('u_p' + i, ((ox % ts) + ts) % ts, ((oy % ts) + ts) % ts, ts)
    }
    u.f('u_lift', 1 - params.coverage * 0.75)
    u.f('u_sigS', params.softness * 8 * rt.pixelRatio * 0.5)
    const shadow = 1 - params.coverage
    const temp = params.temp
    // shadows take the complementary cool tint when the sunlight is warm
    u.v3('u_shade', (58 + shadow * 40 - temp * 10) / 255, (55 + shadow * 40) / 255, (52 + shadow * 40 + temp * 16) / 255)
    // colour temperature: cool blue-white shade light -> warm golden sun
    u.v3('u_light', (176 + (255 - 176) * temp) / 255, (204 + (206 - 204) * temp) / 255, (236 + (128 - 236) * temp) / 255)
    u.f('u_contrast', params.contrast)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
