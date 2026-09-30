// Polaroid — put a live source through an old printed-photo run: faded/sepia
// grade with lifted blacks and a vignette, an optional white instant-film border
// with the fat bottom lip, and a layer of physical damage — hair-thin scratches,
// dust specks, greasy smudges and blooming water stains. The damage is generated
// once from the sketch seed (so every instance is scuffed differently) and sits
// static over the moving image, like a real print you keep re-filming. The grade,
// border and vignette run in a fragment shader; the damage layer is baked on a 2D
// canvas and uploaded as a texture only when a wear slider changes.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')

const TONES = {
  Faded: { lift: 26, gamma: 1.05, sat: 0.72, tint: [1.03, 1.0, 0.92], fade: 0.14 },
  Sepia: { lift: 22, gamma: 1.1, sat: 0.25, tint: [1.12, 0.98, 0.78], fade: 0.1 },
  Instant: { lift: 18, gamma: 0.95, sat: 0.9, tint: [1.05, 1.0, 1.04], fade: 0.08 },
  Cold: { lift: 20, gamma: 1.0, sat: 0.6, tint: [0.94, 0.99, 1.1], fade: 0.12 },
}
const params = rt.params({
  tone: { value: 'Faded', type: 'select', options: Object.keys(TONES), label: 'Film tone' },
  age: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Age' },
  vignette: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  scratches: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Scratches' },
  dust: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Dust & specks' },
  smudges: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Smudges' },
  water: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Water damage' },
  border: { value: true, type: 'bool', label: 'Instant border' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})

const src = createSource()
// damage lives on its own static layer, rebuilt only when a wear param changes
const dmg = document.createElement('canvas')
const dctx = dmg.getContext('2d')
let W = 0, H = 0
let dmgKey = ''

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_dmg;     // static damage layer (straight alpha)
uniform vec2 u_res;
uniform vec2 u_rect_xy;      // content window origin (px, y down)
uniform vec2 u_rect_wh;      // content window size (px)
uniform bool u_border;
uniform float u_lift;        // 0..1
uniform float u_invG;
uniform float u_sat;
uniform vec3 u_tint;
uniform float u_fade;
uniform float u_vig;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  vec2 half_ = u_rect_wh * 0.5;
  vec2 q = abs(p - (u_rect_xy + half_)) - half_;
  bool inside = q.x <= 0.0 && q.y <= 0.0;
  vec3 col;
  if (!inside) {
    // white instant-film border with a soft shadow around the window
    float dist = length(max(q, 0.0));
    float blur = min(u_res.x, u_res.y) * 0.02;
    col = mix(vec3(0.937, 0.914, 0.863), vec3(0.0), 0.35 * (1.0 - smoothstep(0.0, blur, dist)));
  } else {
    vec2 su = (p - u_rect_xy) / u_rect_wh;
    vec3 c = texture(u_tex, vec2(su.x, 1.0 - su.y)).rgb;
    float l = dot(c, LUMA);
    c = l + (c - l) * u_sat;
    c = u_lift + (1.0 - u_lift) * pow(max(c, 0.0), vec3(u_invG));   // gamma + lifted blacks
    c *= u_tint;
    col = c + (vec3(214.0, 204.0, 186.0) / 255.0 - c) * u_fade;    // milky fade toward warm grey
    // vignette within the window
    float rad = length(u_rect_wh) * 0.5;
    float vt = clamp((length(p - (u_rect_xy + half_)) - rad * 0.55) / (rad * 0.45), 0.0, 1.0);
    col = mix(col, vec3(20.0, 14.0, 8.0) / 255.0, 0.55 * u_vig * vt);
    // static damage on top
    vec4 d = texture(u_dmg, v_uv);
    col = mix(col, d.rgb, d.a);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`
const gf = createGLFilter({ rt, src, canvas, frag: FRAG })
const dmgTex = gf.addTexture('u_dmg', 1)

function resize() {
  W = gf.width
  H = gf.height
  dmgKey = '' // force damage rebuild at new size
}

// content rect inside the white border
function contentRect() {
  if (!params.border) return { x: 0, y: 0, w: W, h: H }
  const m = Math.round(Math.min(W, H) * 0.055)
  const bottom = Math.round(Math.min(W, H) * 0.16)
  return { x: m, y: m, w: W - m * 2, h: H - m - bottom }
}

// local seeded PRNG so the wear pattern is stable while sliders move
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function buildDamage() {
  dmg.width = W; dmg.height = H
  dctx.clearRect(0, 0, W, H)
  const R = mulberry32((rt.seed | 0) ^ 0x9e3779b9) // stable seeded 0..1
  const S = Math.min(W, H)
  const age = params.age

  // water stains — irregular blooms with a darker tide-line ring
  const nWater = Math.round(params.water * 5)
  for (let i = 0; i < nWater; i++) {
    const cx = R() * W, cy = R() * H, rad = S * (0.08 + R() * 0.18)
    dctx.save()
    dctx.translate(cx, cy); dctx.scale(1, 0.6 + R() * 0.7)
    // blotch body: slightly darker, desaturating
    const g = dctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad)
    g.addColorStop(0, `rgba(70,60,45,${0.05 + 0.08 * params.water})`)
    g.addColorStop(0.75, `rgba(60,50,35,${0.03 + 0.05 * params.water})`)
    g.addColorStop(0.9, `rgba(40,30,20,${0.10 + 0.14 * params.water})`) // tide line
    g.addColorStop(1, 'rgba(0,0,0,0)')
    dctx.fillStyle = g
    dctx.beginPath()
    const segs = 22
    for (let a = 0; a <= segs; a++) {
      const th = (a / segs) * Math.PI * 2
      const rr = rad * (0.8 + R() * 0.35)
      const px = Math.cos(th) * rr, py = Math.sin(th) * rr
      a ? dctx.lineTo(px, py) : dctx.moveTo(px, py)
    }
    dctx.closePath(); dctx.fill()
    dctx.restore()
  }

  // smudges — soft greasy dark/light blotches
  const nSm = Math.round(params.smudges * 14)
  for (let i = 0; i < nSm; i++) {
    const cx = R() * W, cy = R() * H, rad = S * (0.04 + R() * 0.12)
    const dark = R() < 0.6
    const g = dctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    const a = (0.04 + R() * 0.07) * params.smudges
    g.addColorStop(0, dark ? `rgba(20,18,14,${a})` : `rgba(240,235,225,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    dctx.fillStyle = g
    dctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }

  // scratches — long thin bright hairlines and a few dark gouges
  const nSc = Math.round(params.scratches * 26)
  dctx.lineCap = 'round'
  for (let i = 0; i < nSc; i++) {
    const vertical = R() < 0.7
    const bright = R() < 0.75
    let x = R() * W, y = R() * H
    const len = S * (0.1 + R() * 0.7)
    const drift = (R() - 0.5) * S * 0.05
    dctx.beginPath(); dctx.moveTo(x, y)
    if (vertical) dctx.lineTo(x + drift, y + (R() < 0.5 ? len : -len))
    else dctx.lineTo(x + (R() < 0.5 ? len : -len), y + drift)
    dctx.lineWidth = Math.max(0.5, (0.5 + R() * 1.2) * rt.pixelRatio)
    dctx.strokeStyle = bright
      ? `rgba(255,252,245,${(0.10 + R() * 0.22) * params.scratches})`
      : `rgba(15,12,10,${(0.10 + R() * 0.2) * params.scratches})`
    dctx.stroke()
  }

  // dust & specks — tiny dark and white grains
  const nDust = Math.round(params.dust * 900)
  for (let i = 0; i < nDust; i++) {
    const x = R() * W, y = R() * H, r = (0.3 + R() * 1.6) * rt.pixelRatio
    const white = R() < 0.5
    dctx.fillStyle = white
      ? `rgba(255,255,250,${(0.15 + R() * 0.5) * params.dust})`
      : `rgba(10,8,6,${(0.15 + R() * 0.5) * params.dust})`
    dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill()
  }
  dmgTex.upload(dmg)
  dmgKey = key()
}
function key() {
  return [W, H, params.age, params.scratches, params.dust, params.smudges, params.water, rt.seed].join(':')
}

function frame(now) {
  rt.tick(now)
  if (dmgKey !== key()) buildDamage()
  const rect = contentRect()
  const T = TONES[params.tone]
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.v2('u_rect_xy', rect.x, rect.y)
    u.v2('u_rect_wh', rect.w, rect.h)
    u.i('u_border', params.border ? 1 : 0)
    u.f('u_lift', (T.lift * (0.4 + params.age)) / 255)
    u.f('u_invG', 1 / T.gamma)
    u.f('u_sat', T.sat)
    u.v3('u_tint', T.tint[0], T.tint[1], T.tint[2])
    u.f('u_fade', T.fade * params.age)
    u.f('u_vig', params.vignette)
  })
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
