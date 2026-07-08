const canvas = document.getElementById('canvas')
const gl = canvas.getContext('webgl2')

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
out vec4 outColor;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.6;

  float v = 0.0;
  v += sin(uv.x * 4.0 + t);
  v += sin((uv.y + t) * 3.0);
  v += sin((uv.x + uv.y) * 3.0 + t * 0.5);
  vec2 c = uv + vec2(sin(t * 0.3), cos(t * 0.4)) * 0.7;
  v += sin(length(c) * 6.0 - t * 2.0);
  v *= 0.25;

  vec3 col = 0.5 + 0.5 * cos(6.2831 * (v + vec3(0.0, 0.33, 0.67)) + t * 0.2);
  col *= 0.65 + 0.35 * smoothstep(1.6, 0.2, length(uv));
  outColor = vec4(col, 1.0);
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

// Fullscreen triangle (covers the viewport with 3 vertices).
const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const uResolution = gl.getUniformLocation(program, 'u_resolution')
const uTime = gl.getUniformLocation(program, 'u_time')

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio
  canvas.height = window.innerHeight * devicePixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  gl.uniform2f(uResolution, canvas.width, canvas.height)
  gl.uniform1f(uTime, now * 0.001)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
