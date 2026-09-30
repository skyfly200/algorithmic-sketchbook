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
 */
const VERT = `#version 300 es
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
  const u = {
    f: (n, v) => gl.uniform1f(loc(n), v),
    i: (n, v) => gl.uniform1i(loc(n), v),
    v2: (n, a, b) => gl.uniform2f(loc(n), a, b),
    v3: (n, a, b, c) => gl.uniform3f(loc(n), a, b, c),
    v3arr: (n, flat) => gl.uniform3fv(loc(n), flat),
  }
  gl.uniform1i(loc('u_tex'), 0)

  let W = 0
  let H = 0
  function resize() {
    W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
    H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
    buf.width = W
    buf.height = H
    gl.viewport(0, 0, W, H)
  }
  window.addEventListener('resize', resize)
  resize()

  return {
    get width() { return W },
    get height() { return H },
    // Draws one frame. Returns false (and draws nothing) until the source is ready.
    render({ mirror = false, time = 0 } = {}, setUniforms) {
      src.update(time)
      if (!src.ready) return false
      bctx.clearRect(0, 0, W, H)
      src.draw(bctx, W, H, { mirror })
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
      u.v2('u_res', W, H)
      u.f('u_time', time)
      setUniforms?.(u)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return true
    },
  }
}
