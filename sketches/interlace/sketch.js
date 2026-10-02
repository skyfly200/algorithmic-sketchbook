// Interlace — the comb artifact of interlaced video. A real signal reads the
// even scanlines, then the odd ones a field later, so moving edges tear into
// feathered teeth. The previous frame's rows are painted into the odd scanlines
// of the current one (with an optional horizontal shear to exaggerate the comb),
// then scanline darkening is added.
//
// A stateful GPU filter: the shader samples u_prevIn, the picture that fed it on
// the previous draw (see _lib/glhistory.js), so it can also run inside a shared
// filter chain in Patch.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()

const params = rt.params({
  fieldSize: { value: 2, min: 1, max: 8, step: 1, label: 'Field line height' },
  comb: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Comb shear' },
  fieldBlend: { value: 1, min: 0, max: 1, step: 0.02, label: 'Field time-offset' },
  scanlines: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Scanline darkening' },
  oddFirst: { value: false, type: 'bool', label: 'Odd field first' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.level', 'comb', 0.4)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_prevIn;
uniform vec2 u_res;
uniform float u_fs;        // field line height, px
uniform int u_oddFirst;
uniform float u_shear;     // px
uniform float u_fieldBlend;
uniform float u_scan;      // scanline darkening, 0..1
out vec4 outColor;

void main() {
  vec3 cur = texture(u_tex, v_uv).rgb;
  float y = (1.0 - v_uv.y) * u_res.y;                  // px from the top
  int row = int(floor(y / u_fs));
  vec3 col = cur;
  // the odd field (or the even one with "odd first"): the previous frame, sheared
  if ((row & 1) == (u_oddFirst == 1 ? 0 : 1)) {
    vec2 uv = vec2(v_uv.x - u_shear / u_res.x, v_uv.y);
    if (uv.x >= 0.0 && uv.x <= 1.0) {
      vec3 field = mix(texture(u_prevIn, uv).rgb, texture(u_tex, uv).rgb, 1.0 - u_fieldBlend);
      col = field;
    }
  }
  // scanline darkening on the other rows
  if ((row & 1) == 0) col *= 1.0 - u_scan * 0.6;
  outColor = vec4(col, 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  gf.render({ mirror: params.mirror, time: t }, (u) => {
    u.f('u_fs', Math.max(1, Math.round(params.fieldSize)) * rt.pixelRatio)
    u.i('u_oddFirst', params.oddFirst ? 1 : 0)
    u.f('u_shear', params.comb * 8 * rt.pixelRatio * Math.sin(t * 1.7))
    u.f('u_fieldBlend', params.fieldBlend)
    u.f('u_scan', params.scanlines > 0.01 ? params.scanlines : 0)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
