// Hand a collection plate off to the Patch view — either as a live Media source
// or preloaded into the shape tracer. A writer (CollectionsView) stashes a small
// descriptor in localStorage, then navigates to Patch, which reads and clears it
// on mount. Both carry a public image URL (Commons serves ACAO:* so the URL is
// fetchable / canvas-safe from the live page).

export const COLLECTION_MEDIA_KEY = 'sketchbook-collection-media' // { url, name }
export const COLLECTION_TRACE_KEY = 'sketchbook-collection-trace' // { url, name }

function stash(key, payload) {
  try { localStorage.setItem(key, JSON.stringify(payload)) } catch { /* quota */ }
}
function take(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    localStorage.removeItem(key)
    return JSON.parse(raw)
  } catch { return null }
}

export function handOffMediaToPatch(url, name) { stash(COLLECTION_MEDIA_KEY, { url, name }) }
export function takeMediaHandoff() { return take(COLLECTION_MEDIA_KEY) }
export function handOffTraceToPatch(url, name) { stash(COLLECTION_TRACE_KEY, { url, name }) }
export function takeTraceHandoff() { return take(COLLECTION_TRACE_KEY) }
