// Feedback — video feedback: each frame the previous output is redrawn zoomed,
// rotated and drifting, faded a touch, then the live source is composited on
// top. The result tunnels inward and trails into echoes, exactly like pointing
// a camera at the screen it's feeding. A kaleidoscopic mirror and hue-cycling
// push it fully psychedelic.
//
// A stateful GPU filter: the shader samples u_prev, its own previous output (see
// _lib/glhistory.js), so it can also run inside a shared filter chain in Patch.
// The kaleidoscope mirror is part of what it displays, so it folds back into the
// loop too and the symmetry builds up across frames.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()

const params = rt.params({
  zoom: { value: 1.05, min: 0.8, max: 1.5, step: 0.002, label: 'Zoom' },
  rotate: { value: 2, min: -20, max: 20, step: 0.2, label: 'Rotate °/frame' },
  driftX: { value: 0, min: -8, max: 8, step: 0.1, label: 'Drift X' },
  driftY: { value: 0, min: -8, max: 8, step: 0.1, label: 'Drift Y' },
  // Higher decay + a touch of zoom by default so the additive feedback doesn't
  // pin to white; drop them for longer, brighter trails.
  decay: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Decay' },
  sourceMix: { value: 0.4, min: 0.05, max: 1, step: 0.02, label: 'Source amount' },
  hueCycle: { value: 0.3, min: 0, max: 2, step: 0.02, label: 'Hue cycle' },
  mirror2: { value: false, type: 'bool', label: 'Kaleidoscope mirror' },
  mirror: { value: false, type: 'bool', label: 'Mirror source (selfie)' },
})
rt.mapInput('audio.pulse', 'zoom', 0.05)
rt.mapInput('audio.level', 'rotate', 0.4)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_zoom;
uniform float u_rot;      // radians per frame
uniform vec2 u_drift;     // px, y down
uniform float u_decay;
uniform float u_mix;
uniform float u_hue;      // radians
uniform int u_hueOn;
uniform int u_mirror2;
out vec4 outColor;

// CSS hue-rotate()
vec3 hueRotate(vec3 c, float a) {
  float co = cos(a), si = sin(a);
  mat3 m = mat3(
    0.213 + 0.787 * co - 0.213 * si, 0.213 - 0.213 * co + 0.143 * si, 0.213 - 0.213 * co - 0.787 * si,
    0.715 - 0.715 * co - 0.715 * si, 0.715 + 0.285 * co + 0.140 * si, 0.715 - 0.715 * co + 0.715 * si,
    0.072 - 0.072 * co + 0.928 * si, 0.072 - 0.072 * co - 0.283 * si, 0.072 + 0.928 * co + 0.072 * si);
  return clamp(m * c, 0.0, 1.0);
}

// the new feedback buffer at uv: the previous output transformed and faded, with
// the live source screened over it
vec3 stage(vec2 uv) {
  vec2 px = vec2(uv.x, 1.0 - uv.y) * u_res;           // canvas pixels, y down
  vec2 p = px - (u_res * 0.5 + u_drift);
  float cs = cos(u_rot), sn = sin(u_rot);
  p = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y) / u_zoom; // undo rotate, then scale
  vec2 q = p + u_res * 0.5;
  vec2 puv = vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
  vec3 fb = vec3(0.0);
  if (puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0) fb = texture(u_prev, puv).rgb;
  if (u_hueOn == 1) fb = hueRotate(fb, u_hue);
  fb *= 1.0 - u_decay;
  vec3 s = texture(u_tex, uv).rgb;
  return fb + u_mix * (s - fb * s);                    // 'screen' at alpha u_mix
}

void main() {
  vec3 col = stage(v_uv);
  if (u_mirror2 == 1 && v_uv.x > 0.5) col = mix(col, stage(vec2(1.0 - v_uv.x, v_uv.y)), 0.9);
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

let hue = 0 // degrees
let last = 0
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = Math.min(0.1, t - last || 0.016)
  last = t
  const hueOn = params.hueCycle > 0.01
  if (hueOn) hue = (hue + params.hueCycle * 60 * dt) % 360 // the old per-frame step, at 60 fps
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    u.f('u_zoom', params.zoom)
    u.f('u_rot', (params.rotate * Math.PI) / 180)
    u.v2('u_drift', params.driftX * rt.pixelRatio, params.driftY * rt.pixelRatio)
    u.f('u_decay', params.decay)
    u.f('u_mix', params.sourceMix)
    u.f('u_hue', (hue * Math.PI) / 180)
    u.i('u_hueOn', hueOn ? 1 : 0)
    u.i('u_mirror2', params.mirror2 ? 1 : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
