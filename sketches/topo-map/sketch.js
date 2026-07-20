// Topo Map — a surveyor's contour map of terrain that doesn't exist:
// domain-warped fractal elevation rendered as topographic isolines with
// index contours every fifth line, hypsometric tinting, hillshade relief
// and a flat sea with bathymetric contours. The land slowly erodes and
// uplifts (the field evolves), the mouse pans the sheet, and beats send a
// surveyor's highlight sweeping up through the elevation bands. Styles:
// paper (USGS quad), blueprint, and neon dark.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const STYLES = ['paper', 'blueprint', 'neon']
const params = rt.params({
  style: { value: rt.pick(STYLES), type: 'select', options: STYLES, label: 'Style' },
  interval: { value: 0.05, min: 0.015, max: 0.12, step: 0.001, label: 'Contour interval' },
  weight: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Line weight' },
  zoom: { value: 1, min: 0.4, max: 3, step: 0.05, label: 'Map scale' },
  drift: { value: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Erosion drift' },
  sea: { value: 0.32, min: 0, max: 0.7, step: 0.01, label: 'Sea level' },
  relief: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hillshade' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Neon hue' },
})
rt.mapInput('audio.low', 'sea', 0.1)
rt.mapInput('audio.pulse', 'weight', 0.4)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
uniform vec2 u_pan;
uniform float u_pulse;
uniform float u_style;     // 0 paper, 1 blueprint, 2 neon
uniform float u_interval;
uniform float u_weight;
uniform float u_zoom;
uniform float u_drift;
uniform float u_sea;
uniform float u_relief;
uniform float u_hue;
out vec4 outColor;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + u_seed;
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i), f), dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
    mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash2(i + vec2(1, 1)), f - vec2(1, 1)), u.x),
    u.y);
}
// evolving fbm: the lattice offsets crawl with time so ridges migrate
float fbm(vec2 p, float t, int oct) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * noise(p + t * (0.1 + float(i) * 0.03));
    p = r * p * 2.03;
    a *= 0.5;
  }
  return v;
}
// elevation 0..1 with gentle domain warp for realistic ridge flow
// (coarse 3-octave warp under a 5-octave field keeps the per-pixel cost sane)
float elev(vec2 p, float t) {
  vec2 w = vec2(fbm(p * 0.9 + 11.0, t, 3), fbm(p * 0.9 - 7.0, t, 3));
  return 0.5 + 0.62 * fbm(p + 0.85 * w, t, 5);
}
vec3 hsl2rgb(vec3 hsl) {
  vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  return hsl.z + c * (rgb - 0.5);
}
// AA contour mask: 1 on the line. k widens index contours.
float contour(float h, float step0, float k) {
  float g = fwidth(h) + 1e-6;
  float f = abs(fract(h / step0 + 0.5) - 0.5) * step0; // distance to nearest line
  return 1.0 - smoothstep(0.0, g * u_weight * k, f);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  float t = u_time * u_drift * 0.12;
  vec2 p = uv * 3.0 / u_zoom + u_pan + vec2(u_seed * 0.13, u_seed * 0.29);

  float h = elev(p, t);
  // hillshade from forward differences, NW light like a real quad sheet
  vec2 e = vec2(2.0 / min(u_resolution.x, u_resolution.y) * 3.0 / u_zoom, 0.0);
  float hx = elev(p + e.xy, t) - h;
  float hy = elev(p + e.yx, t) - h;
  float shade = clamp(0.5 + 4.4 * (-hx * 0.7 + hy * 0.7), 0.0, 1.0);

  bool water = h < u_sea;
  float land01 = clamp((h - u_sea) / max(1.0 - u_sea, 0.2), 0.0, 1.0);

  float minor = contour(h, u_interval, 1.0);
  float index = contour(h, u_interval * 5.0, 1.7); // every 5th, heavier

  // beat: a highlight band sweeping up the elevations
  float bandH = fract(u_time * 0.13);
  float sweep = u_pulse * exp(-pow((h - bandH) / 0.05, 2.0));

  vec3 col;
  if (u_style < 0.5) {
    // paper: cream sea-to-summit hypsometric tints, brown contours
    vec3 sea = mix(vec3(0.69, 0.82, 0.88), vec3(0.55, 0.73, 0.84), clamp((u_sea - h) * 6.0, 0.0, 1.0));
    vec3 low = vec3(0.85, 0.90, 0.79);
    vec3 mid = vec3(0.94, 0.90, 0.76);
    vec3 high = vec3(0.93, 0.85, 0.72);
    vec3 peak = vec3(0.97, 0.96, 0.94);
    vec3 land = mix(mix(low, mid, smoothstep(0.0, 0.45, land01)),
                    mix(high, peak, smoothstep(0.55, 1.0, land01)),
                    smoothstep(0.35, 0.75, land01));
    col = water ? sea : land;
    col *= mix(1.0, 0.72 + 0.55 * shade, u_relief * (water ? 0.25 : 1.0));
    vec3 ink = water ? vec3(0.25, 0.45, 0.62) : vec3(0.48, 0.33, 0.19);
    col = mix(col, ink, minor * (water ? 0.35 : 0.55));
    col = mix(col, ink * 0.75, index * (water ? 0.45 : 0.8));
    col += sweep * vec3(0.9, 0.6, 0.2) * 0.5;
  } else if (u_style < 1.5) {
    // blueprint: white lines on cyan-blue
    col = mix(vec3(0.03, 0.12, 0.30), vec3(0.05, 0.19, 0.42), land01);
    if (water) col = vec3(0.02, 0.08, 0.22);
    col *= mix(1.0, 0.75 + 0.45 * shade, u_relief * 0.7);
    col = mix(col, vec3(0.75, 0.85, 1.0), minor * 0.5);
    col = mix(col, vec3(1.0), index * 0.85);
    col += sweep * vec3(0.4, 0.7, 1.0) * 0.6;
  } else {
    // neon: glowing contours on near-black, hue climbing with elevation
    col = vec3(0.02, 0.02, 0.04);
    float hh = u_hue / 360.0 + land01 * 0.22;
    vec3 glow = hsl2rgb(vec3(fract(hh), 0.95, 0.55));
    if (water) glow = hsl2rgb(vec3(fract(u_hue / 360.0 + 0.5), 0.8, 0.4));
    col += glow * minor * 0.85;
    col += glow * index * 1.3;
    col += glow * 0.06 * (water ? 0.4 : 0.8 + land01); // faint fill
    col *= mix(1.0, 0.6 + 0.6 * shade, u_relief * 0.5);
    col += sweep * glow * 2.0;
  }

  outColor = vec4(col, 1.0);
}`

function compile(type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
  return shader
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program)
gl.useProgram(program)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const U = {}
for (const n of ['u_resolution', 'u_time', 'u_seed', 'u_pan', 'u_pulse', 'u_style', 'u_interval', 'u_weight', 'u_zoom', 'u_drift', 'u_sea', 'u_relief', 'u_hue']) {
  U[n] = gl.getUniformLocation(program, n)
}
const seed = rt.random(0, 100)

// drag to pan the sheet (inertial-free, direct like sliding a paper map)
let panX = 0
let panY = 0
let dragging = null
canvas.addEventListener('pointerdown', (e) => {
  dragging = { x: e.clientX, y: e.clientY, px: panX, py: panY }
})
window.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const k = 3 / (params.zoom * Math.min(window.innerWidth, window.innerHeight))
  panX = dragging.px - (e.clientX - dragging.x) * k
  panY = dragging.py + (e.clientY - dragging.y) * k
})
window.addEventListener('pointerup', () => { dragging = null })

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(U.u_resolution, canvas.width, canvas.height)
  gl.uniform1f(U.u_time, now * 0.001)
  gl.uniform1f(U.u_seed, seed)
  gl.uniform2f(U.u_pan, panX, panY)
  gl.uniform1f(U.u_pulse, rt.beat.state.pulse)
  gl.uniform1f(U.u_style, STYLES.indexOf(params.style))
  gl.uniform1f(U.u_interval, params.interval)
  gl.uniform1f(U.u_weight, params.weight)
  gl.uniform1f(U.u_zoom, params.zoom)
  gl.uniform1f(U.u_drift, params.drift)
  gl.uniform1f(U.u_sea, params.sea)
  gl.uniform1f(U.u_relief, params.relief)
  gl.uniform1f(U.u_hue, params.hue)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
