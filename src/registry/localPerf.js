// On-device performance scores. The static perf.json is measured on whatever
// machine ran `npm run perf`, so its numbers rarely match a given user's
// hardware. The viewer measures the real frame rate while a sketch plays and
// records a per-slug score here; the gallery gauges then prefer this local
// measurement over the shipped one, so the badges reflect THIS machine.
const KEY = 'sketchbook-perf-local'
let store = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } })()

export function localScore(slug) {
  return store[slug] ?? null
}

// Fold a freshly measured FPS into the slug's smoothed score (0-100 vs 60fps).
export function recordFps(slug, fps) {
  if (!slug || !fps || fps <= 0) return
  const score = Math.max(1, Math.min(100, Math.round((fps / 60) * 100)))
  const prev = store[slug]
  store[slug] = prev == null ? score : Math.round(prev * 0.7 + score * 0.3)
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch {}
}

// The score to show/grade with: the on-device measurement if we have one,
// otherwise the shipped static score.
export function effectivePerf(sketch) {
  return store[sketch.slug] ?? sketch.perf ?? null
}
