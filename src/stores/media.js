/**
 * Media library — a session-scoped store of the images, videos and recorded
 * clips a Media node can play as a Patch/Mixer source. Blobs live in memory
 * as object URLs (too large for localStorage), so the library rebuilds each
 * session; the shared camera is requested once and every Media node in camera
 * mode reuses the same stream.
 *
 * A recorded/prebaked clip is just a video item captured from a live canvas —
 * that's how a slow non-realtime effect is "prebaked": record its output once,
 * then play the clip back at full speed.
 */
import { reactive } from 'vue'

let idSeq = 1
export const mediaLibrary = reactive([]) // { id, name, kind:'image'|'video', url, thumb, recorded }

export function addMediaFile(file) {
  const kind = file.type.startsWith('video') ? 'video' : 'image'
  const url = URL.createObjectURL(file)
  const item = { id: idSeq++, name: file.name || `${kind} ${idSeq}`, kind, url, recorded: false }
  mediaLibrary.push(item)
  makeThumb(item)
  return item
}

export function addRecordedClip(blob, name) {
  const url = URL.createObjectURL(blob)
  const item = { id: idSeq++, name: name || `clip ${idSeq}`, kind: 'video', url, recorded: true }
  mediaLibrary.push(item)
  makeThumb(item)
  return item
}

export function removeMedia(id) {
  const i = mediaLibrary.findIndex((m) => m.id === id)
  if (i < 0) return
  try {
    URL.revokeObjectURL(mediaLibrary[i].url)
  } catch {}
  mediaLibrary.splice(i, 1)
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
