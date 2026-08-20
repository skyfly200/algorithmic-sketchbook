// Polygon / portal / mask shape helpers for the Patch nodes, lifted out of
// PatchView. Everything here is framework-free: the polygon presets are plain
// normalized point lists (0..1 in each axis), the path builders take a 2D
// context and explicit sizes, and the SVG import turns an <svg> into a single
// path `d` string. Pure geometry, so it's unit-tested.

// A regular n-gon inscribed in the unit box, first vertex pointing up.
export function regPoly(n, r = 0.4, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; pts.push([+(0.5 + r * Math.cos(a)).toFixed(3), +(0.5 + r * Math.sin(a)).toFixed(3)]) }
  return pts
}
export function starPoly(points = 5, outer = 0.44, inner = 0.19) {
  const pts = []
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points, r = i % 2 ? inner : outer; pts.push([+(0.5 + r * Math.cos(a)).toFixed(3), +(0.5 + r * Math.sin(a)).toFixed(3)]) }
  return pts
}
export function heartPoly() {
  const pts = []
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2
    const hx = 16 * Math.pow(Math.sin(t), 3)
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push([+(0.5 + (hx / 34)).toFixed(3), +(0.5 - (hy / 34)).toFixed(3)])
  }
  return pts
}
// Named presets for the Polygon node — the picker seeds a node's points from one.
export const POLY_SHAPES = {
  Triangle: regPoly(3), Square: [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]],
  Pentagon: regPoly(5), Hexagon: regPoly(6), Octagon: regPoly(8),
  Circle: regPoly(28), Diamond: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]],
  Star: starPoly(5), 'Star 6': starPoly(6), Heart: heartPoly(),
  Arrow: [[0.1, 0.35], [0.55, 0.35], [0.55, 0.18], [0.9, 0.5], [0.55, 0.82], [0.55, 0.65], [0.1, 0.65]],
  Cross: [[0.38, 0.1], [0.62, 0.1], [0.62, 0.38], [0.9, 0.38], [0.9, 0.62], [0.62, 0.62], [0.62, 0.9], [0.38, 0.9], [0.38, 0.62], [0.1, 0.62], [0.1, 0.38], [0.38, 0.38]],
}
// Portal destination shapes + Mask blend modes.
export const PORTAL_SHAPES = ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'heart']
export const MASK_MODES = ['multiply', 'screen', 'lighten', 'darken', 'overlay', 'add']

// Build a path for a portal shape inscribed in the rect (x,y,w,h).
export function portalShapePath(ctx, shape, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2
  ctx.beginPath()
  if (shape === 'ellipse') {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath()
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, y); ctx.lineTo(x + w, cy); ctx.lineTo(cx, y + h); ctx.lineTo(x, cy); ctx.closePath()
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3
      const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 ? 0.42 : 1
      const px = cx + Math.cos(a) * rx * r, py = cy + Math.sin(a) * ry * r
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape === 'heart') {
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2
      const hx = 16 * Math.pow(Math.sin(t), 3)
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      const px = cx + (hx / 17) * rx, py = cy - (hy / 17) * ry
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else {
    ctx.rect(x, y, w, h)
  }
}

// Trace a Polygon node's normalized points into the context, scaled to (W,H).
// `invert` adds the full rect first so an even-odd/nonzero fill cuts the polygon
// out of the frame instead of keeping it.
export function polyPath(cx, pts, invert, W, H) {
  cx.beginPath()
  if (invert) { cx.rect(0, 0, W, H) }
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] * W, y = pts[i][1] * H
    if (i === 0) cx.moveTo(x, y)
    else cx.lineTo(x, y)
  }
  cx.closePath()
}

// Reduce one SVG element to a path `d` string (the Shape node only fills paths).
export function svgElToPath(el) {
  const t = el.tagName.toLowerCase()
  const f = (a) => parseFloat(el.getAttribute(a) || '0')
  if (t === 'path') return el.getAttribute('d') || ''
  if (t === 'rect') { const x = f('x'), y = f('y'), w = f('width'), h = f('height'); return w && h ? `M${x} ${y}h${w}v${h}h${-w}Z` : '' }
  if (t === 'circle') { const cx = f('cx'), cy = f('cy'), r = f('r'); return r ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : '' }
  if (t === 'ellipse') { const cx = f('cx'), cy = f('cy'), rx = f('rx'), ry = f('ry'); return rx && ry ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` : '' }
  if (t === 'line') return `M${f('x1')} ${f('y1')}L${f('x2')} ${f('y2')}`
  if (t === 'polyline' || t === 'polygon') {
    const nums = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
    if (nums.length < 4) return ''
    let d = `M${nums[0]} ${nums[1]}`
    for (let i = 2; i < nums.length - 1; i += 2) d += `L${nums[i]} ${nums[i + 1]}`
    return t === 'polygon' ? d + 'Z' : d
  }
  return ''
}
// Parse an SVG document into a single combined path + its bounding box (measured
// via a throwaway offscreen <svg>, so this needs a DOM).
export function svgToPathData(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  const els = doc.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')
  const parts = []
  for (const el of els) { const d = svgElToPath(el); if (d) parts.push(d) }
  if (!parts.length) return null
  const combined = parts.join(' ')
  const NS = 'http://www.w3.org/2000/svg'
  const tmp = document.createElementNS(NS, 'svg')
  tmp.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden')
  const pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', combined); tmp.appendChild(pth)
  document.body.appendChild(tmp)
  let bb; try { bb = pth.getBBox() } catch { bb = null } finally { document.body.removeChild(tmp) }
  if (!bb || !bb.width || !bb.height) return null
  return { d: combined, bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height } }
}
