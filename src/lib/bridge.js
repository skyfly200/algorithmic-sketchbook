// Where the UI points people for the Sketchbook Bridge, the local helper that
// receives Art-Net and phone / OSC input for the browser (bridge/, packaged by
// scripts/package-bridge.mjs; the Bridge release workflow publishes the zips).
export const BRIDGE_DOWNLOAD_URL = 'https://github.com/skyfly200/algorithmic-sketchbook/releases'
export const BRIDGE_DOCS_ROUTE = { name: 'docs', params: { page: 'bridge' } }

// Input sources that only arrive through the bridge.
export const needsBridge = (source) => typeof source === 'string' && (source.startsWith('artnet.') || source.startsWith('remote.'))
