/**
 * Frame history for stateful single-pass filters, shared by glfilter.js (a filter on
 * its own canvas) and the Patch chain runner (the same shader inside a chain), so the
 * two behave the same.
 *
 * A fragment shader opts in by sampling either of:
 *   uniform sampler2D u_prev;    // this filter's own previous output (what it last drew)
 *   uniform sampler2D u_prevIn;  // the picture that fed it on the previous draw
 * Both are black / transparent until the first draw and are cleared on a size change.
 * Note that u_prev is the *displayed* output: a filter that post-processes what it shows
 * (a mirror, say) feeds that back into its own loop.
 *
 * A filter that uses history is animated: it redraws every frame, since its picture
 * evolves on its own.
 *
 * Usage, per draw: history.resize(w, h); history.bind(loc); <draw>; history.after(inputTex)
 * with the output still bound as the read framebuffer.
 */
export const PREV_UNIT = 6
export const PREV_IN_UNIT = 7

export const historyUses = (frag) => ({ out: /\bu_prev\b/.test(frag), in: /\bu_prevIn\b/.test(frag) })
export const usesHistory = (frag) => {
  const u = historyUses(frag)
  return u.out || u.in
}

/** @returns null when the shader uses no history. */
export function createHistory(gl, frag) {
  const uses = historyUses(frag)
  if (!uses.out && !uses.in) return null
  const makeTex = () => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const out = uses.out ? makeTex() : null
  const inn = uses.in ? makeTex() : null
  let fbo = null // reads the input texture back for the u_prevIn copy
  let W = 0
  let H = 0
  const restoreUnit0 = () => gl.activeTexture(gl.TEXTURE0)

  return {
    uses,
    /** (Re)allocate at the render size; the history restarts from black. */
    resize(w, h) {
      if (w === W && h === H) return
      W = w
      H = h
      for (const [t, unit] of [[out, PREV_UNIT], [inn, PREV_IN_UNIT]]) {
        if (!t) continue
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      restoreUnit0()
    },
    /** Bind the history samplers on their units; leaves unit 0 active. */
    bind(loc) {
      if (out) { gl.activeTexture(gl.TEXTURE0 + PREV_UNIT); gl.bindTexture(gl.TEXTURE_2D, out); gl.uniform1i(loc('u_prev'), PREV_UNIT) }
      if (inn) { gl.activeTexture(gl.TEXTURE0 + PREV_IN_UNIT); gl.bindTexture(gl.TEXTURE_2D, inn); gl.uniform1i(loc('u_prevIn'), PREV_IN_UNIT) }
      restoreUnit0()
    },
    /**
     * Call right after the pass is drawn, while its output is the bound framebuffer
     * (a target or the canvas; the canvas needs antialias: false to be readable this
     * way). Copies the output into u_prev and `inputTex` into u_prevIn. Leaves the
     * framebuffer binding on the default one when the input copy ran.
     */
    after(inputTex) {
      if (out) {
        gl.activeTexture(gl.TEXTURE0 + PREV_UNIT)
        gl.bindTexture(gl.TEXTURE_2D, out)
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H)
      }
      if (inn && inputTex) {
        fbo ??= gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, inputTex, 0)
        gl.activeTexture(gl.TEXTURE0 + PREV_IN_UNIT)
        gl.bindTexture(gl.TEXTURE_2D, inn)
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      }
      restoreUnit0()
    },
    dispose() {
      if (out) gl.deleteTexture(out)
      if (inn) gl.deleteTexture(inn)
      if (fbo) gl.deleteFramebuffer(fbo)
    },
  }
}
