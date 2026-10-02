// Neural image upscaler (main-thread driver). The model runs in worker.js; this cuts the
// picture into overlapping tiles (tiles.js), feeds them through the worker one at a time,
// and stitches the results into one canvas / PNG. Images only: running a model per video
// frame is far too slow to be useful.
import { planTiles, checkOutput, estimateRemaining } from './tiles.js'

// Swin2SR models from Hugging Face (Xenova ports, ONNX). `size` is the quantized download.
export const MODELS = [
  { id: 'fast', repo: 'Xenova/swin2SR-lightweight-x2-64', scale: 2, label: 'Fast ×2', size: '7 MB', note: 'Lightweight. Best for clean images.' },
  { id: 'quality', repo: 'Xenova/swin2SR-classical-sr-x2-64', scale: 2, label: 'Quality ×2', size: 'about 21 MB', note: 'Larger network, cleaner detail, several times slower.' },
  { id: 'photo', repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', scale: 4, label: 'Photo restore ×4', size: 'about 19 MB', note: 'Trained on noisy, compressed real-world photos. The slowest.' },
]
export const modelById = (id) => MODELS.find((m) => m.id === id) ?? MODELS[0]

export const TILE = 64
export const OVERLAP = 8

export const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' })

/** Read the pixel size of an image Blob / File without keeping it around. */
export async function imageSize(blob) {
  const bmp = await createImageBitmap(blob)
  const size = { width: bmp.width, height: bmp.height }
  bmp.close()
  return size
}

// A tile canvas for input rect t. Where the rect hangs over the image edge (a small image padded
// to a model-friendly size) the last row / column is repeated.
function cutTile(src, t) {
  const c = document.createElement('canvas')
  c.width = t.w
  c.height = t.h
  const x = c.getContext('2d', { willReadFrequently: true })
  const cw = Math.min(t.w, src.width - t.x)
  const ch = Math.min(t.h, src.height - t.y)
  x.drawImage(src, t.x, t.y, cw, ch, 0, 0, cw, ch)
  if (cw < t.w) x.drawImage(c, cw - 1, 0, 1, ch, cw, 0, t.w - cw, ch)
  if (ch < t.h) x.drawImage(c, 0, ch - 1, t.w, 1, 0, ch, t.w, t.h - ch)
  return x.getImageData(0, 0, t.w, t.h)
}

/**
 * Upscale one image.
 * @param {Blob|File} blob
 * @param {{ model?: string, signal?: AbortSignal, onStatus?: (s: object) => void }} opts
 *   onStatus gets { phase: 'load'|'run'|'finish', loadProgress, device, tilesDone, tilesTotal, etaMs }
 * @returns {Promise<{ blob: Blob, width: number, height: number, device: string, ms: number }>}
 */
export async function upscaleImage(blob, { model = 'fast', signal, onStatus } = {}) {
  const m = modelById(model)
  const bmp = await createImageBitmap(blob)
  const W = bmp.width
  const H = bmp.height
  const limit = checkOutput(W, H, m.scale)
  if (!limit.ok) { bmp.close(); throw new Error(limit.reason) }
  if (signal?.aborted) { bmp.close(); throw abortError() }

  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sctx = src.getContext('2d', { willReadFrequently: true })
  sctx.drawImage(bmp, 0, 0)
  bmp.close()

  // The model only sees RGB; carry any transparency over separately with a plain resample.
  const px = sctx.getImageData(0, 0, W, H).data
  let hasAlpha = false
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { hasAlpha = true; break }

  const out = document.createElement('canvas')
  out.width = limit.width
  out.height = limit.height
  const octx = out.getContext('2d')
  const tiles = planTiles(W, H, { tile: TILE, overlap: OVERLAP })

  const t0 = performance.now()
  let device = 'wasm'
  let tile = 0
  // One worker at a time. If WebGPU fails the worker is replaced by a WASM one and carries on
  // from the current tile.
  const run = (gpu) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    const done = (fn, v) => { signal?.removeEventListener('abort', onAbort); worker.terminate(); fn(v) }
    const onAbort = () => done(reject, abortError())
    signal?.addEventListener('abort', onAbort, { once: true })
    let tileStart = 0
    let runStart = 0
    worker.onerror = (e) => done(reject, new Error(e.message || 'The upscaler worker failed to start'))
    const status = (extra) => onStatus?.({ phase: 'run', device, tilesDone: tile, tilesTotal: tiles.length, ...extra })
    const next = () => {
      if (tile >= tiles.length) { done(resolve); return }
      const t = tiles[tile]
      const img = cutTile(src, t)
      tileStart = performance.now()
      worker.postMessage({ type: 'tile', id: tile, w: t.w, h: t.h, rgba: img.data.buffer }, [img.data.buffer])
    }
    worker.onmessage = (e) => {
      const d = e.data
      if (d.type === 'load') { if (d.status === 'progress') onStatus?.({ phase: 'load', device, loadProgress: d.progress, file: d.file }) }
      else if (d.type === 'ready') { device = d.device; runStart = performance.now(); status({ etaMs: null }); next() }
      else if (d.type === 'error') {
        if (d.gpu) { worker.terminate(); signal?.removeEventListener('abort', onAbort); run(false).then(resolve, reject) } // WebGPU failed: use WASM
        else done(reject, new Error(d.message))
      } else if (d.type === 'tile') {
        const t = tiles[d.id]
        const piece = document.createElement('canvas')
        piece.width = d.w
        piece.height = d.h
        piece.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.rgba), d.w, d.h), 0, 0)
        const s = m.scale
        octx.drawImage(piece, (t.keep.x - t.x) * s, (t.keep.y - t.y) * s, t.keep.w * s, t.keep.h * s, t.keep.x * s, t.keep.y * s, t.keep.w * s, t.keep.h * s)
        tile++
        status({ etaMs: estimateRemaining(tile, tiles.length, performance.now() - runStart), lastTileMs: Math.round(performance.now() - tileStart) })
        next()
      }
    }
    onStatus?.({ phase: 'load', device, loadProgress: 0 })
    worker.postMessage({ type: 'init', repo: m.repo, gpu })
  })
  await run(true)

  onStatus?.({ phase: 'finish', device, tilesDone: tiles.length, tilesTotal: tiles.length })
  if (hasAlpha) {
    // resample the source's alpha to the output size and write it over the opaque result
    const scaled = document.createElement('canvas')
    scaled.width = out.width
    scaled.height = out.height
    const zctx = scaled.getContext('2d', { willReadFrequently: true })
    zctx.imageSmoothingQuality = 'high'
    zctx.drawImage(src, 0, 0, out.width, out.height)
    const a = zctx.getImageData(0, 0, out.width, out.height).data
    const img = octx.getImageData(0, 0, out.width, out.height)
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = a[i]
    octx.putImageData(img, 0, 0)
  }
  const png = await new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the result'))), 'image/png'))
  return { blob: png, width: out.width, height: out.height, device, ms: Math.round(performance.now() - t0) }
}
