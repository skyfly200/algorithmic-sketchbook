/**
 * Motion bus — lets one sketch broadcast a per-frame image (e.g. the extracted
 * motion mask) so other same-origin sketches can consume it as a mask/layer.
 *
 * Built on BroadcastChannel, so publisher and subscriber can be in different
 * browser tabs/windows (or the gallery's separate sketch iframes) at once:
 *
 *   // in the source effect (e.g. motion-extraction):
 *   const bus = createMotionPublisher()
 *   bus.publish(maskCanvas)   // call each frame; it self-throttles
 *
 *   // in a consuming effect:
 *   const feed = createMotionSubscriber()
 *   // feed.canvas is an HTMLCanvasElement kept up to date with the latest
 *   // frame (or null until the first arrives); draw/sample it as a layer.
 */
const CHANNEL = 'bright-waves-motion'

export function createMotionPublisher({ fps = 20, width = 320, height = 180 } = {}) {
  const supported = 'BroadcastChannel' in window && 'createImageBitmap' in window
  const ch = supported ? new BroadcastChannel(CHANNEL) : null
  const minInterval = 1000 / fps
  let last = 0
  let busy = false

  return {
    supported,
    publish(source) {
      if (!ch || busy) return
      const now = performance.now()
      if (now - last < minInterval) return
      last = now
      busy = true
      // ImageBitmap is structured-cloneable, so BroadcastChannel can carry it.
      createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' })
        .then((bitmap) => {
          ch.postMessage({ bitmap, w: width, h: height })
          bitmap.close?.()
        })
        .catch(() => {})
        .finally(() => (busy = false))
    },
    close() {
      ch?.close()
    },
  }
}

export function createMotionSubscriber() {
  const supported = 'BroadcastChannel' in window
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const state = { supported, canvas, hasData: false, lastAt: 0 }
  if (!supported) return state

  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = (e) => {
    const { bitmap, w, h } = e.data || {}
    if (!bitmap) return
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close?.()
    state.hasData = true
    state.lastAt = performance.now()
  }
  state.close = () => ch.close()
  return state
}
