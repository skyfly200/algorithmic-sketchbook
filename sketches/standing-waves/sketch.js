/**
 * Standing Waves — a vibrating shape whose rim is a standing wave. The boundary
 * radius is R(θ,t) = R0 + Σ Aₖ·sin(ωₖt)·cos(mₖθ): each angular mode mₖ lays down
 * that many lobes around the rim, and the sin(ωt) term makes them breathe in and
 * out like a plucked membrane frozen into its normal modes. Superpose two modes
 * for richer, flower-like shapes. In Membrane mode the inside is filled with the
 * drumhead's nodal field — concentric and angular nodal lines in two tones —
 * instead of a flat fill. Waves, amplitudes, radial nodes, speed, spin, outline,
 * colour and glow are all live, and the mic can drive the amplitude so it pulses
 * to sound. (Generalises the classic `0.5 + 0.35·sin(2t)·sin(13θ)` rim blob.)
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  mode: { value: 'Membrane', type: 'select', options: ['Blob', 'Membrane', 'Outline'], label: 'Mode' },
  baseRadius: { value: 0.5, min: 0.15, max: 0.85, step: 0.01, label: 'Base radius' },
  waves: { value: 6, min: 0, max: 24, step: 1, label: 'Waves (mode 1)' },
  amplitude: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Amplitude 1' },
  waves2: { value: 13, min: 0, max: 30, step: 1, label: 'Waves (mode 2)' },
  amplitude2: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Amplitude 2' },
  waves3: { value: 20, min: 0, max: 40, step: 1, label: 'Waves (mode 3)' },
  amplitude3: { value: 0, min: 0, max: 0.4, step: 0.01, label: 'Amplitude 3 (0 = off)' },
  radialNodes: { value: 3, min: 0, max: 9, step: 1, label: 'Radial nodes (membrane)' },
  speed: { value: 1, min: 0.05, max: 4, step: 0.05, label: 'Vibration speed' },
  spin: { value: 0.15, min: -2, max: 2, step: 0.05, label: 'Spin' },
  outline: { value: 0, min: 0, max: 0.2, step: 0.005, label: 'Outline (0 = filled)' },
  hue: { value: 190, min: 0, max: 360, step: 1, label: 'Hue' },
  glow: { value: 0.8, min: 0, max: 2, step: 0.05, label: 'Rim glow' },
})
rt.mapInput('audio.pulse', 'amplitude', 0.4)
rt.mapInput('audio.level', 'amplitude2', 0.3)

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_r0, u_m1, u_a1, u_m2, u_a2, u_m3, u_a3, u_nodes, u_speed, u_spin, u_outline, u_hue, u_glow, u_mode;
out vec4 outColor;
const float PI = 3.14159265;

vec3 hsv(float h, float s, float v) {
  vec3 c = abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
  return v * mix(vec3(1.0), clamp(c, 0.0, 1.0), s);
}

void main() {
  // aspect-correct, y-normalised coordinates centred on the frame
  vec2 p = (2.0 * gl_FragCoord.xy - u_res) / u_res.y;
  float sp = u_spin * u_time;
  p = mat2(cos(sp), -sin(sp), sin(sp), cos(sp)) * p;
  float r = length(p);
  float a = atan(p.y, p.x);

  // up to three standing-wave rim modes breathing at slightly different rates
  float o1 = sin(u_speed * u_time);
  float o2 = sin(u_speed * 1.37 * u_time + 1.7);
  float o3 = sin(u_speed * 0.83 * u_time + 3.1);
  float Rb = u_r0 + u_a1 * o1 * cos(u_m1 * a) + u_a2 * o2 * cos(u_m2 * a) + u_a3 * o3 * cos(u_m3 * a);
  Rb = max(0.03, Rb);

  float e = fwidth(r) * 1.5 + 0.0025; // anti-aliased edge
  float inside = smoothstep(Rb + e, Rb - e, r);

  vec3 col = vec3(0.0);
  if (u_mode < 0.5) {
    // Blob — a flat, glowing filled shape (the generalised rim blob)
    vec3 fill = hsv(u_hue, 0.5, 1.0);
    if (u_outline > 0.001) {
      float band = smoothstep(u_outline + e, u_outline - e, abs(r - Rb));
      col = fill * band;
    } else {
      col = fill * inside * (0.75 + 0.35 * smoothstep(Rb, 0.0, r)); // brighter toward centre
    }
  } else if (u_mode < 1.5) {
    // Membrane — the drumhead's nodal field: angular + radial standing waves,
    // two tones for the +/- antinodes, dark nodal lines between them.
    float rr = r / Rb; // 0..1 within the shape
    float u = cos(u_m1 * a) * cos(u_nodes * PI * rr) * o1
            + 0.7 * cos(u_m2 * a) * cos((u_nodes + 1.0) * PI * rr) * o2;
    float s = clamp(u * 0.95, -1.0, 1.0);
    vec3 pos = hsv(u_hue, 0.75, 1.0);
    vec3 neg = hsv(mod(u_hue + 170.0, 360.0), 0.75, 1.0);
    vec3 fld = mix(neg, pos, 0.5 + 0.5 * s) * (0.15 + 0.85 * abs(s));
    if (u_outline > 0.001) inside *= smoothstep(u_outline + e, u_outline - e, abs(r - Rb));
    col = fld * inside;
  } else {
    // Outline — just the rim curve, a clean glowing stroke on an empty field.
    float w = max(u_outline, 0.008);
    float line = smoothstep(w + e, w - e, abs(r - Rb));
    col = hsv(u_hue, 0.6, 1.0) * line;
  }

  // glowing rim on the boundary
  float rim = exp(-abs(r - Rb) / 0.02) * u_glow;
  col += hsv(u_hue, 0.3, 1.0) * rim * 0.7;

  col *= 1.0 - 0.18 * dot(p, p); // gentle vignette
  outColor = vec4(max(col, 0.0), 1.0);
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
for (const name of ['u_res', 'u_time', 'u_r0', 'u_m1', 'u_a1', 'u_m2', 'u_a2', 'u_m3', 'u_a3', 'u_nodes', 'u_speed', 'u_spin', 'u_outline', 'u_hue', 'u_glow', 'u_mode'])
  u[name] = gl.getUniformLocation(program, name)

function resize() {
  canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_r0, params.baseRadius)
  gl.uniform1f(u.u_m1, params.waves)
  gl.uniform1f(u.u_a1, params.amplitude)
  gl.uniform1f(u.u_m2, params.waves2)
  gl.uniform1f(u.u_a2, params.amplitude2)
  gl.uniform1f(u.u_m3, params.waves3)
  gl.uniform1f(u.u_a3, params.amplitude3)
  gl.uniform1f(u.u_nodes, params.radialNodes)
  gl.uniform1f(u.u_speed, params.speed)
  gl.uniform1f(u.u_spin, params.spin)
  gl.uniform1f(u.u_outline, params.outline)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_glow, params.glow)
  gl.uniform1f(u.u_mode, params.mode === 'Outline' ? 2 : params.mode === 'Membrane' ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
