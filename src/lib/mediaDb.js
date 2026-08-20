// A tiny IndexedDB store for the media library's blobs. Imported images, videos
// and recorded clips are too large for localStorage, so their object URLs used
// to vanish on reload — a show built around imported footage lost its media
// every refresh. Here we keep the raw Blobs (plus the id/name/kind metadata a
// Media node references) in IndexedDB and rehydrate fresh object URLs at start.
//
// Live sources (camera, screen share) are deliberately NOT persisted — they're
// device streams, re-requested per session with a user gesture.
const DB_NAME = 'sketchbook-media'
const STORE = 'blobs'
let dbPromise = null

function db() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((e) => { dbPromise = null; throw e })
  return dbPromise
}

function tx(mode) {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE))
}

// Store one media record: { id, name, kind, recorded, blob }. Best-effort —
// a failure (private mode, quota) shouldn't break the in-memory library.
export async function putMediaBlob(record) {
  try {
    const store = await tx('readwrite')
    await new Promise((res, rej) => { const r = store.put(record); r.onsuccess = res; r.onerror = () => rej(r.error) })
  } catch { /* persistence is best-effort */ }
}

export async function deleteMediaBlob(id) {
  try {
    const store = await tx('readwrite')
    await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = res; r.onerror = () => rej(r.error) })
  } catch { /* ignore */ }
}

export async function allMediaBlobs() {
  try {
    const store = await tx('readonly')
    return await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error) })
  } catch { return [] }
}

export async function clearMediaBlobs() {
  try {
    const store = await tx('readwrite')
    await new Promise((res, rej) => { const r = store.clear(); r.onsuccess = res; r.onerror = () => rej(r.error) })
  } catch { /* ignore */ }
}
