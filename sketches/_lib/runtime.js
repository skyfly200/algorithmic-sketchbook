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
 *   rt.mapInput('beat.pulse', 'speed', 0.35)  // default input→param mapping
 *
 * Declaring params connects the sketch to the viewer over postMessage: the
 * viewer renders sliders, edits mappings, and saves/applies scenes
 * (param values + input mappings + display settings). Input sources:
 * beat.pulse, beat.level, mouse.x, mouse.y, time.sin — each 0..1; a mapping's
 * amount (-1..1) adds source × amount × (max − min) to the param's base value.
 *
 * Everything is opt-in — sketches that ignore all of this still work.
 */
import { createBeatDetector } from './beat.js'

export const INPUT_SOURCES = ['beat.pulse', 'beat.level', 'mouse.x', 'mouse.y', 'time.sin']

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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function createRuntime() {
  const urlParams = new URLSearchParams(location.search)
  const quality = QUALITY[urlParams.get('quality')] ?? QUALITY.native
  // Preview mode (gallery thumbnail iframes): no overlay chrome, no mic button.
  const preview = urlParams.get('preview') === '1'
  const fpsTick = !preview && urlParams.get('fps') === '1' ? mountFpsMeter() : null

  const beat = createBeatDetector()

  // --- param engine ------------------------------------------------------
  const schema = {}
  const base = {} // values as set by the sketch / viewer / scene
  const effective = {} // base + input modulation, what sketches read
  let mappings = []
  let announced = false

  const mouse = { x: 0.5, y: 0.5 }
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / window.innerWidth
    mouse.y = 1 - e.clientY / window.innerHeight
  })

  function sourceValue(source, now) {
    switch (source) {
      case 'beat.pulse': return beat.state.pulse
      case 'beat.level': return beat.state.level
      case 'mouse.x': return mouse.x
      case 'mouse.y': return mouse.y
      case 'time.sin': return 0.5 + 0.5 * Math.sin(now * 0.001 * Math.PI * 0.2) // 10 s period
      default: return 0
    }
  }

  function applyModulation(now) {
    for (const name in base) effective[name] = base[name]
    for (const m of mappings) {
      const def = schema[m.param]
      if (!def || typeof def.min !== 'number') continue
      effective[m.param] = clamp(
        effective[m.param] + sourceValue(m.source, now) * m.amount * (def.max - def.min),
        def.min,
        def.max,
      )
    }
  }

  function setMappings(next) {
    mappings = (next ?? []).filter((m) => m && m.source && m.param)
    if (!preview && mappings.some((m) => m.source.startsWith('beat.'))) mountMicButton(beat)
  }

  function announce() {
    if (announced) return
    announced = true
    queueMicrotask(() => {
      window.parent?.postMessage(
        { type: 'sketch:ready', schema, values: { ...base }, mappings: [...mappings] },
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
    }
  })

  return {
    pixelRatio: quality.pixelRatio,
    detail: quality.detail,
    beat,

    onBeat(cb) {
      if (!preview) mountMicButton(beat)
      beat.onBeat(cb)
    },

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

    mapInput(source, param, amount = 0.5) {
      setMappings([...mappings, { source, param, amount }])
    },

    tick(now = performance.now()) {
      fpsTick?.(now)
      beat.update(now)
      applyModulation(now)
    },
  }
}
