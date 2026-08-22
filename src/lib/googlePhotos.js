// Google Photos Picker API client. Lets a user pick photos/videos from their
// Google Photos and pull the bytes into the media library.
//
// SETUP (required, one-time — the app ships without credentials):
//   1. In Google Cloud, enable the "Photos Picker API".
//   2. Create an OAuth 2.0 Client ID (type: Web application) and add this app's
//      origin to the authorized JavaScript origins.
//   3. Put the client id in a `.env` file:  VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
//   4. Rebuild. The "Google Photos" button in a Media node then works.
//
// Flow (per the Picker API): get an access token via Google Identity Services,
// create a picker session, open its pickerUri for the user, poll the session
// until they finish selecting, list the picked items, then download each item's
// bytes with the bearer token.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const API = 'https://photospicker.googleapis.com/v1'

// The client id may come from a build-time env var or be set at runtime from
// Settings (so a static deploy can enable Google Photos without a rebuild).
let runtimeClientId = ''
export function setGooglePhotosClientId(id) { runtimeClientId = (id || '').trim() }
const cid = () => runtimeClientId || CLIENT_ID
export function googlePhotosConfigured() { return !!cid() }

let gisReady = null
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisReady) return gisReady
  gisReady = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { gisReady = null; reject(new Error('Could not load Google sign-in.')) }
    document.head.appendChild(s)
  })
  return gisReady
}

let tokenClient = null
let accessToken = ''
let pendingReject = null
function getToken() {
  return new Promise((resolve, reject) => {
    pendingReject = reject
    const cb = (resp) => {
      if (resp.error) reject(new Error(resp.error_description || resp.error))
      else { accessToken = resp.access_token; resolve(accessToken) }
    }
    if (!tokenClient) {
      // A stable error_callback (routed to the current call's reject) means a
      // closed or blocked consent popup fails fast instead of leaving the caller
      // to retry — the usual cause of the sign-in "looping".
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cid(), scope: SCOPE, callback: cb,
        error_callback: (err) => pendingReject?.(new Error(
          err?.type === 'popup_closed' ? 'Sign-in was closed before finishing.'
            : err?.type === 'popup_failed_to_open' ? 'Sign-in popup was blocked — allow pop-ups for this site.'
              : (err?.message || 'Google sign-in failed — check the client ID and that this site’s origin is an Authorized JavaScript origin.'),
        )),
      })
    } else {
      tokenClient.callback = cb
    }
    // Don't force prompt:'consent' every time — GIS re-prompts on its own only
    // when it actually needs to, so a granted app won't re-ask on each import.
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

async function api(path, opts = {}) {
  const r = await fetch(`${API}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  if (!r.ok) throw new Error(`Google Photos API returned ${r.status}`)
  return r.status === 204 ? {} : r.json()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const secs = (s, fallback) => (s ? parseFloat(String(s).replace('s', '')) : 0) || fallback

// Sign in, open the picker, wait for the user, download the picks.
// onStatus(msg) reports progress. Returns [{ blob, name, kind }].
export async function pickFromGooglePhotos(onStatus = () => {}) {
  if (!cid()) throw new Error('Add a Google client ID in Settings to enable Google Photos.')
  await loadGis()
  onStatus('Waiting for Google sign-in')
  await getToken()

  onStatus('Opening the Google Photos picker')
  const session = await api('sessions', { method: 'POST', body: '{}' })
  // Open WITHOUT noopener so a blocked popup returns null and we can report it
  // (rather than silently polling a session the user never sees).
  const win = window.open(session.pickerUri, '_blank')
  if (!win) throw new Error('The picker pop-up was blocked — allow pop-ups for this site and try again.')

  // poll the session until the user finishes selecting
  const interval = secs(session.pollingConfig?.pollInterval, 2)
  const timeout = secs(session.pollingConfig?.timeoutIn, 600)
  const deadline = Date.now() + timeout * 1000
  let set = !!session.mediaItemsSet
  while (!set) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a selection.')
    await sleep(Math.max(1, interval) * 1000)
    set = !!(await api(`sessions/${session.id}`)).mediaItemsSet
  }

  onStatus('Downloading')
  const items = []
  let pageToken = ''
  do {
    const q = `mediaItems?sessionId=${encodeURIComponent(session.id)}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`
    const page = await api(q)
    for (const it of page.mediaItems || []) items.push(it)
    pageToken = page.nextPageToken || ''
  } while (pageToken)

  const out = []
  for (const it of items) {
    const mf = it.mediaFile || {}
    const isVideo = it.type === 'VIDEO' || (mf.mimeType || '').startsWith('video')
    try {
      const r = await fetch(`${mf.baseUrl}=${isVideo ? 'dv' : 'd'}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!r.ok) continue
      out.push({ blob: await r.blob(), name: mf.filename || `photo-${out.length + 1}`, kind: isVideo ? 'video' : 'image' })
    } catch { /* skip a failed item */ }
  }
  try { await api(`sessions/${session.id}`, { method: 'DELETE' }) } catch { /* best-effort cleanup */ }
  onStatus('')
  return out
}
