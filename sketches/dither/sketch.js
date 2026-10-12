// Dither — ordered (Bayer), Floyd-Steinberg, Atkinson, and random dithering
// applied to a live source, with configurable palette size and pixel scale.
//
// The source is drawn into a small (W / scale × H / scale) canvas. Ordered and
// Random are per-pixel, so they run entirely in a WebGL2 fragment shader over
// that small picture. Floyd-Steinberg and Atkinson are serial (each pixel
// depends on the error pushed from the previous ones), so they stay exact on the
// CPU at the small size (in a worker, one float plane per channel, one plane for
// mono); the GPU then does the nearest-neighbour upscale to the full canvas.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  mode: { value: 'Floyd-Steinberg', type: 'select', options: ['Ordered', 'Floyd-Steinberg', 'Atkinson', 'Random'], label: 'Algorithm' },
  levels: { value: 4, min: 2, max: 16, step: 1, label: 'Palette levels' },
  scale: { value: 3, min: 1, max: 8, step: 1, label: 'Pixel scale' },
  colour: { value: true, type: 'bool', label: 'Colour' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})

const canvas = document.getElementById('canvas')
const capture = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: capture, antialias: false })
const src = createSource()

// Off-screen buffer the source is cover-fit into at the dither resolution.
const small = document.createElement('canvas')
const sctx = small.getContext('2d', { willReadFrequently: true })

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_tex;   // small picture, row 0 = top
uniform vec2 u_res;        // canvas size
uniform ivec2 u_small;     // small picture size
uniform int u_mode;        // 0 = already dithered (error diffusion), 1 = ordered, 2 = random
uniform float u_levels;
uniform bool u_colour;
uniform uint u_seed;
out vec4 outColor;

const float BAYER4[16] = float[16](
   0./16.,  8./16.,  2./16., 10./16.,
  12./16.,  4./16., 14./16.,  6./16.,
   3./16., 11./16.,  1./16.,  9./16.,
  15./16.,  7./16., 13./16.,  5./16.);

float quantise(float v) {
  float st = 1.0 / (u_levels - 1.0);
  return floor(v / st + 0.5) * st;
}
// PCG-style integer hash -> [0, 1)
float hash(uvec3 v) {
  uint h = v.x * 1664525u + v.y * 22695477u + v.z * 2891336453u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h >> 8) / 16777216.0;
}

void main() {
  // Same nearest-neighbour mapping as drawImage(small, 0, 0, W, H) with smoothing off.
  int x = clamp(int(floor(gl_FragCoord.x * float(u_small.x) / u_res.x)), 0, u_small.x - 1);
  int y = clamp(int(floor((u_res.y - gl_FragCoord.y) * float(u_small.y) / u_res.y)), 0, u_small.y - 1);
  vec4 c = texelFetch(u_tex, ivec2(x, y), 0);
  vec3 v = c.rgb;
  if (u_mode != 0) {
    if (!u_colour) v = vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114)));
    float th = u_mode == 1
      ? BAYER4[(y & 3) * 4 + (x & 3)]
      : hash(uvec3(uint(x), uint(y), u_seed));
    th = (th - 0.5) / (u_levels - 1.0); // spread ±0.5 step around threshold
    v = vec3(quantise(clamp(v.r + th, 0.0, 1.0)), quantise(clamp(v.g + th, 0.0, 1.0)), quantise(clamp(v.b + th, 0.0, 1.0)));
  }
  outColor = vec4(v * c.a, c.a);
}`

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

function compile(type, source) {
  const s = gl.createShader(type)
  gl.shaderSource(s, source)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(program)
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
gl.useProgram(program)
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const posLoc = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(posLoc)
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
const U = {}
for (const n of ['u_tex', 'u_res', 'u_small', 'u_mode', 'u_levels', 'u_colour', 'u_seed']) U[n] = gl.getUniformLocation(program, n)
const tex = gl.createTexture()
gl.activeTexture(gl.TEXTURE0)
gl.bindTexture(gl.TEXTURE_2D, tex)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
gl.uniform1i(U.u_tex, 0)

let W = 0, H = 0

function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  gl.viewport(0, 0, W, H)
}

// Exact error diffusion (Floyd-Steinberg / Atkinson) over RGBA bytes, in place.
// Self-contained (no outer references) so the same source runs in the worker
// below and, as a fallback, on the main thread.
function edKernel() {
  const quantise = (v, step) => Math.round(v / step) * step
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  // Working float planes, reused across frames (reallocated only when the size changes).
  const planes = []
  const plane = (k, n) => {
    if (!planes[k] || planes[k].length !== n) planes[k] = new Float32Array(n)
    return planes[k]
  }
  // One channel plane at a time: channels never exchange error, so this gives
  // exactly the per-pixel RGB result.
  function diffuseFS(p, w, h, step) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      const below = y + 1 < h
      for (let x = 0; x < w; x++) {
        const i = row + x
        const o = p[i]
        const n = quantise(o, step)
        p[i] = n
        const e = o - n
        // distribute error: right 7/16, bl 3/16, below 5/16, br 1/16
        if (x + 1 < w) p[i + 1] = clamp01(p[i + 1] + e * (7 / 16))
        if (below) {
          if (x > 0) p[i + w - 1] = clamp01(p[i + w - 1] + e * (3 / 16))
          p[i + w] = clamp01(p[i + w] + e * (5 / 16))
          if (x + 1 < w) p[i + w + 1] = clamp01(p[i + w + 1] + e * (1 / 16))
        }
      }
    }
  }
  function diffuseAtkinson(p, w, h, step) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      const below = y + 1 < h
      const below2 = y + 2 < h
      for (let x = 0; x < w; x++) {
        const i = row + x
        const o = p[i]
        const n = quantise(o, step)
        p[i] = n
        const e = (o - n) / 8
        if (x + 1 < w) p[i + 1] = clamp01(p[i + 1] + e)
        if (x + 2 < w) p[i + 2] = clamp01(p[i + 2] + e)
        if (below) {
          if (x > 0) p[i + w - 1] = clamp01(p[i + w - 1] + e)
          p[i + w] = clamp01(p[i + w] + e)
          if (x + 1 < w) p[i + w + 1] = clamp01(p[i + w + 1] + e)
        }
        if (below2) p[i + w * 2] = clamp01(p[i + w * 2] + e)
      }
    }
  }
  return function errorDiffuse(d, w, h, mode, levels, colour) {
    const n = w * h
    const step = 1 / (levels - 1)
    const run = mode === 'Atkinson' ? diffuseAtkinson : diffuseFS
    if (colour) {
      for (let c = 0; c < 3; c++) {
        const p = plane(c, n)
        for (let i = 0, px = c; i < n; i++, px += 4) p[i] = d[px] / 255
        run(p, w, h, step)
        for (let i = 0, px = c; i < n; i++, px += 4) d[px] = p[i] * 255
      }
    } else {
      // luminance: the three channels would be identical, so diffuse one plane
      const p = plane(0, n)
      for (let i = 0, px = 0; i < n; i++, px += 4) p[i] = (d[px] * 0.299 + d[px + 1] * 0.587 + d[px + 2] * 0.114) / 255
      run(p, w, h, step)
      for (let i = 0, px = 0; i < n; i++, px += 4) d[px] = d[px + 1] = d[px + 2] = p[i] * 255
    }
  }
}

// The diffusion runs in a worker so the page's main thread (shared with the
// Patch / Mixer compositor) stays free; the dithered frame lands a frame or so
// later. With a manual clock (baking, deterministic captures) or no Worker it
// runs inline instead.
let errorDiffuse = null // main-thread fallback, built on first use
let worker = null
if (new URLSearchParams(location.search).get('clock') !== 'manual' && typeof Worker !== 'undefined') {
  try {
    const code = `const errorDiffuse = (${edKernel.toString()})();
onmessage = (e) => {
  const m = e.data
  const d = new Uint8ClampedArray(m.buf)
  errorDiffuse(d, m.w, m.h, m.mode, m.levels, m.colour)
  postMessage(m, [m.buf])
}`
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
  } catch { worker = null }
}
let busy = false // a frame is out at the worker
let result = null // { buf, w, h } back from the worker, waiting to be drawn
if (worker) {
  worker.onmessage = (e) => { busy = false; result = e.data }
  worker.onerror = (e) => { e.preventDefault?.(); worker.terminate(); worker = null; busy = false; lastSig = null }
}

function draw(sw, sh, modeId, levels) {
  gl.uniform2f(U.u_res, W, H)
  gl.uniform2i(U.u_small, sw, sh)
  gl.uniform1i(U.u_mode, modeId)
  gl.uniform1f(U.u_levels, levels)
  gl.uniform1i(U.u_colour, params.colour ? 1 : 0)
  if (modeId === 2) gl.uniform1ui(U.u_seed, (rt.rng() * 4294967296) >>> 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

let lastSig = null
function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  const mode = params.mode
  const diffusion = mode === 'Floyd-Steinberg' || mode === 'Atkinson'
  gl.bindTexture(gl.TEXTURE_2D, tex)

  // A diffused frame came back from the worker: show it (unless the mode moved on).
  if (result) {
    const r = result
    result = null
    if (diffusion) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r.w, r.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(r.buf))
      draw(r.w, r.h, 0, r.levels)
    }
  }

  // Skip when nothing it depends on changed (Random re-rolls its noise each frame),
  // or while the worker is still busy with the previous frame (retried next frame).
  const sig = [src.version, mode, params.levels, params.scale, params.colour, params.mirror, W, H].join(',')
  if ((sig === lastSig && mode !== 'Random') || (diffusion && busy)) { requestAnimationFrame(frame); return }
  lastSig = sig

  const scale = Math.round(params.scale)
  const sw = Math.max(1, Math.round(W / scale))
  const sh = Math.max(1, Math.round(H / scale))
  if (small.width !== sw || small.height !== sh) {
    small.width = sw; small.height = sh
  }

  // downscale source into small buffer
  sctx.clearRect(0, 0, sw, sh)
  src.draw(sctx, sw, sh, { mirror: params.mirror })

  const levels = Math.round(params.levels)
  if (diffusion) {
    const imgData = sctx.getImageData(0, 0, sw, sh)
    if (worker) {
      busy = true
      const buf = imgData.data.buffer
      worker.postMessage({ buf, w: sw, h: sh, mode, levels, colour: params.colour }, [buf])
    } else {
      errorDiffuse ??= edKernel()
      errorDiffuse(imgData.data, sw, sh, mode, levels, params.colour)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgData)
      draw(sw, sh, 0, levels)
    }
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small)
    draw(sw, sh, mode === 'Ordered' ? 1 : 2, levels)
  }

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
