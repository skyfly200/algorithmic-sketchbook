// Tile planning for the neural upscaler. Pure and framework-free.
//
// A super-resolution model only takes a small picture at a time, so a big image is cut
// into overlapping tiles, each tile is upscaled, and the results are stitched by keeping
// only the part of every tile away from its (less reliable) borders.
//
// Along one axis of length n, tiles are `tile` px long and overlap by 2 * `overlap`.
// Each tile has an input range [start, start + size) and a "keep" range [keepFrom, keepTo)
// inside it; the keep ranges of consecutive tiles touch and together cover [0, n) exactly.

/** @returns Array of { start, size, keepFrom, keepTo } along one axis. */
export function planAxis(n, tile, overlap, multiple = 8) {
  if (!(n > 0)) return []
  if (n <= tile) {
    // One tile. Models want sizes that are a multiple of their window, so it may extend past
    // the image; the caller pads the extra with the edge pixels and keeps only [0, n).
    return [{ start: 0, size: Math.min(tile, Math.ceil(n / multiple) * multiple), keepFrom: 0, keepTo: n }]
  }
  if (tile <= overlap * 2) throw new Error('tile must be larger than twice the overlap')
  const step = tile - overlap * 2
  const out = []
  let prevKeepTo = 0
  for (let i = 0; ; i++) {
    const start = Math.min(i * step, n - tile) // the last tile is pulled back inside the image
    const last = start + tile >= n
    const keepTo = last ? n : start + tile - overlap
    out.push({ start, size: tile, keepFrom: prevKeepTo, keepTo })
    if (last) break
    prevKeepTo = keepTo
  }
  return out
}

/** @returns Array of { x, y, w, h, keep: { x, y, w, h } } in input pixels, row by row. */
export function planTiles(width, height, { tile = 64, overlap = 8 } = {}) {
  const xs = planAxis(width, tile, overlap)
  const ys = planAxis(height, tile, overlap)
  const out = []
  for (const y of ys) {
    for (const x of xs) {
      out.push({
        x: x.start, y: y.start, w: x.size, h: y.size,
        keep: { x: x.keepFrom, y: y.keepFrom, w: x.keepTo - x.keepFrom, h: y.keepTo - y.keepFrom },
      })
    }
  }
  return out
}

/** The model's output size for an input size. */
export const outputSize = (width, height, scale) => ({ width: width * scale, height: height * scale })

/**
 * Whether an upscale is allowed: browsers cap canvas size, and the result is stored in
 * IndexedDB as a PNG. Returns { ok, width, height, reason }.
 */
export const MAX_OUTPUT_EDGE = 4096
export const MAX_OUTPUT_PIXELS = 4096 * 4096
export function checkOutput(width, height, scale, { maxEdge = MAX_OUTPUT_EDGE, maxPixels = MAX_OUTPUT_PIXELS } = {}) {
  const o = outputSize(width, height, scale)
  if (Math.max(o.width, o.height) > maxEdge || o.width * o.height > maxPixels) {
    return { ok: false, ...o, reason: `The result would be ${o.width} × ${o.height}; the limit is ${maxEdge} px on the long edge. Use a smaller image or a lower scale.` }
  }
  return { ok: true, ...o, reason: '' }
}

/** Rough time left, from the time the finished tiles took. */
export function estimateRemaining(doneTiles, totalTiles, elapsedMs) {
  if (doneTiles <= 0) return null
  return Math.max(0, Math.round((elapsedMs / doneTiles) * (totalTiles - doneTiles)))
}
