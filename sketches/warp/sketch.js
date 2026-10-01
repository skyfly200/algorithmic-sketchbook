// Warp — a live displacement filter over any source (camera / dropped media /
// demo / the Mixer-Patch layers below). The picture is resampled through an
// animated warp field in a fragment shader, so ripples, swirls, waves,
// pinch/bulge and a fisheye lens bend the image in real time. The distortion
// amount, frequency and speed are live params, mappable to the music, so beats
// can pump the warp. Being a single shader pass it also runs in a Patch filter chain.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  pattern: {
    value: 'Ripple', type: 'select',
    options: ['Ripple', 'Swirl', 'Waves', 'Pinch', 'Bulge', 'Fisheye'],
    label: 'Warp pattern',
  },
  amount: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Amount' },
  frequency: { value: 0.5, min: 0.1, max: 2, step: 0.02, label: 'Frequency' },
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
  // Crop-to-fill: overscan so distortions that pull the image inward (pinch,
  // fisheye, big ripples) never reveal the background at the edges — the output
  // always fills the frame.
  fill: { value: true, type: 'bool', label: 'Crop to fill' },
  fillZoom: { value: 1.2, min: 1, max: 2, step: 0.02, label: 'Fill overscan' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats and loudness pump the warp by default.
rt.mapInput('audio.pulse', 'amount', 0.5)
rt.mapInput('audio.level', 'frequency', 0.3)

const PATTERNS = ['Ripple', 'Swirl', 'Waves', 'Pinch', 'Bulge', 'Fisheye']

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform int u_pattern;
uniform float u_amt;
uniform float u_fq;
uniform float u_speed;
uniform float u_zoom; // 1 = no crop-to-fill overscan

out vec4 outColor;

// Where in the source does screen point (u, v) (y down, 0..1) come from?
vec2 warp(vec2 p, float ph) {
  float u = p.x, v = p.y;
  vec2 c = p - 0.5;
  float r = length(c) + 1e-5;
  if (u_pattern == 2) { // Waves
    return vec2(u + u_amt * 0.06 * sin(v * u_fq * 12.0 + ph), v + u_amt * 0.06 * sin(u * u_fq * 12.0 + ph * 1.2));
  } else if (u_pattern == 0) { // Ripple
    float off = u_amt * 0.05 * sin(r * u_fq * 40.0 - ph * 3.0);
    return p + (c / r) * off;
  } else if (u_pattern == 1) { // Swirl
    float rot = u_amt * 3.2 * max(0.0, 0.5 - r) + sin(ph) * u_amt * 0.4;
    float cs = cos(-rot), sn = sin(-rot);
    return 0.5 + vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  }
  float k;
  if (u_pattern == 3) k = 1.0 - u_amt * 0.6 * max(0.0, 0.5 - r) * 2.0 * (0.7 + 0.3 * sin(ph)); // Pinch
  else if (u_pattern == 4) k = 1.0 + u_amt * 0.8 * max(0.0, 0.5 - r) * 2.0 * (0.7 + 0.3 * sin(ph)); // Bulge
  else { float rn = min(1.0, r / 0.5); k = 1.0 - u_amt * 0.5 * (1.0 - rn * rn) * (0.8 + 0.2 * sin(ph)); } // Fisheye
  return 0.5 + c / max(k, 0.1); // the old mesh pushed points out by k; sampling pulls them back by 1/k
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  p = 0.5 + (p - 0.5) / u_zoom;
  vec2 s = warp(p, u_time * u_speed);
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { outColor = vec4(0.02, 0.024, 0.04, 1.0); return; }
  outColor = vec4(texture(u_tex, vec2(s.x, 1.0 - s.y)).rgb, 1.0);
}`

const canvas = document.getElementById('canvas')
// Demo source: a bold colour grid so the distortion is easy to read.
const src = createSource({
  demo(c, t, w, h) {
    c.fillStyle = '#0a0d16'
    c.fillRect(0, 0, w, h)
    const n = 12
    const cw = w / n, ch = h / n
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const hue = ((x + y) * 18 + t * 20) % 360
        c.fillStyle = (x + y) % 2 ? `hsl(${hue}, 70%, 55%)` : `hsl(${(hue + 40) % 360}, 60%, 22%)`
        c.fillRect(x * cw, y * ch, cw, ch)
      }
    }
    // a bright ring so radial warps show clearly
    c.strokeStyle = 'rgba(255,255,255,0.85)'
    c.lineWidth = Math.max(3, w * 0.006)
    c.beginPath(); c.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2); c.stroke()
  },
})
const gf = createGLFilter({ rt, src, canvas, frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ mirror: params.mirror, time: now * 0.001 }, (u) => {
    u.i('u_pattern', Math.max(0, PATTERNS.indexOf(params.pattern)))
    u.f('u_amt', params.amount)
    u.f('u_fq', params.frequency)
    u.f('u_speed', params.speed)
    u.f('u_zoom', params.fill ? params.fillZoom : 1)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
