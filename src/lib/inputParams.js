// Build the URL query fragment that carries the user's global setup into a
// sketch iframe. beat.js reads `aud` for getUserMedia's deviceId; inputs.js
// reads `midich` to filter MIDI to one channel; runtime.js reads `gpu` to hint
// the browser toward the dedicated graphics card. Returns '' when nothing is
// configured.
export function inputParams(settings) {
  const parts = []
  if (settings.audioDeviceId) parts.push('aud=' + encodeURIComponent(settings.audioDeviceId))
  if (settings.midiEnabled && settings.midiChannel) parts.push('midich=' + settings.midiChannel)
  if (settings.highPerformance) parts.push('gpu=high')
  return parts.length ? '&' + parts.join('&') : ''
}

// Group the flat INPUT_SOURCES list into the optgroups the mapping pickers show
// (audio, mouse, touch, tilt, time, leap, artnet). MIDI is hidden until it's set
// up in Settings, then surfaced as a fixed trio (the channel is chosen globally).
export function groupInputSources(sources, { midiEnabled = false } = {}) {
  const groups = { audio: [], midi: [], mouse: [], touch: [], tilt: [], time: [], leap: [], artnet: [] }
  for (const s of sources) {
    if (s.startsWith('midi.')) continue // handled below
    const head = s.split('.')[0]
    const g = head === 'shake' ? 'tilt' : head
    ;(groups[g] ?? (groups[g] = [])).push(s)
  }
  if (midiEnabled) groups.midi = ['midi.cc1', 'midi.note', 'midi.velocity']
  return Object.entries(groups).filter(([, list]) => list.length)
}
