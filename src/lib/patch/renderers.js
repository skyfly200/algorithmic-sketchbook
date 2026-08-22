// The Patch compositor's per-node-type renderers, lifted out of PatchView. Each
// draws one node into its offscreen ctx (octx of runtime state s) at the current
// compositor size (W, H, passed per frame). The view's live helpers — reading an
// upstream frame, cover-fitting, modulated params, media/sprite/text sources —
// are injected once via createRenderers(deps); the framework-free colour/shape
// utilities are imported directly. geo/vcam/geodata keep their own evaluators in
// the view and are merged into the dispatch map there.
import { hsvCss } from './geometry.js'
import { portalShapePath, polyPath } from './shapes.js'
import { ASPECTS, TYPES } from './constants.js'
import { sharedCameraStream } from '../../stores/media.js'

export function createRenderers({ cover, inputCanvas, pval, mediaEl, spriteImg, textSequence, inputValue, clamp }) {
  function renderEffect(node, octx, s) {
    try {
      const cv = s.iframe?.contentDocument?.querySelector('canvas')
      if (cv && cv.width) cover(octx, cv, cv.width, cv.height)
    } catch { /* cross-origin / not ready */ }
  }
  function renderFilter(node, octx, s) {
    // Feed the upstream frame into the filter sketch as its mixer:frame source
    // (the shared source pipeline auto-selects it), then capture its canvas.
    const input = inputCanvas(node, 0)
    if (input && s.iframe?.contentWindow && !s.feeding) {
      s.feeding = true
      createImageBitmap(input)
        .then((bmp) => { s.iframe?.contentWindow?.postMessage({ type: 'mixer:frame', bitmap: bmp }, '*', [bmp]) })
        .catch(() => {})
        .finally(() => (s.feeding = false))
    }
    try {
      const cv = s.iframe?.contentDocument?.querySelector('canvas')
      if (cv && cv.width) cover(octx, cv, cv.width, cv.height)
    } catch { /* not ready */ }
  }
  function renderMedia(node, octx) {
    const el = mediaEl(node)
    if (el) {
      if (el.tagName === 'VIDEO' && el.videoWidth) cover(octx, el, el.videoWidth, el.videoHeight)
      else if (el.tagName === 'IMG' && el.naturalWidth) cover(octx, el, el.naturalWidth, el.naturalHeight)
      else if (el.tagName === 'CANVAS') cover(octx, el, el.width, el.height)
    }
  }
  function renderText(node, octx, s, W, H) {
    const p = node.params
    // numeric params read through pval() so wired inputs modulate them live
    const hue = pval(node, 'hue')
    // lyrics/text-over-time sequencing (null when off): overrides the drawn
    // string and adds an entrance/exit transform + alpha
    const seq = textSequence(node)
    if (p.bg) { octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H) }
    else octx.clearRect(0, 0, W, H)
    const px = Math.max(4, pval(node, 'size') * H)
    octx.save()
    octx.translate(pval(node, 'x') * W, pval(node, 'y') * H)
    if (seq) { octx.translate(seq.dx * W, seq.dy * H); if (seq.scale !== 1) octx.scale(seq.scale, seq.scale) }
    octx.rotate(((pval(node, 'rotate') ?? 0) * Math.PI) / 180)
    octx.font = `${p.italic ? 'italic ' : ''}${Math.round(pval(node, 'weight'))} ${px}px "${pval(node, 'font') || 'sans-serif'}"`
    octx.textAlign = 'center'
    octx.textBaseline = 'middle'
    octx.globalAlpha = seq ? Math.max(0, Math.min(1, seq.alpha)) : 1
    octx.fillStyle = hsvCss(hue, p.sat ?? 82, p.val ?? 96)
    if (p.glow > 0.01) { octx.shadowColor = hsvCss(hue, 100, 100); octx.shadowBlur = px * 0.4 * p.glow }
    // letter-spacing (tracking) drawn glyph-by-glyph; multiple lines stacked
    const track = (pval(node, 'tracking') ?? 0) * px
    const lines = String((seq ? seq.text : p.text) ?? '').split('\n')
    const lineH = px * 1.18
    const top = -(lineH * (lines.length - 1)) / 2
    lines.forEach((line, li) => {
      const y = top + li * lineH
      let total = 0
      for (const ch of line) total += octx.measureText(ch).width + track
      total -= track
      let cx = -total / 2
      for (const ch of line) {
        const w = octx.measureText(ch).width
        octx.fillText(ch, cx + w / 2, y)
        cx += w + track
      }
    })
    octx.restore()
    octx.shadowBlur = 0
  }
  function renderSprite(node, octx, s, W, H) {
    // A loaded image / sprite-sheet placed in the frame. Transparent background
    // so it composites over other layers; position/size/rotation/opacity read
    // through pval() (control-mappable), plus a built-in motion preset over time.
    octx.clearRect(0, 0, W, H)
    const img = spriteImg(node)
    if (img && img.complete && img.naturalWidth) {
      const p = node.params
      const t = performance.now() / 1000
      let x = pval(node, 'x'), y = pval(node, 'y')
      let scl = pval(node, 'scale'), rot = pval(node, 'rotate') ?? 0
      const op = pval(node, 'opacity') ?? 1
      const sp = p.speed ?? 0.5, amp = p.amp ?? 0.2
      if (p.motion === 'Drift') { x += Math.sin(t * sp) * amp; y += Math.cos(t * sp * 0.7) * amp }
      else if (p.motion === 'Orbit') { x += Math.cos(t * sp) * amp; y += Math.sin(t * sp) * amp }
      else if (p.motion === 'Bounce') { y += (Math.abs(Math.sin(t * sp * 2)) - 0.5) * amp * 2 }
      else if (p.motion === 'Float') { y += Math.sin(t * sp) * amp; rot += Math.sin(t * sp * 0.6) * 10 }
      else if (p.motion === 'Spin') { rot += t * sp * 90 }
      rot += (p.spin ?? 0) * t * 90
      const cols = Math.max(1, Math.round(p.cols || 1)), rows = Math.max(1, Math.round(p.rows || 1))
      const frames = cols * rows
      const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows
      const fi = frames > 1 ? Math.floor(t * (p.fps || 12)) % frames : 0
      const sx = (fi % cols) * fw, sy = Math.floor(fi / cols) * fh
      const drawH = Math.max(1, scl * H), drawW = drawH * (fw / fh)
      octx.save()
      octx.globalAlpha = Math.max(0, Math.min(1, op))
      octx.translate(x * W, y * H)
      octx.rotate((rot * Math.PI) / 180)
      octx.imageSmoothingEnabled = true
      octx.drawImage(img, sx, sy, fw, fh, -drawW / 2, -drawH / 2, drawW, drawH)
      octx.restore()
      octx.globalAlpha = 1
    }
  }
  function renderPortal(node, octx, s, W, H) {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
    const p = node.params
    const sx = pval(node, 'srcX') * W, sy = pval(node, 'srcY') * H, sw = pval(node, 'srcW') * W, sh = pval(node, 'srcH') * H
    const dx = pval(node, 'dstX') * W, dy = pval(node, 'dstY') * H
    let dw = pval(node, 'dstW') * W
    let dh = pval(node, 'dstH') * H
    // Lock proportions: derive the destination height from its width so the
    // portal keeps a chosen aspect ratio (in real pixels).
    if (p.lockAspect) dh = dw / (ASPECTS[p.aspect] ?? 1)
    // remap the source region into the destination region, optionally
    // recursively so the portal shows a portal showing a portal…
    const times = Math.max(1, Math.round(p.recurse ?? 1))
    for (let k = 0; k < times; k++) {
      octx.save()
      portalShapePath(octx, p.shape ?? 'rectangle', dx, dy, dw, dh)
      octx.clip()
      octx.drawImage(s.out, sx, sy, sw, sh, dx, dy, dw, dh)
      octx.restore()
    }
    if (p.border) {
      octx.strokeStyle = 'rgba(138,208,255,0.8)'
      octx.lineWidth = Math.max(1, W * 0.003)
      portalShapePath(octx, p.shape ?? 'rectangle', dx, dy, dw, dh)
      octx.stroke()
    }
  }
  function renderMask(node, octx, s, W, H) {
    // A luma matte, NOT a blend: the matte input's brightness becomes an alpha
    // channel that reveals/hides the content. (Mixing two pictures is Blend's
    // job — this cuts one picture to a shape/gradient.) The matte is keyed at a
    // capped resolution for cheap per-frame luma→alpha conversion.
    const content = inputCanvas(node, 0)
    const mask = inputCanvas(node, 1)
    if (content) octx.drawImage(content, 0, 0, W, H)
    if (content && mask) {
      // Key the matte near the output resolution so crisp vector mattes (a Text
      // outline, a Polygon) stay sharp — a low cap made their edges pixelated
      // once upscaled. Still bounded so a huge native canvas can't stall.
      const mw = Math.min(1280, W), mh = Math.max(1, Math.round((mw * H) / W))
      const t = s.matte || (s.matte = document.createElement('canvas'))
      if (t.width !== mw || t.height !== mh) { t.width = mw; t.height = mh }
      const tx = s.matteCtx || (s.matteCtx = t.getContext('2d', { willReadFrequently: true }))
      tx.clearRect(0, 0, mw, mh)
      tx.drawImage(mask, 0, 0, mw, mh)
      try {
        const img = tx.getImageData(0, 0, mw, mh)
        const d = img.data
        const inv = !!node.params.invert
        const strength = node.params.strength ?? 1
        for (let i = 0; i < d.length; i += 4) {
          let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
          if (inv) l = 1 - l
          // strength dials how hard the matte cuts (0 = passes everything through)
          const a = strength * l + (1 - strength)
          d[i] = d[i + 1] = d[i + 2] = 255
          d[i + 3] = Math.round(a * 255)
        }
        tx.putImageData(img, 0, 0)
        octx.globalCompositeOperation = 'destination-in'
        octx.drawImage(t, 0, 0, W, H)
        octx.globalCompositeOperation = 'source-over'
      } catch { /* tainted matte */ }
    }
  }
  function renderPolygon(node, octx, s, W, H) {
    // A matte-shape SOURCE: a white editable polygon on black. Vertices live in
    // node.params.points (normalized [x,y]); drag them on the output. Wire this
    // node's output into a Mask node's matte input to cut a picture to the
    // shape (the Mask node's own "invert matte" flips it — projection mapping).
    const feather = pval(node, 'feather') || 0
    octx.fillStyle = '#fff'
    if (feather > 0.001) octx.filter = `blur(${feather * 0.12 * Math.min(W, H)}px)`
    if (node.params.svg?.d) {
      // an imported SVG matte: fit its bbox into the frame (even-odd for holes)
      const { d, bbox } = node.params.svg
      const scale = 0.9 * Math.min(W / bbox.w, H / bbox.h)
      const dx = (W - bbox.w * scale) / 2 - bbox.x * scale
      const dy = (H - bbox.h * scale) / 2 - bbox.y * scale
      octx.save()
      octx.setTransform(scale, 0, 0, scale, dx, dy)
      try { octx.fill(new Path2D(d), 'evenodd') } catch { /* malformed path */ }
      octx.restore()
    } else {
      const pts = node.params.points || []
      if (pts.length >= 3) { polyPath(octx, pts, false, W, H); octx.fill('nonzero') }
    }
    octx.filter = 'none'
  }
  function renderBlend(node, octx, s, W, H) {
    // "swap" flips which input is the base and which is composited on top.
    const a = inputCanvas(node, node.params.swap ? 1 : 0)
    const b = inputCanvas(node, node.params.swap ? 0 : 1)
    if (a) octx.drawImage(a, 0, 0, W, H)
    if (b) {
      octx.globalCompositeOperation = node.params.mode === 'add' ? 'lighter' : node.params.mode === 'normal' ? 'source-over' : node.params.mode
      octx.globalAlpha = pval(node, 'mix') ?? 1 // top input's contribution (modulated)
      octx.drawImage(b, 0, 0, W, H)
      octx.globalAlpha = 1
      octx.globalCompositeOperation = 'source-over'
    }
  }
  function renderOutput(node, octx, s, W, H) {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
  }
  function renderInput(node, octx, s, W, H) {
    // A VU-style meter of the control value the node is emitting.
    const v = inputValue(node, performance.now())
    octx.fillStyle = '#0c0e14'
    octx.fillRect(0, 0, W, H)
    octx.fillStyle = TYPES.input.color
    octx.fillRect(0, H * (1 - v), W, H * v)
    octx.fillStyle = 'rgba(255,255,255,0.9)'
    octx.font = `${Math.round(H * 0.16)}px system-ui, sans-serif`
    octx.fillText(node.params.source, W * 0.03, H * 0.22)
    octx.fillText(v.toFixed(2), W * 0.03, H * 0.95)
  }
  function renderXY(node, octx, s, W, H) {
    // Touch surface: the thumbnail *is* the pad — drag on it to set x/y.
    const x = node.params.x * W
    const y = (1 - node.params.y) * H
    octx.fillStyle = '#0c0e14'
    octx.fillRect(0, 0, W, H)
    octx.strokeStyle = 'rgba(224,160,96,0.25)'
    octx.lineWidth = Math.max(1, H / 108)
    for (let i = 1; i < 4; i++) {
      octx.beginPath(); octx.moveTo((W * i) / 4, 0); octx.lineTo((W * i) / 4, H); octx.stroke()
      octx.beginPath(); octx.moveTo(0, (H * i) / 4); octx.lineTo(W, (H * i) / 4); octx.stroke()
    }
    octx.strokeStyle = TYPES.xy.color
    octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, H); octx.stroke()
    octx.beginPath(); octx.moveTo(0, y); octx.lineTo(W, y); octx.stroke()
    octx.fillStyle = TYPES.xy.color
    octx.beginPath(); octx.arc(x, y, H * 0.06, 0, Math.PI * 2); octx.fill()
    octx.fillStyle = 'rgba(255,255,255,0.85)'
    octx.font = `${Math.round(H * 0.14)}px system-ui, sans-serif`
    octx.fillText(`${node.params.x.toFixed(2)}, ${node.params.y.toFixed(2)}`, W * 0.03, H * 0.95)
  }
  function renderTracker(node, octx, s, W, H) {
    // Camera/video tracking: find the brightest region of the input, emit its
    // smoothed x / y and apparent size (a stand-in for depth — nearer = bigger).
    // With nothing wired in, fall back to the live shared camera so a bare
    // Tracker node just works once the webcam is on.
    let input = inputCanvas(node, 0)
    if (!input) {
      const stream = sharedCameraStream()
      if (stream) {
        if (!s.camVid || s.camVid.srcObject !== stream) {
          const v = document.createElement('video')
          v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream
          v.play().catch(() => {})
          s.camVid = v
        }
        if (s.camVid.videoWidth) input = s.camVid
      }
    }
    if (input) {
      octx.drawImage(input, 0, 0, W, H)
      if (!s.tinyT) {
        s.tinyT = document.createElement('canvas')
        s.tinyT.width = 48
        s.tinyT.height = 27
        s.tinyTx = s.tinyT.getContext('2d', { willReadFrequently: true })
        s.track = { x: 0.5, y: 0.5, z: 0 }
      }
      s.tinyTx.drawImage(input, 0, 0, 48, 27)
      try {
        const d = s.tinyTx.getImageData(0, 0, 48, 27).data
        const th = (node.params.thresh ?? 0.5) * 255
        let sx = 0, sy = 0, sw = 0
        for (let yy = 0; yy < 27; yy++) {
          for (let xx = 0; xx < 48; xx++) {
            const i = (yy * 48 + xx) * 4
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
            if (l > th) {
              const w = l - th
              sx += xx * w
              sy += yy * w
              sw += w
            }
          }
        }
        const sm = node.params.smooth ?? 0.7
        if (sw > 0) {
          const nx = sx / sw / 48
          const ny = 1 - sy / sw / 27
          const nz = clamp(sw / (48 * 27 * (255 - th) * 0.25), 0, 1)
          s.track.x = s.track.x * sm + nx * (1 - sm)
          s.track.y = s.track.y * sm + ny * (1 - sm)
          s.track.z = s.track.z * sm + nz * (1 - sm)
        } else {
          s.track.z *= sm // lost the target: size decays, position holds
        }
      } catch { /* tainted input */ }
      // Crosshair overlay at the tracked point, ring sized by z.
      const tx = s.track.x * W
      const ty = (1 - s.track.y) * H
      octx.strokeStyle = TYPES.tracker.color
      octx.lineWidth = Math.max(1.5, H / 80)
      octx.beginPath(); octx.moveTo(tx - W * 0.04, ty); octx.lineTo(tx + W * 0.04, ty); octx.stroke()
      octx.beginPath(); octx.moveTo(tx, ty - W * 0.04); octx.lineTo(tx, ty + W * 0.04); octx.stroke()
      octx.beginPath(); octx.arc(tx, ty, Math.max(2, s.track.z * H * 0.45), 0, Math.PI * 2); octx.stroke()
    } else {
      octx.fillStyle = '#0c0e14'
      octx.fillRect(0, 0, W, H)
      octx.fillStyle = 'rgba(255,255,255,0.5)'
      octx.font = `${Math.round(H * 0.13)}px system-ui, sans-serif`
      octx.fillText('wire a camera / video input', W * 0.06, H * 0.5)
    }
  }
  return {
    effect: renderEffect, filter: renderFilter, media: renderMedia, text: renderText,
    sprite: renderSprite, portal: renderPortal, mask: renderMask, polygon: renderPolygon,
    blend: renderBlend, output: renderOutput, input: renderInput, xy: renderXY, tracker: renderTracker,
  }
}
