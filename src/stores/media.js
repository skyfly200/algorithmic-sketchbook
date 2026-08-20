/**
 * Media library — the images, videos and recorded clips a Media node can play
 * as a Patch/Mixer source. The raw Blobs are persisted to IndexedDB (too large
 * for localStorage) and rehydrated into fresh object URLs at start, so a show
 * built around imported footage keeps its media across reloads; ids are stable
 * so a saved patch/show that references media by id still resolves. The shared
 * camera and screen streams are live device sources — requested per session,
 * never persisted.
 *
 * A recorded/prebaked clip is just a video item captured from a live canvas —
 * that's how a slow non-realtime effect is "prebaked": record its output once,
 * then play the clip back at full speed.
 */
import { reactive } from 'vue'
import { putMediaBlob, deleteMediaBlob, allMediaBlobs, clearMediaBlobs } from '../lib/mediaDb.js'

let idSeq = 1
export const mediaLibrary = reactive([]) // { id, name, kind:'image'|'video', url, thumb, recorded }

export function addMediaFile(file) {
  const kind = file.type.startsWith('video') ? 'video' : 'image'
  const id = idSeq++
  const url = URL.createObjectURL(file)
  const item = { id, name: file.name || `${kind} ${id}`, kind, url, recorded: false }
  mediaLibrary.push(item)
  makeThumb(item)
  putMediaBlob({ id, name: item.name, kind, recorded: false, blob: file })
  return item
}

export function addRecordedClip(blob, name) {
  const id = idSeq++
  const url = URL.createObjectURL(blob)
  const item = { id, name: name || `clip ${id}`, kind: 'video', url, recorded: true }
  mediaLibrary.push(item)
  makeThumb(item)
  putMediaBlob({ id, name: item.name, kind: 'video', recorded: true, blob })
  return item
}

export function removeMedia(id) {
  const i = mediaLibrary.findIndex((m) => m.id === id)
  if (i < 0) return
  try {
    URL.revokeObjectURL(mediaLibrary[i].url)
  } catch {}
  mediaLibrary.splice(i, 1)
  deleteMediaBlob(id)
}

// Wipe the whole persisted library (used by Settings' "clear" controls).
export function clearMediaLibrary() {
  for (const m of mediaLibrary) { try { URL.revokeObjectURL(m.url) } catch {} }
  mediaLibrary.splice(0, mediaLibrary.length)
  clearMediaBlobs()
}

// Rehydrate persisted blobs into the live library once, at app start. Fresh
// object URLs are minted from the stored Blobs; idSeq is advanced past every
// restored id so new imports never collide with a persisted one.
let hydrated = false
export async function hydrateMediaLibrary() {
  if (hydrated) return
  hydrated = true
  const records = await allMediaBlobs()
  records.sort((a, b) => a.id - b.id)
  for (const rec of records) {
    if (!rec || !rec.blob) continue
    if (rec.id >= idSeq) idSeq = rec.id + 1
    if (mediaLibrary.some((m) => m.id === rec.id)) continue
    const url = URL.createObjectURL(rec.blob)
    const item = { id: rec.id, name: rec.name, kind: rec.kind, url, recorded: !!rec.recorded }
    mediaLibrary.push(item)
    makeThumb(item)
  }
}

export function mediaById(id) {
  return mediaLibrary.find((m) => m.id === id) ?? null
}

// Grab a small poster frame so the library reads at a glance.
function makeThumb(item) {
  try {
    if (item.kind === 'image') {
      const img = new Image()
      img.onload = () => (item.thumb = drawThumb(img, img.naturalWidth, img.naturalHeight))
      img.src = item.url
    } else {
      const v = document.createElement('video')
      v.muted = true
      v.src = item.url
      v.addEventListener('loadeddata', () => {
        v.currentTime = Math.min(0.1, v.duration || 0.1)
      })
      v.addEventListener('seeked', () => {
        item.thumb = drawThumb(v, v.videoWidth, v.videoHeight)
      }, { once: true })
    }
  } catch {}
}
function drawThumb(el, w, h) {
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 54
  const x = c.getContext('2d')
  const s = Math.max(96 / w, 54 / h)
  x.drawImage(el, (96 - w * s) / 2, (54 - h * s) / 2, w * s, h * s)
  try {
    return c.toDataURL('image/jpeg', 0.6)
  } catch {
    return null
  }
}

// --- shared camera: one getUserMedia, reused by every Media node -----------
let camStream = null
let camPromise = null
let camFacing = 'user' // 'user' (front) | 'environment' (back)
export function sharedCameraOn() {
  return !!camStream
}
// The live shared-camera stream, for hosts that want to draw it themselves
// (e.g. Autopilot feeding the camera through a filter). Null when off.
export function sharedCameraStream() {
  return camStream
}
export function sharedCameraFacing() {
  return camFacing
}
export async function startSharedCamera(facingMode = camFacing) {
  if (camStream && facingMode === camFacing) return camStream
  // Switching facing means dropping the current stream first — a device only
  // streams one camera at a time.
  if (camStream && facingMode !== camFacing) stopSharedCamera()
  camFacing = facingMode
  if (!camPromise) {
    camPromise = navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, facingMode } })
      .then((s) => (camStream = s))
      .catch((e) => {
        camPromise = null
        throw e
      })
  }
  return camPromise
}
// Flip the shared camera front↔back; returns the new stream.
export function flipSharedCamera() {
  return startSharedCamera(camFacing === 'user' ? 'environment' : 'user')
}
export function stopSharedCamera() {
  if (camStream) {
    for (const t of camStream.getTracks()) t.stop()
    camStream = null
    camPromise = null
  }
}

// --- shared screen: one getDisplayMedia, reused by every screen-mode node ----
// getDisplayMedia needs a user gesture, and the picker also has its own "Stop
// sharing" button; when the user stops it there the track ends, so we listen
// and clear the shared stream so nodes fall back cleanly.
let screenStream = null
let screenPromise = null
export function sharedScreenOn() { return !!screenStream }
export function sharedScreenStream() { return screenStream }
export async function startSharedScreen() {
  if (screenStream) return screenStream
  if (!screenPromise) {
    screenPromise = navigator.mediaDevices
      .getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      .then((s) => {
        screenStream = s
        // the browser's own "Stop sharing" ends the track — reflect that here
        s.getVideoTracks()[0]?.addEventListener('ended', () => stopSharedScreen())
        return s
      })
      .catch((e) => { screenPromise = null; throw e })
      .finally(() => { screenPromise = null })
  }
  return screenPromise
}
export function stopSharedScreen() {
  if (screenStream) {
    for (const t of screenStream.getTracks()) t.stop()
    screenStream = null
  }
  screenPromise = null
}
