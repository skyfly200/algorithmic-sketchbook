import { reactive, watch } from 'vue'
import { gallery, loadFromGallery } from './gallery.js'
import { settings, PRESETS, applyPreset, randomize } from './settings.js'

// Display view modes:
//  - gallery: cycles through the saved gallery (or the built-in presets
//    while the gallery has fewer than two entries)
//  - shuffle: jumps to fully randomized settings every interval
//  - morph:   continuously eases the numeric settings (frequencies,
//    rotations, offsets, zoom, line width, colors) toward new random
//    targets, reaching one per interval
//  - shufflemorph: shuffle + morph — pattern types, combine ops, and layer
//    count jump to random picks at the start of each cycle while all
//    numeric settings fade smoothly toward random targets
// None of the modes ever enables animation by itself (photosensitivity).

export const SLIDESHOW_MODES = [
  { value: 'current', label: 'Current settings' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'shuffle', label: 'Shuffle' },
  { value: 'morph', label: 'Morph' },
  { value: 'shufflemorph', label: 'Shuffle + Morph' },
]

export const slideshow = reactive({
  active: false,
  mode: 'current',
  interval: 8, // seconds per slide / per morph cycle
  morphRate: 8, // seconds a morph fade takes (clamped to the interval)
  index: 0,
})

let timer = null
let rafId = 0

function items() {
  return gallery.length >= 2 ? gallery : PRESETS
}

// Advance one slide manually (also used by the on-beat "next slide" action;
// works whether or not the display view is running).
export function nextSlide() {
  advance()
}

function advance() {
  const list = items()
  if (!list.length) return
  slideshow.index = slideshow.index % list.length
  const item = list[slideshow.index]
  // Preserve the user's play/pause choice across slides: gallery snapshots
  // carry their own animate flag, which is deliberately overridden so the
  // slideshow never turns animation on by itself (photosensitivity risk).
  const wasAnimating = settings.animate
  if (item.snap) loadFromGallery(item)
  else applyPreset(item)
  settings.animate = wasAnimating
  slideshow.index++
}

// --- Morph mode -------------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a)

function lerp(a, b, u) {
  return a + (b - a) * u
}

function lerpColor(a, b, u) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  let out = '#'
  for (const shift of [16, 8, 0]) {
    const c = Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, u))
    out += c.toString(16).padStart(2, '0')
  }
  return out
}

function randomHex() {
  return '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')
}

function captureMorphState() {
  return {
    zoom: settings.zoom,
    thickness: settings.thickness,
    colorA: settings.colorA,
    colorB: settings.colorB,
    layers: settings.layers.map((l) => ({ freq: l.freq, rot: l.rot, x: l.x, y: l.y })),
  }
}

function randomMorphTarget() {
  const baseFreq = rnd(60, 320)
  return {
    zoom: rnd(0.6, 1.6),
    thickness: rnd(0.35, 0.65),
    colorA: Math.random() < 0.5 ? settings.colorA : randomHex(),
    colorB: Math.random() < 0.5 ? settings.colorB : randomHex(),
    layers: settings.layers.map((l, i) => ({
      freq: l.op === 8 ? rnd(30, 80) : baseFreq * rnd(0.96, 1.04),
      rot: rnd(-Math.PI, Math.PI) * 0.25,
      x: rnd(-0.3, 0.3),
      y: rnd(-0.3, 0.3),
    })),
  }
}

// Shuffle + morph: re-roll the discrete options (they can't fade) at the
// start of each cycle; the numeric target then fades in as usual.
function shuffleDiscretes() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  settings.layerCount = 2 + Math.floor(rnd(0, 4))
  const basePattern = pick([0, 1, 2, 3, 4, 5, 6, 7, 8])
  settings.layers.forEach((l) => {
    l.pattern = Math.random() < 0.75 ? basePattern : pick([0, 1, 2, 3, 4, 5, 6, 7, 8])
    l.op = pick([0, 0, 1, 1, 3, 4, 5])
  })
  if (settings.layerCount >= 3 && Math.random() < 0.4) {
    const m = settings.layers[1]
    m.op = 8
    if (Math.random() < 0.5) m.pattern = pick([10, 11, 12, 13, 14])
  }
}

function nextMorphCycle(now) {
  if (slideshow.mode === 'shufflemorph') shuffleDiscretes()
  morphFrom = captureMorphState()
  morphTo = randomMorphTarget()
  morphStart = now
}

let morphFrom = null
let morphTo = null
let morphStart = 0

function applyMorph(u) {
  const e = u * u * (3 - 2 * u) // smoothstep easing
  settings.zoom = lerp(morphFrom.zoom, morphTo.zoom, e)
  settings.thickness = lerp(morphFrom.thickness, morphTo.thickness, e)
  settings.colorA = lerpColor(morphFrom.colorA, morphTo.colorA, e)
  settings.colorB = lerpColor(morphFrom.colorB, morphTo.colorB, e)
  settings.layers.forEach((l, i) => {
    l.freq = lerp(morphFrom.layers[i].freq, morphTo.layers[i].freq, e)
    l.rot = lerp(morphFrom.layers[i].rot, morphTo.layers[i].rot, e)
    l.x = lerp(morphFrom.layers[i].x, morphTo.layers[i].x, e)
    l.y = lerp(morphFrom.layers[i].y, morphTo.layers[i].y, e)
  })
}

function morphTick(now) {
  const elapsed = now - morphStart
  const fadeMs = Math.min(slideshow.morphRate, slideshow.interval) * 1000
  applyMorph(Math.min(elapsed / fadeMs, 1))
  if (elapsed >= slideshow.interval * 1000) nextMorphCycle(now)
  rafId = requestAnimationFrame(morphTick)
}

// --- Start / stop -----------------------------------------------------

export function startSlideshow() {
  if (slideshow.active) return
  slideshow.active = true
  slideshow.index = 0
  if (slideshow.mode === 'current') {
    // Just present the current settings — no timers, nothing changes.
  } else if (slideshow.mode === 'gallery') {
    advance()
    timer = setInterval(advance, slideshow.interval * 1000)
  } else if (slideshow.mode === 'shuffle') {
    randomize(false)
    timer = setInterval(() => randomize(false), slideshow.interval * 1000)
  } else {
    nextMorphCycle(performance.now())
    rafId = requestAnimationFrame(morphTick)
  }
}

export function stopSlideshow() {
  if (!slideshow.active) return
  slideshow.active = false
  clearInterval(timer)
  timer = null
  cancelAnimationFrame(rafId)
  rafId = 0
}

watch(
  () => slideshow.interval,
  () => {
    if (!timer) return
    clearInterval(timer)
    timer = setInterval(
      slideshow.mode === 'gallery' ? advance : () => randomize(false),
      slideshow.interval * 1000,
    )
  },
)

// Switching mode while running restarts the show in the new mode.
watch(
  () => slideshow.mode,
  () => {
    if (!slideshow.active) return
    stopSlideshow()
    startSlideshow()
  },
)
