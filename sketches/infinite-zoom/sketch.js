/**
 * Infinite Zoom — an endless dive through nested, *changing* geometric
 * structures (not just light). Working in log-polar space, each integer band of
 * log-radius is one nested "ring" of architecture — a regular polygon frame
 * with radial spokes and a shape stamped in every cell. The number of sides,
 * the rotation, and the per-cell stamps are hashed from the band index, so as
 * you fall inward you pass through a different structure at every level. Because
 * the band motif is periodic and shares its frame ring at each integer boundary,
 * the zoom is a true seamless loop. Runs as a fragment shader.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  speed: { value: +rt.random(0.15, 0.4).toFixed(2), min: -1.5, max: 1.5, step: 0.01, label: 'Zoom speed (±)' },
  density: { value: +rt.random(0.7, 1.3).toFixed(2), min: 0.3, max: 2.5, step: 0.05, label: 'Levels per zoom' },
  twist: { value: +rt.random(-0.6, 0.6).toFixed(2), min: -2, max: 2, step: 0.02, label: 'Spiral twist' },
  variation: { value: +rt.random(0.5, 1).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Structure variation' },
  stamps: { value: rt.rng() > 0.4, type: 'bool', label: 'Cell stamps' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  cycle: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Palette cycle' },
})
// Music: loudness drives the zoom, beats twist the structures.
rt.mapInput('beat.volume', 'speed', 0.5)
rt.mapInput('beat.pulse', 'twist', 0.5)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_density, u_twist, u_variation, u_stamps, u_hue, u_cycle;
out vec4 outColor;
#define PI 3.14159265
#define TAU 6.28318531

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 palette(float t) {
  return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)) + u_hue * TAU);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y);
  float r = length(uv) + 1e-4;
  float ang = atan(uv.y, uv.x);

  // Continuous log-radius zoom coordinate. Falling inward = z increases.
  float z = -log(r) * u_density + u_time;
  vec3 col = vec3(0.0);

  // Sum a few nested bands so structures overlap smoothly as they pass.
  for (int i = -1; i <= 1; i++) {
    float lvl = floor(z) + float(i);
    float f = z - lvl;                       // 0..1 within this band (0 = outer ring)
    float win = sin(clamp(f, 0.0, 1.0) * PI); // fade at band seams -> seamless loop

    float h = hash(lvl);
    float sides = 3.0 + floor(mix(0.0, 8.0, h * u_variation) + 3.0 * (1.0 - u_variation));
    float rot = h * TAU + lvl * u_twist;
    float sa = ang + rot;
    float sp = (sa / TAU + 0.5) * sides;      // sector coordinate around the ring
    float cell = abs(fract(sp) - 0.5);        // 0 at sector centre, 0.5 at a vertex

    // Structure: a mid-band polygon ring + radial spokes at the vertices.
    float ring = smoothstep(0.07, 0.0, abs(f - 0.5));
    float spoke = smoothstep(0.06, 0.0, cell - 0.44);
    float s = ring * 0.7 + spoke * 0.6;

    // A shape stamped into every cell, its size hashed per (band, sector).
    if (u_stamps > 0.5) {
      float ch = hash(lvl * 41.0 + floor(sp) * 7.0);
      vec2 cp = vec2(f - 0.5, (fract(sp) - 0.5) / max(sides, 1.0) * sides * 0.5);
      float rad = 0.10 + 0.10 * ch;
      s += smoothstep(rad, rad - 0.04, length(cp)) * 0.7;
    }

    col += palette(lvl * 0.13 + f * 0.12 + u_time * u_cycle * 0.05) * s * win;
  }

  col *= 1.0 - 0.35 * dot(uv, uv); // vignette
  outColor = vec4(col, 1.0);
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
for (const name of ['u_res', 'u_time', 'u_density', 'u_twist', 'u_variation', 'u_stamps', 'u_hue', 'u_cycle'])
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
  gl.uniform1f(u.u_stamps, params.stamps ? 1 : 0)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_cycle, params.cycle)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
