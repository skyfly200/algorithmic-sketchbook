// Gaudí Fold Field — the full-screen sibling of the Gaudí Column shader: the
// same procedural organic fold pattern from the column, but rendered edge to
// edge across the whole plane instead of wrapped onto a column. Two extra
// "misgeneration" modes push it further: Moiré interference beats a
// high-frequency grid against itself into shimmering fringes, and Edge warping
// pinches and tears the field near its borders with hard overfitted rings, like
// a neural net hallucinating detail. (For the lit twisted column, see Gaudí
// Column.)
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const MODES = ['Normal', 'Moiré interference', 'Edge warping']
const params = rt.params({
  mode: { value: 'Normal', type: 'select', options: MODES, label: 'Mode' },
  speed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Speed' },
  scale: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Fold scale' },
})
rt.mapInput('audio.pulse', 'speed', 0.4)

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`

// Ported from the supplied #version 330 core shader to WebGL2 GLSL ES.
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform int u_mode; // 0: Normal, 1: Moiré interference, 2: Edge warping
out vec4 outColor;

// Procedural organic fold pattern (echoes the swept-flute column geometry)
float foldPattern(vec2 uv) {
  vec2 p = uv * (6.0 * u_scale) - 3.0;
  float n = 0.0;
  float t = u_time * 0.2;
  for (int i = 0; i < 3; i++) {
    p.x += sin(p.y + t + float(i)) * 0.5;
    p.y += cos(p.x - t + float(i)) * 0.5;
    n += sin(p.x + p.y);
  }
  return n;
}

// Mode 1: high-frequency interference simulating Moiré fringes
vec3 computeMoire(vec2 uv) {
  vec2 gridFreq = u_resolution * 0.75;
  float pattern1 = sin(uv.x * gridFreq.x) * sin(uv.y * gridFreq.y);
  float pattern2 = sin((uv.x + uv.y) * gridFreq.x * 0.95);
  float interference = abs(pattern1 - pattern2);
  vec3 baseColor = mix(vec3(0.15, 0.17, 0.22), vec3(0.72, 0.70, 0.65), foldPattern(uv));
  return mix(baseColor, vec3(1.0, 0.2, 0.4), interference * 0.6);
}

// Mode 2: high-frequency edge distortion simulating overfitting artifacts
vec2 computeOverfitWarp(vec2 uv) {
  vec2 distortedUV = uv;
  if (u_mode == 2) {
    float highFreqNoise = sin(uv.x * 120.0 + u_time * 5.0) * cos(uv.y * 120.0 - u_time * 4.0);
    float edgeMask = smoothstep(0.0, 0.3, uv.x) * smoothstep(1.0, 0.7, uv.x);
    distortedUV += vec2(highFreqNoise) * (1.0 - edgeMask) * 0.08;
  }
  return distortedUV;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 processedUV = computeOverfitWarp(uv);
  vec3 color = vec3(0.0);

  if (u_mode == 1) {
    color = computeMoire(processedUV);
  } else if (u_mode == 2) {
    float f = foldPattern(processedUV);
    vec3 base = mix(vec3(0.1), vec3(0.65, 0.63, 0.58), f);
    float overfitArtifact = step(0.85, fract(processedUV.x * 40.0 + processedUV.y * 40.0));
    color = mix(base, vec3(0.2, 0.9, 0.8), overfitArtifact * 0.7);
  } else {
    float f = foldPattern(uv);
    color = mix(vec3(0.12, 0.14, 0.18), vec3(0.75, 0.73, 0.68), f);
  }

  outColor = vec4(color, 1.0);
}`

function compile(type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }
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

const uResolution = gl.getUniformLocation(program, 'u_resolution')
const uTime = gl.getUniformLocation(program, 'u_time')
const uScale = gl.getUniformLocation(program, 'u_scale')
const uMode = gl.getUniformLocation(program, 'u_mode')

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

// Accumulate time so changing Speed stays continuous (no jumps).
let shaderTime = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  shaderTime += params.speed * dt
  gl.uniform2f(uResolution, canvas.width, canvas.height)
  gl.uniform1f(uTime, shaderTime)
  gl.uniform1f(uScale, params.scale)
  gl.uniform1i(uMode, Math.max(0, MODES.indexOf(params.mode)))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
