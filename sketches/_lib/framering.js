/**
 * A ring of past frames for delay-line sketches (delay, motion-extraction) that
 * only holds as many frames as the current delay needs, under a memory cap.
 *
 *   const ring = createFrameRing()
 *   ring.resize(W, H)          // on window resize (clears the history)
 *   ring.need(d)               // each frame: the furthest-back frame you will read
 *   const past = ring.get(d)   // a canvas holding the frame d pushes ago (blank if not written yet)
 *   ring.push((c, w, h) => c.drawImage(canvas, 0, 0, w, h))   // record this frame
 *
 * Frames are stored at `ring.width x ring.height`, which is W x H unless
 * frames x W x H x 4 would pass `maxBytes`; then every slot is stored smaller,
 * so draw `get()` results with an explicit destination size. Growing keeps the
 * existing history; shrinking waits `shrinkAfter` pushes of lower need, so a
 * slider drag or a tempo wobble does not churn canvases.
 */
export function createFrameRing({ maxBytes = 192 * 1024 * 1024, shrinkAfter = 180 } = {}) {
  let slots = [] // circular; `head` is the next slot to write (also the oldest)
  let head = 0
  let W = 0, H = 0, sw = 0, sh = 0
  let lowFor = 0

  const blank = () => {
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    return c
  }
  // Storage size for `n` slots of W x H under the byte cap.
  function sizeFor(n) {
    const full = n * W * H * 4
    const s = full > maxBytes ? Math.sqrt(maxBytes / full) : 1
    return [Math.max(1, Math.floor(W * s)), Math.max(1, Math.floor(H * s))]
  }
  // Oldest → newest.
  const chronological = () => slots.slice(head).concat(slots.slice(0, head))

  // Rebuild with `n` slots, keeping the newest frames (resampled if the slot size changes).
  function rebuild(n) {
    const old = chronological()
    const [nw, nh] = sizeFor(n)
    const resample = nw !== sw || nh !== sh
    sw = nw
    sh = nh
    const keep = old.slice(Math.max(0, old.length - n))
    const next = []
    for (let i = 0; i < n - keep.length; i++) next.push(blank())
    for (const c of keep) {
      if (!resample) { next.push(c); continue }
      const r = blank()
      r.getContext('2d').drawImage(c, 0, 0, sw, sh)
      next.push(r)
    }
    slots = next
    head = 0
  }

  return {
    get width() { return sw },
    get height() { return sh },
    get length() { return slots.length },
    resize(w, h) {
      W = Math.max(1, Math.floor(w))
      H = Math.max(1, Math.floor(h))
      const n = Math.max(1, slots.length)
      slots = []
      head = 0
      ;[sw, sh] = sizeFor(n)
      for (let i = 0; i < n; i++) slots.push(blank())
    },
    // Make sure the frame `d` pushes ago can be read; frees slots after a while of lower need.
    need(d) {
      const n = Math.max(1, Math.round(d))
      if (n > slots.length) { lowFor = 0; rebuild(n); return }
      if (n < slots.length) {
        if (++lowFor >= shrinkAfter) { lowFor = 0; rebuild(n) }
      } else lowFor = 0
    },
    get(d) {
      const n = slots.length
      const k = Math.min(n, Math.max(1, Math.round(d)))
      return slots[(head - k + n) % n]
    },
    push(draw) {
      const c = slots[head]
      const x = c.getContext('2d')
      x.clearRect(0, 0, sw, sh)
      draw(x, sw, sh)
      head = (head + 1) % slots.length
    },
  }
}
