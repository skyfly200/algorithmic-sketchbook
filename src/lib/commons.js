/**
 * Wikimedia Commons image fetch — the runtime source for built-in Collections.
 *
 * Collections don't ship image bytes; they name a public-domain source (a
 * Commons category or search) and the plate list is fetched live, in the user's
 * browser, from the Commons MediaWiki API. Commons serves the API and the files
 * with `Access-Control-Allow-Origin: *`, so `origin=*` gives us a CORS-clean
 * JSON response and the returned file URLs can be drawn to a canvas
 * (crossOrigin='anonymous') without tainting it — which is what lets a plate
 * flow into a Patch Media node or the shape tracer.
 *
 * Nothing here runs at build time (the build sandbox has no egress); it's all
 * on-demand from the live page.
 */

const API = 'https://commons.wikimedia.org/w/api.php'

// Pull a plain string out of a Commons extmetadata field (values are
// `{ value: '<html>' }`), stripping any HTML the API wraps around it.
function meta(extmeta, key) {
  const v = extmeta?.[key]?.value
  if (v == null) return ''
  const s = String(v)
  if (!s.includes('<')) return s.trim()
  const el = document.createElement('div')
  el.innerHTML = s
  return (el.textContent || '').trim()
}

// Turn one MediaWiki `page` (with imageinfo) into our normalised item.
function toItem(page) {
  const info = page.imageinfo?.[0]
  if (!info) return null
  const ext = info.extmetadata || {}
  const title = String(page.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
  return {
    id: page.pageid,
    title,
    thumb: info.thumburl || info.url,
    thumbWidth: info.thumbwidth || info.width,
    thumbHeight: info.thumbheight || info.height,
    url: info.url, // full-resolution original
    width: info.width,
    height: info.height,
    mime: info.mime || '',
    descriptionUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.title || '')}`,
    license: meta(ext, 'LicenseShortName') || 'Public domain',
    artist: meta(ext, 'Artist'),
    credit: meta(ext, 'Credit'),
    date: meta(ext, 'DateTimeOriginal') || meta(ext, 'DateTime'),
  }
}

async function callApi(params) {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params })
  const res = await fetch(`${API}?${qs}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Commons API ${res.status}`)
  const data = await res.json()
  const pages = data?.query?.pages
  if (!pages) return []
  return Object.values(pages)
    .map(toItem)
    .filter(Boolean)
    .filter((it) => /^image\//.test(it.mime) || /\.(jpe?g|png|gif|webp|tiff?)$/i.test(it.url || ''))
}

const IIPROPS = { prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '640' }

// Files inside a Commons category (best for a specific book/collection).
export async function fetchCommonsCategory(category, limit = 60) {
  const items = await callApi({
    generator: 'categorymembers',
    gcmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
    gcmtype: 'file',
    gcmlimit: String(limit),
    ...IIPROPS,
  })
  // Category members come back unordered; sort by title so plates read in a
  // stable, roughly page-like order.
  return items.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
}

// Full-text file search on Commons (fallback / general collections).
export async function fetchCommonsSearch(search, limit = 60) {
  return callApi({
    generator: 'search',
    gsrsearch: search,
    gsrnamespace: '6', // File:
    gsrlimit: String(limit),
    ...IIPROPS,
  })
}

// Resolve a collection's source to a list of plates, category first with a
// search fallback so a mis-named category still yields something.
export async function fetchCollectionItems(source, limit = 60) {
  if (source.category) {
    try {
      const items = await fetchCommonsCategory(source.category, limit)
      if (items.length) return items
    } catch { /* fall through to search */ }
  }
  if (source.search) return fetchCommonsSearch(source.search, limit)
  return []
}
