/**
 * Energy-based beat detector on top of the Web Audio API.
 *
 * Watches the bass band of the microphone signal and fires when the current
 * energy spikes above its recent rolling average. Microphone access requires
 * a user gesture, so `start()` is meant to be called from a click handler —
 * the runtime mounts a mic toggle button that does this for you.
 *
 *   const beat = createBeatDetector()
 *   beat.onBeat(({ energy }) => { ... })
 *   beat.update(now)     // call once per animation frame
 *   beat.state.pulse     // 1 on beat, decays toward 0 — drive visuals with it
 *   beat.state.level     // live bass energy 0..1
 *   beat.trigger()       // fire a beat manually (click/keyboard fallback)
 */
export function createBeatDetector({
  threshold = 1.35, // energy must exceed rolling average by this factor
  minEnergy = 0.12, // ignore near-silence
  minIntervalMs = 220, // refractory period (~270 BPM ceiling)
  pulseDecay = 0.94, // per-frame decay of state.pulse
} = {}) {
  let audioCtx = null
  let analyser = null
  let stream = null
  let bins = null
  let history = []
  let lastBeat = 0
  const callbacks = []

  // level = bass energy (kept for existing beat.level mappings); low/mid/high
  // are per-band energies and volume is the broadband average — all 0..1.
  // interval = smoothed ms between recent beats; bpm derived from it.
  const state = { active: false, level: 0, pulse: 0, low: 0, mid: 0, high: 0, volume: 0, interval: 0, bpm: 0 }
  let prevBeatAt = 0

  // Record a beat's timing to estimate tempo (used by beat-synced effects).
  function noteBeat(now) {
    if (prevBeatAt) {
      const dt = now - prevBeatAt
      if (dt > 100 && dt < 2000) {
        // 30–600 BPM
        state.interval = state.interval ? state.interval * 0.7 + dt * 0.3 : dt
        state.bpm = Math.round(60000 / state.interval)
      }
    }
    prevBeatAt = now
  }

  async function start() {
    if (state.active) return
    // getUserMedia only exists in a secure context (https:// or localhost).
    // Surface that clearly instead of letting a bare TypeError bubble up.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const err = new Error('Microphone needs a secure context (https or localhost).')
      err.name = 'InsecureContextError'
      throw err
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    // Autoplay policies can leave the context suspended until a user gesture;
    // start() is called from a click, so resume() here is allowed.
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.4
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    bins = new Uint8Array(analyser.frequencyBinCount)
    history = []
    state.active = true
  }

  function stop() {
    stream?.getTracks().forEach((t) => t.stop())
    audioCtx?.close()
    audioCtx = analyser = stream = bins = null
    state.active = false
    state.level = state.low = state.mid = state.high = state.volume = 0
    state.interval = state.bpm = 0
    prevBeatAt = 0
  }

  // Average a contiguous FFT-bin range, normalized to 0..1.
  function bandEnergy(lo, hi) {
    let sum = 0
    for (let i = lo; i <= hi; i++) sum += bins[i]
    return sum / ((hi - lo + 1) * 255)
  }

  function trigger(energy = 1) {
    const now = performance.now()
    lastBeat = now
    noteBeat(now)
    state.pulse = 1
    for (const cb of callbacks) cb({ energy })
  }

  function update(now = performance.now()) {
    state.pulse *= pulseDecay
    if (!state.active) return

    analyser.getByteFrequencyData(bins)
    // Split the spectrum into bands (bin width ≈ sampleRate/fftSize ≈ 86 Hz).
    const energy = bandEnergy(1, 8) // bass ~90–750 Hz — where kicks live
    state.level = energy
    state.low = energy
    state.mid = bandEnergy(9, 48) // ~0.8–4 kHz — vocals, snares
    state.high = bandEnergy(49, 160) // ~4–14 kHz — hats, cymbals, air
    state.volume = bandEnergy(1, 200) // broadband loudness

    history.push(energy)
    if (history.length > 45) history.shift() // ~0.75 s at 60 fps

    const avg = history.reduce((a, b) => a + b, 0) / history.length
    if (
      history.length > 20 &&
      energy > minEnergy &&
      energy > avg * threshold &&
      now - lastBeat > minIntervalMs
    ) {
      lastBeat = now
      noteBeat(now)
      state.pulse = 1
      for (const cb of callbacks) cb({ energy })
    }
  }

  return {
    state,
    start,
    stop,
    update,
    trigger,
    onBeat(cb) {
      callbacks.push(cb)
    },
  }
}
