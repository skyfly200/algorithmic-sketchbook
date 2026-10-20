// Small shared maths / colour helpers for the mushroom sketch.
export const TAU = Math.PI * 2
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
export function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const C = (h, s, l) => ({ h, s, l })
export function hsl(h, s, l, a = 1) { return `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a})` }
export function mix(a, b, t) { return C(lerp(a.h, b.h, t), lerp(a.s, b.s, t), lerp(a.l, b.l, t)) }
export const pickOf = (r, a) => a[(r() * a.length) | 0]
