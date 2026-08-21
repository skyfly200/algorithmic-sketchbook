// The query fragment that carries global input setup into a sketch iframe. Only
// configured options appear, and it must start with '&' (it's appended to an
// existing query string) or be empty.
import { describe, it, expect } from 'vitest'
import { inputParams } from '../src/lib/inputParams.js'

describe('inputParams', () => {
  it('returns empty when nothing is configured', () => {
    expect(inputParams({})).toBe('')
    // MIDI enabled but "all channels" (0) contributes nothing
    expect(inputParams({ midiEnabled: true, midiChannel: 0 })).toBe('')
    // a device id that isn't set is skipped
    expect(inputParams({ audioDeviceId: '', highPerformance: false })).toBe('')
  })
  it('encodes an audio device id', () => {
    expect(inputParams({ audioDeviceId: 'abc 123' })).toBe('&aud=abc%20123')
  })
  it('includes a specific MIDI channel only when MIDI is enabled', () => {
    expect(inputParams({ midiEnabled: true, midiChannel: 5 })).toBe('&midich=5')
    expect(inputParams({ midiEnabled: false, midiChannel: 5 })).toBe('')
  })
  it('adds the GPU hint when high performance is on', () => {
    expect(inputParams({ highPerformance: true })).toBe('&gpu=high')
  })
  it('joins multiple parts with & and leads with &', () => {
    const q = inputParams({ audioDeviceId: 'mic', midiEnabled: true, midiChannel: 3, highPerformance: true })
    expect(q).toBe('&aud=mic&midich=3&gpu=high')
  })
})

import { groupInputSources } from '../src/lib/inputParams.js'
describe('groupInputSources', () => {
  const SRC = ['audio.pulse', 'audio.low', 'mouse.x', 'shake.x', 'time.saw', 'midi.cc1', 'leap.pinch']
  it('buckets sources by their prefix and folds shake→tilt', () => {
    const g = Object.fromEntries(groupInputSources(SRC, {}))
    expect(g.audio).toEqual(['audio.pulse', 'audio.low'])
    expect(g.mouse).toEqual(['mouse.x'])
    expect(g.tilt).toEqual(['shake.x']) // shake folds into tilt
    expect(g.leap).toEqual(['leap.pinch'])
  })
  it('drops empty groups and hides MIDI until enabled', () => {
    const off = Object.fromEntries(groupInputSources(SRC, { midiEnabled: false }))
    expect(off.midi).toBeUndefined()
    const on = Object.fromEntries(groupInputSources(SRC, { midiEnabled: true }))
    expect(on.midi).toEqual(['midi.cc1', 'midi.note', 'midi.velocity'])
  })
})
