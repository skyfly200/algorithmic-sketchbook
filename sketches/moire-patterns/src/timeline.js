import { reactive } from 'vue'
import { settings } from './settings.js'

// Keyframe timeline. Each track automates one settings path
// (e.g. 'zoom', 'layers.0.freq', 'colorA') with an easing curve applied to
// every segment between consecutive keyframes.

export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']

const EASE = {
  linear: (u) => u,
  'ease-in': (u) => u * u,
  'ease-out': (u) => u * (2 - u),
  'ease-in-out': (u) => u * u * (3 - 2 * u),
  hold: () => 0,
}

// Discrete params: stepped by default and rounded on apply.
const INT_GLOBALS = new Set(['patternType', 'blendMode', 'aaMode', 'layerCount', 'colorMode'])

function isIntPath(path) {
  return INT_GLOBALS.has(path) || /\.(pattern|op)$/.test(path)
}

const KEY_EPS = 0.051 // seconds — clicks this close to an existing key toggle it

export const timeline = reactive({
  duration: 8,
  time: 0,
  smoothLoop: false, // blend from the last keyframe back into the first
  tracks: [], // { path, easing, keys: [{ t, v }] } sorted by t
})

export function getParam(path) {
  return path.split('.').reduce((o, k) => o[k], settings)
}

export function setParam(path, v) {
  const parts = path.split('.')
  const o = parts.slice(0, -1).reduce((obj, k) => obj[k], settings)
  o[parts[parts.length - 1]] = v
}

export function isColorPath(path) {
  return path.includes('color')
}

export function findTrack(path) {
  return timeline.tracks.find((tr) => tr.path === path)
}

export function hasKeyNear(path, t) {
  const tr = findTrack(path)
  return !!tr && tr.keys.some((k) => Math.abs(k.t - t) < KEY_EPS)
}

export function toggleKeyAt(path, time) {
  const t = +time.toFixed(2)
  let tr = findTrack(path)
  if (tr) {
    const i = tr.keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPS)
    if (i >= 0) {
      tr.keys.splice(i, 1)
      if (!tr.keys.length) removeTrack(path)
      return
    }
  } else {
    tr = { path, easing: isIntPath(path) ? 'hold' : 'ease-in-out', keys: [] }
    timeline.tracks.push(tr)
  }
  tr.keys.push({ t, v: getParam(path) })
  tr.keys.sort((a, b) => a.t - b.t)
}

export function removeTrack(path) {
  const i = timeline.tracks.findIndex((tr) => tr.path === path)
  if (i >= 0) timeline.tracks.splice(i, 1)
}

function lerpColor(a, b, u) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  let out = '#'
  for (const shift of [16, 8, 0]) {
    const c = Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * u)
    out += c.toString(16).padStart(2, '0')
  }
  return out
}

export function evalTrack(tr, t) {
  const keys = tr.keys
  // Smooth loop: past the last key (or before the first), interpolate from
  // the last key back to the first across the loop boundary.
  if (timeline.smoothLoop && keys.length > 1) {
    const a = keys[keys.length - 1]
    const b = keys[0]
    if (t > a.t || t < b.t) {
      const span = timeline.duration - a.t + b.t
      if (span > 1e-6) {
        const dt = t >= a.t ? t - a.t : t + (timeline.duration - a.t)
        const u = EASE[tr.easing](Math.min(dt / span, 1))
        if (isColorPath(tr.path)) return lerpColor(a.v, b.v, u)
        const v = a.v + (b.v - a.v) * u
        return isIntPath(tr.path) ? Math.round(v) : v
      }
    }
  }
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  let i = 0
  while (keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const u = EASE[tr.easing]((t - a.t) / (b.t - a.t))
  if (isColorPath(tr.path)) return lerpColor(a.v, b.v, u)
  const v = a.v + (b.v - a.v) * u
  return isIntPath(tr.path) ? Math.round(v) : v
}

export function applyTimeline(t) {
  for (const tr of timeline.tracks) {
    if (tr.keys.length) setParam(tr.path, evalTrack(tr, t))
  }
}

const GLOBAL_LABELS = {
  patternType: 'Type',
  blendMode: 'Blend',
  aaMode: 'Anti-alias',
  layerCount: 'Layers',
  colorMode: 'Color mode',
  zoom: 'Zoom',
  thickness: 'Line width',
  animSpeed: 'Speed',
  colorA: 'Color A',
  colorB: 'Color B',
  colorC: 'Color C',
}

const LAYER_LABELS = {
  freq: 'frequency',
  rot: 'rotation',
  x: 'offset X',
  y: 'offset Y',
  color: 'color',
  alpha: 'opacity',
  pattern: 'type',
  op: 'combine',
}

// Jump the playhead to the nearest keyframe in the given direction
// (dir = -1 previous, +1 next), wrapping around the key set.
export function jumpToKey(dir) {
  const times = [...new Set(timeline.tracks.flatMap((tr) => tr.keys.map((k) => k.t)))]
    .sort((a, b) => a - b)
  if (!times.length) return
  let target
  if (dir > 0) {
    target = times.find((t) => t > timeline.time + 0.011) ?? times[0]
  } else {
    target = [...times].reverse().find((t) => t < timeline.time - 0.011) ?? times[times.length - 1]
  }
  timeline.time = target
  applyTimeline(target)
}

export function trackLabel(path) {
  if (GLOBAL_LABELS[path]) return GLOBAL_LABELS[path]
  const m = path.match(/^layers\.(\d+)\.(\w+)$/)
  if (m) return `L${+m[1] + 1} ${LAYER_LABELS[m[2]] || m[2]}`
  return path
}

// Compact serialization for share links and gallery snapshots.
export function tlSnapshot() {
  if (!timeline.tracks.length) return undefined
  return {
    d: timeline.duration,
    loop: timeline.smoothLoop ? 1 : undefined,
    tracks: timeline.tracks.map((tr) => ({
      p: tr.path,
      e: tr.easing,
      k: tr.keys.map((k) => [k.t, typeof k.v === 'number' ? +k.v.toFixed(4) : k.v]),
    })),
  }
}

export function tlApply(s) {
  timeline.time = 0
  if (!s) {
    timeline.tracks = []
    timeline.smoothLoop = false
    return
  }
  timeline.duration = s.d || 8
  timeline.smoothLoop = !!s.loop
  timeline.tracks = (s.tracks || []).map((tr) => ({
    path: tr.p,
    easing: EASINGS.includes(tr.e) ? tr.e : 'linear',
    keys: (tr.k || []).map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t),
  }))
}
