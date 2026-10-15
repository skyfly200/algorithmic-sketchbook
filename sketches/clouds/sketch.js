// Clouds — a sky of clouds that form, drift and dissolve. A big baked fbm field
// is sampled each frame at two slowly-diverging offsets and cross-faded, so the
// cloud shapes continuously morph (form and break up) as the field drifts on
// the wind. The cloud "type" reshapes the density curve — puffy cumulus, flat
// stratus, wispy cirrus, or a dark storm, plus rarer types (smooth stacked
// lenticular lenses, pouchy mammatus, dappled mackerel sky, and electric-blue
// noctilucent wisps) — and the sun rakes across so tops glow and undersides
// shade.
//
// The fbm field is still baked once in JS (same seeded permutation), then lives
// in a float texture; every pixel's density, lighting and colour is a fragment
// shader. The cloud picture is rendered into a buffer under screen size (clouds
// are soft; the old path used 240 px across) and scaled up, so the cost stays small on weak GPUs.
import { createRuntime } from '../_lib/runtime.js'
import { createGLPipe } from '../_lib/glpipe.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
// Made here first with antialias off: the buffer is blitted onto the canvas, which a
// multisampled drawing buffer would refuse. glpipe then gets this same context.
canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const pipe = createGLPipe({ rt, src: null, canvas })
const gl = pipe.gl

const params = rt.params({
  type: { value: 'Cumulus', type: 'select', options: ['Cumulus', 'Stratus', 'Cirrus', 'Storm', 'Lenticular', 'Mammatus', 'Mackerel', 'Noctilucent'], label: 'Cloud type' },
  evolve: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Evolve / cycle type' },
  cover: { value: 0.5, min: 0.1, max: 1, step: 0.02, label: 'Cloud cover' },
  wind: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Wind' },
  sun: { value: 40, min: 0, max: 90, step: 1, label: 'Sun angle°' },
  sky: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Sky (day↔dusk)' },
})
rt.mapInput('audio.level', 'wind', 0.4)

// --- baked tileable fbm field ----------------------------------------------
const FS = 512
const field = new Float32Array(FS * FS)
{
  const P = new Uint8Array(512); const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = (rt.rng() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  const fade = (x) => x * x * (3 - 2 * x)
  const vn = (x, y, rep) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
    const hsh = (a, b) => P[(P[((a % rep) + rep) % rep] + (((b % rep) + rep) % rep)) & 511] / 255
    const u = fade(xf)
    const A = hsh(xi, yi) + u * (hsh(xi + 1, yi) - hsh(xi, yi))
    const B = hsh(xi, yi + 1) + u * (hsh(xi + 1, yi + 1) - hsh(xi, yi + 1))
    return A + fade(yf) * (B - A)
  }
  for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
    const fx = (x / FS) * 6, fy = (y / FS) * 6
    let n = 0.5 * vn(fx, fy, 6) + 0.28 * vn(fx * 2, fy * 2, 12) + 0.15 * vn(fx * 4, fy * 4, 24) + 0.07 * vn(fx * 8, fy * 8, 48)
    field[y * FS + x] = n
  }
}
// the field as a repeating, linearly filtered R16F texture
const fieldTex = { tex: gl.createTexture() }
gl.bindTexture(gl.TEXTURE_2D, fieldTex.tex)
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, FS, FS, 0, gl.RED, gl.FLOAT, field)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)

// Per-type look: horizontal stretch, a density curve over the fbm value, an
// optional altitude band (confines the cloud in the sky), a fine ripple carve,
// and lighting/colour flags. The last four are the rarer cloud types. The
// curves and bands are in the shader (cloud() below), indexed by type.
const TYPES = ['Cumulus', 'Stratus', 'Cirrus', 'Storm', 'Lenticular', 'Mammatus', 'Mackerel', 'Noctilucent']

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
out vec4 outColor;
uniform sampler2D u_field;
uniform int u_typeA, u_typeB;
uniform float u_blend, u_cover, u_drift, u_vt, u_sky;
uniform vec2 u_light;
const float FS = ${FS}.0;

// bilinear sample of the tileable field, texel corners at integer positions
// like the old JS sampler (hence the half-texel shift)
float F(float u, float v) { return texture(u_field, vec2(u, v) + 0.5 / FS).r; }
float smooth01(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float gauss(float x, float c, float w) { float k = (x - c) / w; return exp(-k * k); }

// density + lighting + colour for one type at a pixel: rgb in 0..255, a = density
vec4 cloud(int T, float nx, float ny) {
  float stretch = T == 1 ? 1.6 : T == 2 ? 4.5 : T == 4 ? 5.0 : T == 5 ? 1.1 : T == 6 ? 1.25 : T == 7 ? 4.5 : 1.0;
  bool storm = T == 3 || T == 5, glow = T == 7, dull = T == 1, litBelow = T == 5;
  float u = nx / stretch + u_drift;
  float v = ny * 1.4;
  float n1 = F(u, v);
  float n2 = F(u + 0.13, v + u_vt);
  float n = n1 * 0.6 + n2 * 0.4;
  // cover lowers the density floor: at cover->1 almost the whole sky clouds
  // over into a dense overcast; at low cover only the fbm peaks poke through.
  float lo = 0.62 - u_cover * 0.62;
  float e = smooth01(lo, lo + 0.3, n);
  float d;
  if (T == 0) d = pow(e, 1.8) * 1.4;
  else if (T == 1) d = min(1.0, 0.35 + e * 0.55);      // flat, featureless grey overcast sheet
  else if (T == 2) d = pow(e, 1.8) * 1.1;              // high fibrous mare's-tails
  else if (T == 3) d = pow(e, 1.3) * 1.6;
  else if (T == 4) d = pow(smooth01(0.35, 1.0, e), 1.1); // smooth stacked lens discs
  else if (T == 5) d = pow(e, 1.2) * 1.5;              // dark pouches lit from beneath
  else if (T == 6) d = pow(e, 1.05) * 1.35;            // mackerel sky
  else d = pow(e, 2.4) * 1.15;                         // noctilucent wisps
  // altitude bands
  if (T == 2) d *= smooth01(0.75, 0.35, ny);
  else if (T == 4) d *= min(1.0, gauss(ny, 0.4, 0.07) + 0.75 * gauss(ny, 0.53, 0.05) + 0.5 * gauss(ny, 0.29, 0.05));
  else if (T == 5) d *= smooth01(0.22, 0.5, ny);
  else if (T == 7) d *= gauss(ny, 0.26, 0.13);
  // rows of puffs (mackerel / altocumulus): a regular horizontal banding
  if (T == 6) d *= 0.35 + 0.65 * pow(abs(sin(ny * 3.14159265 * 8.0)), 0.6);
  // fibrous carve (cirrus): fine wind-stretched streaks
  if (T == 2) { float fb = F(u * 0.6 + 5.0, v * 7.0 + 2.0); d *= 0.25 + 0.75 * smooth01(0.4, 0.66, fb); }
  float ripple = T == 5 ? 5.5 : T == 6 ? 3.6 : 0.0;
  if (ripple > 0.0) { float rip = F(u * ripple + 11.0, v * ripple + 3.0); d *= 0.22 + 0.78 * smooth01(0.4, 0.62, rip); }
  // overcast fill: at very high cover, lift the thin gaps so it reads solid
  if (u_cover > 0.8) d = d + (u_cover - 0.8) * 3.5 * (1.0 - d) * smooth01(lo - 0.05, lo + 0.15, n);
  d = min(1.0, d);
  // lighting: brighter where the field rises toward the light (below for mammatus)
  float s = litBelow ? -1.0 : 1.0;
  float nA = F(u + u_light.x * 0.02, v + u_light.y * 0.02 * s);
  float shade = max(storm ? 0.28 : 0.42, min(1.0, 0.6 + (n - nA) * 2.0 * s));
  vec3 c;
  if (storm) { float val = 90.0 * (0.4 + shade * 0.6); c = vec3(val, val, val * 1.05); }
  else if (glow) { float val = 235.0 * shade; c = vec3(val * 0.55, val * 0.82, val * 1.15); }
  else if (dull) { float val = 200.0 * (0.6 + shade * 0.4); c = vec3(val, val, val * 1.03); }
  else { float val = 235.0 * shade; c = vec3(val, val * 0.99, val * 0.98); }
  return vec4(c, d);
}

void main() {
  float nx = floor(gl_FragCoord.x) / u_res.x;
  float ny = (u_res.y - 1.0 - floor(gl_FragCoord.y)) / u_res.y; // top-down
  // sky gradient
  vec3 skyTop = vec3(60.0 + u_sky * 60.0, 110.0 + u_sky * 20.0, 190.0 - u_sky * 40.0);
  vec3 skyBot = vec3(150.0 + u_sky * 60.0, 180.0 - u_sky * 30.0, 210.0 - u_sky * 40.0);
  vec3 sky = mix(skyTop, skyBot, ny);
  vec4 A = cloud(u_typeA, nx, ny);
  if (u_blend > 0.01) A = mix(A, cloud(u_typeB, nx, ny), u_blend);
  vec3 col = mix(sky, A.rgb, A.a);
  outColor = vec4(min(col, 255.0) / 255.0, 1.0);
}`
const cloudP = pipe.program(FRAG)

// integrated rate, so a modulated rate never jumps the phase
const phase = (key, rate) => rt.phase(key, rate)

let W = 0, H = 0, GW = 0, GH = 0, img = null
function resize() {
  W = pipe.width; H = pipe.height // glpipe sized the canvas (its listener runs first)
  // render the clouds a little under screen size, scaled with the quality setting
  GW = Math.min(W, Math.round(400 * (0.5 + 0.5 * rt.detail)))
  GH = Math.max(60, Math.round(GW * (H / W)))
  pipe.release(img)
  img = pipe.target({ width: GW, height: GH })
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  // wind drift (0.12 × wind per second = the old 0.002 per frame at 60 fps).
  // Kept modulo 10 so it stays precise: every texture lookup scales u by a
  // factor (1, 0.6, 5.5, 3.6) that turns a shift of 10 into whole field tiles.
  const drift = phase('drift', params.wind * 0.12) % 10
  const sunA = (params.sun * Math.PI) / 180

  // auto-evolve the type by cross-blending toward the next one
  const typeIdx = Math.max(0, TYPES.indexOf(params.type))
  const nextIdx = (typeIdx + 1) % TYPES.length
  const ev = phase('evolve', 0.05 * params.evolve)
  const blend = params.evolve > 0.01 ? (0.5 + 0.5 * Math.sin(ev)) * params.evolve : 0

  pipe.run(cloudP, { u_field: fieldTex }, img, (u) => {
    u.i('u_typeA', typeIdx)
    u.i('u_typeB', nextIdx)
    u.f('u_blend', blend)
    u.f('u_cover', params.cover)
    u.f('u_drift', drift)
    u.f('u_vt', (t * 0.004) % 1)
    u.f('u_sky', params.sky)
    u.v2('u_light', Math.cos(sunA) * 0.6, -Math.sin(sunA) * 0.6)
  })
  // scale up to the canvas: a filtered blit, no shader pass
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, img.fbo)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  gl.blitFramebuffer(0, 0, GW, GH, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
