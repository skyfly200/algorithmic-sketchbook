/**
 * Infinite Zoom — an endless dive through nested, *generated architecture*.
 * Working in log-polar space, each integer band of log-radius is one ring of
 * structure: solid ring beams at its boundaries, radial columns between cells,
 * optional diagonal cross-braces, and per-cell panels with lit "windows". The
 * side count, rotation, brace pattern, and which windows are lit are all hashed
 * from the band index, so every level you fall through is a different structure
 * — and because bands share their boundary beams, the zoom is a true seamless
 * loop. Runs as a fragment shader.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const STRUCTURES = ['girders', 'arches', 'gothic', 'orbitals', 'lattice', 'organic']
const params = rt.params({
  structure: { value: rt.pick(STRUCTURES), type: 'select', options: STRUCTURES, label: 'Structure' },
  speed: { value: +rt.random(0.15, 0.4).toFixed(2), min: -1.5, max: 1.5, step: 0.01, label: 'Zoom speed (±)' },
  density: { value: +rt.random(0.8, 1.4).toFixed(2), min: 0.3, max: 2.5, step: 0.05, label: 'Levels per zoom' },
  twist: { value: +rt.random(-0.5, 0.5).toFixed(2), min: -2, max: 2, step: 0.02, label: 'Spiral twist' },
  variation: { value: +rt.random(0.6, 1).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Structure variation' },
  braces: { value: rt.rng() > 0.3, type: 'bool', label: 'Cross-braces' },
  windows: { value: true, type: 'bool', label: 'Lit windows' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  cycle: { value: 0.25, min: 0, max: 2, step: 0.05, label: 'Palette cycle' },
})
// Music: loudness drives the zoom, beats twist the structures.
rt.mapInput('audio.volume', 'speed', 0.5)
rt.mapInput('audio.pulse', 'twist', 0.4)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_density, u_twist, u_variation, u_braces, u_windows, u_hue, u_cycle, u_style;
out vec4 outColor;
#define PI 3.14159265
#define TAU 6.28318531

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 palette(float t) {
  return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)) + u_hue * TAU);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y);
  float r = length(uv) + 1e-5;
  float ang = atan(uv.y, uv.x);

  // Continuous log-radius zoom coordinate; each integer band is one structure.
  float z = -log(r) * u_density + u_time;
  float lvl = floor(z);
  float f = z - lvl; // 0 at the band's outer beam, 1 at its inner beam

  float h = hash(lvl);
  float sides = 4.0 + floor(h * 8.0 * u_variation);
  float rot = hash(lvl * 3.7) * TAU + lvl * u_twist;
  float sp = ((ang + rot) / TAU + 0.5) * sides;
  float cellI = floor(sp);
  float s = fract(sp); // 0..1 across this cell

  // --- structural elements (crisp, solid), per architectural style ---
  // Ring beams on both band boundaries: shared with the neighbouring band, so
  // the zoom loop has no visible seam.
  float ring = 1.0 - smoothstep(0.045, 0.075, min(f, 1.0 - f));
  // Columns between cells.
  float col = 1.0 - smoothstep(0.035, 0.065, min(s, 1.0 - s));
  float braceOn = u_braces * step(0.35, hash(lvl * 7.3));

  float structure = 0.0;
  float opening = 0.0; // where a window can glow (shape depends on style)
  int style = int(u_style + 0.5);

  if (style == 0) {
    // Girders: rings + columns + hashed diagonal X braces; rectangular windows.
    float d1 = abs(s - f);
    float d2 = abs(s - (1.0 - f));
    float brace = braceOn * (1.0 - smoothstep(0.018, 0.05, min(d1, d2)));
    structure = max(ring, max(col, brace));
    opening = smoothstep(0.26, 0.22, abs(s - 0.5)) * smoothstep(0.30, 0.26, abs(f - 0.5));
  } else if (style == 1) {
    // Arches: an arcade — round-topped openings on stout piers.
    structure = max(ring, col);
    float dArch = f > 0.5 ? length(vec2((s - 0.5) * 1.15, (f - 0.5) * 1.3)) : abs(s - 0.5) * 1.15;
    opening = smoothstep(0.335, 0.30, dArch) * smoothstep(0.06, 0.12, f);
  } else if (style == 2) {
    // Gothic: narrow pointed arches with a central mullion.
    structure = max(ring, col);
    float dPoint = abs(s - 0.5) * 1.55 + max(f - 0.42, 0.0) * 0.85;
    opening = smoothstep(0.33, 0.30, dPoint) * smoothstep(0.05, 0.11, f);
    float mullion = 1.0 - smoothstep(0.012, 0.03, abs(s - 0.5));
    structure = max(structure, mullion * opening);
  } else if (style == 3) {
    // Orbitals: concentric pipe rings with hashed dash gaps — a ringworld.
    float tube = 1.0 - smoothstep(0.05, 0.09, abs(f - 0.5));
    float seg = step(0.35, hash(floor(sp * 2.0) + lvl * 31.0));
    float spokes = braceOn * (1.0 - smoothstep(0.012, 0.03, min(s, 1.0 - s)));
    structure = max(ring * 0.9, max(tube * seg, spokes));
    opening = tube * (1.0 - seg); // lights ride the gaps in the pipe
  } else if (style == 4) {
    // Lattice: a dense diamond truss (double-frequency braces both ways).
    float s2 = fract(sp * 2.0);
    float d1 = abs(s2 - f);
    float d2 = abs(s2 - (1.0 - f));
    float net = 1.0 - smoothstep(0.02, 0.05, min(d1, d2));
    structure = max(ring, net);
    opening = smoothstep(0.30, 0.18, length(vec2(s2 - 0.5, f - 0.5))); // diamond panes
  } else {
    // Organic: walls meander like cave growth; rounded cell mouths.
    float sw = s + 0.09 * sin(f * TAU + hash(lvl * 5.1) * TAU) * u_variation;
    float colW = 1.0 - smoothstep(0.05, 0.1, min(sw, 1.0 - sw));
    float ringW = 1.0 - smoothstep(0.06, 0.11, min(f, 1.0 - f) + 0.03 * sin(s * TAU * 2.0 + lvl));
    structure = max(ringW, colW);
    opening = smoothstep(0.36, 0.24, length(vec2((s - 0.5) * 1.5, (f - 0.5) * 1.3)));
  }

  // --- panels & windows behind the structure ---
  float ch = hash(lvl * 57.0 + cellI * 13.0);
  vec3 base = palette(lvl * 0.09 + u_time * u_cycle * 0.05);
  vec3 panel = base * (0.06 + 0.05 * ch); // dark facade, slight per-cell tint
  // A lit opening in ~half the cells.
  float lit = u_windows * step(0.45, ch);
  vec3 windowGlow = palette(lvl * 0.09 + 0.38 + ch * 0.1) * (0.55 + 0.45 * hash(cellI * 91.0 + lvl));
  vec3 cellCol = mix(panel, windowGlow, lit * opening);

  // Structure sits in front: bright structural alloy from the same palette.
  vec3 structCol = base * 0.55 + vec3(0.5);
  vec3 colr = mix(cellCol, structCol, structure);

  // Depth cues: fog toward the centre (far away), vignette at the rim.
  colr *= smoothstep(0.0, 0.22, r);
  colr *= 1.0 - 0.3 * dot(uv, uv);

  outColor = vec4(colr, 1.0);
}`

function compile(type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
  return sh
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

const u = {}
for (const name of ['u_res', 'u_time', 'u_density', 'u_twist', 'u_variation', 'u_braces', 'u_windows', 'u_hue', 'u_cycle', 'u_style'])
  u[name] = gl.getUniformLocation(program, name)

// Accumulate the (speed-scaled) zoom phase so speed can change smoothly.
let phase = 0
let lastNow = 0

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  phase += params.speed * dt

  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, phase)
  gl.uniform1f(u.u_density, params.density)
  gl.uniform1f(u.u_twist, params.twist)
  gl.uniform1f(u.u_variation, params.variation)
  gl.uniform1f(u.u_braces, params.braces ? 1 : 0)
  gl.uniform1f(u.u_windows, params.windows ? 1 : 0)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_cycle, params.cycle)
  gl.uniform1f(u.u_style, Math.max(0, STRUCTURES.indexOf(params.structure)))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
