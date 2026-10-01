// Runs a filter chain (see filterChain.js) in one WebGL2 context.
//
// Each member sketch stays in its iframe as the parameter host and sends us its
// fragment shader (`setProgram`) and uniform values (`setUniforms`). We upload the
// head's input once, ping-pong the passes through two framebuffers, and copy the
// last pass into the tail's 2D canvas. u_res and u_time are ours.
import { VERT } from '../../../sketches/_lib/glfilter.js'

export function createChainRunner() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
  if (!gl) return null

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const progs = new Map() // node id -> { prog, frag, mipmaps, animated, locs, uniforms, ver, failed }
  const inTex = makeTex()
  const targets = [makeTarget(), makeTarget()]
  let W = 0
  let H = 0
  let lost = false
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })

  function makeTex() {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  function makeTarget() {
    return { tex: makeTex(), fbo: gl.createFramebuffer() }
  }
  function size(w, h) {
    if (w === W && h === H) return
    W = canvas.width = w
    H = canvas.height = h
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  function compile(type, source) {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log) }
    return s
  }
  function build(frag) {
    const prog = gl.createProgram()
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, frag)
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.bindAttribLocation(prog, 0, 'position')
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error(log) }
    return prog
  }

  const UNIFORM_CALLS = {
    f: (l, v) => gl.uniform1f(l, v[0]),
    i: (l, v) => gl.uniform1i(l, v[0]),
    v2: (l, v) => gl.uniform2f(l, v[0], v[1]),
    v3: (l, v) => gl.uniform3f(l, v[0], v[1], v[2]),
    v3arr: (l, v) => gl.uniform3fv(l, v),
  }

  // The sketch announced its shader. Returns whether the node can run in a chain.
  function setProgram(id, { frag, mipmaps = false, animated = false }) {
    const old = progs.get(id)
    if (old && old.frag === frag) { old.mipmaps = mipmaps; old.animated = animated; return !old.failed }
    if (old?.prog) gl.deleteProgram(old.prog)
    const entry = { frag, mipmaps, animated, prog: null, locs: {}, uniforms: old?.uniforms ?? [], ver: 0, failed: false }
    try { entry.prog = build(frag) } catch { entry.failed = true }
    progs.set(id, entry)
    return !entry.failed
  }
  function setUniforms(id, list) {
    const p = progs.get(id)
    if (!p) return
    p.uniforms = list
    p.ver++
  }
  const ready = (id) => { const p = progs.get(id); return !!p && !p.failed && !!p.prog }
  const failed = (id) => !!progs.get(id)?.failed
  function drop(id) {
    const p = progs.get(id)
    if (p?.prog) gl.deleteProgram(p.prog)
    progs.delete(id)
  }

  // Signature of everything that changes a chain's picture. Equal signatures mean
  // the last run is still correct. `animatedTick` advances for animated members.
  function signature(ids, inputVer, w, h, now) {
    let s = `${inputVer}|${w}x${h}`
    for (const id of ids) {
      const p = progs.get(id)
      s += `|${p ? p.ver : -1}`
      if (p?.animated) s += `@${now >> 4}`
    }
    return s
  }

  function bindPass(id, srcTex, time) {
    const p = progs.get(id)
    gl.useProgram(p.prog)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, p.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    if (p.mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
    const loc = (n) => (n in p.locs ? p.locs[n] : (p.locs[n] = gl.getUniformLocation(p.prog, n)))
    gl.uniform1i(loc('u_tex'), 0)
    gl.uniform2f(loc('u_res'), W, H)
    gl.uniform1f(loc('u_time'), time)
    for (const [kind, name, vals] of p.uniforms) UNIFORM_CALLS[kind]?.(loc(name), vals)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  /**
   * Run one chain. `input` is the head's upstream canvas (compositor-sized); the
   * result is copied into `outCtx`. `thumbs` (optional) maps an interior node id
   * to its 2D context so its preview can be refreshed on a slow cadence.
   * Returns false when the chain could not run (caller falls back to iframes).
   */
  function run(ids, input, w, h, time, outCtx, thumbs = null) {
    if (lost || !input || !ids.every(ready)) return false
    size(w, h)
    gl.viewport(0, 0, w, h)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.activeTexture(gl.TEXTURE0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) // only the upload is upright-flipped; pass outputs are already GL-oriented
    gl.bindTexture(gl.TEXTURE_2D, inTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input)
    let srcTex = inTex
    let ping = 0
    for (let i = 0; i < ids.length; i++) {
      const last = i === ids.length - 1
      const thumb = !last && thumbs?.get(ids[i])
      if (thumb) { // a preview: draw this pass to the canvas too, then redo it to a target
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        bindPass(ids[i], srcTex, time)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        thumb.drawImage(canvas, 0, 0)
      }
      if (last) gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      else gl.bindFramebuffer(gl.FRAMEBUFFER, targets[ping].fbo)
      bindPass(ids[i], srcTex, time)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!last) { srcTex = targets[ping].tex; ping ^= 1 }
    }
    outCtx.drawImage(canvas, 0, 0)
    return true
  }

  return { setProgram, setUniforms, ready, failed, drop, signature, run, get lost() { return lost } }
}
