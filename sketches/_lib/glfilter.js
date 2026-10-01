/**
 * Boilerplate for single-pass WebGL2 filter sketches.
 *
 * The source (camera / clip / demo / Mixer feed) is cover-fit onto a 2D canvas,
 * uploaded as a texture, and a fragment shader runs over it. The shader gets:
 *   in vec2 v_uv;            // 0..1, y up
 *   uniform sampler2D u_tex; // the source
 *   uniform vec2 u_res;      // output size in pixels
 *   uniform float u_time;    // seconds
 * plus whatever the sketch sets in the `setUniforms` callback of render().
 *
 *   const gf = createGLFilter({ rt, src, canvas, frag })
 *   // each frame:
 *   gf.render({ mirror, time }, (u) => { u.f('u_amount', 1); u.i('u_mode', 2) })
 *
 * Frames are skipped when nothing changed: the source picture (src.version), the
 * uniforms, the mirror flag and the size are all unchanged and the shader does
 * not use u_time. A still image with static params therefore costs ~nothing.
 * render() returns true when it drew, false when it skipped (or had no source).
 *
 * Chain mode: inside Patch, the parent can ask a filter to join a shared filter
 * chain (`filter:chain`). The sketch then keeps running its params and calls
 * render() as usual, but draws nothing: it sends its fragment shader once
 * (`filter:program`) and its uniform values whenever they change
 * (`filter:uniforms`); the parent runs the whole chain in one GL context.
 * u_res and u_time are the parent's. In chain mode rt.pixelRatio and gf.width/height
 * report the parent's render size, so size-dependent uniforms need no special casing.
 * A sketch that adds extra textures declines.
 */
export const VERT = `#version 300 es
in vec2 position;
out vec2 v_uv;
void main() {
  v_uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

// `mipmaps: true` builds a mip chain for the source every frame, so a shader can
// read a pre-blurred version with textureLod(u_tex, uv, lod) in a single cheap tap.
export function createGLFilter({ rt, src, canvas, frag, mipmaps = false }) {
  const capture = new URLSearchParams(location.search).get('capture') === '1'
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: capture })
  const buf = document.createElement('canvas')
  const bctx = buf.getContext('2d')

  const compile = (type, source) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(program)
  gl.useProgram(program)

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  const locs = {}
  const loc = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(program, n)))
  // A shader that reads u_time anywhere beyond its declaration animates on its
  // own, so it can never skip frames.
  const animated = /u_time/.test(frag.replace(/uniform\s+\w+\s+u_time\s*;/g, ''))
  let sig = ''
  // In chain mode the uniform calls are recorded for the parent instead of
  // reaching GL. u_res / u_time are the parent's to set.
  let chain = false
  let chainList = []
  let chainSent = null
  const rec = (n, kind, vals) => {
    if (n === 'u_res' || n === 'u_time') return
    chainList.push([kind, n, vals])
    sig += vals.join(':') + ','
  }
  const u = {
    f: (n, v) => { if (chain) return rec(n, 'f', [v]); if (animated || n !== 'u_time') sig += v + ','; gl.uniform1f(loc(n), v) },
    i: (n, v) => { if (chain) return rec(n, 'i', [v]); sig += v + ','; gl.uniform1i(loc(n), v) },
    v2: (n, a, b) => { if (chain) return rec(n, 'v2', [a, b]); sig += a + ':' + b + ','; gl.uniform2f(loc(n), a, b) },
    v3: (n, a, b, c) => { if (chain) return rec(n, 'v3', [a, b, c]); sig += a + ':' + b + ':' + c + ','; gl.uniform3f(loc(n), a, b, c) },
    v3arr: (n, flat) => { if (chain) return rec(n, 'v3arr', [...flat]); sig += flat.join(':') + ','; gl.uniform3fv(loc(n), flat) },
  }
  // A chained filter never draws, so it parks its canvases at 1x1 instead of holding
  // full-size frame buffers (the parent's cost model counts on this).
  const park = () => { canvas.width = canvas.height = buf.width = buf.height = 1 }
  const basePixelRatio = rt.pixelRatio
  let declined = false // extra textures can't be shared, so such a sketch stays an iframe
  const toParent = (msg) => { try { window.parent.postMessage(msg, '*') } catch { /* no parent */ } }
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.type !== 'filter:chain' || window.parent === window || e.source !== window.parent) return
    if (d.on) {
      chain = !declined
      if (chain) {
        // The parent renders at its own size: report that size (rt.pixelRatio, gf.width/height)
        // so pixel-valued params (radii, cell sizes) mean the same thing as unchained.
        if (d.width > 0 && window.innerWidth > 0) rt.pixelRatio = d.width / window.innerWidth
        resize()
        park()
      }
      chainSent = null // (re)send the uniforms along with the program
      toParent({ type: 'filter:program', ok: chain, frag, mipmaps, animated })
    } else if (chain) {
      chain = false
      rt.pixelRatio = basePixelRatio
      resize() // back to full size; redraws from our own source
    }
  })
  gl.uniform1i(loc('u_tex'), 0)
  let forceDraw = false

  // Extra sampler (LUT, baked overlay …) on its own texture unit. upload() takes
  // a canvas/ImageData/typed array (+ width/height for raw arrays) and forces the
  // next render() to draw even if nothing else changed.
  function addTexture(name, unit, { filter = 'LINEAR', flipY = true } = {}) {
    declined = true
    const t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl[filter])
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl[filter])
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(loc(name), unit)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    return {
      upload(source, w, h) {
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
        if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        forceDraw = true
      },
    }
  }

  let W = 0
  let H = 0
  let lastVersion = -1
  let lastMirror = null
  let lastSig = null
  function resize() {
    W = Math.floor(window.innerWidth * rt.pixelRatio)
    H = Math.floor(window.innerHeight * rt.pixelRatio)
    if (chain) return // chain mode parks the canvases at 1x1 (see park())
    canvas.width = buf.width = W
    canvas.height = buf.height = H
    gl.viewport(0, 0, W, H)
    lastVersion = -1 // force a fresh upload + draw
  }
  window.addEventListener('resize', resize)
  resize()

  return {
    get width() { return W },
    get height() { return H },
    addTexture,
    // Draws one frame. Returns true if it drew, false if it skipped (nothing
    // changed) or the source is not ready yet.
    render({ mirror = false, time = 0 } = {}, setUniforms) {
      if (chain) {
        sig = ''
        chainList = []
        setUniforms?.(u)
        if (sig !== chainSent) { chainSent = sig; toParent({ type: 'filter:uniforms', list: chainList }) }
        return false
      }
      src.update(time)
      if (!src.ready) return false
      sig = ''
      u.v2('u_res', W, H)
      u.f('u_time', time)
      setUniforms?.(u)
      const fresh = src.version !== lastVersion || mirror !== lastMirror
      if (!fresh && !animated && !forceDraw && sig === lastSig) return false
      forceDraw = false
      if (fresh) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        bctx.clearRect(0, 0, W, H)
        src.draw(bctx, W, H, { mirror })
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf)
        if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
        lastVersion = src.version
        lastMirror = mirror
      }
      lastSig = sig
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return true
    },
  }
}
