/**
 * Fractal Kaleidoscope — the classic "fract(uv*k)-0.5" domain-repeat bloom lit
 * with an Inigo Quilez cosine palette. Each layer folds space in on itself and
 * draws thin glowing rings; stacked, they make an infinitely detailed neon
 * flower that breathes with the music.
 *
 * Palette: https://iquilezles.org/articles/palettes/
 * Fractal: https://www.shadertoy.com/view/mtyGWy (adapted to WebGL2 + params)
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  layers: { value: 4, min: 1, max: 8, step: 1, label: 'Fold layers' },
  zoom: { value: 1.5, min: 1.1, max: 2.4, step: 0.05, label: 'Fold zoom' },
  speed: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Palette speed' },
  warp: { value: 8, min: 2, max: 24, step: 0.5, label: 'Ring frequency' },
  glow: { value: 1, min: 0.2, max: 3, step: 0.05, label: 'Glow' },
  contrast: { value: 1.2, min: 0.6, max: 2.5, step: 0.05, label: 'Contrast' },
  hue: { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
})
// Music: loudness drives the palette, beats flare the glow.
rt.mapInput('audio.volume', 'speed', 0.6)
rt.mapInput('audio.pulse', 'glow', 0.6)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_layers, u_zoom, u_speed, u_warp, u_glow, u_contrast, u_hue;
out vec4 outColor;

// iq cosine palette
vec3 palette(float t) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.263, 0.416, 0.557);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  vec2 uv0 = uv;
  vec3 finalColor = vec3(0.0);
  float T = u_time * u_speed + u_hue;
  int N = int(u_layers);
  for (int i = 0; i < 8; i++) {
    if (i >= N) break;
    uv = fract(uv * u_zoom) - 0.5;
    float d = length(uv) * exp(-length(uv0));
    vec3 col = palette(length(uv0) + float(i) * 0.4 + T);
    d = sin(d * u_warp + u_time) / u_warp;
    d = abs(d);
    d = pow((0.01 * u_glow) / d, u_contrast);
    finalColor += col * d;
  }
  outColor = vec4(finalColor, 1.0);
}`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program); gl.useProgram(program)

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const U = (n) => gl.getUniformLocation(program, n)
const uRes = U('u_res'), uTime = U('u_time'), uLayers = U('u_layers'), uZoom = U('u_zoom'),
  uSpeed = U('u_speed'), uWarp = U('u_warp'), uGlow = U('u_glow'), uContrast = U('u_contrast'), uHue = U('u_hue')

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(uRes, canvas.width, canvas.height)
  gl.uniform1f(uTime, now * 0.001)
  gl.uniform1f(uLayers, params.layers)
  gl.uniform1f(uZoom, params.zoom)
  gl.uniform1f(uSpeed, params.speed)
  gl.uniform1f(uWarp, params.warp)
  gl.uniform1f(uGlow, params.glow)
  gl.uniform1f(uContrast, params.contrast)
  gl.uniform1f(uHue, params.hue * 6.28318)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
