/**
 * Creation — the famous 4-tweet "Creation by Silexars" shader: three offset
 * time-slices of a radial ripple field, one per colour channel, tiled through a
 * mod() lattice so the whole plane pulses with concentric travelling waves.
 * Tiny and hypnotic.
 *
 * Original by Danilo Guanabara — http://www.pouet.net/prod.php?which=57245
 * (adapted to WebGL2 + live params; credit retained per the author's request).
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  speed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Speed' },
  offset: { value: 0.07, min: 0.02, max: 0.2, step: 0.005, label: 'Channel offset' },
  warp: { value: 9, min: 2, max: 20, step: 0.5, label: 'Ripple frequency' },
  tiles: { value: 1, min: 0.5, max: 3, step: 0.05, label: 'Tiling' },
  intensity: { value: 0.01, min: 0.003, max: 0.03, step: 0.001, label: 'Brightness' },
})
// Music: loudness speeds the ripples, beats brighten them.
rt.mapInput('audio.volume', 'speed', 0.5)
rt.mapInput('audio.pulse', 'intensity', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_speed, u_offset, u_warp, u_tiles, u_intensity;
out vec4 outColor;

void main() {
  vec2 r = u_res;
  float t = u_time * u_speed;
  vec3 c;
  float l, z = t;
  for (int i = 0; i < 3; i++) {
    vec2 uv, p = gl_FragCoord.xy / r;
    uv = p;
    p -= 0.5;
    p.x *= r.x / r.y;
    z += u_offset;
    l = length(p);
    uv += p / l * (sin(z) + 1.0) * abs(sin(l * u_warp - z - z));
    c[i] = u_intensity / length(mod(uv * u_tiles, 1.0) - 0.5);
  }
  outColor = vec4(c / l, 1.0);
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
const uRes = U('u_res'), uTime = U('u_time'), uSpeed = U('u_speed'), uOffset = U('u_offset'),
  uWarp = U('u_warp'), uTiles = U('u_tiles'), uIntensity = U('u_intensity')

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(uRes, canvas.width, canvas.height)
  gl.uniform1f(uTime, now * 0.001)
  gl.uniform1f(uSpeed, params.speed)
  gl.uniform1f(uOffset, params.offset)
  gl.uniform1f(uWarp, params.warp)
  gl.uniform1f(uTiles, params.tiles)
  gl.uniform1f(uIntensity, params.intensity)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
