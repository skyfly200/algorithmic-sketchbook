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
  'median', 'oil-paint', 'difference-of-gaussians', 'directional-sharpen', 'detail-upscale',
]
export const FILTER_SLUG_SET = new Set(FILTER_SLUGS)
export function isFilterSketch(sketch) {
  return !!sketch && FILTER_SLUG_SET.has(sketch.slug)
}

// Single-pass `createGLFilter` filters that can run inside Patch's shared filter
// chain (one GL context instead of one iframe + bitmap transfer each). A sketch
// belongs here only if `gf.render` is all it draws and the GL work is a pure
// function of the input picture, the uniforms, time and any textures it uploads
// through `gf.addTexture` (those are shared with the chain runner): no glpipe /
// multipass, no raw GL of its own. (In chain mode
// rt.pixelRatio and gf.width/height report the chain's render size and a window
// 'resize' fires, so pixel-valued uniforms and size-dependent bakes need no
// special casing.) History is allowed through u_prev / u_prevIn only (the previous
// output / input of that filter); sketches that need a held frame or a ring of past
// frames (delay, tiling, strobe, motion-extraction, rolling-shutter, fps-limiter) are
// Canvas2D and stay iframes.
export const CHAINABLE_SLUGS = [
  // colour and tone
  'invert', 'solarize', 'duotone', 'gradient-map', 'brightness-contrast', 'color-filter', 'film-tone',
  'channel-offset', 'polarization', 'uv-light', 'liquid-metal', 'birefringence',
  // blur, glow and atmosphere
  'blur', 'glow', 'mist', 'vignette', 'tilt-shift', 'crt',
  // sharpen and edges
  'sharpen', 'emboss', 'edge-detect', 'glowing-edges', 'kuwahara',
  // stylise
  'halftone', 'pointillism', 'crystallize', 'mosaic', 'pixelate', 'stained-glass',
  // geometry
  'pinch', 'spherize', 'ripple', 'polar-coordinates', 'twist', 'displace', 'warp',
  'funhouse-mirror', 'kaleidoscope',
  'median', 'oil-paint', 'difference-of-gaussians', 'directional-sharpen', 'detail-upscale',
  // with baked textures (LUT, dirt, damage overlay)
  'curves', 'camera-lens', 'polaroid',
  // stateful (u_prev / u_prevIn history, see sketches/_lib/glhistory.js)
  'feedback', 'interlace',
]
export const CHAINABLE_SLUG_SET = new Set(CHAINABLE_SLUGS)
