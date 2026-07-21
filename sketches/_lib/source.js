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
 *
 * It wires a chooser overlay if the page has one (#chooser with #use-camera,
 * #use-upload, #use-demo, #file-input), and accepts a file dropped anywhere.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// The default demo: soft drifting colour blobs over a warm gradient — a scene
// with smooth tone and a few hard edges, which flatters most filters.
function defaultDemo(rand = Math.random) {
  const blobs = Array.from({ length: 7 }, (_, i) => ({
    x: rand(),
    y: rand(),
    r: 0.18 + rand() * 0.22,
    hue: (i * 47 + rand() * 30) % 360,
    px: rand() * Math.PI * 2,
    py: rand() * Math.PI * 2,
    sx: 0.4 + rand() * 0.5,
    sy: 0.4 + rand() * 0.5,
  }))
  return (d, t, W, H) => {
    const g = d.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#12203a')
    g.addColorStop(0.55, '#3a2a55')
    g.addColorStop(1, '#6a3f4a')
    d.fillStyle = g
    d.fillRect(0, 0, W, H)
    d.globalCompositeOperation = 'lighter'
    for (const b of blobs) {
      const cx = (b.x + 0.12 * Math.sin(t * b.sx + b.px)) * W
      const cy = (b.y + 0.12 * Math.cos(t * b.sy + b.py)) * H
      const rr = b.r * H
      const rg = d.createRadialGradient(cx, cy, 0, cx, cy, rr)
      rg.addColorStop(0, `hsla(${b.hue}, 85%, 62%, 0.9)`)
      rg.addColorStop(1, 'hsla(0, 0%, 0%, 0)')
      d.fillStyle = rg
      d.beginPath()
      d.arc(cx, cy, rr, 0, Math.PI * 2)
      d.fill()
    }
    d.fillStyle = 'rgba(255, 224, 170, 0.9)'
    d.beginPath()
    d.arc(W * 0.75, H * 0.28, H * 0.085, 0, Math.PI * 2)
    d.fill()
    d.globalCompositeOperation = 'source-over'
  }
}

export function createSource(opts = {}) {
  const preview = new URLSearchParams(location.search).get('preview') === '1'
  const chooser = document.getElementById('chooser')

  const state = {
    el: null, // <video> | <img> | <canvas>
    w: 0,
    h: 0,
    kind: null, // 'camera' | 'image' | 'video' | 'demo' | 'mixer'
  }

  // Demo scene lives on its own canvas so `update()` can repaint it.
  const demoCanvas = document.createElement('canvas')
  demoCanvas.width = opts.demoWidth ?? 960
  demoCanvas.height = opts.demoHeight ?? 540
  const demoCtx = demoCanvas.getContext('2d')
  const demoPaint = opts.demo ?? defaultDemo()

  let mixerCanvas = null

  function hideChooser() {
    if (chooser) chooser.style.display = 'none'
  }

  function set(el, w, h, kind) {
    state.el = el
    state.w = w
    state.h = h
    state.kind = kind
    hideChooser()
    opts.onSource?.(kind)
  }

  function useDemo() {
    set(demoCanvas, demoCanvas.width, demoCanvas.height, 'demo')
  }

  async function useCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()
    set(video, video.videoWidth, video.videoHeight, 'camera')
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
    wire('use-demo', useDemo, 'Demo failed to start.')
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
    loadFile,
    hideChooser,

    // Repaint the demo scene (no-op unless the demo is the active source).
    update(t) {
      if (state.kind === 'demo') demoPaint(demoCtx, t, demoCanvas.width, demoCanvas.height)
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
