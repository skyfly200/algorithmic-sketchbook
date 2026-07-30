// Build the URL query fragment that carries the user's global input setup
// (chosen audio device + MIDI channel) into a sketch iframe. beat.js reads
// `aud` for getUserMedia's deviceId; inputs.js reads `midich` to filter MIDI
// to one channel. Returns '' when nothing is configured.
export function inputParams(settings) {
  const parts = []
  if (settings.audioDeviceId) parts.push('aud=' + encodeURIComponent(settings.audioDeviceId))
  if (settings.midiEnabled && settings.midiChannel) parts.push('midich=' + settings.midiChannel)
  return parts.length ? '&' + parts.join('&') : ''
}
