// Tier 1 of "don't pay for work that isn't changing": find effect nodes whose output has stopped
// changing and let the compositor stop evaluating (and the deck policy pause) them. Framework-free.
//
// A node is sampled on a slow cadence (a small hash of its output). Identical samples for
// `freezeMs` freeze it. While frozen it is re-probed every `probeEveryMs`: it is let run for
// `probeMs`, sampled once more, and goes back to frozen only if the picture is still the same.
// Anything that can change a node's picture from outside (a param, a link, a mapping, audio, a
// resize, a reloaded iframe) calls wake(), which starts the node over as live.
export const IDLE_DEFAULTS = { sampleMs: 250, freezeMs: 1000, probeEveryMs: 2000, probeMs: 200 }

/** FNV-1a over RGBA bytes, with the low `shift` bits dropped so +-1 level dither does not count. */
export function hashPixels(data, shift = 2) {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] >> shift
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export class StaticTracker {
  constructor(opts = {}) {
    this.o = { ...IDLE_DEFAULTS, ...opts }
    this.s = new Map() // id -> { phase: 'live'|'frozen'|'probing', last, sameSince, nextAt, frozenAt, probeAt }
  }
  _e(id, now = 0) {
    let e = this.s.get(id)
    if (!e) this.s.set(id, (e = { phase: 'live', last: null, sameSince: null, nextAt: now + this.o.sampleMs, frozenAt: 0, probeAt: 0 }))
    return e
  }
  isFrozen(id) { return this.s.get(id)?.phase === 'frozen' }
  phase(id) { return this.s.get(id)?.phase ?? 'live' }
  /** Advance time-based transitions: a frozen node that is due is let run for a probe. */
  tick(id, now) {
    const e = this._e(id, now)
    if (e.phase === 'frozen' && now - e.frozenAt >= this.o.probeEveryMs) { e.phase = 'probing'; e.probeAt = now }
  }
  /** Whether to take a sample of this node's output now. */
  wantSample(id, now) {
    const e = this._e(id, now)
    if (e.phase === 'live') return now >= e.nextAt
    if (e.phase === 'probing') return now - e.probeAt >= this.o.probeMs
    return false
  }
  /** Record a sample. */
  observe(id, hash, now) {
    const e = this._e(id, now)
    if (e.phase === 'probing') {
      if (hash === e.last) { e.phase = 'frozen'; e.frozenAt = now }
      else { e.phase = 'live'; e.last = hash; e.sameSince = now; e.nextAt = now + this.o.sampleMs }
      return
    }
    if (e.phase !== 'live') return
    e.nextAt = now + this.o.sampleMs
    if (hash === e.last) {
      if (e.sameSince == null) e.sameSince = now
      if (now - e.sameSince >= this.o.freezeMs) { e.phase = 'frozen'; e.frozenAt = now }
    } else {
      e.last = hash
      e.sameSince = now
    }
  }
  /** Something may have changed this node's picture: start over as live. */
  wake(id, now = 0) {
    const e = this.s.get(id)
    if (!e) return
    e.phase = 'live'
    e.last = null
    e.sameSince = null
    e.nextAt = now + this.o.sampleMs
  }
  wakeAll(now = 0) { for (const id of this.s.keys()) this.wake(id, now) }
  forget(id) { this.s.delete(id) }
  /** Ids currently frozen (for badges). */
  frozenIds() { const out = []; for (const [id, e] of this.s) if (e.phase === 'frozen') out.push(id); return out }
}
