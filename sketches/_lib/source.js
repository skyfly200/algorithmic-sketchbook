/**
 * Shared image/video source for effect sketches.
 *
 * The "filter" sketches (motion extraction, pointillism, camera lens, rain on a
 * window …) all need the same thing: something to process. This module gives
 * them one pipeline for it so the acquisition code lives in exactly one place:
 *
 *   - the device camera (getUserMedia),
 *   - an uploaded / drag-dropped image or video,
 *   - a built-in animated demo scene (so nothing is ever blank), and
 *   - the Mixer/Patch feed — when the sketch is a layer, the parent streams the
 *     composite of the layers below as `mixer:frame` bitmaps, auto-selected so
 *     the effect processes what's beneath it with no camera needed.
 *
 * Usage:
 *   const src = createSource({ demo: (ctx, t, w, h) => {…} }) // demo optional
 *   if (src.ready) { src.update(t); src.draw(ctx, w, h, { mirror: true }) }
 *   src.width / src.height   // current source dimensions
 *   src.kind                 // 'camera'|'image'|'video'|'demo'|'mixer'|null
 *   src.version              // bumps whenever the picture changes (skip work if unchanged)
 *   src.cycleDemo()          // next built-in demo scene (also: press D, or ?demo=<name|index>)
 *
 * It wires a chooser overlay if the page has one (#chooser with #use-camera,
 * #use-upload, #use-demo, #file-input), and accepts a file dropped anywhere.
 */

import { DEMOS } from './demos.js'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createSource(opts = {}) {
  const preview = new URLSearchParams(location.search).get('preview') === '1'
  const chooser = document.getElementById('chooser')

  const state = {
    el: null, // <video> | <img> | <canvas>
    w: 0,
    h: 0,
    kind: null, // 'camera' | 'image' | 'video' | 'demo' | 'mixer'
    version: 0, // bumps whenever the picture changes
  }

  // Demo scene lives on its own canvas so `update()` can repaint it.
  const demoCanvas = document.createElement('canvas')
  demoCanvas.width = opts.demoWidth ?? 1280
  demoCanvas.height = opts.demoHeight ?? 720
  const demoCtx = demoCanvas.getContext('2d')
  // Built-in scenes (landscape / test chart / night city); a sketch can still
  // pass its own `demo` painter, which replaces them.
  const scenes = opts.demo ? [{ name: 'custom', make: () => opts.demo }] : DEMOS
  const wanted = new URLSearchParams(location.search).get('demo')
  let demoIdx = 0
  if (wanted != null) {
    const byName = scenes.findIndex((sc) => sc.name.toLowerCase().replace(/\s+/g, '-') === wanted.toLowerCase())
    demoIdx = byName >= 0 ? byName : clamp(parseInt(wanted, 10) || 0, 0, scenes.length - 1)
  }
  let demoPaint = scenes[demoIdx].make()
  function cycleDemo() {
    demoIdx = (demoIdx + 1) % scenes.length
    demoPaint = scenes[demoIdx].make()
    state.version++
    return scenes[demoIdx].name
  }
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|textarea|select/i.test(e.target?.tagName || '')) cycleDemo()
  })

  let mixerCanvas = null

  function hideChooser() {
    if (chooser) chooser.style.display = 'none'
  }

  function set(el, w, h, kind) {
    state.el = el
    state.w = w
    state.h = h
    state.kind = kind
    state.version++
    watchVideo(el)
    hideChooser()
    updateFlipBtn?.()
    opts.onSource?.(kind)
  }

  // Video-like sources bump the version on each decoded frame where the browser
  // can tell us (requestVideoFrameCallback); otherwise update() bumps it.
  let rvfc = false
  function watchVideo(el) {
    rvfc = false
    if (el instanceof HTMLVideoElement && typeof el.requestVideoFrameCallback === 'function') {
      rvfc = true
      const tick = () => {
        if (state.el !== el) return
        state.version++
        el.requestVideoFrameCallback(tick)
      }
      el.requestVideoFrameCallback(tick)
    }
  }

  function useDemo() {
    set(demoCanvas, demoCanvas.width, demoCanvas.height, 'demo')
  }

  let camStream = null
  let facing = 'user' // 'user' (front) | 'environment' (back)
  async function useCamera(facingMode = facing) {
    // Release any camera we already hold before opening another (a device can
    // only stream one facing at a time, and leaked tracks keep the light on).
    if (camStream) for (const t of camStream.getTracks()) t.stop()
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode },
    })
    facing = facingMode
    const video = document.createElement('video')
    video.srcObject = camStream
    video.muted = true
    video.playsInline = true
    await video.play()
    set(video, video.videoWidth, video.videoHeight, 'camera')
    updateFlipBtn()
  }
  // Flip between the front and rear cameras (mainly for phones/tablets).
  function flipCamera() {
    return useCamera(facing === 'user' ? 'environment' : 'user')
  }
  // A small floating "flip camera" button, shown only while a camera is live.
  let flipBtn = null
  function updateFlipBtn() {
    if (preview) return
    const live = state.kind === 'camera'
    if (live && !flipBtn) {
      flipBtn = document.createElement('button')
      flipBtn.textContent = '🔄 flip'
      flipBtn.title = 'Switch between the front and back camera'
      flipBtn.style.cssText =
        'position:fixed;left:96px;bottom:12px;z-index:9;font:13px system-ui,sans-serif;' +
        'color:#fff;cursor:pointer;padding:7px 14px;border-radius:999px;' +
        'background:rgba(20,22,30,0.7);border:1px solid rgba(255,255,255,0.25);backdrop-filter:blur(4px);'
      flipBtn.addEventListener('click', () => flipCamera().catch(() => {}))
      document.body.appendChild(flipBtn)
    }
    if (flipBtn) flipBtn.style.display = live ? 'block' : 'none'
  }

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      if (file.type.startsWith('image/')) {
        const img = new Image()
        img.onload = () => {
          set(img, img.naturalWidth, img.naturalHeight, 'image')
          resolve()
        }
        img.onerror = reject
        img.src = url
      } else {
        const video = document.createElement('video')
        video.src = url
        video.loop = true
        video.muted = true
        video.playsInline = true
        video.onloadeddata = async () => {
          try {
            await video.play()
          } catch {
            /* the click that opened the picker is our gesture; ignore */
          }
          set(video, video.videoWidth, video.videoHeight, 'video')
          resolve()
        }
        video.onerror = () => reject(new Error('decode failed'))
      }
    })
  }

  // Mixer/Patch feed: the parent posts the composite below this layer.
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.type !== 'mixer:frame' || !d.bitmap) return
    const bmp = d.bitmap
    if (!mixerCanvas) mixerCanvas = document.createElement('canvas')
    if (mixerCanvas.width !== bmp.width) mixerCanvas.width = bmp.width
    if (mixerCanvas.height !== bmp.height) mixerCanvas.height = bmp.height
    mixerCanvas.getContext('2d').drawImage(bmp, 0, 0)
    bmp.close?.()
    set(mixerCanvas, mixerCanvas.width, mixerCanvas.height, 'mixer')
  })

  // Wire the chooser overlay, if the page has one.
  if (chooser) {
    const fileInput = document.getElementById('file-input')
    const uploadBtn = document.getElementById('use-upload')
    uploadBtn?.addEventListener('click', () => fileInput?.click())
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      try {
        await loadFile(file)
      } catch {
        const p = chooser.querySelector('p')
        if (p) p.textContent = 'Could not load that file — try another photo or video.'
      }
    })
    const wire = (id, fn, msg) => {
      document.getElementById(id)?.addEventListener('click', async () => {
        try {
          await fn()
        } catch {
          const p = chooser.querySelector('p')
          if (p) p.textContent = msg
        }
      })
    }
    wire('use-camera', useCamera, 'Camera unavailable — try the demo or upload a file instead.')
    wire('use-demo', () => (state.kind === 'demo' ? cycleDemo() : useDemo()), 'Demo failed to start.')
  }

  // Accept a file dropped anywhere on the page.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    try {
      await loadFile(file)
    } catch {
      /* ignore */
    }
  })

  // Never sit blank: start the demo immediately. Rather than block the view
  // with a full-screen chooser, default straight to the demo and tuck
  // camera/upload behind a small unobtrusive "source" button (bottom-left).
  // Inside a preview iframe (Patch/Mixer/Autopilot) there's no chooser at all
  // — the compositor feeds the source.
  useDemo()
  hideChooser()
  if (!preview && chooser) {
    const btn = document.createElement('button')
    btn.textContent = '📷 source'
    btn.title = 'Choose a source — camera, a file, or the demo'
    btn.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:9;font:13px system-ui,sans-serif;' +
      'color:#fff;cursor:pointer;padding:7px 14px;border-radius:999px;' +
      'background:rgba(20,22,30,0.7);border:1px solid rgba(255,255,255,0.25);backdrop-filter:blur(4px);'
    btn.addEventListener('click', () => {
      chooser.style.display = chooser.style.display === 'none' ? 'flex' : 'none'
    })
    // clicking a chooser button also dismisses the overlay
    for (const b of chooser.querySelectorAll('button')) b.addEventListener('click', () => hideChooser())
    document.body.appendChild(btn)
  }

  return {
    get el() {
      return state.el
    },
    get width() {
      return state.w
    },
    get height() {
      return state.h
    },
    get kind() {
      return state.kind
    },
    get ready() {
      return !!state.el && state.w > 0 && state.h > 0
    },
    useDemo,
    useCamera,
    flipCamera,
    loadFile,
    hideChooser,

    // Repaint the demo scene (no-op unless the demo is the active source).
    update(t) {
      if (state.kind === 'demo') {
        demoPaint(demoCtx, t, demoCanvas.width, demoCanvas.height)
        state.version++
      } else if ((state.kind === 'camera' || state.kind === 'video') && !rvfc) {
        state.version++
      }
    },
    cycleDemo,
    get version() {
      return state.version
    },

    // Cover-fit the current source onto a target context sized (tw, th).
    // Mirror is a selfie convenience for the camera; the Mixer feed is never
    // flipped so it stays registered with the layers below.
    draw(ctx, tw, th, { mirror = false } = {}) {
      if (!this.ready) return
      const scale = Math.max(tw / state.w, th / state.h)
      const w = state.w * scale
      const h = state.h * scale
      const x = (tw - w) / 2
      const y = (th - h) / 2
      if (mirror && state.kind !== 'mixer') {
        ctx.save()
        ctx.translate(tw, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(state.el, x, y, w, h)
        ctx.restore()
      } else {
        ctx.drawImage(state.el, x, y, w, h)
      }
    },
  }
}

export { clamp }
