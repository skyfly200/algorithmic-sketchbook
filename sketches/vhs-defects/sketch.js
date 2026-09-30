/**
 * VHS Defects — the failure modes of a worn VHS tape, run over any live source
 * (camera / dropped photo or video / the synthwave demo scene / the Mixer-Patch
 * layers below, via the shared _lib/source.js pipeline).
 * The processing is done in YIQ, the way analogue video actually separates luma
 * from chroma, which is what makes VHS look like VHS:
 *
 *   • chroma bleed + lag — the tape's tiny colour bandwidth, so hues smear
 *     sideways and trail to the right of edges;
 *   • tracking jitter — each scanline shoved horizontally by tape-speed error;
 *   • head-switching noise — the torn, noisy band along the bottom edge;
 *   • dropouts — bright white streaks where oxide has flaked off;
 *   • tape snow, scanlines, and a vertical-hold roll that slips now and then.
 *
 * GPU version: the footage is downsampled to a small "tape" resolution, one
 * fragment shader degrades it (per-row jitter, horizontal chroma box blur in
 * YIQ, snow, scanlines, roll, dropouts), and a final pass upscales it with the
 * vignette. Only the tiny working image is ever processed per pixel.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const params = rt.params({
  tracking: { value: +rt.random(0.25, 0.9).toFixed(2), min: 0, max: 2, step: 0.02, label: 'Tracking jitter' },
  chroma: { value: +rt.random(0.4, 1.1).toFixed(2), min: 0, max: 2, step: 0.02, label: 'Chroma bleed' },
  noise: { value: +rt.random(0.2, 0.7).toFixed(2), min: 0, max: 1.5, step: 0.02, label: 'Tape snow' },
  dropouts: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Dropouts' },
  scan: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Scanlines' },
  roll: { value: 0.3, min: 0, max: 1.5, step: 0.02, label: 'Vertical hold' },
  wear: { value: +rt.random(0.25, 0.75).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Desaturate / wear' },
})
// Music: beats knock the tracking, loudness raises the snow.
rt.mapInput('audio.pulse', 'tracking', 0.8)
rt.mapInput('audio.volume', 'noise', 0.5)

const canvas = document.getElementById('canvas')

// --- demo footage: a scrolling synthwave scene (so motion reveals the
// tracking + chroma artifacts). Any other source (camera, dropped file,
// Mixer feed) simply replaces it via the shared pipeline. -------------------
function synthwave(sctx, t, W, H) {
  const horizon = H * 0.55
  // Sky.
  const sky = sctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#1a0b2e')
  sky.addColorStop(0.6, '#5b1b6b')
  sky.addColorStop(1, '#ff5f6d')
  sctx.fillStyle = sky
  sctx.fillRect(0, 0, W, horizon)
  // Sun with the classic horizontal cuts.
  const sunR = H * 0.24
  const sunX = W / 2, sunY = horizon - sunR * 0.35
  const sun = sctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR)
  sun.addColorStop(0, '#ffe14d')
  sun.addColorStop(1, '#ff4d8d')
  sctx.save()
  sctx.beginPath(); sctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); sctx.clip()
  sctx.fillStyle = sun; sctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2)
  sctx.globalCompositeOperation = 'destination-out'
  sctx.fillStyle = '#000'
  for (let k = 0; k < 6; k++) {
    const yy = sunY + sunR * 0.15 + k * sunR * 0.16
    sctx.fillRect(sunX - sunR, yy, sunR * 2, sunR * (0.03 + k * 0.012))
  }
  sctx.restore()
  // Ground.
  sctx.fillStyle = '#0a0410'
  sctx.fillRect(0, horizon, W, H - horizon)
  // Perspective grid scrolling toward the viewer.
  sctx.strokeStyle = 'rgba(120,60,200,0.9)'
  sctx.lineWidth = Math.max(1, H * 0.004)
  const scroll = (t * 0.35) % 1
  for (let n = 0; n < 14; n++) {
    const f = (n + scroll) / 14
    const yy = horizon + (H - horizon) * f * f
    sctx.beginPath(); sctx.moveTo(0, yy); sctx.lineTo(W, yy); sctx.stroke()
  }
  for (let vx = -7; vx <= 7; vx++) {
    sctx.beginPath()
    sctx.moveTo(W / 2 + vx * (W * 0.06), horizon)
    sctx.lineTo(W / 2 + vx * (W * 0.7), H)
    sctx.stroke()
  }
}

const src = createSource({ demo: synthwave })
const pipe = createGLPipe({ rt, src, canvas, mipmaps: true })

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
// 1. shrink the footage to the tape's working resolution
const DOWN = HEAD + `
uniform sampler2D u_src;
uniform float u_lod;
void main() { outColor = vec4(textureLod(u_src, v_uv, u_lod).rgb, 1.0); }`

// 2. the VHS deck
const TAPE = HEAD + `
uniform sampler2D u_low;
uniform float u_tracking, u_chroma, u_noise, u_scan, u_wear, u_seed;
uniform int u_roll, u_nDrop;
uniform vec4 u_drop[6];    // x, y, length, alpha (px, y down)

vec3 yiq(vec3 c) {
  return vec3(dot(c, LUMA), 0.596 * c.r - 0.274 * c.g - 0.322 * c.b, 0.211 * c.r - 0.523 * c.g + 0.312 * c.b);
}

void main() {
  ivec2 sz = textureSize(u_low, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int x = p.x;
  int y = sz.y - 1 - p.y;                       // y down, like the old canvas version
  float fy = float(y);

  // per-line tracking jitter: slow wobble + high-frequency tape error
  float jit = (sin(fy * 0.3 + u_time * 6.0) * 1.5 + sin(fy * 1.7 + u_time * 13.0) * 1.0) * u_tracking
            + (hash21(vec2(fy, u_seed)) - 0.5) * 2.0 * u_tracking;
  // head-switching band: the torn, noisy strip along the very bottom
  bool band = y > sz.y - int(round(float(sz.y) * 0.06));
  if (band) jit += (hash21(vec2(fy + 0.5, u_seed + 3.0)) - 0.5) * float(sz.x) * 0.25 * (0.4 + u_tracking);
  int srcY = ((y + u_roll) % sz.y + sz.y) % sz.y;

  int lx = clamp(int(round(float(x) + jit)), 0, sz.x - 1);
  float lag = u_chroma * 6.0;                   // colour trails to the right of edges
  int cx = clamp(int(round(float(x) + jit + lag)), 0, sz.x - 1);
  int row = sz.y - 1 - srcY;                    // back to texture rows (y up)

  float yv = yiq(texelFetch(u_low, ivec2(lx, row), 0).rgb).x;
  // horizontal box blur of the chroma: VHS's narrow colour bandwidth
  int rc = max(1, int(round(2.0 + u_chroma * 7.0)));
  vec2 iq = vec2(0.0);
  for (int k = -16; k <= 16; k++) {
    if (abs(k) > rc) continue;
    iq += yiq(texelFetch(u_low, ivec2(clamp(cx + k, 0, sz.x - 1), row), 0).rgb).yz;
  }
  iq /= float(rc * 2 + 1);
  iq *= 1.0 - u_wear * 0.55;

  // snow: luma noise, heavier in the dark (and across the whole band)
  float n = (hash21(vec2(float(x), fy) + u_seed) - 0.5) * u_noise * (band ? 1.4 : 0.35 + (1.0 - yv) * 0.8);
  yv += n;
  vec3 c = vec3(yv + 0.956 * iq.x + 0.621 * iq.y,
                yv - 0.272 * iq.x - 0.647 * iq.y,
                yv - 1.106 * iq.x + 1.703 * iq.y);
  if (u_scan > 0.0 && (y & 1) == 1) c *= 1.0 - u_scan * 0.35;

  // dropouts: short bright streaks where the oxide flaked off
  for (int i = 0; i < 6; i++) {
    if (i >= u_nDrop) break;
    vec4 d = u_drop[i];
    if (float(x) >= d.x && float(x) < d.x + d.z) {
      if (fy == d.y) c += d.w;
      else if (fy == d.y + 1.0) c += vec3(180.0, 180.0, 255.0) / 255.0 * 0.4;
    }
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

// 3. upscale to the screen with a vignette
const SHOW = HEAD + `
uniform sampler2D u_tape;
void main() {
  vec3 c = texture(u_tape, v_uv).rgb;
  float t = clamp((length(v_uv * u_res - u_res * 0.5) - u_res.y * 0.3) / (u_res.y * 0.45), 0.0, 1.0);
  outColor = vec4(c * (1.0 - 0.5 * t), 1.0);
}`

const pDown = pipe.program(DOWN)
const pTape = pipe.program(TAPE)
const pShow = pipe.program(SHOW)

let tw = 0
let th = 0
let low = null
let tape = null
function ensureTargets() {
  const long = Math.round(Math.min(Math.max(window.innerWidth, window.innerHeight), 380) * rt.detail)
  const ar = window.innerWidth / window.innerHeight
  const w = ar >= 1 ? long : Math.round(long * ar)
  const h = ar >= 1 ? Math.round(long / ar) : long
  if (low && w === tw && h === th) return
  tw = w
  th = h
  low = pipe.target({ width: w, height: h, filter: 'NEAREST' })
  tape = pipe.target({ width: w, height: h })
}

// vertical-hold roll: usually still, occasionally slips and rolls
let rollOffset = 0
let rollVel = 0
function updateRoll(dt) {
  if (Math.random() < 0.004 * params.roll) rollVel += (Math.random() - 0.2) * 40 * params.roll
  rollOffset += rollVel * dt * 6
  rollVel *= 0.92
  if (Math.abs(rollVel) < 0.05) rollVel = 0
}

let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016)
  lastNow = now
  updateRoll(dt)
  if (pipe.begin({ time: now * 0.001 })) {
    ensureTargets()
    pipe.run(pDown, { u_src: pipe.source }, low, (u) => u.f('u_lod', Math.max(0, Math.log2(pipe.width / tw))))

    const drops = []
    const nDrop = Math.random() < params.dropouts * 0.5 ? Math.min(6, 1 + ((Math.random() * params.dropouts * 3) | 0)) : 0
    for (let k = 0; k < nDrop; k++) drops.push([Math.random() * tw | 0, Math.random() * th | 0, tw * (0.05 + Math.random() * 0.25), 0.5 + Math.random() * 0.4])
    pipe.run(pTape, { u_low: low }, tape, (u) => {
      u.f('u_tracking', params.tracking)
      u.f('u_chroma', params.chroma)
      u.f('u_noise', params.noise)
      u.f('u_scan', params.scan)
      u.f('u_wear', params.wear)
      u.f('u_seed', Math.random() * 1000)
      u.i('u_roll', Math.round(rollOffset))
      u.i('u_nDrop', nDrop)
      drops.forEach((d, i) => u.v4('u_drop[' + i + ']', d[0], d[1], d[2], d[3]))
    })
    pipe.run(pShow, { u_tape: tape }, null)
  }
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => { low = null })
requestAnimationFrame(frame)
