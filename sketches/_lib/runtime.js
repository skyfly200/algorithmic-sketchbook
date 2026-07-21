/**
 * Shared runtime for embedded sketches.
 *
 * The gallery viewer passes display settings via query params
 * (?fps=1&quality=low|medium|high|native); this module reads them and gives
 * every sketch the same capabilities:
 *
 *   const rt = createRuntime()
 *   rt.pixelRatio   // canvas pixels per CSS pixel — use instead of devicePixelRatio
 *   rt.detail       // 0..1 workload factor — scale particle counts etc. with it
 *   rt.tick(now)    // call once per frame: FPS meter, beat detector, modulation
 *
 * BEAT DETECTION
 *   rt.onBeat(cb)     // fires on detected beats; mounts a mic toggle button
 *   rt.beat.state     // { active, level, pulse } — pulse decays 1 → 0 per beat
 *   rt.beat.trigger() // fire a beat manually
 *
 * PARAMS & INPUT MAPPINGS (what scenes save)
 *   const params = rt.params({
 *     speed: { value: 1.4, min: 0.3, max: 4, step: 0.1, label: 'Speed' },
 *     mirror: { value: false, type: 'bool', label: 'Mirror' },
 *   })
 *   params.speed                          // read the live (modulated) value
 *   rt.mapInput('audio.pulse', 'speed', 0.35) // default input→param mapping
 *
 * Declaring params connects the sketch to the viewer over postMessage: the
 * viewer renders sliders, edits mappings, and saves/applies scenes
 * (param values + input mappings + display settings). Input sources:
 * audio.pulse/level/low/mid/high/volume, mouse.x/y, tilt.x/y + shake
 * (accelerometer/gyro), time.sin — each 0..1; a mapping's amount (-1..1) adds
 * source × amount × (max − min) to the param's base value. Legacy 'beat.*'
 * source names (older saved scenes) still resolve.
 *
 * Everything is opt-in — sketches that ignore all of this still work.
 */
import { createBeatDetector } from './beat.js'
import { createMidiInput, createLeapInput, createArtnetInput } from './inputs.js'

export const INPUT_SOURCES = [
  'audio.pulse', // 1 on each detected beat, decays to 0
  'audio.level', // bass energy (alias of audio.low)
  'audio.low', // bass band
  'audio.mid', // mids — vocals / snares
  'audio.high', // highs — hats / cymbals
  'audio.volume', // broadband loudness
  'audio.centroid', // spectral brightness (bassy 0 … airy 1)
  'audio.flux', // spectral change — transients/onsets spike it
  'mouse.x',
  'mouse.y',
  'touch.x', // touchscreen finger position (first touch)
  'touch.y',
  'touch.down', // 1 while a finger is on the screen
  'tilt.x', // device tilt left–right (accelerometer/gyro)
  'tilt.y', // device tilt front–back
  'shake', // device shake intensity (accelerometer), decays
  'time.sin', // slow 10 s oscillation
  // Free-running low-frequency oscillators (4 s period, 0..1) — pick a
  // waveform to drive a param cyclically. Shape with an Input node's
  // scale/offset in Patch, or a mapping's amount elsewhere.
  'osc.sine',
  'osc.triangle',
  'osc.saw',
  'osc.square',
  'osc.random', // stepped sample-and-hold — a new random level each cycle
  'midi.cc1', // MIDI control change (any midi.ccN resolves)
  'midi.cc2',
  'midi.cc3',
  'midi.cc4',
  'midi.note', // 1 while any key is held
  'midi.velocity', // last note-on velocity
  'leap.x', // Leap Motion palm position (0..1)
  'leap.y',
  'leap.z',
  'leap.pinch', // pinch strength 0..1
  'leap.grab', // grab (fist) strength 0..1
  'artnet.ch1', // DMX channels via `npm run artnet-bridge` (any artnet.chN)
  'artnet.ch2',
  'artnet.ch3',
  'artnet.ch4',
]

const QUALITY = {
  low: { pixelRatio: 0.5, detail: 0.4 },
  medium: { pixelRatio: 0.75, detail: 0.7 },
  high: { pixelRatio: 1, detail: 1 },
  native: { pixelRatio: Math.min(window.devicePixelRatio || 1, 3), detail: 1 },
}

function mountFpsMeter() {
  const el = document.createElement('div')
  el.id = 'fps-meter'
  el.style.cssText = `
    position: fixed; top: 10px; left: 10px; z-index: 1000;
    padding: 3px 8px; border-radius: 6px;
    font: 12px/1.4 ui-monospace, monospace; color: #8f8;
    background: rgba(0, 0, 0, 0.55); pointer-events: none;`
  el.textContent = '-- FPS'
  document.body.appendChild(el)

  let frames = 0
  let windowStart = performance.now()
  return (now) => {
    frames++
    if (now - windowStart >= 500) {
      el.textContent = `${Math.round((frames * 1000) / (now - windowStart))} FPS`
      frames = 0
      windowStart = now
    }
  }
}

// Turn a getUserMedia failure into a short, actionable message.
function micErrorMessage(err) {
  switch (err?.name) {
    case 'InsecureContextError':
      return 'Mic needs HTTPS (or localhost)'
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Mic permission blocked — allow it and retry'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found'
    case 'NotReadableError':
      return 'Mic is in use by another app'
    default:
      return `Mic unavailable (${err?.name || 'error'})`
  }
}

function showToast(message) {
  let toast = document.getElementById('rt-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'rt-toast'
    toast.style.cssText = `
      position: fixed; bottom: 62px; right: 12px; z-index: 1001; max-width: 240px;
      padding: 8px 12px; border-radius: 8px; font: 13px/1.35 system-ui, sans-serif;
      color: #fff; background: rgba(20, 20, 28, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.18); transition: opacity 0.3s; opacity: 0;`
    document.body.appendChild(toast)
  }
  toast.textContent = message
  requestAnimationFrame(() => (toast.style.opacity = 1))
  clearTimeout(showToast._t)
  showToast._t = setTimeout(() => (toast.style.opacity = 0), 4000)
}

function mountMicButton(beat) {
  if (document.getElementById('mic-toggle')) return
  const btn = document.createElement('button')
  btn.id = 'mic-toggle'
  btn.textContent = '🎤'
  btn.title = 'Enable microphone beat detection'
  btn.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 1000;
    width: 42px; height: 42px; border-radius: 50%;
    font-size: 18px; cursor: pointer; opacity: 0.45;
    color: #fff; background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.3);`
  btn.addEventListener('click', async () => {
    if (beat.state.active) {
      beat.stop()
      btn.style.opacity = 0.45
      btn.textContent = '🎤'
      btn.title = 'Enable microphone beat detection'
      return
    }
    try {
      await beat.start()
      btn.style.opacity = 1
      btn.textContent = '🎧'
      btn.title = 'Listening — click to stop'
    } catch (err) {
      // Stay retryable: keep the mic icon, explain why, let the user try again.
      btn.textContent = '🎤'
      const msg = micErrorMessage(err)
      btn.title = msg + ' (click to retry)'
      showToast(msg)
    }
  })
  document.body.appendChild(btn)
}

// Permission button for device motion (iOS). onGrant returns true on success.
function mountMotionButton(onGrant) {
  if (document.getElementById('motion-toggle')) return
  const btn = document.createElement('button')
  btn.id = 'motion-toggle'
  btn.textContent = '📱'
  btn.title = 'Enable motion / tilt input'
  btn.style.cssText = `
    position: fixed; bottom: 12px; right: 62px; z-index: 1000;
    width: 42px; height: 42px; border-radius: 50%;
    font-size: 18px; cursor: pointer; opacity: 0.45;
    color: #fff; background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.3);`
  btn.addEventListener('click', async () => {
    const ok = await onGrant()
    if (ok) {
      btn.style.opacity = 1
      btn.title = 'Motion enabled'
    } else {
      showToast('Motion permission denied')
    }
  })
  document.body.appendChild(btn)
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function createRuntime() {
  const urlParams = new URLSearchParams(location.search)
  const quality = QUALITY[urlParams.get('quality')] ?? QUALITY.native
  // Preview mode (gallery thumbnail iframes): no overlay chrome, no mic button.
  const preview = urlParams.get('preview') === '1'
  const fpsTick = !preview && urlParams.get('fps') === '1' ? mountFpsMeter() : null

  // Seeded RNG (mulberry32): a sketch that derives its look from rt.rng() gets
  // a fresh variation per ?seed= (the viewer's 🎲 button re-seeds), while the
  // same seed always reproduces — so a look can be saved/shared.
  const seedParam = urlParams.get('seed')
  const seed = (seedParam ? parseInt(seedParam, 36) : (Math.random() * 4294967296) >>> 0) >>> 0
  let _s = seed
  function rng() {
    _s = (_s + 0x6d2b79f5) | 0
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Universal pause: freeze the sketch by holding its requestAnimationFrame
  // callbacks until resumed (works for any sketch without per-sketch code —
  // the viewer's Space key and compositors post `sketch:pause`).
  let paused = false
  const heldRaf = []
  const nativeRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => {
    if (paused) {
      heldRaf.push(cb)
      return heldRaf.length
    }
    return nativeRaf(cb)
  }
  function setPaused(p) {
    if (p === paused) return
    paused = p
    if (!paused) {
      const held = heldRaf.splice(0)
      for (const cb of held) nativeRaf(cb)
    }
  }

  const beat = createBeatDetector()
  // External inputs, started lazily the first time a mapping uses them.
  const midi = createMidiInput()
  const leap = createLeapInput()
  const artnet = createArtnetInput()

  // --- param engine ------------------------------------------------------
  const schema = {}
  const base = {} // values as set by the sketch / viewer / scene
  const effective = {} // base + input modulation, what sketches read
  let mappings = []
  const defaultMappings = [] // the sketch's own rt.mapInput() calls, for auto-map
  // Patch loads effect iframes with ?nomap=1 so they start with no reactivity
  // until the user opts in (Auto-map button); the defaults are still remembered.
  const noDefaultMap = urlParams.get('nomap') === '1'
  let announced = false

  const mouse = { x: 0.5, y: 0.5 }
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / window.innerWidth
    mouse.y = 1 - e.clientY / window.innerHeight
  })
  // Touch: the first finger's position + a held flag (distinct from mouse so a
  // touch surface can be mapped separately from a hovering cursor).
  const touch = { x: 0.5, y: 0.5, down: 0 }
  const setTouch = (e) => {
    const t = e.touches[0]
    if (!t) return
    touch.x = t.clientX / window.innerWidth
    touch.y = 1 - t.clientY / window.innerHeight
    touch.down = 1
  }
  window.addEventListener('touchstart', setTouch, { passive: true })
  window.addEventListener('touchmove', setTouch, { passive: true })
  window.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) touch.down = 0
  })

  // Device motion (accelerometer + gyroscope): tilt.x/y are orientation, shake
  // is acceleration magnitude. Enabled lazily when a tilt/shake mapping is used
  // (iOS needs a permission gesture — handled by a mounted button).
  const motion = { x: 0.5, y: 0.5, shake: 0 }
  let motionStarted = false
  let motionOk = false // a real sensor event has arrived
  let motionFallback = false // no sensor → tilt.x/y follow the mouse instead
  function startMotion() {
    if (motionStarted) return
    motionStarted = true
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null && e.beta == null) return
      motionOk = true
      if (e.gamma != null) motion.x = clamp(0.5 + e.gamma / 90, 0, 1) // left–right
      if (e.beta != null) motion.y = clamp(0.5 + e.beta / 90, 0, 1) // front–back
    })
    window.addEventListener('devicemotion', (e) => {
      const a = e.acceleration || e.accelerationIncludingGravity
      if (a && (a.x != null || a.y != null || a.z != null)) {
        motionOk = true
        const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0)
        motion.shake = Math.max(motion.shake, Math.min(1, mag / 22))
      }
    })
    // Many machines (laptops/desktops) have no motion sensor, so the events
    // never fire and a tilt mapping looks broken. If nothing arrives shortly,
    // fall back to steering tilt.x/y with the mouse so the mapping is usable.
    setTimeout(() => {
      if (!motionOk && !preview) {
        motionFallback = true
        showToast('No motion sensor — tilt follows the mouse')
      }
    }, 1600)
  }
  function enableMotion() {
    const DOE = window.DeviceOrientationEvent
    const DME = window.DeviceMotionEvent
    // iOS 13+ gates the sensors behind a permission request from a user gesture.
    const needsPrompt =
      (DOE && typeof DOE.requestPermission === 'function') ||
      (DME && typeof DME.requestPermission === 'function')
    if (needsPrompt) {
      mountMotionButton(async () => {
        try {
          if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission()
          if (DME && typeof DME.requestPermission === 'function') await DME.requestPermission()
          startMotion()
          return true
        } catch {
          return false
        }
      })
    } else {
      startMotion()
    }
  }

  // Low-frequency oscillators for the osc.* input sources (0..1, 4 s period).
  const OSC_PERIOD = 4000
  let oscHoldIdx = -1
  let oscHoldVal = Math.random()
  function oscVal(kind, now) {
    const ph = (now % OSC_PERIOD) / OSC_PERIOD // 0..1
    switch (kind) {
      case 'sine': return 0.5 + 0.5 * Math.sin(ph * Math.PI * 2)
      case 'triangle': return 1 - Math.abs(2 * ph - 1)
      case 'saw': return ph
      case 'square': return ph < 0.5 ? 1 : 0
      case 'random': {
        const idx = Math.floor(now / OSC_PERIOD)
        if (idx !== oscHoldIdx) { oscHoldIdx = idx; oscHoldVal = Math.random() }
        return oscHoldVal
      }
    }
    return 0
  }
  function sourceValue(source, now) {
    // Legacy alias: 'beat.*' was renamed to 'audio.*'; old saved scenes and
    // mappings keep working.
    const s = source.startsWith('beat.') ? 'audio.' + source.slice(5) : source
    // Numbered families: any midi.ccN / artnet.chN resolves, not just the few
    // listed in INPUT_SOURCES.
    if (s.startsWith('midi.cc')) return midi.state.cc[parseInt(s.slice(7), 10)] ?? 0
    if (s.startsWith('artnet.ch')) return artnet.state.ch[parseInt(s.slice(9), 10) - 1] ?? 0
    switch (s) {
      case 'audio.pulse': return beat.state.pulse
      case 'audio.level': return beat.state.level
      case 'audio.low': return beat.state.low
      case 'audio.mid': return beat.state.mid
      case 'audio.high': return beat.state.high
      case 'audio.volume': return beat.state.volume
      case 'audio.centroid': return beat.state.centroid
      case 'audio.flux': return beat.state.flux
      case 'mouse.x': return mouse.x
      case 'mouse.y': return mouse.y
      case 'touch.x': return touch.x
      case 'touch.y': return touch.y
      case 'touch.down': return touch.down
      case 'tilt.x': return motionFallback ? mouse.x : motion.x
      case 'tilt.y': return motionFallback ? mouse.y : motion.y
      case 'shake': return motion.shake
      case 'time.sin': return 0.5 + 0.5 * Math.sin(now * 0.001 * Math.PI * 0.2) // 10 s period
      case 'osc.sine':
      case 'osc.triangle':
      case 'osc.saw':
      case 'osc.square':
      case 'osc.random': return oscVal(s.slice(4), now)
      case 'midi.note': return midi.state.note
      case 'midi.velocity': return midi.state.velocity
      case 'leap.x': return leap.state.x
      case 'leap.y': return leap.state.y
      case 'leap.z': return leap.state.z
      case 'leap.pinch': return leap.state.pinch
      case 'leap.grab': return leap.state.grab
      default: return 0
    }
  }

  // A sensible smoothing default for an auto-declared mapping, by source type.
  // Impulse-y sources (a beat pulse, an onset, a shake) should stay punchy;
  // continuous but noisy ones (raw audio bands, loudness) want real inertia so
  // the reaction glides instead of chattering. Already-smooth sources (an LFO)
  // need none.
  function defaultSmooth(source) {
    if (source === 'time.sin' || source.startsWith('osc.')) return 0 // keep the waveform crisp
    if (/^(audio\.pulse|audio\.flux|shake|touch\.down|midi\.note)$/.test(source)) return 0.3
    if (source.startsWith('audio.')) return 0.75 // level/low/mid/high/volume/centroid
    if (source.startsWith('midi.')) return 0.4
    return 0.5 // mouse/touch position, tilt, leap, artnet
  }

  // Per-mapping smoothed source values (keyed by source→param) so a mapping's
  // `smooth` (0..1, inertia) makes live input glide instead of jumping.
  const smoothed = new Map()
  function applyModulation(now) {
    for (const name in base) effective[name] = base[name]
    for (const m of mappings) {
      const def = schema[m.param]
      if (!def || typeof def.min !== 'number') continue
      let v = sourceValue(m.source, now)
      const sm = m.smooth ?? 0
      if (sm > 0) {
        const key = m.source + '>' + m.param
        const prev = smoothed.get(key)
        v = prev == null ? v : prev * sm + v * (1 - sm)
        smoothed.set(key, v)
      }
      effective[m.param] = clamp(
        effective[m.param] + v * m.amount * (def.max - def.min),
        def.min,
        def.max,
      )
    }
  }

  function setMappings(next) {
    mappings = (next ?? []).filter((m) => m && m.source && m.param)
    if (preview) return
    if (mappings.some((m) => m.source.startsWith('audio.') || m.source.startsWith('beat.')))
      mountMicButton(beat)
    if (mappings.some((m) => m.source.startsWith('tilt.') || m.source === 'shake')) enableMotion()
    // External inputs connect lazily, only when something maps them.
    if (mappings.some((m) => m.source.startsWith('midi.'))) midi.start()
    if (mappings.some((m) => m.source.startsWith('leap.'))) leap.start()
    if (mappings.some((m) => m.source.startsWith('artnet.'))) artnet.start()
  }

  function announce() {
    if (announced) return
    announced = true
    queueMicrotask(() => {
      window.parent?.postMessage(
        { type: 'sketch:ready', schema, values: { ...base }, mappings: [...mappings], defaultMappings: [...defaultMappings] },
        '*',
      )
    })
  }

  window.addEventListener('message', (e) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'sketch:set-param' && msg.name in base) {
      base[msg.name] = msg.value
      applyModulation(performance.now())
    } else if (msg.type === 'sketch:set-mappings') {
      setMappings(msg.mappings)
    } else if (msg.type === 'sketch:apply-scene') {
      for (const [k, v] of Object.entries(msg.values ?? {})) if (k in base) base[k] = v
      setMappings(msg.mappings)
      applyModulation(performance.now())
    } else if (msg.type === 'input:beat' && msg.state) {
      // A parent compositor (Mixer/Patch) runs its own mic and feeds beat
      // state into embedded layers, which run in preview mode without their
      // own mic button. Pulse stays locally-driven via trigger()+decay.
      Object.assign(beat.state, msg.state)
      if (msg.beat) beat.trigger(msg.energy ?? 1)
    } else if (msg.type === 'sketch:pause') {
      setPaused(!!msg.paused)
    } else if (msg.type === 'sketch:auto-map') {
      // apply the sketch's own default input mappings on demand
      setMappings([...defaultMappings])
      window.parent?.postMessage(
        { type: 'sketch:ready', schema, values: { ...base }, mappings: [...mappings], defaultMappings: [...defaultMappings] },
        '*',
      )
    }
  })

  return {
    pixelRatio: quality.pixelRatio,
    detail: quality.detail,
    beat,

    // Seeded randomness for generative variation (see note above).
    seed,
    rng,
    random: (min = 0, max = 1) => min + (max - min) * rng(),
    pick: (arr) => arr[Math.floor(rng() * arr.length)],

    onBeat(cb) {
      if (!preview) mountMicButton(beat)
      beat.onBeat(cb)
    },

    // Opt in to accelerometer/gyro without a mapping (prompts on iOS).
    enableMotion() {
      if (!preview) enableMotion()
    },
    motion,

    params(def) {
      const view = {}
      for (const [name, spec] of Object.entries(def)) {
        schema[name] = spec
        base[name] = spec.value
        effective[name] = spec.value
        Object.defineProperty(view, name, { get: () => effective[name], enumerable: true })
      }
      announce()
      return view
    },

    mapInput(source, param, amount = 0.5, smooth = defaultSmooth(source)) {
      // Default mappings used to run with no inertia (smooth 0), so the param
      // snapped to the raw input every frame — visibly jumpy, especially in
      // Autopilot where every layer reacts to the shared mic at once. Give
      // each a source-appropriate smoothing unless the caller overrides it.
      defaultMappings.push({ source, param, amount, smooth })
      if (!noDefaultMap) setMappings([...mappings, { source, param, amount, smooth }])
    },

    tick(now = performance.now()) {
      fpsTick?.(now)
      beat.update(now)
      motion.shake *= 0.9 // shake decays like beat.pulse
      applyModulation(now)
    },
  }
}
