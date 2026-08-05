// Gaudí Column Field — a fragment-shader Gaudí column. Two fluted star profiles
// are swept up a shaft and twisted opposite ways; their radial minimum carves the
// grooves, which spiral because the twist grows with height. It renders as a lit
// stone column, not a flat field. Two "misgeneration" modes then treat the column
// SURFACE: Moiré interference beats a high-frequency grid against itself into
// shimmering fringes, and Edge warping pinches and tears the flutes near the
// silhouette with hard overfitted rings, like a net hallucinating detail.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const MODES = ['Normal', 'Moiré interference', 'Edge warping']
const params = rt.params({
  mode: { value: 'Normal', type: 'select', options: MODES, label: 'Mode' },
  width: { value: 0.9, min: 0.3, max: 1.6, step: 0.05, label: 'Column width' },
  flutesA: { value: 8, min: 3, max: 20, step: 1, label: 'Points (A)' },
  twistA: { value: 90, min: -360, max: 360, step: 5, label: 'Twist deg (A)' },
  flutesB: { value: 8, min: 3, max: 20, step: 1, label: 'Points (B)' },
  twistB: { value: -90, min: -360, max: 360, step: 5, label: 'Twist deg (B)' },
  depth: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Groove depth' },
  speed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Speed' },
})
rt.mapInput('audio.pulse', 'depth', 0.15)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_mode;      // 0 Normal · 1 Moiré · 2 Edge warping
uniform float u_width;   // column half-width (world x, aspect-corrected)
uniform float u_flutesA, u_twistA, u_flutesB, u_twistB, u_depth;
out vec4 outColor;

const float PI = 3.14159265;

// procedural fold detail, reused as a faint surface grain
float foldPattern(vec2 uv) {
  vec2 p = uv * 6.0 - 3.0;
  float n = 0.0;
  float t = u_time * 0.2;
  for (int i = 0; i < 3; i++) {
    p.x += sin(p.y + t + float(i)) * 0.5;
    p.y += cos(p.x - t + float(i)) * 0.5;
    n += sin(p.x + p.y);
  }
  return n;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float cx = (uv.x - 0.5) * aspect;   // world x, 0 at centre
  float v = uv.y;                     // height 0..1

  float R = u_width * 0.5;
  float xn = cx / R;                  // -1..1 across the column
  vec3 bg = mix(vec3(0.05, 0.06, 0.08), vec3(0.11, 0.12, 0.15), uv.y);
  if (abs(xn) >= 1.0) { outColor = vec4(bg, 1.0); return; }

  // surface angle facing the viewer, and the two counter-twisting flute profiles
  float theta = asin(clamp(xn, -1.0, 1.0));
  float twA = radians(u_twistA) * v;
  float twB = radians(u_twistB) * v;
  float fa = cos((theta - twA) * u_flutesA);
  float fb = cos((theta + twB) * u_flutesB);
  float flute = min(fa, fb);          // -1 groove .. +1 ridge
  float cyl = cos(theta);             // cylinder body: 1 centre .. 0 silhouette

  // lit stone: cylinder falloff modulated by the flute grooves
  float lit = cyl * (0.42 + 0.58 * (0.5 + 0.5 * flute * (0.4 + u_depth)));
  vec3 stone = vec3(0.82, 0.79, 0.72);
  vec3 col = stone * (0.22 + 0.78 * lit);
  // sheen on ridges catching the upper-left key light
  float ridge = smoothstep(0.55, 1.0, flute) * smoothstep(1.0, 0.2, xn + 1.0);
  col += vec3(0.30, 0.29, 0.26) * ridge * cyl;

  // surface coordinates that wrap with the column (front hemisphere → 0..1)
  vec2 suv = vec2(theta / PI + 0.5, v);
  float edgeMask = 1.0 - smoothstep(0.55, 0.98, abs(xn)); // 1 centre → 0 silhouette

  if (u_mode == 1) {
    // Moiré fringes over the stone, densest across the lit face
    vec2 g = suv * u_resolution * 0.35;
    float p1 = sin(g.x) * sin(g.y);
    float p2 = sin((suv.x + suv.y) * u_resolution.x * 0.34);
    float interference = abs(p1 - p2);
    col = mix(col, vec3(1.0, 0.2, 0.4), interference * 0.55 * cyl);
  } else if (u_mode == 2) {
    // high-frequency tearing + hard overfitted rings, worst near the silhouette
    float hf = sin(theta * 60.0 + u_time * 5.0) * cos(v * 120.0 - u_time * 4.0);
    float rings = step(0.85, fract(theta * 9.0 + v * 40.0));
    col = mix(col, vec3(0.2, 0.9, 0.8), rings * 0.6 * cyl);
    col *= mix(1.0, 0.55 + 0.45 * hf, (1.0 - edgeMask));
  } else {
    // faint organic grain so the stone isn't flat
    float f = foldPattern(suv);
    col *= 0.9 + 0.1 * clamp(f, -1.0, 1.0);
  }

  // seat the column edges into shadow against the background
  col *= smoothstep(1.0, 0.9, abs(xn));
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

const U = (n) => gl.getUniformLocation(program, n)
const uResolution = U('u_resolution'), uTime = U('u_time'), uMode = U('u_mode')
const uWidth = U('u_width'), uFlutesA = U('u_flutesA'), uTwistA = U('u_twistA')
const uFlutesB = U('u_flutesB'), uTwistB = U('u_twistB'), uDepth = U('u_depth')

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

let shaderTime = 0
let lastNow = 0
function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  shaderTime += params.speed * dt
  gl.uniform2f(uResolution, canvas.width, canvas.height)
  gl.uniform1f(uTime, shaderTime)
  gl.uniform1i(uMode, Math.max(0, MODES.indexOf(params.mode)))
  gl.uniform1f(uWidth, params.width)
  gl.uniform1f(uFlutesA, params.flutesA)
  gl.uniform1f(uTwistA, params.twistA)
  gl.uniform1f(uFlutesB, params.flutesB)
  gl.uniform1f(uTwistB, params.twistB)
  gl.uniform1f(uDepth, params.depth)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
