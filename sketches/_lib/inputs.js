/**
 * External input backends for the mapping system: MIDI, Leap Motion, ArtNet.
 * Each exposes a `state` the runtime samples per-frame and a lazy `start()`
 * that the runtime calls the first time a mapping uses that source family —
 * so sketches pay nothing for inputs they don't map.
 *
 *   MIDI    — Web MIDI API (Chrome/Edge). Sources: midi.cc1…cc16 (any CC
 *             number resolves), midi.note (gate: 1 while any key held),
 *             midi.velocity (last note-on velocity).
 *   LEAP    — Leap Motion / Ultraleap's local WebSocket service
 *             (ws://localhost:6437). Sources: leap.x/y/z (palm position,
 *             normalized 0..1), leap.pinch, leap.grab.
 *   ARTNET  — Browsers can't receive UDP, so `npm run artnet-bridge` runs a
 *             tiny local bridge (scripts/artnet-bridge.mjs) that listens for
 *             ArtDMX on UDP :6454 and re-serves it as Server-Sent Events on
 *             http://localhost:9321/artnet. Sources: artnet.ch1…ch32 (DMX
 *             channels of the last received universe, 0..1).
 */

export function createMidiInput() {
  const state = { cc: {}, note: 0, velocity: 0, held: 0 }
  let started = false
  function start() {
    if (started) return
    started = true
    if (!navigator.requestMIDIAccess) return
    navigator
      .requestMIDIAccess()
      .then((access) => {
        const bind = () => {
          for (const input of access.inputs.values()) input.onmidimessage = onMsg
        }
        access.onstatechange = bind
        bind()
      })
      .catch(() => {})
  }
  function onMsg(e) {
    const [status, d1, d2] = e.data
    const type = status & 0xf0
    if (type === 0xb0) {
      state.cc[d1] = d2 / 127 // control change
    } else if (type === 0x90 && d2 > 0) {
      state.held++
      state.note = 1
      state.velocity = d2 / 127
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      state.held = Math.max(0, state.held - 1)
      if (state.held === 0) state.note = 0
    }
  }
  return { state, start }
}

export function createLeapInput() {
  const state = { x: 0.5, y: 0.5, z: 0.5, pinch: 0, grab: 0 }
  let started = false
  function start() {
    if (started) return
    started = true
    connect()
  }
  function connect() {
    let ws
    try {
      ws = new WebSocket('ws://localhost:6437/v6.json')
    } catch {
      return
    }
    ws.onopen = () => ws.send(JSON.stringify({ background: true }))
    ws.onmessage = (e) => {
      let f
      try {
        f = JSON.parse(e.data)
      } catch {
        return
      }
      const hand = f.hands?.[0]
      if (!hand) return
      const box = f.interactionBox
      const p = hand.palmPosition
      if (p && box?.size?.[0]) {
        state.x = clamp01((p[0] - box.center[0]) / box.size[0] + 0.5)
        state.y = clamp01((p[1] - box.center[1]) / box.size[1] + 0.5)
        state.z = clamp01((p[2] - box.center[2]) / box.size[2] + 0.5)
      }
      state.pinch = hand.pinchStrength ?? 0
      state.grab = hand.grabStrength ?? 0
    }
    // The Leap service may not be running; retry occasionally.
    ws.onclose = () => setTimeout(connect, 5000)
    ws.onerror = () => ws.close()
  }
  return { state, start }
}

export function createArtnetInput() {
  const state = { ch: new Float32Array(512) }
  let started = false
  function start() {
    if (started) return
    started = true
    connect()
  }
  function connect() {
    let es
    try {
      es = new EventSource('http://localhost:9321/artnet')
    } catch {
      return
    }
    es.onmessage = (e) => {
      try {
        const { data } = JSON.parse(e.data)
        for (let i = 0; i < data.length && i < 512; i++) state.ch[i] = data[i] / 255
      } catch {
        /* malformed frame */
      }
    }
    es.onerror = () => {
      es.close()
      setTimeout(connect, 5000) // bridge may not be running yet
    }
  }
  return { state, start }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}
