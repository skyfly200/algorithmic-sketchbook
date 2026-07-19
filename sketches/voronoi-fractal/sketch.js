// Voronoi Fractal — cells within cells: an animated Voronoi diagram where
// every cell contains its own smaller Voronoi pattern, recursively. Each
// level inherits a random rotation and drift from its parent cell's id, so
// the whole hierarchy shears organically as the seed points swim. Neon cell
// walls thin out with depth, a slow breathing zoom dives toward the centre,
// and beats send a bright ripple down through the levels.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  depth: { value: 4, min: 1, max: 6, step: 1, label: 'Nesting depth' },
  scale: { value: 1.6, min: 0.6, max: 4, step: 0.05, label: 'Zoom' },
  branch: { value: 3.1, min: 2, max: 5, step: 0.05, label: 'Cells / cell' },
  swim: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'Point swim' },
  walls: { value: 0.7, min: 0, max: 1.5, step: 0.02, label: 'Wall glow' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Hue' },
  spread: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hue spread' },
  breathe: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Breathing zoom' },
})
rt.mapInput('audio.pulse', 'walls', 0.6)
rt.mapInput('audio.mid', 'swim', 0.4)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
uniform vec2 u_mouse;      // -1..1, pans the field
uniform float u_pulse;     // beat pulse 1 -> 0
uniform float u_depth;
uniform float u_scale;
uniform float u_branch;
uniform float u_swim;
uniform float u_walls;
uniform float u_hue;
uniform float u_spread;
uniform float u_breathe;
out vec4 outColor;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + u_seed;
  return fract(sin(p) * 43758.5453);
}

// Animated Voronoi: returns F1, F2, and the winning cell's id.
// Feature points swim inside their lattice cells.
void voronoi(vec2 p, float swim, out float f1, out float f2, out vec2 id) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  f1 = 8.0; f2 = 8.0; id = n;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(n + g);
    o = 0.5 + 0.42 * sin(u_time * swim + 6.2831 * o); // swimming points
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = n + g; }
    else if (d < f2) { f2 = d; }
  }
  f1 = sqrt(f1); f2 = sqrt(f2);
}

vec3 hsl2rgb(vec3 hsl) {
  vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  return hsl.z + c * (rgb - 0.5);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  // slow breathing dive toward the centre, plus mouse pan
  float zoom = u_scale * exp(u_breathe * 0.5 * sin(u_time * 0.12));
  vec2 p = uv * zoom + u_mouse * 1.5 + vec2(u_seed * 0.37, u_seed * 0.61);

  vec3 col = vec3(0.0);
  float energy = 0.0;     // accumulated wall light, for the core tint
  float amp = 1.0;        // per-level contribution
  vec2 carryId = vec2(0.0);
  int depth = int(u_depth + 0.5);

  for (int lvl = 0; lvl < 6; lvl++) {
    if (lvl >= depth) break;
    float fl = float(lvl);

    float f1, f2; vec2 id;
    // deeper levels swim less (small cells jitter, don't fly)
    voronoi(p, u_swim / (1.0 + fl * 0.8), f1, f2, id);

    // cell fill: tinted by cell id + level, shaded toward the wall
    vec2 h = hash2(id + carryId);
    float hue = fract(u_hue / 360.0 + (h.x - 0.5) * u_spread + fl * 0.045);
    float edge = f2 - f1; // 0 at walls
    vec3 fill = hsl2rgb(vec3(hue, 0.62, 0.16 + 0.3 * f1)) * amp;

    // neon wall: thinner and dimmer with depth, flashed by the beat ripple
    float w = 0.045 / (1.0 + fl * 0.7);
    float ripple = 1.0 + u_pulse * 2.5 * smoothstep(0.5, 0.0, abs(fl / max(u_depth - 1.0, 1.0) - (1.0 - u_pulse)));
    float wall = (1.0 - smoothstep(0.0, w, edge)) * u_walls * ripple;
    vec3 wallCol = hsl2rgb(vec3(fract(hue + 0.08), 0.9, 0.62));

    col += fill * 0.5 + wallCol * wall * amp;
    energy += wall * amp;

    // recurse: local coordinates of this cell, rotated by the cell's own
    // random angle, scaled up — the child pattern lives inside the parent
    vec2 center = id + 0.5;
    float ang = (h.y - 0.5) * 2.2 + u_time * 0.02 * (h.x - 0.5);
    float ca = cos(ang), sa = sin(ang);
    p = mat2(ca, -sa, sa, ca) * (p - center) * u_branch + h * 7.3;
    carryId = id;
    amp *= 0.62;
  }

  // faint centre glow where many walls stacked, then gentle vignette
  col += vec3(0.4, 0.5, 0.9) * energy * energy * 0.05;
  col *= 1.0 - 0.35 * dot(uv, uv);
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

const buffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const U = {}
for (const name of ['u_resolution', 'u_time', 'u_seed', 'u_mouse', 'u_pulse', 'u_depth', 'u_scale', 'u_branch', 'u_swim', 'u_walls', 'u_hue', 'u_spread', 'u_breathe']) {
  U[name] = gl.getUniformLocation(program, name)
}
const seed = rt.random(0, 100)

// mouse pans the field, eased so it feels like leaning over a map
let mx = 0
let my = 0
let tx = 0
let ty = 0
window.addEventListener('pointermove', (e) => {
  tx = (e.clientX / window.innerWidth) * 2 - 1
  ty = -((e.clientY / window.innerHeight) * 2 - 1)
})

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  mx += (tx - mx) * 0.04
  my += (ty - my) * 0.04
  // cap depth by graphics quality: 6 nested voronois is a lot of ALU
  const depth = Math.min(Math.round(params.depth), rt.detail < 0.6 ? 3 : 6)
  gl.uniform2f(U.u_resolution, canvas.width, canvas.height)
  gl.uniform1f(U.u_time, now * 0.001)
  gl.uniform1f(U.u_seed, seed)
  gl.uniform2f(U.u_mouse, mx, my)
  gl.uniform1f(U.u_pulse, rt.beat.state.pulse)
  gl.uniform1f(U.u_depth, depth)
  gl.uniform1f(U.u_scale, params.scale)
  gl.uniform1f(U.u_branch, params.branch)
  gl.uniform1f(U.u_swim, params.swim)
  gl.uniform1f(U.u_walls, params.walls)
  gl.uniform1f(U.u_hue, params.hue)
  gl.uniform1f(U.u_spread, params.spread)
  gl.uniform1f(U.u_breathe, params.breathe)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
