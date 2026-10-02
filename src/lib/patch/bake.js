// Tier 2: bake a node that cannot keep up in real time into a short looping clip, and play that back.
// This file is the pure part (framework-free, tested): loop and seam maths, the key that says a
// recording is still valid, the advisor that decides when to bake, and the memory budget.
// baker.js does the DOM work (stepping a hidden iframe, encoding frames, decoding them again).

export const BAKE_DEFAULTS = {
  fps: 30,
  seconds: 6, // length of the loop
  seamSeconds: 0.75, // cross-fade that hides the jump where the loop wraps
  warmupSeconds: 1.5, // run first so fade-ins and particle systems have settled
  quality: 0.86, // lossy encode quality of each frame
}

/**
 * What a bake renders. The sketch is stepped through warmup + loop + seam frames; frames after the
 * warmup are numbered 0..N+K-1 and the last K are blended back over the first K (seamWeight), so
 * the loop's end flows into its start.
 */
export function planBake(opts = {}) {
  const o = { ...BAKE_DEFAULTS, ...opts }
  const fps = Math.max(1, Math.round(o.fps))
  const frames = Math.max(2, Math.round(o.seconds * fps))
  const seam = Math.max(0, Math.min(Math.floor(frames / 2), Math.round(o.seamSeconds * fps)))
  const warmup = Math.max(0, Math.round(o.warmupSeconds * fps))
  return { fps, frames, seam, warmup, total: warmup + frames + seam, stepMs: 1000 / fps, quality: o.quality }
}

/** Weight of the loop's START frame j (0 <= j < K) when blending it over the continuation frame N + j. */
export function seamWeight(j, K) {
  if (K <= 0) return 1
  const t = Math.min(1, Math.max(0, (j + 0.5) / K))
  return t * t * (3 - 2 * t)
}

/** Which frame of an N-frame loop that started at `startMs` is showing at `nowMs`. */
export function loopFrame(nowMs, startMs, fps, N) {
  const i = Math.floor(((nowMs - startMs) * fps) / 1000)
  return ((i % N) + N) % N
}

/** JSON with sorted keys, so equal objects give equal strings whatever order they were built in. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
}

/**
 * Everything that changes what a node draws. A baked clip is valid only while this stays equal.
 * `values` / `state` are the sketch's own params and serialisable state.
 */
export function bakeKey({ slug, seed, values, state, mappingCount = 0, linkCount = 0, width, height }) {
  return [slug, seed ?? '', stable(values), stable(state), mappingCount, linkCount, width + 'x' + height].join('|')
}

/** Whether a node's picture is a function of time alone, so a recording of it is a faithful stand-in. */
export function bakeEligibility({ isEffect, hasSlug, modulated, micOn, ready }) {
  if (!isEffect || !hasSlug) return { ok: false, reason: 'Only effect nodes can be baked.' }
  if (modulated) return { ok: false, reason: 'A control link or input mapping drives this node, so a recording would stop it reacting.' }
  if (micOn) return { ok: false, reason: 'The microphone is on: sketches can react to the audio, which a recording cannot.' }
  if (!ready) return { ok: false, reason: 'The sketch has not finished loading.' }
  return { ok: true, reason: '' }
}

/**
 * Decides which node, if any, to bake. A node qualifies when it has run well below the rate it was
 * asked for over several fps reports in a row, has not changed for a while, and is eligible.
 */
export class BakeAdvisor {
  constructor({ badReports = 3, ratio = 0.75, stableMs = 3000 } = {}) {
    this.o = { badReports, ratio, stableMs }
    this.m = new Map() // id -> { streak, key, since, blockedKey, fpsRatio }
  }
  _e(id) {
    let e = this.m.get(id)
    if (!e) this.m.set(id, (e = { streak: 0, key: null, since: 0, blockedKey: null, fpsRatio: 1 }))
    return e
  }
  /** A sketch:fps report. `want` is the rate the node was asked to run at. */
  report(id, fps, want) {
    const e = this._e(id)
    e.fpsRatio = want > 0 ? fps / want : 1
    e.streak = e.fpsRatio < this.o.ratio ? e.streak + 1 : 0
  }
  /** Tell the advisor what the node's key is now; a change restarts its stability clock and the streak. */
  observeKey(id, key, now) {
    const e = this._e(id)
    if (e.key !== key) { e.key = key; e.since = now; e.streak = 0 }
  }
  /** The user sent a node back to live: leave it alone until its key changes. */
  block(id) { const e = this._e(id); e.blockedKey = e.key }
  slow(id) { return (this.m.get(id)?.streak ?? 0) >= this.o.badReports }
  /**
   * @param candidates ids that are eligible and not already baked / baking / protected
   * @returns the slowest qualifying id, or null
   */
  pick(now, candidates) {
    let best = null
    let bestRatio = Infinity
    for (const id of candidates) {
      const e = this.m.get(id)
      if (!e || e.streak < this.o.badReports || now - e.since < this.o.stableMs) continue
      if (e.blockedKey != null && e.blockedKey === e.key) continue
      if (e.fpsRatio < bestRatio) { best = id; bestRatio = e.fpsRatio }
    }
    return best
  }
  forget(id) { this.m.delete(id) }
}

/** Memory budget for recordings, evicting the least recently used when it is exceeded. */
export class BakeBudget {
  constructor(maxBytes) {
    this.max = maxBytes
    this.m = new Map() // id -> { bytes, used }
  }
  get total() { let t = 0; for (const e of this.m.values()) t += e.bytes; return t }
  touch(id, now) { const e = this.m.get(id); if (e) e.used = now }
  remove(id) { this.m.delete(id) }
  /** Add a recording; returns the ids that must be dropped to stay within budget (never `id` itself). */
  add(id, bytes, now) {
    this.m.set(id, { bytes, used: now })
    const drop = []
    let total = this.total
    const order = [...this.m.entries()].filter(([k]) => k !== id).sort((a, b) => a[1].used - b[1].used)
    for (const [k, e] of order) {
      if (total <= this.max) break
      drop.push(k)
      total -= e.bytes
      this.m.delete(k)
    }
    return drop
  }
}
