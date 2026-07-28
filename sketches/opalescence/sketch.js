/**
 * Opalescence — the play-of-colour of a precious opal, from structural colour
 * rather than pigment. Opal is a lattice of sub-micron silica spheres; each
 * ordered patch diffracts light like a tiny grating, throwing a pure spectral
 * flash whose colour depends on the sphere spacing and the viewing angle. Here
 * an animated Voronoi field stands in for those colour domains, each given its
 * own thin-film thickness and orientation; a thin-film interference term turns
 * that into a spectral colour that shifts and flares as the stone "tilts", all
 * floating in a milky pearl body with a scatter of pinfire sparkle. A fragment
 * shader on a fullscreen triangle. Tilt on the beat; everything else is live.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  scale: { value: 4, min: 1.5, max: 12, step: 0.1, label: 'Grain (finer →)' },
  depth: { value: 1, min: 0.4, max: 2.2, step: 0.05, label: 'Film depth' },
  play: { value: 0.6, min: 0, max: 2.2, step: 0.05, label: 'Play of colour' },
  saturation: { value: 1, min: 0, max: 1.8, step: 0.05, label: 'Colour intensity' },
  milkiness: { value: 0.6, min: 0, max: 1.3, step: 0.05, label: 'Milkiness' },
  sparkle: { value: 0.5, min: 0, max: 1.2, step: 0.05, label: 'Pinfire sparkle' },
  tilt: { value: 0, min: -1.5, max: 1.5, step: 0.02, label: 'View angle' },
  flow: { value: 0.4, min: 0, max: 1.5, step: 0.05, label: 'Flow' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue shift' },
})
// Music remixes the shimmer by default (edit in the controls panel).
rt.mapInput('audio.level', 'play', 0.7) // louder = faster play of colour
rt.mapInput('audio.pulse', 'tilt', 0.4) // beats tilt the stone → domains flash

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_scale, u_depth, u_play, u_sat, u_milk, u_sparkle, u_tilt, u_flow, u_hue, u_pulse;
out vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = sin(dot(p, vec2(41.0, 289.0))); return fract(vec2(262144.0, 32768.0) * n); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; } return s; }

// animated Voronoi → x: nearest sq-dist, y: per-domain random, z: edge distance
vec3 voro(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0; vec2 idc = n;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(n + g);
    o = 0.5 + 0.5 * sin(u_time * 0.22 * (0.3 + u_play) + 6.2831853 * o); // domains drift
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; idc = n + g; }
    else if (d < f2) { f2 = d; }
  }
  return vec3(f1, h21(idc), sqrt(f2) - sqrt(f1));
}

// thin-film interference reflectance sampled at three wavelengths (nm)
vec3 spectral(float opd) {
  vec3 wl = vec3(650.0, 545.0, 460.0);
  return 0.5 + 0.5 * cos(6.2831853 * opd / wl);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time;

  // organic patches: domain-warp the lattice so cells flow like opal veils
  vec2 w = uv * u_scale;
  vec2 wq = vec2(fbm(w * 0.6 + t * 0.05 * u_flow), fbm(w * 0.6 + 7.3 - t * 0.06 * u_flow));
  w += (wq - 0.5) * 1.6 * u_flow;

  vec3 v = voro(w);
  float cr = v.y, edge = v.z;

  // each domain gets an orientation; project position along it for striations
  float ori = cr * 6.2831853;
  vec2 dir = vec2(cos(ori), sin(ori));
  float s = dot(uv, dir);

  // thin-film optical path difference (sphere-spacing × angle), in nm-ish units
  float T = mix(260.0, 1500.0, cr) * u_depth;
  float ang = u_tilt * 1.3 + s * 0.9 + 0.35 * sin(t * 0.3 + cr * 6.2831853) + u_pulse * 0.6;
  float opd = 2.0 * T * cos(ang) + s * 380.0 + t * u_play * 130.0 + u_hue * 600.0;

  vec3 iri = spectral(opd);
  iri = mix(vec3(dot(iri, vec3(0.3333))), iri, 1.25); // deepen saturation

  // which domains are "firing" right now — only some flash at any tilt
  float fire = 0.5 + 0.5 * sin(t * u_play * 1.4 + cr * 23.0 + s * 2.5 + u_tilt * 3.0);
  fire = pow(clamp(fire, 0.0, 1.0), 2.2) * (0.7 + 0.5 * u_pulse);

  // milky pearl body with faint internal cloudiness
  vec3 milk = vec3(0.66, 0.71, 0.83);
  milk *= 0.85 + 0.22 * fbm(w * 0.8 + 3.0);

  vec3 col = milk * u_milk + iri * u_sat * fire;

  // crisp domain seams
  col *= mix(0.7, 1.0, smoothstep(0.0, 0.05, edge));

  // pinfire sparkle — tiny bright spectral flecks that twinkle
  float cell = h21(floor(uv * u_res.y * 0.08) + floor(t * 5.0));
  float spk = pow(cell, 45.0);
  col += spk * (u_sparkle + u_pulse * 0.5) * spectral(opd * 1.4);

  // gentle sheen + vignette, then a soft gamma lift
  float r = length(uv);
  col *= 1.0 - 0.28 * r * r;
  col = pow(max(col, 0.0), vec3(0.85));
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
for (const name of ['u_res', 'u_time', 'u_scale', 'u_depth', 'u_play', 'u_sat', 'u_milk', 'u_sparkle', 'u_tilt', 'u_flow', 'u_hue', 'u_pulse'])
  u[name] = gl.getUniformLocation(program, name)

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_scale, params.scale)
  gl.uniform1f(u.u_depth, params.depth)
  gl.uniform1f(u.u_play, params.play)
  gl.uniform1f(u.u_sat, params.saturation)
  gl.uniform1f(u.u_milk, params.milkiness)
  gl.uniform1f(u.u_sparkle, params.sparkle)
  gl.uniform1f(u.u_tilt, params.tilt)
  gl.uniform1f(u.u_flow, params.flow)
  gl.uniform1f(u.u_hue, params.hue)
  gl.uniform1f(u.u_pulse, rt.beat.state.pulse || 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
