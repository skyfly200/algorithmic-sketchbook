/**
 * Search for the effect / filter pickers. Every word of the query must match
 * somewhere in a sketch's title, slug, tags, tech or description; results are
 * ranked so title hits come before tag hits, which come before description hits.
 * Pure (tested in tests/sketchSearch.test.js).
 */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

// How well one query word matches a sketch (0 = no match).
function wordScore(w, s) {
  const title = norm(s.title)
  if (title.startsWith(w)) return 100
  if (title.split(/[^a-z0-9]+/).some((t) => t.startsWith(w))) return 80
  if (title.includes(w)) return 60
  if (norm(s.slug).includes(w)) return 50
  const tags = [...(s.tags ?? []), ...(s.tech ?? [])].map(norm)
  if (tags.some((t) => t.startsWith(w))) return 40
  if (tags.some((t) => t.includes(w))) return 30
  if (norm(s.description).includes(w)) return 10
  return 0
}

/** Score a sketch against a query (0 = no match; higher is better). */
export function scoreSketch(s, query) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  let total = 0
  for (const w of words) {
    const sc = wordScore(w, s)
    if (!sc) return 0
    total += sc
  }
  return total
}

/** The sketches matching `query`, best first (ties keep their input order). */
export function searchSketches(list, query) {
  if (!norm(query).trim()) return list.slice()
  return list
    .map((s, i) => ({ s, i, sc: scoreSketch(s, query) }))
    .filter((r) => r.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .map((r) => r.s)
}
