// Colour-theory maths for the palette system: conversions plus harmony
// generators (complementary, analogous, triadic, …) that derive a set of
// related colours from one base colour by rotating it around the wheel in HSL.
// Pure functions, no state — the palette store and the pickers build on these.

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

export function hexToRgb(hex) {
  hex = (hex || '').replace('#', '')
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const n = parseInt(hex || '000000', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  const l = (mx + mn) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return [h, s * 100, l * 100]
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
export function hexToHsl(hex) { const [r, g, b] = hexToRgb(hex); return rgbToHsl(r, g, b) }
export function hslToHex(h, s, l) { const [r, g, b] = hslToRgb(h, s, l); return rgbToHex(r, g, b) }

// Named colour-harmony schemes (classic colour-wheel relationships).
export const HARMONIES = [
  'Complementary', 'Analogous', 'Triadic', 'Tetradic', 'Split-complementary', 'Monochromatic',
]

// Build a palette of hex colours related to `base` by the chosen harmony.
export function harmony(base, type) {
  const [h, s, l] = hexToHsl(base)
  const at = (dh, dl = 0, ds = 0) => hslToHex(h + dh, clamp(s + ds, 0, 100), clamp(l + dl, 6, 96))
  switch (type) {
    case 'Complementary': return [at(0), at(180), at(0, 18), at(180, 18)]
    case 'Analogous': return [at(-60), at(-30), at(0), at(30), at(60)]
    case 'Triadic': return [at(0), at(120), at(240), at(0, 20)]
    case 'Tetradic': return [at(0), at(90), at(180), at(270)]
    case 'Split-complementary': return [at(0), at(150), at(210), at(0, 18)]
    case 'Monochromatic': return [at(0, -28), at(0, -14), at(0), at(0, 14), at(0, 26)]
    default: return [at(0)]
  }
}

// Evenly-spaced gradient stops from a list of colours.
export function gradientStops(colors) {
  const n = colors.length
  return colors.map((c, i) => ({ pos: n > 1 ? i / (n - 1) : 0, color: c }))
}
// CSS linear-gradient string for previews.
export function gradientCss(stops, angle = 90) {
  const s = [...stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')
  return `linear-gradient(${angle}deg, ${s})`
}
