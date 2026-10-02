/**
 * Temporal upscaling for heavy full-screen shader sketches (an FSR2 / TAAU-style prototype,
 * not DLSS: no network, no engine motion vectors).
 *
 * The sketch renders its scene at a fraction of the canvas size, with a different sub-pixel
 * jitter every frame, into a low-resolution target that also records ray depth. A resolve pass
 * then builds the full-size picture: it blends the current low-res samples into a reprojected,
 * colour-clamped history, so detail from many jittered frames accumulates.
 *
 * Reprojection is exact for a known camera. Two camera models:
 *   - pinhole: the resolve pass takes each pixel's ray and depth, rebuilds the world point and
 *     projects it through the PREVIOUS frame's camera ({ ro, uu, vv, ww, f }, see below);
 *   - 2D pan / zoom: a flat scene viewed through { center: [x, y], scale } with
 *     p = center + uv * scale and uv = (2 * fragCoord - res) / min(res.x, res.y); no depth needed.
 *     (The centre difference is formed in JS in double precision, so deep zooms keep their precision.)
 * The sketch reports its camera each frame.
 * Content that moves on its own (anything not explained by the camera) just falls back to the
 * current low-res sample; the history clamp stops it from ghosting.
 *
 *   const taau = createTAAU(gl)                       // null when the GPU can't (no float targets)
 *   taau.resize(canvas.width, canvas.height, 0.5)     // full size + render scale
 *   const { size, jitter } = taau.begin()             // binds the low-res target
 *   //   scene shader: vec2 fc = gl_FragCoord.xy + u_jitter;  ...
 *   //                 layout(location = 0) out vec4 outColor;  layout(location = 1) out float outDepth;
 *   //                 (outDepth = ray distance along the normalised ray, or a large value on a miss)
 *   gl.drawArrays(...)
 *   taau.end({ ro, uu, vv, ww, f })                   // resolve + present on the canvas
 * The camera maps a pixel to a ray with: uv = (2 * fragCoord - res) / res.y;
 *   rd = normalize(uv.x * uu + uv.y * vv + f * ww).
 */
const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const RESOLVE = `#version 300 es
precision highp float;
precision highp sampler2D; // the depth target holds real distances
uniform sampler2D u_color;
uniform sampler2D u_depth;
uniform sampler2D u_hist;
uniform vec2 u_full;
uniform vec2 u_low;
uniform vec2 u_jit;
uniform vec3 u_ro, u_uu, u_vv, u_ww;
uniform float u_f;
uniform vec3 u_pro, u_puu, u_pvv, u_pww;
uniform float u_pf;
uniform float u_alpha;
uniform float u_valid;
uniform float u_kernel;
uniform int u_mode;     // 0 pinhole + depth, 1 2D pan / zoom
uniform vec2 u_dc;      // 2D: centre - previous centre (double precision from JS)
uniform vec2 u_s2;      // 2D: scale, previous scale
out vec4 outColor;

vec3 toY(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromY(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }

// Catmull-Rom history sample (5 taps), so reprojection does not blur the history away
vec3 histBicubic(vec2 uv) {
  vec2 size = u_full;
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / size, t3 = (c + 2.0) / size, t12 = (c + w2 / w12) / size;
  vec3 r = textureLod(u_hist, vec2(t12.x, t0.y), 0.0).rgb * (w12.x * w0.y)
         + textureLod(u_hist, vec2(t0.x, t12.y), 0.0).rgb * (w0.x * w12.y)
         + textureLod(u_hist, t12, 0.0).rgb * (w12.x * w12.y)
         + textureLod(u_hist, vec2(t3.x, t12.y), 0.0).rgb * (w3.x * w12.y)
         + textureLod(u_hist, vec2(t12.x, t3.y), 0.0).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return r / ws;
}

void main() {
  vec2 lp = gl_FragCoord.xy / u_full * u_low;      // this pixel in low-res coordinates
  ivec2 base = ivec2(floor(lp));
  ivec2 lim = ivec2(u_low) - 1;

  // current frame: the 3x3 low-res samples around the pixel, weighted by how close each sample's
  // jittered position is to the pixel centre
  vec3 sum = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
  float wsum = 0.0, zmin = 1e9;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 t = clamp(base + ivec2(dx, dy), ivec2(0), lim);
      vec3 col = texelFetch(u_color, t, 0).rgb;
      vec2 d = vec2(t) + 0.5 + u_jit - lp;
      float w = exp(-u_kernel * dot(d, d));
      sum += col * w;
      wsum += w;
      vec3 y = toY(col);
      m1 += y;
      m2 += y * y;
      zmin = min(zmin, texelFetch(u_depth, t, 0).r);   // nearest surface keeps edges tight
    }
  }
  vec3 cur = sum / max(wsum, 1e-4);
  vec3 curY = toY(cur);

  // reproject through the previous camera
  bool ok = false;
  vec2 ptc = vec2(0.0);
  if (u_mode == 1) {
    vec2 uvc = (2.0 * lp - u_low) / min(u_low.x, u_low.y);
    vec2 puv = (uvc * u_s2.x + u_dc) / u_s2.y;
    ptc = (puv * min(u_full.x, u_full.y) + u_full) * 0.5 / u_full;
    ok = true;
  } else {
    vec2 uvv = (2.0 * lp - u_low) / u_low.y;
    vec3 rd = normalize(uvv.x * u_uu + uvv.y * u_vv + u_f * u_ww);
    vec3 v = u_ro + rd * zmin - u_pro;
    float z = dot(v, u_pww);
    if (z > 1e-3) {
      vec2 puv = vec2(dot(v, u_puu), dot(v, u_pvv)) * u_pf / z;
      ptc = (puv * u_full.y + u_full) * 0.5 / u_full;
      ok = true;
    }
  }
  float alpha = 1.0;
  vec3 outc = cur;
  if (u_valid > 0.5 && ok) {
    if (ptc.x > 0.0 && ptc.x < 1.0 && ptc.y > 0.0 && ptc.y < 1.0) {
      vec3 hY = toY(histBicubic(ptc));
      // clamp the history to the local colour distribution (variance clipping)
      vec3 mu = m1 / 9.0;
      vec3 sd = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
      vec3 lo = mu - 1.5 * sd - 0.01, hi = mu + 1.5 * sd + 0.01;
      vec3 hc = clamp(hY, lo, hi);
      float rejected = length(hY - hc);
      alpha = mix(u_alpha, 1.0, smoothstep(0.04, 0.25, rejected));
      outc = fromY(mix(hc, curY, alpha));
    }
  }
  outColor = vec4(max(outc, 0.0), 1.0);
}`

const COPY = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_tex;
out vec4 outColor;
void main() { outColor = vec4(texelFetch(u_tex, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`

// Halton(2, 3): a low-discrepancy sequence of sub-pixel offsets
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b) } return r }
const JITTER_PHASES = 16

/** @returns null when the browser cannot render to float textures. */
export function createTAAU(gl) {
  if (!gl.getExtension('EXT_color_buffer_float')) return null

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const program = (frag) => {
    const p = gl.createProgram()
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    const locs = {}
    return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) }
  }
  const resolve = program(RESOLVE)
  const copy = program(COPY)
  const vao = gl.createVertexArray()

  const tex = (internal, w, h, filter) => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  let W = 0, H = 0, lw = 0, lh = 0, scale = 0.5
  let scene = null // { color, depth, fbo }
  let hist = null  // [{ tex, fbo }, { tex, fbo }]
  let frame = 0
  let prevCam = null
  let valid = false
  let jitter = [0, 0]

  function free() {
    if (scene) { gl.deleteTexture(scene.color); gl.deleteTexture(scene.depth); gl.deleteFramebuffer(scene.fbo) }
    if (hist) for (const h of hist) { gl.deleteTexture(h.tex); gl.deleteFramebuffer(h.fbo) }
    scene = hist = null
  }
  function alloc() {
    free()
    lw = Math.max(2, Math.round(W * scale))
    lh = Math.max(2, Math.round(H * scale))
    scene = { color: tex(gl.RGBA8, lw, lh, gl.NEAREST), depth: tex(gl.R32F, lw, lh, gl.NEAREST), fbo: gl.createFramebuffer() }
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene.color, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, scene.depth, 0)
    hist = [0, 1].map(() => {
      const h = { tex: tex(gl.RGBA16F, W, H, gl.LINEAR), fbo: gl.createFramebuffer() }
      gl.bindFramebuffer(gl.FRAMEBUFFER, h.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, h.tex, 0)
      return h
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    valid = false
    prevCam = null
  }

  const setCam = (loc, p, c) => {
    gl.uniform3fv(resolve.u(p + 'ro'), c.ro)
    gl.uniform3fv(resolve.u(p + 'uu'), c.uu)
    gl.uniform3fv(resolve.u(p + 'vv'), c.vv)
    gl.uniform3fv(resolve.u(p + 'ww'), c.ww)
    gl.uniform1f(resolve.u(p === 'u_' ? 'u_f' : 'u_pf'), c.f)
  }

  return {
    get lowSize() { return [lw, lh] },
    get supported() { return true },
    /** Set the full output size and the render scale (0.25 .. 1). Reallocates only on change. */
    resize(width, height, s) {
      const ns = Math.min(1, Math.max(0.25, s))
      if (width === W && height === H && ns === scale && scene) return
      W = width
      H = height
      scale = ns
      alloc()
    },
    /** Forget the history (after a cut or a big parameter change). */
    reset() { valid = false },
    /** Bind the low-res scene target. The sketch draws into it with `jitter` (low-res px). */
    begin() {
      jitter = [halton(frame % JITTER_PHASES + 1, 2) - 0.5, halton(frame % JITTER_PHASES + 1, 3) - 0.5]
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
      gl.viewport(0, 0, lw, lh)
      return { size: [lw, lh], jitter }
    },
    /**
     * Resolve the low-res frame into the history and present it. `cam` is this frame's camera.
     * opts.alpha: weight of the new frame (default 0.15; use more when the content changed).
     * opts.history: false disables temporal accumulation (the plain low-res upscale, for comparison).
     */
    end(cam, { alpha = 0.15, history = true, kernel = 6.0 } = {}) {
      const read = hist[frame & 1]
      const write = hist[(frame + 1) & 1]
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      gl.viewport(0, 0, W, H)
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)
      gl.bindVertexArray(vao)
      gl.useProgram(resolve.p)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.color); gl.uniform1i(resolve.u('u_color'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, scene.depth); gl.uniform1i(resolve.u('u_depth'), 1)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(resolve.u('u_hist'), 2)
      gl.uniform2f(resolve.u('u_full'), W, H)
      gl.uniform2f(resolve.u('u_low'), lw, lh)
      gl.uniform2f(resolve.u('u_jit'), jitter[0], jitter[1])
      const flat = !!cam.center
      gl.uniform1i(resolve.u('u_mode'), flat ? 1 : 0)
      if (flat) {
        const p = prevCam ?? cam
        gl.uniform2f(resolve.u('u_dc'), cam.center[0] - p.center[0], cam.center[1] - p.center[1])
        gl.uniform2f(resolve.u('u_s2'), cam.scale, p.scale)
      } else {
        setCam(resolve, 'u_', cam)
        setCam(resolve, 'u_p', prevCam ?? cam)
      }
      gl.uniform1f(resolve.u('u_alpha'), alpha)
      gl.uniform1f(resolve.u('u_valid'), history && valid && prevCam ? 1 : 0)
      gl.uniform1f(resolve.u('u_kernel'), kernel)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // present
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, W, H)
      gl.useProgram(copy.p)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(copy.u('u_tex'), 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)

      prevCam = flat ? { center: [...cam.center], scale: cam.scale } : { ro: [...cam.ro], uu: [...cam.uu], vv: [...cam.vv], ww: [...cam.ww], f: cam.f }
      valid = true
      frame++
    },
    dispose() { free() },
  }
}
