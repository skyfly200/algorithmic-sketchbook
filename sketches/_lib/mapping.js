// The pure per-mapping step of input→param modulation, used by the runtime's
// applyModulation and unit-tested on its own (tests/mapping.test.js). Every
// input source is 0..1; a mapping is { source, param, amount (-1..1), smooth?,
// gate?, curve?, center? }.

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

// Shape a raw 0..1 source value by the mapping's response options, before
// smoothing:
//  • gate — ignore input below a floor, then rescale [gate..1] → [0..1]
//  • curve — response shape: >0 eases out (boosts low input, more sensitive),
//    <0 eases in (only strong input registers, punchy)
export function shapeSource(v, m) {
  if (m.gate > 0) v = v <= m.gate ? 0 : (v - m.gate) / (1 - m.gate)
  if (m.curve) v = Math.pow(clamp(v, 0, 1), Math.pow(2, -m.curve * 2.5))
  return v
}

// Add one mapping's contribution to a param value. `v` is the shaped (and
// smoothed) source value; `def` is the param's { min, max }. Normally the
// mapping only adds (source 0 = no change), so a pointer driving a "centred"
// param from its midpoint would clamp half the screen away. `center` makes it
// bipolar instead: the source's midpoint (0.5) is no change and the param
// swings both ways around its base — so the base can sit at the centre, which
// is also right when the mapping is off (e.g. Patch loads sketches with
// default mappings disabled).
export function applyMapping(current, v, m, def) {
  const s = m.center ? v - 0.5 : v
  return clamp(current + s * m.amount * (def.max - def.min), def.min, def.max)
}
