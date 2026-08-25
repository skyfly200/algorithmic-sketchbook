// Trace prominent shapes out of a picture and hand back simple polygons, ready
// to drop in as Polygon matte nodes. Pure and dependency-free: it works on a
// plain { data, width, height } (an ImageData), so it runs in a worker, a test,
// or the main thread. The pipeline is deliberately classic and cheap —
// grayscale → Otsu threshold → connected components → Moore boundary trace →
// Douglas–Peucker simplify — which is plenty to lift the big silhouettes a
// person points a camera at (a hand, a bottle, a cut-out, a logo) into a
// handful of draggable corners.

// Luminance (Rec. 601) for each pixel, 0..255.
export function toGray({ data, width, height }) {
  const g = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    // assignment to a clamped array rounds — don't truncate first
    g[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114
  }
  return g
}

// Otsu's method: the grayscale threshold that best splits the histogram into two
// classes (maximises between-class variance). Returns 1..254.
export function otsu(gray) {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = 0, thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue
    const wF = total - wB; if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  return thr
}

// Binary foreground mask. Otsu splits the histogram into a low class (≤ thr) and
// a high class (> thr); background is whichever of those dominates the image
// border (the frame), so the foreground is the subject the camera was aimed at,
// whether it's dark-on-light or light-on-dark.
export function foregroundMask(gray, width, height, thr, invert = false) {
  let borderSum = 0, borderN = 0
  const edge = (x, y) => { borderSum += gray[y * width + x]; borderN++ }
  for (let x = 0; x < width; x++) { edge(x, 0); edge(x, height - 1) }
  for (let y = 1; y < height - 1; y++) { edge(0, y); edge(width - 1, y) }
  const bgHigh = borderSum / Math.max(1, borderN) > thr // is the frame the high class?
  const fg = new Uint8Array(width * height)
  // invert flips which class counts as the subject (for when the auto guess is
  // backwards — e.g. a light object held against a lit background).
  for (let i = 0; i < fg.length; i++) fg[i] = ((gray[i] > thr) === bgHigh) !== invert ? 0 : 1
  return fg
}

// Label 8-connected foreground blobs (iterative flood fill). Returns each
// component's pixel count and a seed (its top-most, then left-most pixel — the
// starting point Moore tracing needs).
export function components(fg, width, height) {
  const seen = new Uint8Array(width * height)
  const out = []
  const stack = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * width + x
      if (!fg[s] || seen[s]) continue
      let area = 0, seed = s
      seen[s] = 1; stack.length = 0; stack.push(s)
      while (stack.length) {
        const i = stack.pop(); area++
        if (i < seed) seed = i // row-major min == top-most then left-most
        const px = i % width, py = (i / width) | 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = px + dx, ny = py + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const ni = ny * width + nx
            if (fg[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni) }
          }
        }
      }
      out.push({ area, seed })
    }
  }
  return out
}

// Moore-neighbour boundary trace (clockwise) of the blob containing `seed`.
// Walks the outer contour and returns its pixel ring [[x,y], …].
export function traceContour(fg, width, height, seed) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && fg[y * width + x]
  // 8 neighbours clockwise from "west", the classic Moore ordering.
  const N = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]
  const sx = seed % width, sy = (seed / width) | 0
  const contour = [[sx, sy]]
  let cx = sx, cy = sy, bDir = 0 // came from the west of the seed
  const maxSteps = width * height * 4
  for (let step = 0; step < maxSteps; step++) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const dir = (bDir + k) % 8
      const nx = cx + N[dir][0], ny = cy + N[dir][1]
      if (inside(nx, ny)) {
        cx = nx; cy = ny
        bDir = (dir + 6) % 8 // step back one, then resume the clockwise scan
        found = true
        break
      }
    }
    if (!found) break // isolated pixel
    if (cx === sx && cy === sy) break // closed the loop
    contour.push([cx, cy])
  }
  return contour
}

// Perpendicular distance from p to the segment a→b.
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (!len2) { const ex = p[0] - a[0], ey = p[1] - a[1]; return Math.hypot(ex, ey) }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
// Douglas–Peucker simplification of an open polyline.
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice()
  let maxD = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return left.slice(0, -1).concat(right)
}

// Simplify a closed pixel ring to a small corner set, then normalise to 0..1.
// Bumps epsilon until the point count fits `maxPts`, so busy edges don't yield a
// 60-point "polygon". Returns null if it can't reach a sane 3..maxPts shape.
function ringToPolygon(ring, width, height, eps0, maxPts) {
  let eps = eps0
  for (let tries = 0; tries < 8; tries++) {
    const simplified = rdp(ring, eps)
    // drop the duplicated closing point if present
    const s = simplified.length > 1 &&
      simplified[0][0] === simplified[simplified.length - 1][0] &&
      simplified[0][1] === simplified[simplified.length - 1][1]
      ? simplified.slice(0, -1) : simplified
    if (s.length >= 3 && s.length <= maxPts) {
      return s.map((p) => [+(p[0] / width).toFixed(4), +(p[1] / height).toFixed(4)])
    }
    if (s.length < 3) return null
    eps *= 1.6 // too many corners — coarsen and retry
  }
  return null
}

// The whole pipeline. Returns up to `maxShapes` polygons, largest first, each
// { points: [[x,y]…] (0..1), area (0..1 fraction) }.
export function extractShapes(image, opts = {}) {
  const { width, height } = image
  if (!width || !height) return []
  const {
    maxShapes = 6,
    minAreaFrac = 0.004, // ignore specks
    maxAreaFrac = 0.92,  // ignore a blob that's basically the whole frame
    maxPoints = 14,
    invert = false,      // flip the subject/background guess
    smoothing = 1,       // >1 = fewer corners (coarser), <1 = more faithful
  } = opts
  const gray = toGray(image)
  const thr = otsu(gray)
  const fg = foregroundMask(gray, width, height, thr, invert)
  const total = width * height
  const eps0 = Math.max(1, Math.hypot(width, height) * 0.012 * smoothing)
  const shapes = []
  for (const c of components(fg, width, height)) {
    const frac = c.area / total
    if (frac < minAreaFrac || frac > maxAreaFrac) continue
    const ring = traceContour(fg, width, height, c.seed)
    if (ring.length < 3) continue
    const points = ringToPolygon(ring, width, height, eps0, maxPoints)
    if (points) shapes.push({ points, area: frac })
  }
  shapes.sort((a, b) => b.area - a.area)
  return shapes.slice(0, maxShapes)
}
