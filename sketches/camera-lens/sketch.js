/**
 * Camera lens: put a real lens between you and a live source (camera, a dropped
 * photo/video, the demo, or — in the Mixer/Patch — the layers below). A focal
 * plane you can rack with the mouse defines what's sharp; everything a "depth"
 * away from it dissolves into aperture blur / bokeh. On top sit the things that
 * make glass read as glass: highlight bloom, a smear of lens dirt that lights
 * up against bright areas, and a soft vignette.
 *
 * There's no true depth here (the source is flat), so depth is modelled as
 * distance from a focal region — pick the lens type: a tilt-shift focal band, a
 * radial "portrait" spot, or the stepped concentric zones of a Fresnel lens.
 *
 * It all runs in one fragment shader; average scene brightness comes from the
 * top mip of the source instead of a per-frame pixel readback.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'
const LENSES = ['Tilt-shift', 'Radial', 'Fresnel']

// Procedural lens-dirt texture (smudges, dust specks, a couple of hairs), baked
// once per size and uploaded as a texture. The shader screen-blends it, so it
// only ever adds light — the way grime on a lens veils and flares against a
// bright scene.
function buildDirt(W, H) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const d = c.getContext('2d')
  const R = () => Math.random()
  // Greasy smudges: large, soft, slightly elongated bright blobs.
  for (let i = 0; i < 16; i++) {
    const x = R() * W
    const y = R() * H
    const r = (0.06 + R() * 0.16) * Math.min(W, H)
    d.save()
    d.translate(x, y)
    d.rotate(R() * Math.PI)
    d.scale(1, 0.4 + R() * 0.7)
    const g = d.createRadialGradient(0, 0, 0, 0, 0, r)
    const a = 0.05 + R() * 0.12
    g.addColorStop(0, `rgba(210,215,230,${a})`)
    g.addColorStop(0.6, `rgba(180,190,210,${a * 0.4})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    d.fillStyle = g
    d.beginPath()
    d.arc(0, 0, r, 0, Math.PI * 2)
    d.fill()
    d.restore()
  }
  // Dust specks.
  for (let i = 0; i < 900; i++) {
    const x = R() * W
    const y = R() * H
    const r = (0.4 + R() * 1.8) * (Math.min(W, H) / 900 + 0.5)
    d.fillStyle = `rgba(230,235,245,${0.06 + R() * 0.5})`
    d.beginPath()
    d.arc(x, y, r, 0, Math.PI * 2)
    d.fill()
  }
  // A few stray hairs / fibres.
  d.lineCap = 'round'
  for (let i = 0; i < 9; i++) {
    let x = R() * W
    let y = R() * H
    d.strokeStyle = `rgba(220,225,235,${0.08 + R() * 0.18})`
    d.lineWidth = 0.6 + R() * 1.2
    d.beginPath()
    d.moveTo(x, y)
    const steps = 6 + (R() * 10) | 0
    let a = R() * Math.PI * 2
    for (let s = 0; s < steps; s++) {
      a += (R() - 0.5) * 1.1
      x += Math.cos(a) * (6 + R() * 14)
      y += Math.sin(a) * (6 + R() * 14)
      d.lineTo(x, y)
    }
    d.stroke()
  }
  return c
}


// Auto-scan: a camera hunting for focus — pull to a new focal plane, ease in
// (with a little settling wobble), hold, then rack to another.
let scanCur = 0.5, scanTarget = 0.5, scanNext = 0, lastT = 0
function autoFocal(t, rt, params) {
  const dt = Math.min(0.05, lastT ? t - lastT : 0.016)
  lastT = t
  if (t > scanNext) { scanTarget = rt.random(0.15, 0.85); scanNext = t + rt.random(2.4, 5) / Math.max(0.2, params.scanSpeed) }
  scanCur += (scanTarget - scanCur) * Math.min(1, dt * 2.4 * params.scanSpeed)
  // a faint focus-breathing wobble as it settles
  return Math.max(0, Math.min(1, scanCur + Math.sin(t * 6) * 0.01 * Math.abs(scanTarget - scanCur)))
}
let dirtTex = null
let dirtSize = ''

const idx = (list, v) => Math.max(0, list.indexOf(v))

const rt = createRuntime()
const params = rt.params({
  focalPlane: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Focal plane' },
  autoScan: { value: false, type: 'bool', label: 'Auto-scan focus' },
  scanSpeed: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Auto-scan speed' },
  focusDepth: { value: 0.3, min: 0.03, max: 1, step: 0.01, label: 'Focus depth' },
  aperture: { value: +rt.random(0.35, 0.8).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Aperture (blur)' },
  // How the sharp zone is shaped: a tilt-shift focal band, a radial portrait
  // spot, or the stepped concentric zones of a Fresnel lens.
  lens: { value: rt.rng() < 0.3 ? 'Radial' : 'Tilt-shift', type: 'select', options: LENSES, label: 'Lens type' },
  bloom: { value: 0.35, min: 0, max: 1, step: 0.02, label: 'Highlight bloom' },
  dirt: { value: +rt.random(0.2, 0.7).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Lens dirt' },
  vignette: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Vignette' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Rack focus by moving the mouse up and down — works with no permissions.
// Centred: the pointer racks focus from near (bottom) to far (top) around the
// mid-depth base, instead of only reaching the far half.
rt.mapInput('mouse.y', 'focalPlane', 1, { center: true })

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

uniform sampler2D u_dirtTex;
uniform float u_fp;          // focal plane, 0 = top
uniform int u_lens;          // 0 tilt-shift, 1 radial, 2 fresnel
uniform float u_depth;
uniform float u_blurPx;
uniform float u_bloom;
uniform float u_dirt;
uniform float u_vig;
uniform float u_rings;
uniform float u_pr;

// 0 = in focus, 1 = fully blurred
float dofMask(vec2 px) {
  float mn = min(u_res.x, u_res.y);
  vec2 c = vec2(u_res.x * 0.5, u_fp * u_res.y);
  if (u_lens == 1) {                        // portrait spot: a sharp disc that softens outward
    float rIn = u_depth * 0.5 * mn;
    float rOut = rIn + u_depth * 0.9 * mn + 1.0;
    return clamp((length(px - c) - rIn) / (rOut - rIn), 0.0, 1.0);
  }
  if (u_lens == 2) {                        // alternating sharp / soft rings, like Fresnel grooves
    float maxR = 0.5 * length(u_res) + 1.0;
    float stops = u_rings * 2.0;
    float f = length(px - c) / maxR * stops;
    if (f >= stops) return mod(stops, 2.0) < 0.5 ? 0.0 : 1.0;
    float fr = fract(f);
    return mod(floor(f), 2.0) < 0.5 ? fr : 1.0 - fr;
  }
  float yf = px.y / u_res.y;                // tilt-shift: a sharp band at the focal plane
  float hw = u_depth * 0.5;
  if (yf <= u_fp - hw) return 1.0;
  if (yf < u_fp) return min(1.0, (u_fp - yf) / hw);
  if (yf < u_fp + hw) return min(1.0, (yf - u_fp) / hw);
  return 1.0;
}

// disc blur (golden-angle spiral) that reads a pre-blurred mip so few taps suffice
vec3 blurDisc(vec2 uv, float radPx, float lod) {
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 20; i++) {
    float f = (float(i) + 0.5) / 20.0;
    float a = float(i) * 2.399963;
    float w = exp(-1.5 * f);
    acc += textureLod(u_tex, uv + vec2(cos(a), sin(a)) * sqrt(f) * radPx / u_res, lod).rgb * w;
    ws += w;
  }
  return acc / ws;
}

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;       // y-down px
  vec3 col = tex(v_uv);
  // average scene brightness from the smallest mip (no readback)
  float bright = dot(textureLod(u_tex, vec2(0.5), 30.0).rgb, LUMA);

  // depth of field: blend toward a blurred copy away from the focal zone
  if (u_blurPx > 0.4) {
    float k = dofMask(px);
    if (k > 0.004) col = mix(col, blurDisc(v_uv, u_blurPx * 2.0, max(0.0, log2(u_blurPx / 5.0))), k);
  }

  // highlight bloom: blurred bright-pass added back (brightness 0.55, contrast 2.4)
  if (u_bloom > 0.01) {
    vec3 b = vec3(0.0);
    float ws = 0.0;
    float r = 8.0 * u_pr * 2.0;
    for (int i = 0; i < 12; i++) {
      float f = (float(i) + 0.5) / 12.0;
      float a = float(i) * 2.399963;
      float w = exp(-2.0 * f);
      vec3 s = clamp(tex(v_uv + vec2(cos(a), sin(a)) * sqrt(f) * r / u_res) * 0.55, 0.0, 1.0);
      b += clamp((s - 0.5) * 2.4 + 0.5, 0.0, 1.0) * w;
      ws += w;
    }
    col += b / ws * min(1.0, u_bloom * (0.5 + 0.7 * bright));
  }

  // lens dirt: screen-blended so it flares against bright areas
  if (u_dirt > 0.01) {
    vec4 d = texture(u_dirtTex, v_uv);
    float a = clamp(d.a * u_dirt * (0.22 + 0.95 * bright), 0.0, 1.0);
    col += a * d.rgb * (1.0 - col);
  }

  // Fresnel groove seams: faint concentric ring lines catching the light
  if (u_lens == 2) {
    vec2 c = vec2(u_res.x * 0.5, u_fp * u_res.y);
    float maxR = 0.5 * length(u_res);
    float sp = maxR / (u_rings * 2.0);
    float dist = abs(mod(length(px - c) + sp * 0.5, sp) - sp * 0.5);
    float lw = max(1.0, u_pr);
    col += vec3(200.0, 220.0, 255.0) / 255.0 * 0.06 * (0.5 + 0.6 * bright) * (1.0 - smoothstep(lw * 0.5 - 0.5, lw * 0.5 + 0.5, dist));
  }

  // vignette
  float mn = min(u_res.x, u_res.y), mx = max(u_res.x, u_res.y);
  float t = clamp((length(px - u_res * 0.5) - mn * 0.35) / (mx * 0.72 - mn * 0.35), 0.0, 1.0);
  col *= 1.0 - u_vig * 0.85 * t;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG, mipmaps: true })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    const t = now * 0.001
    const fp = params.autoScan ? autoFocal(t, rt, params) : params.focalPlane
    // (re)bake the dirt texture when the size changes
    const size = gf.width + 'x' + gf.height
    if (size !== dirtSize) {
      dirtSize = size
      if (!dirtTex) dirtTex = gf.addTexture('u_dirtTex', 1)
      dirtTex.upload(buildDirt(gf.width, gf.height))
    }
    u.f('u_fp', fp)
    u.i('u_lens', idx(LENSES, params.lens))
    u.f('u_depth', params.focusDepth)
    u.f('u_blurPx', params.aperture * 22 * Math.max(0.6, rt.pixelRatio))
    u.f('u_bloom', params.bloom)
    u.f('u_dirt', params.dirt)
    u.f('u_vig', params.vignette)
    u.f('u_rings', Math.max(3, Math.min(26, Math.round(0.7 / params.focusDepth))))
    u.f('u_pr', rt.pixelRatio)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
