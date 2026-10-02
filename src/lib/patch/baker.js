// The DOM half of baking a Patch node to a looping clip (the maths lives in bake.js).
//
//   bakeNode()          loads the node's sketch in a hidden iframe on a manual clock, steps it frame by frame
//                       (as fast as it can render, not in real time), and keeps each frame as an encoded
//                       blob. The last frames are cross-faded over the first so the loop wraps smoothly.
//   createLoopPlayer()  plays those blobs back, decoding a few frames ahead.
//
// The iframe is not part of Patch's frame list, so the live node keeps running untouched while it bakes.
import { planBake, seamWeight, loopFrame } from './bake.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
export const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' })

let encType = null
function encoding() {
  if (!encType) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    encType = c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  }
  return encType
}
const encode = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a frame'))), encoding(), quality))

// Cover-fit a source into the whole canvas, the way the compositor does for an effect node.
function cover(ctx, src, sw, sh, W, H) {
  const k = Math.max(W / sw, H / sh)
  const w = sw * k
  const h = sh * k
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h)
}

/**
 * Record `seconds` of a sketch as a seamless loop.
 * @param {object} o
 *   src      sketch URL (the node's iframe URL, without the clock flag)
 *   values   the node's sketch params;  state: its serialisable state
 *   width, height   frame size (the compositor size)
 *   signal   AbortSignal to cancel;  onProgress({ done, total });  yieldMs  pause between frames
 *   fps / seconds / seamSeconds / warmupSeconds / quality   see BAKE_DEFAULTS
 * @returns {Promise<{ frames: Blob[], fps: number, width: number, height: number, bytes: number }>}
 */
export async function bakeNode({ src, values, state = null, width, height, signal, onProgress, yieldMs = 0, ...opts }) {
  const plan = planBake(opts)
  const iframe = document.createElement('iframe')
  iframe.src = src + (src.includes('?') ? '&' : '?') + 'clock=manual'
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  // off screen but laid out at full size (a display:none frame would report a 0-pixel window)
  iframe.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;`
  const waiters = new Map() // 'ready' | step id -> resolver
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow) return
    const d = e.data
    if (d?.type === 'sketch:ready') waiters.get('ready')?.()
    else if (d?.type === 'sketch:stepped') waiters.get(d.id)?.()
  }
  window.addEventListener('message', onMessage)
  document.body.appendChild(iframe)
  const waitFor = (key, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { waiters.delete(key); reject(new Error('The sketch stopped responding while baking')) }, ms)
    waiters.set(key, () => { clearTimeout(t); waiters.delete(key); resolve() })
  })
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const octx = out.getContext('2d')
  const check = () => { if (signal?.aborted) throw abortError() }

  try {
    await waitFor('ready', 60000)
    check()
    // the node's own look, with no input mappings (a recording cannot react)
    iframe.contentWindow.postMessage({ type: 'sketch:apply-scene', values, mappings: [], state }, '*')
    const START = 2000 // ms; steps run on a clock of their own
    const frames = new Array(plan.frames)
    const head = [] // the first K frames, kept to be blended with the continuation
    const tail = [] // frames N .. N+K-1
    let bytes = 0
    for (let i = 0; i < plan.total; i++) {
      check()
      const id = i + 1
      const stepped = waitFor(id, 120000)
      iframe.contentWindow.postMessage({ type: 'sketch:step', now: START + i * plan.stepMs, id }, '*')
      await stepped
      const j = i - plan.warmup // loop frame number; negative while warming up
      if (j >= 0) {
        const cv = iframe.contentDocument?.querySelector('canvas')
        if (!cv?.width) throw new Error('The sketch has no canvas to record')
        octx.globalCompositeOperation = 'source-over'
        octx.globalAlpha = 1
        octx.fillStyle = '#000'
        octx.fillRect(0, 0, width, height)
        cover(octx, cv, cv.width, cv.height, width, height)
        const blob = await encode(out, j < plan.seam || j >= plan.frames ? 0.95 : plan.quality)
        if (j >= plan.frames) tail.push(blob)
        else if (j < plan.seam) head.push(blob)
        else { frames[j] = blob; bytes += blob.size }
      }
      onProgress?.({ done: i + 1, total: plan.total })
      if (yieldMs) await wait(yieldMs)
    }
    // the loop's start: the continuation (frame N + j) fading into the true start (frame j)
    for (let j = 0; j < plan.seam; j++) {
      check()
      const [a, b] = await Promise.all([createImageBitmap(head[j]), createImageBitmap(tail[j])])
      octx.globalCompositeOperation = 'source-over'
      octx.globalAlpha = 1
      octx.drawImage(b, 0, 0, width, height)
      octx.globalAlpha = seamWeight(j, plan.seam)
      octx.drawImage(a, 0, 0, width, height)
      octx.globalAlpha = 1
      a.close()
      b.close()
      frames[j] = await encode(out, plan.quality)
      bytes += frames[j].size
    }
    return { frames, fps: plan.fps, width, height, bytes }
  } finally {
    window.removeEventListener('message', onMessage)
    iframe.remove()
  }
}

/**
 * Plays a baked loop. draw() paints the frame for the current time, decoding a few frames ahead
 * (and closing bitmaps that fall out of the window), so playback never waits on a decode.
 */
export function createLoopPlayer({ frames, fps, now = performance.now() }) {
  const N = frames.length
  const AHEAD = 6
  const cache = new Map() // frame index -> ImageBitmap
  const pending = new Set()
  let shown = -1
  let dead = false
  const load = (i) => {
    if (cache.has(i) || pending.has(i)) return
    pending.add(i)
    createImageBitmap(frames[i])
      .then((bmp) => { pending.delete(i); if (dead) bmp.close(); else cache.set(i, bmp) })
      .catch(() => pending.delete(i))
  }
  const index = (t) => loopFrame(t, now, fps, N)
  return {
    frames: N,
    fps,
    index,
    get ready() { return cache.size > 0 },
    /** A frame newer than the one on screen should be drawn. */
    due(t) {
      const i = index(t)
      for (let k = 0; k <= AHEAD; k++) load((i + k) % N) // start decoding so the first frame can arrive
      return i !== shown && this.ready
    },
    /** Paint the frame for time t onto ctx (frames are already the node's size). Returns the frame index drawn, or -1. */
    draw(ctx, t, W, H) {
      if (dead) return -1
      const i = index(t)
      for (let k = 0; k <= AHEAD; k++) load((i + k) % N)
      for (const [k, bmp] of cache) {
        const ahead = (k - i + N) % N
        if (ahead > AHEAD && ahead < N - 2) { bmp.close(); cache.delete(k) } // keep a couple behind as a fallback
      }
      let use = cache.has(i) ? i : -1
      for (let back = 1; use < 0 && back <= 3; back++) { const p = (i - back + N) % N; if (cache.has(p)) use = p }
      if (use < 0) return -1
      ctx.drawImage(cache.get(use), 0, 0, W, H)
      shown = i
      return use
    },
    dispose() {
      dead = true
      for (const bmp of cache.values()) bmp.close()
      cache.clear()
    },
  }
}
