// Unified live search across the Collections sources (Wikimedia Commons +
// Internet Archive). Each source is queried in parallel and failures are
// isolated so one provider being down still returns the other's results. Items
// share the normalised shape used by the Collections grid, tagged with a
// `provider` so the UI can label them and resolve full URLs correctly.

import { fetchCommonsSearch } from './commons.js'
import { searchArchiveImages, ensureFullUrl } from './archive.js'

export const PROVIDERS = [
  { id: 'commons', label: 'Wikimedia Commons' },
  { id: 'archive', label: 'Internet Archive' },
]

// Run a keyword search. `sources` is a Set/array of provider ids to include.
// Returns { items, errors } — errors names any provider that failed.
export async function searchCollections(query, sources = ['commons', 'archive'], perSource = 40) {
  const want = new Set(sources)
  const jobs = []
  if (want.has('commons')) jobs.push(['commons', fetchCommonsSearch(query, perSource)])
  if (want.has('archive')) jobs.push(['archive', searchArchiveImages(query, perSource)])
  const settled = await Promise.allSettled(jobs.map(([, p]) => p))

  const items = []
  const errors = []
  settled.forEach((r, i) => {
    const id = jobs[i][0]
    if (r.status === 'fulfilled') items.push(...r.value)
    else errors.push(id)
  })
  // Interleave providers so results don't clump by source.
  const byProvider = {}
  for (const it of items) (byProvider[it.provider] ||= []).push(it)
  const merged = []
  const lists = Object.values(byProvider)
  for (let i = 0; lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i]) merged.push(l[i])
  }
  return { items: merged, errors }
}

// Re-export so callers resolve an item's full-res URL through one entry point,
// regardless of provider (Commons items already carry `url`).
export { ensureFullUrl }
