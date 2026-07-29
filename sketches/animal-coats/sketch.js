/**
 * Animal Coats — a generator of the patterned coats of the animal kingdom, both
 * families in one place: the stripes of zebra, tiger, okapi and brindle, and
 * the spots and blotches of cheetah, leopard, jaguar and giraffe. Biologists
 * model all of these as Turing (reaction–diffusion) patterns — the same
 * chemistry tuned to lay down bands, dots or a cracked mosaic. Here it's built
 * procedurally on a fragment shader:
 *   • Stripes — a directional wave, domain-warped for the waver and given phase
 *     dislocations for the Y-forks, thresholded into two coat tones.
 *   • Spots — an animated Voronoi field of irregular filled dots (cheetah).
 *   • Rosettes — broken rings of dark around a warmer centre (leopard), with an
 *     optional inner spot (jaguar).
 *   • Giraffe — Voronoi cells filled brown with pale cracks between them.
 * A species preset picks the family, colours and character; a Pattern switch can
 * force any family onto any palette. Scale, waver, forking, curve, width,
 * softness, orientation, flow and fur grain are live. Leave flow at zero for a
 * still coat, or drive it with the music.
 */
import { createRuntime } from '../_lib/runtime.js'

const MODE = { stripes: 0, spots: 1, rosettes: 2, giraffe: 3, blotch: 4 }
const PRESETS = {
  Zebra: { mode: 'stripes', coat: '#f3efe6', mark: '#141109', mark2: '#141109', belly: '#ece7db', freq: 0.85, warp: 1.15, fork: 0.85, curve: 1.1, width: 0.5, inner: 0 },
  Tiger: { mode: 'stripes', coat: '#d67b2b', mark: '#180f06', mark2: '#180f06', belly: '#efe4cf', freq: 1.0, warp: 0.8, fork: 0.6, curve: 0.7, width: 0.64, inner: 0 },
  Okapi: { mode: 'stripes', coat: '#3c2416', mark: '#e7dabc', mark2: '#e7dabc', belly: '#2e1b10', freq: 1.5, warp: 0.5, fork: 0.3, curve: 1.4, width: 0.74, inner: 0 },
  Brindle: { mode: 'stripes', coat: '#9a6a37', mark: '#241407', mark2: '#241407', belly: '#7a5228', freq: 1.2, warp: 1.6, fork: 1.1, curve: 0.4, width: 0.6, inner: 0 },
  Cheetah: { mode: 'spots', coat: '#d3a860', mark: '#241407', mark2: '#241407', belly: '#efe0c2', freq: 2.2, warp: 0.5, fork: 0.5, curve: 0, width: 0.5, inner: 0 },
  Leopard: { mode: 'rosettes', coat: '#cfa25a', mark: '#241a0f', mark2: '#a9752f', belly: '#ecdcbc', freq: 2.0, warp: 0.6, fork: 0.7, curve: 0, width: 0.5, inner: 0 },
  Jaguar: { mode: 'rosettes', coat: '#c8913f', mark: '#20140a', mark2: '#9d661f', belly: '#e6d3a2', freq: 1.4, warp: 0.5, fork: 0.6, curve: 0, width: 0.56, inner: 1 },
  Giraffe: { mode: 'giraffe', coat: '#b0742f', mark: '#f0e6cf', mark2: '#f0e6cf', belly: '#9a6428', freq: 1.0, warp: 0.7, fork: 0.3, curve: 0, width: 0.5, inner: 0 },
  Dartfrog: { mode: 'blotch', coat: '#1f7ae0', mark: '#0a0d12', mark2: '#0a0d12', belly: '#123a86', freq: 1.2, warp: 0.9, fork: 0.5, curve: 0, width: 0.52, inner: 0 },
}
const rt = createRuntime()
const params = rt.params({
  species: { value: 'Zebra', type: 'select', options: Object.keys(PRESETS), label: 'Species' },
  pattern: { value: 'Auto', type: 'select', options: ['Auto', 'Stripes', 'Spots', 'Rosettes', 'Giraffe', 'Blotch'], label: 'Pattern' },
  frequency: { value: 14, min: 3, max: 44, step: 0.5, label: 'Scale / density' },
  warp: { value: 1, min: 0, max: 2.2, step: 0.05, label: 'Waver' },
  forking: { value: 0.7, min: 0, max: 1.6, step: 0.05, label: 'Forking / break' },
  curve: { value: 0.4, min: -1.2, max: 1.2, step: 0.05, label: 'Curve (stripes)' },
  width: { value: 0.5, min: 0.2, max: 0.85, step: 0.01, label: 'Mark width' },
  crisp: { value: 0.06, min: 0.004, max: 0.32, step: 0.004, label: 'Softness' },
  orient: { value: 0, min: 0, max: 180, step: 1, label: 'Orientation' },
  flow: { value: 0, min: 0, max: 1, step: 0.02, label: 'Flow (morph)' },
  texture: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Fur grain' },
})
rt.mapInput('audio.level', 'flow', 0.6)
rt.mapInput('audio.pulse', 'warp', 0.3)

const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_mode, u_freq, u_warp, u_fork, u_curve, u_width, u_crisp, u_orient, u_flow, u_tex, u_inner;
uniform vec3 u_coat, u_mark, u_mark2, u_belly;
out vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = sin(dot(p, vec2(41.0, 289.0))); return fract(vec2(262144.0, 32768.0) * n); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

// Voronoi → xy: vector to nearest feature, z: per-cell random, w: edge distance
vec4 voro(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0; vec2 mr = f; vec2 idc = n;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(n + g);
    o = 0.5 + 0.5 * sin(u_time * 0.2 * u_flow + 6.2831853 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; mr = r; idc = n + g; }
    else if (d < f2) { f2 = d; }
  }
  return vec4(mr, h21(idc), sqrt(f2) - sqrt(f1));
}

void main() {
  vec2 uvO = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float a = radians(u_orient);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));

  // paler belly toward the bottom of the frame (shared body shading)
  vec3 base = mix(u_belly, u_coat, smoothstep(-0.25, 0.7, uvO.y));
  vec3 col;

  if (u_mode < 0.5) {
    // ---- STRIPES ----
    vec2 q = R * uvO;
    q.x += u_curve * (q.y * q.y - 0.3);
    float wv1 = fbm(q * 2.5 + vec2(0.0, u_time * u_flow * 0.5));
    float ph = q.x * u_freq + (wv1 - 0.5) * u_warp * 5.0;
    float disl = fbm(q * 1.7 + 20.0 + u_time * u_flow * 0.2);
    ph += 3.14159265 * u_fork * smoothstep(0.42, 0.58, disl);
    float wv = 0.5 + 0.5 * sin(ph);
    float e = u_crisp + fwidth(wv) * 1.2;
    float coat = smoothstep(u_width - e, u_width + e, wv);
    col = mix(u_mark, base, coat);
  } else {
    // ---- CELL-BASED: spots / rosettes / giraffe ----
    vec2 cq = R * uvO * (u_freq * 0.16);
    cq += (vec2(fbm(cq * 1.3 + u_time * 0.1 * u_flow), fbm(cq * 1.3 + 9.0)) - 0.5) * u_warp * 1.1;
    vec4 vd = voro(cq);
    vec2 mr = vd.xy; float cr = vd.z, ed = vd.w;
    float d = length(mr);
    float e = u_crisp + fwidth(d) * 1.5;
    col = base;

    if (u_mode < 1.5) {
      // spots (cheetah): irregular filled dots
      float rad = u_width * 0.55 * (0.6 + 0.7 * cr);
      float wob = (fbm(mr * 7.0 + cr * 20.0) - 0.5) * 0.14 * (0.5 + u_warp);
      float spot = smoothstep(rad + e, rad - e, d + wob);
      col = mix(base, u_mark, spot);
    } else if (u_mode < 2.5) {
      // rosettes (leopard / jaguar): broken ring + warm centre
      float rad = u_width * 0.6;
      float ang = atan(mr.y, mr.x);
      float petal = 0.5 + 0.5 * sin(ang * 6.0 + cr * 34.0);
      float ring = smoothstep(0.09, 0.0, abs(d - rad)) * smoothstep(0.32, 0.62, petal + (1.0 - u_fork) * 0.4);
      float centre = smoothstep(rad - 0.02, rad - 0.16, d);
      col = mix(base, u_mark2, centre * 0.85);
      col = mix(col, u_mark, ring);
      if (u_inner > 0.5) col = mix(col, u_mark, smoothstep(0.06, 0.02, d)); // jaguar inner spot
    } else if (u_mode < 3.5) {
      // giraffe: brown cells with pale cracks
      float bw = 0.02 + u_width * 0.1;
      float border = smoothstep(bw + e, bw - e, ed);
      vec3 cellCol = u_coat * (0.78 + 0.3 * cr);
      col = mix(cellCol, u_mark, border);
    } else {
      // blotch (dart frog): bold irregular dark patches from thresholded noise
      float n = fbm(cq * 1.5) * 0.65 + fbm(cq * 3.1 + 4.0) * 0.35;
      float thr = 0.5 - (u_width - 0.5) * 0.5;
      float be = u_crisp * 0.6 + fwidth(n) * 1.5;
      col = mix(base, u_mark, smoothstep(thr - be, thr + be, n));
    }
  }

  // fur grain + fine directional sheen
  float fur = 0.88 + 0.24 * fbm(R * uvO * 42.0);
  col *= mix(1.0, fur, u_tex);
  col *= 0.93 + 0.11 * fbm(R * uvO * vec2(3.0, 34.0));
  col *= 1.0 - 0.16 * dot(uvO, uvO); // vignette
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
for (const name of ['u_res', 'u_time', 'u_mode', 'u_freq', 'u_warp', 'u_fork', 'u_curve', 'u_width', 'u_crisp', 'u_orient', 'u_flow', 'u_tex', 'u_inner', 'u_coat', 'u_mark', 'u_mark2', 'u_belly'])
  u[name] = gl.getUniformLocation(program, name)

function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
}

function frame(now) {
  rt.tick(now)
  const p = PRESETS[params.species] ?? PRESETS.Zebra
  const mode = params.pattern === 'Auto' ? MODE[p.mode] : MODE[params.pattern.toLowerCase()]
  gl.uniform2f(u.u_res, canvas.width, canvas.height)
  gl.uniform1f(u.u_time, now * 0.001)
  gl.uniform1f(u.u_mode, mode)
  gl.uniform1f(u.u_freq, params.frequency * p.freq)
  gl.uniform1f(u.u_warp, params.warp * p.warp)
  gl.uniform1f(u.u_fork, params.forking * p.fork)
  gl.uniform1f(u.u_curve, params.curve * p.curve)
  gl.uniform1f(u.u_width, Math.max(0.12, Math.min(0.9, p.width + (params.width - 0.5))))
  gl.uniform1f(u.u_crisp, params.crisp)
  gl.uniform1f(u.u_orient, params.orient)
  gl.uniform1f(u.u_flow, params.flow)
  gl.uniform1f(u.u_tex, params.texture)
  gl.uniform1f(u.u_inner, p.inner)
  gl.uniform3fv(u.u_coat, hexRgb(p.coat))
  gl.uniform3fv(u.u_mark, hexRgb(p.mark))
  gl.uniform3fv(u.u_mark2, hexRgb(p.mark2))
  gl.uniform3fv(u.u_belly, hexRgb(p.belly))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
