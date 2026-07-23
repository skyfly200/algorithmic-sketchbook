// The canonical set of local sketches that act as source *filters* (they take
// an upstream image and process it) rather than standalone *effects*. Shared by
// the gallery role sort, the Patch/Autopilot pools and the Settings picker so
// the effect/filter split stays defined in exactly one place.
export const FILTER_SLUGS = [
  'pointillism', 'camera-lens', 'rain-window', 'halftone', 'channel-offset', 'delay',
  'lens-flare', 'motion-extraction', 'vhs-defects', 'kaleidoscope', 'fog', 'mist', 'glow',
  'nebula-gasses', 'strobe', 'color-filter', 'crt', 'uv-light', 'polarization', 'light-leaves',
  'warp', 'rolling-shutter', 'feedback', 'interlace', 'painterly',
]
export const FILTER_SLUG_SET = new Set(FILTER_SLUGS)
export function isFilterSketch(sketch) {
  return sketch?.type === 'local' && FILTER_SLUG_SET.has(sketch.slug)
}
