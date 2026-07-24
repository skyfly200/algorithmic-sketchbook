// Backup / restore — snapshot every persisted `sketchbook-*` localStorage entry
// into a single JSON file and restore it later or on another machine. That one
// prefix covers the lot: your settings + favorites, saved routings and blocks,
// scenes, the Mixer / Autopilot / Patch working state, viewer prefs, and the
// on-device performance measurements. Poster thumbnails live in sessionStorage
// and regenerate themselves, so they're intentionally left out.
const PREFIX = 'sketchbook-'
export const BACKUP_APP = 'bright-waves'
export const BACKUP_VERSION = 1

// Every persisted key in our namespace, as a plain { key: value } map.
function collectData() {
  const data = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(PREFIX)) data[key] = localStorage.getItem(key)
  }
  return data
}

export function collectBackup() {
  const data = collectData()
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    keys: Object.keys(data).length,
    data,
  }
}

// Serialize the whole library + settings and download it as a .json file.
// Returns how many keys were written so the caller can report it.
export function exportBackup() {
  const backup = collectBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `bright-waves-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return backup.keys
}

// Parse + validate a picked file. Throws with a friendly message if it isn't one
// of our backups, so the caller can surface it.
export async function readBackupFile(file) {
  const text = await file.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  if (!parsed || parsed.app !== BACKUP_APP || typeof parsed.data !== 'object' || parsed.data === null) {
    throw new Error('That doesn’t look like a Bright Waves backup file.')
  }
  return parsed
}

// Write a parsed backup back into localStorage. With `replace` (the default) any
// existing `sketchbook-*` keys are cleared first so the restore is exact; only
// keys in our namespace are ever touched. Returns the number of keys written.
export function applyBackup(parsed, { replace = true } = {}) {
  if (replace) {
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PREFIX)) toRemove.push(key)
    }
    for (const k of toRemove) localStorage.removeItem(k)
  }
  let n = 0
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') continue // stay in our namespace
    localStorage.setItem(k, v)
    n++
  }
  return n
}
