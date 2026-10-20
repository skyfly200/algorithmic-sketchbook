// Log ("taper") sliders for params whose useful values bunch up at the low end
// of the range — an intensity where 0.05 vs 0.1 matters but 1.2 vs 1.3 doesn't,
// a rate or a size spanning orders of magnitude. Declare `scale: 'log'` on a
// range param; everything that turns a param into a 0..1 slider position (the
// controls panels, input mappings, Patch control wires, randomise / drift) goes
// through toPos / fromPos, so the slider's midpoint (position 0.5) is its centre
// and a centred mapping swings it equally far both ways in position.
//
//   value = min + (max − min) · (R^pos − 1) / (R − 1)
//
// With min > 0 and R = max / min this is a true log scale (value = min · R^pos).
// With min = 0 it is a pseudo-log that still reaches 0; R (`logRange`, default
// 100) is how much finer the bottom of the track is than the top. A param with
// min < 0, or anything not marked log, stays linear.

const DEFAULT_RANGE = 100

function clamp01(u) { return u < 0 ? 0 : u > 1 ? 1 : u }

export function isLog(spec) {
  return !!spec && spec.scale === 'log' && typeof spec.min === 'number' && spec.min >= 0 && spec.max > spec.min
}

function ratio(spec) {
  return spec.min > 0 ? spec.max / spec.min : (spec.logRange > 1 ? spec.logRange : DEFAULT_RANGE)
}

// param value → 0..1 slider position
export function toPos(value, spec) {
  const span = spec.max - spec.min || 1
  const lin = clamp01((value - spec.min) / span)
  if (!isLog(spec)) return lin
  const R = ratio(spec)
  return Math.log(1 + lin * (R - 1)) / Math.log(R)
}

// 0..1 slider position → param value
export function fromPos(pos, spec) {
  const u = clamp01(pos)
  if (!isLog(spec)) return spec.min + u * (spec.max - spec.min)
  const R = ratio(spec)
  return spec.min + (spec.max - spec.min) * (Math.pow(R, u) - 1) / (R - 1)
}

// A value fit for a stored knob / scene: snapped to the param's step on a linear
// slider, kept to 3 significant figures on a log one (a fixed step would be far
// too coarse at the bottom of the track and pointlessly fine at the top).
export function tidy(value, spec) {
  if (isLog(spec)) return value === 0 ? 0 : +value.toPrecision(3)
  const step = spec.step || (spec.max - spec.min) / 100 || 0.01
  return +(spec.min + Math.round((value - spec.min) / step) * step).toFixed(6)
}
