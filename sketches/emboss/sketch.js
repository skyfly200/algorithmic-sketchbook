// Emboss — treats brightness as a height map lit from a chosen angle. The
// directional derivative of luminance becomes relief shading: grey clay, the
// image's own colours carved with relief, or a light relief laid over the image.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const STYLES = ['Grey relief', 'Colour relief', 'Overlay']

const rt = createRuntime()
const params = rt.params({
  style: { value: 'Grey relief', type: 'select', options: STYLES, label: 'Style' },
  angle: { value: 135, min: 0, max: 360, step: 1, label: 'Light angle' },
  depth: { value: 3, min: 0, max: 12, step: 0.1, label: 'Depth' },
  size: { value: 1.5, min: 0.5, max: 8, step: 0.1, label: 'Relief size' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
rt.mapInput('audio.pulse', 'depth', 0.5)
rt.mapInput('beat.pulse', 'angle', 0.2)

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_dir;    // light direction in pixels (already scaled by size)
uniform float u_depth;
uniform int u_style;
out vec4 outColor;

float luma(vec2 uv) { return dot(texture(u_tex, uv).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 o = u_dir / u_res;
  // 5-tap smoothed derivative along the light direction
  float d = (luma(v_uv + o) - luma(v_uv - o)) * 0.5
          + (luma(v_uv + o * 2.0) - luma(v_uv - o * 2.0)) * 0.25;
  float relief = d * u_depth;
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 col;
  if (u_style == 0) col = vec3(0.5 + relief);
  else if (u_style == 1) col = base * (0.5 + relief) * 2.0;
  else col = base + relief * 0.8;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const canvas = document.getElementById('canvas')
const gf = createGLFilter({ rt, src: createSource(), canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  const a = (params.angle * Math.PI) / 180
  const s = params.size * rt.pixelRatio
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.v2('u_dir', Math.cos(a) * s, -Math.sin(a) * s)
    u.f('u_depth', params.depth)
    u.i('u_style', Math.max(0, STYLES.indexOf(params.style)))
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
