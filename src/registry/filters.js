// The canonical set of local sketches that act as source *filters* (they take
// an upstream image and process it) rather than standalone *effects*. Shared by
// the gallery role sort, the Patch/Autopilot pools and the Settings picker so
// the effect/filter split stays defined in exactly one place.
export const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone', 'channel-offset', 'delay',
  'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope', 'fog', 'mist', 'glow',
  'nebula-gasses', 'strobe', 'color-filter', 'crt', 'uv-light', 'polarization', 'light-leaves',
  'warp', 'rolling-shutter', 'feedback', 'interlace', 'painterly', 'film-tone',
  'blur', 'brightness-contrast', 'shaky-film', 'fps-limiter', 'funhouse-mirror', 'stained-glass',
  'birefringence', 'curves', 'twist', 'wind', 'liquid-metal', 'tiling',
  'polaroid', 'ink-bleed', 'edge-detect',
  'kuwahara', 'emboss', 'sharpen', 'tilt-shift', 'gradient-map',
  'solarize', 'duotone', 'invert', 'vignette', 'crystallize', 'mosaic', 'pixelate', 'displace', 'ripple', 'pinch', 'spherize', 'polar-coordinates', 'glowing-edges',
]
export const FILTER_SLUG_SET = new Set(FILTER_SLUGS)
export function isFilterSketch(sketch) {
  return !!sketch && FILTER_SLUG_SET.has(sketch.slug)
}

// Single-pass `createGLFilter` filters that can run inside Patch's shared filter
// chain (one GL context instead of one iframe + bitmap transfer each). A sketch
// belongs here only if `gf.render` is all it draws: no extra textures, no
// pixel-ratio-scaled uniforms, no multipass state (glpipe).
export const CHAINABLE_SLUGS = [
  'invert', 'solarize', 'vignette', 'duotone', 'kuwahara', 'pinch', 'spherize', 'ripple',
  'gradient-map', 'polar-coordinates', 'brightness-contrast', 'color-filter', 'film-tone',
]
export const CHAINABLE_SLUG_SET = new Set(CHAINABLE_SLUGS)
