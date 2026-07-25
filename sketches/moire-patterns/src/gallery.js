import { reactive } from 'vue'
import { snapshot, applySnapshot } from './settings.js'

const KEY = 'moire-gallery-v1'
const COL_KEY = 'moire-collections-v1'
const MAX_ENTRIES = 60

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function loadCollections() {
  try {
    const list = JSON.parse(localStorage.getItem(COL_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(gallery))
  } catch {
    // Storage full or unavailable — the in-memory gallery still works.
  }
}

function persistCollections() {
  try {
    localStorage.setItem(COL_KEY, JSON.stringify(collections))
  } catch {
    // ignore
  }
}

export const gallery = reactive(load())
export const collections = reactive(loadCollections())

// Which collection the drawer is showing: 'all', 'uncat', or a name.
export const galleryView = reactive({ filter: 'all' })

export function saveToGallery(thumb, collection) {
  // Default into the collection currently being viewed, if any.
  const col =
    collection !== undefined
      ? collection
      : galleryView.filter !== 'all' && galleryView.filter !== 'uncat'
        ? galleryView.filter
        : ''
  gallery.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    thumb,
    collection: col,
    snap: snapshot(),
  })
  if (gallery.length > MAX_ENTRIES) gallery.length = MAX_ENTRIES
  persist()
}

export function loadFromGallery(entry) {
  applySnapshot(entry.snap)
}

export function removeFromGallery(id) {
  const i = gallery.findIndex((e) => e.id === id)
  if (i >= 0) {
    gallery.splice(i, 1)
    persist()
  }
}

export function createCollection(name) {
  name = (name || '').trim()
  if (name && !collections.includes(name)) {
    collections.push(name)
    persistCollections()
  }
  return name
}

export function renameCollection(oldName, name) {
  name = (name || '').trim()
  if (!name || collections.includes(name)) return
  const i = collections.indexOf(oldName)
  if (i >= 0) collections[i] = name
  gallery.forEach((e) => {
    if (e.collection === oldName) e.collection = name
  })
  persistCollections()
  persist()
  if (galleryView.filter === oldName) galleryView.filter = name
}

export function deleteCollection(name) {
  const i = collections.indexOf(name)
  if (i >= 0) {
    collections.splice(i, 1)
    persistCollections()
  }
  // Entries in the deleted collection fall back to uncategorized (not lost).
  gallery.forEach((e) => {
    if (e.collection === name) e.collection = ''
  })
  persist()
  if (galleryView.filter === name) galleryView.filter = 'all'
}

export function setEntryCollection(id, name) {
  const e = gallery.find((x) => x.id === id)
  if (!e) return
  e.collection = name
  if (name && !collections.includes(name)) {
    collections.push(name)
    persistCollections()
  }
  persist()
}
