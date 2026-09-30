/**
 * Multipass WebGL2 helper for filter sketches that need more than one shader
 * pass: separable blurs, prefix scans, persistent simulation state (ping-pong).
 * glfilter.js covers the common single-pass case; this is its bigger sibling and
 * uses the same conventions (v_uv y-up, u_res, u_time, cover-fit source).
 *
 *   const pipe = createGLPipe({ rt, src, canvas, mipmaps: true })
 *   const pA = pipe.program(FRAG_A)                 // fragment shaders get v_uv, u_res, u_time
 *   const tA = pipe.target({ scale: 0.5 })          // screen-relative render target
 *   const tB = pipe.target({ width: 440, height: 248 }) // fixed size
 *   // each frame:
 *   if (!pipe.begin({ mirror, time })) return        // uploads the source if it changed
 *   pipe.run(pA, { u_src: pipe.source }, tA, (u) => u.f('u_amount', 1))
 *   pipe.run(pB, { u_in: tA, u_src: pipe.source }, null)   // null = the screen
 *
 * Samplers named in `inputs` are bound to consecutive texture units and their
 * uniforms set automatically. Float (RGBA16F) targets are used when the browser
 * can render to them, else RGBA8. pipe.changed reports whether begin() saw a new
 * source picture, so a sketch can skip frames that would be identical.
 */
const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() {
  v_uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

export function createGLPipe({ rt, src, canvas, mipmaps = false }) {
  const capture = new URLSearchParams(location.search).get('capture') === '1'
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: capture })
  const floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
  const buf = document.createElement('canvas')
  const bctx = buf.getContext('2d')

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const sourceTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, sourceTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const source = { tex: sourceTex }

  let W = 0
  let H = 0
  let lastVersion = -1
  let lastMirror = null
  const targets = []

  function makeTarget(t) {
    const w = Math.max(2, t.width || Math.round(W * (t.scale ?? 1)))
    const h = Math.max(2, t.height || Math.round(H * (t.scale ?? 1)))
    if (t.tex) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    t.w = w
    t.h = h
    t.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t.tex)
    const f = t.filter === 'NEAREST' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (t.float && floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    t.fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  function resize() {
    W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
    H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
    buf.width = W
    buf.height = H
    lastVersion = -1
    for (const t of targets) if (!t.width) makeTarget(t) // screen-relative targets follow the size
  }
  window.addEventListener('resize', resize)

  function compile(type, text) {
    const s = gl.createShader(type)
    gl.shaderSource(s, text)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }

  const api = {
    gl,
    source,
    changed: true,
    floatTargets: floatOK,
    get width() { return W },
    get height() { return H },

    program(frag) {
      const p = gl.createProgram()
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
      gl.bindAttribLocation(p, 0, 'position')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      const locs = {}
      const loc = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n)))
      const u = {
        f: (n, v) => gl.uniform1f(loc(n), v),
        i: (n, v) => gl.uniform1i(loc(n), v),
        v2: (n, a, b) => gl.uniform2f(loc(n), a, b),
        v3: (n, a, b, c) => gl.uniform3f(loc(n), a, b, c),
        v4: (n, a, b, c, d) => gl.uniform4f(loc(n), a, b, c, d),
      }
      return { p, loc, u }
    },

    // A render target: { scale } of the screen, or fixed { width, height }. float: true
    // asks for RGBA16F (simulation state); filter: 'NEAREST' for exact texel reads.
    target({ scale, width, height, float = false, filter = 'LINEAR' } = {}) {
      const t = { scale, width, height, float, filter, tex: null, fbo: null, w: 0, h: 0 }
      makeTarget(t)
      targets.push(t)
      return t
    },

    // Start a frame: upload the source picture if it changed. Returns false until
    // the source is ready. api.changed says whether the picture is new this frame.
    begin({ mirror = false, time = 0 } = {}) {
      src.update(time)
      api.time = time
      if (!src.ready) return false
      api.changed = src.version !== lastVersion || mirror !== lastMirror
      if (api.changed) {
        bctx.clearRect(0, 0, W, H)
        src.draw(bctx, W, H, { mirror })
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sourceTex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf)
        if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
        lastVersion = src.version
        lastMirror = mirror
      }
      return true
    },

    // Run `prog` over a full-screen triangle into `target` (null = the canvas).
    run(prog, inputs, target, setUniforms) {
      gl.useProgram(prog.p)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
      const w = target ? target.w : W
      const h = target ? target.h : H
      gl.viewport(0, 0, w, h)
      let unit = 0
      for (const name in inputs) {
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, inputs[name].tex)
        gl.uniform1i(prog.loc(name), unit)
        unit++
      }
      prog.u.v2('u_res', w, h)
      prog.u.f('u_time', api.time || 0)
      setUniforms?.(prog.u)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  }
  resize()
  return api
}
