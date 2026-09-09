// A tiny IndexedDB cache for gallery card "posters" — the single warm-up frame
// each local sketch captures for its card. Capturing spins up a hidden iframe
// per card, so re-doing it on every page load is a real cost on a 150-sketch
// grid. Here we keep the captured data-URLs keyed by slug, versioned by the
// sketch's `updated` date so a changed sketch re-captures. Best-effort: any
// failure (private mode, quota, no IndexedDB) just falls back to live capture.
const DB_NAME = 'sketchbook-posters'
const STORE = 'posters'
let dbPromise = null

function db() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'slug' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((e) => { dbPromise = null; throw e })
  return dbPromise
}
function tx(mode) { return db().then((d) => d.transaction(STORE, mode).objectStore(STORE)) }

// Return the cached data-URL for a slug iff it matches the given version, else ''.
export async function getPoster(slug, version) {
  try {
    const store = await tx('readonly')
    const rec = await new Promise((res, rej) => { const r = store.get(slug); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    return rec && rec.version === version ? rec.dataUrl : ''
  } catch { return '' }
}

export async function putPoster(slug, version, dataUrl) {
  try {
    const store = await tx('readwrite')
    await new Promise((res, rej) => { const r = store.put({ slug, version, dataUrl }); r.onsuccess = res; r.onerror = () => rej(r.error) })
  } catch { /* persistence is best-effort */ }
}
