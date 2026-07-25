import { reactive } from 'vue'
import { snapshot, applySnapshot } from './settings.js'

// Named "modes": full-state snapshots saved alongside the gallery. A mode
// captures everything a share link does — all settings, custom expressions,
// the keyframe timeline, live-input mappings and beat triggers, and the
// display-view configuration — under a user-given name. Modes 1-9 load
// from the number keys for live performance.

const KEY = 'moire-modes-v1'
const MAX_MODES = 24

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(modes))
  } catch {
    // Storage full or unavailable — the in-memory list still works.
  }
}

export const modes = reactive(load())

export function saveMode(name, thumb) {
  modes.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '').trim() || 'Mode ' + (modes.length + 1),
    date: new Date().toISOString(),
    thumb,
    snap: snapshot(),
  })
  if (modes.length > MAX_MODES) modes.length = MAX_MODES
  persist()
}

export function loadMode(entry) {
  applySnapshot(entry.snap)
}

export function removeMode(id) {
  const i = modes.findIndex((m) => m.id === id)
  if (i >= 0) {
    modes.splice(i, 1)
    persist()
  }
}

export function renameMode(id, name) {
  const m = modes.find((x) => x.id === id)
  if (m && name && name.trim()) {
    m.name = name.trim()
    persist()
  }
}
