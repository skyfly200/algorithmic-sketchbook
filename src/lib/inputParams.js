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
