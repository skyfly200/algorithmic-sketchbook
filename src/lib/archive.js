/**
 * Internet Archive image search — a second live source for Collections.
 *
 * Like Commons, nothing is bundled: we hit archive.org's public Advanced Search
 * API from the browser (it serves JSON with Access-Control-Allow-Origin: *) to
 * find image items, and use the per-item thumbnail service for the grid. The
 * full-resolution file URL is resolved lazily (one metadata call) only when a
 * plate is actually used in Patch or traced, so a search doesn't fan out into
 * dozens of metadata requests. Archive's file nodes also send ACAO:* so the
 * resolved URL is fetchable and canvas-safe.
 */

const SEARCH = 'https://archive.org/advancedsearch.php'
const META = 'https://archive.org/metadata'

function firstOf(v) { return Array.isArray(v) ? v[0] : v }

// Search image items. Returns items in our normalised shape; `url` is null until
// resolveArchiveImage() fills it in (grid rendering only needs `thumb`).
export async function searchArchiveImages(query, limit = 40) {
  const q = `(${query}) AND mediatype:image`
  const params = new URLSearchParams({ q, rows: String(limit), page: '1', output: 'json' })
  for (const f of ['identifier', 'title', 'creator', 'year', 'licenseurl']) params.append('fl[]', f)
  const res = await fetch(`${SEARCH}?${params}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Archive search ${res.status}`)
  const data = await res.json()
  const docs = data?.response?.docs || []
  return docs.map((d) => ({
    id: `ia:${d.identifier}`,
    identifier: d.identifier,
    provider: 'archive',
    title: firstOf(d.title) || d.identifier,
    thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
    url: null, // resolved on demand
    descriptionUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
    license: d.licenseurl ? 'See source' : 'Public domain / see source',
    artist: firstOf(d.creator) || '',
    date: d.year ? String(d.year) : '',
  }))
}

// Pick the best still image inside an archive item and return a direct download
// URL. Prefers a real JPEG/PNG original over derivatives and thumbnails.
export async function resolveArchiveImage(identifier) {
  const res = await fetch(`${META}/${encodeURIComponent(identifier)}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Archive metadata ${res.status}`)
  const data = await res.json()
  const files = data?.files || []
  const images = files.filter((f) => /\.(jpe?g|png|gif|webp|tiff?)$/i.test(f.name || ''))
  if (!images.length) return null
  // Prefer originals, then the largest by byte size.
  const score = (f) => (f.source === 'original' ? 1e15 : 0) + (Number(f.size) || 0)
  images.sort((a, b) => score(b) - score(a))
  const best = images[0]
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(best.name)}`
}

// Ensure an item has a usable full-res `url`, resolving archive items on demand.
export async function ensureFullUrl(item) {
  if (item.url) return item.url
  if (item.provider === 'archive') {
    const url = await resolveArchiveImage(item.identifier)
    item.url = url || item.thumb
    return item.url
  }
  return item.thumb
}
