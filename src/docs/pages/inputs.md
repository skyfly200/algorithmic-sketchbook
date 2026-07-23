# Inputs & mappings

A **mapping** routes a live input source into a numeric parameter. Every frame,
the runtime computes:

```
final = base + source × amount        (optionally smoothed, inverted or curved)
```

where `base` is the slider's own value. So a mapping *adds motion on top of*
whatever you set by hand — turn the slider to taste, then let the music (or your
hand, or a MIDI knob) push it around. Mappings are edited in the controls panel
and saved with [scenes](#/docs/scenes) and patches.

## Sources

| Source | What it is |
| --- | --- |
| `audio.pulse` | Beat detector — spikes to 1 on each detected beat and decays. |
| `audio.level` · `low` · `mid` · `high` | Overall loudness and three frequency bands. |
| `audio.volume` | Smoothed RMS volume. |
| `audio.centroid` | Spectral centroid — how "bright" the sound is. |
| `audio.flux` | Spectral flux — transients / how fast the spectrum is changing. |
| `mouse.x` · `mouse.y` | Pointer position across the window (y points up). |
| `touch.x` · `touch.y` · `touch.down` | First finger position, plus a held flag on touchscreens. |
| `tilt.x` · `tilt.y` · `shake` | Device accelerometer / gyro (falls back to the mouse where there's no sensor). |
| `time.sin` | A slow ~10-second oscillation — free automation with no hardware at all. |
| `midi.ccN` · `midi.note` · `midi.velocity` | Any WebMIDI controller; every CC number resolves (`midi.cc74`, …). |
| `leap.x` · `y` · `z` · `pinch` · `grab` | Leap Motion hand tracking. |
| `artnet.chN` | DMX channels received over Art-Net. |

All sources are normalised to roughly `0..1` (bipolar ones like tilt sit around
`0.5` at rest), so a single *amount* behaves predictably across them.

## Shaping a mapping

Beyond source and amount, a mapping can be shaped:

- **Smoothing** eases the value so it glides instead of snapping — good for
  audio, which is jittery frame to frame.
- **Invert** flips the response (`1 - source`).
- **Scale curve** bends the response — ease-in, ease-out or S-curve — so, say, a
  beat hits hard then tails off gently.

## Audio

Audio comes from the microphone in the solo viewer (after you grant the 🎤), or
from the **shared feed** in the [Mixer](#/docs/mixer), [Patch](#/docs/patch) and
[Autopilot](#/docs/autopilot) — one beat engine drives every layer in sync, so a
whole stacked mix pulses together. A few resonant pieces (the Rubens' tube,
cymatics) also take the raw FFT directly for physically-driven standing waves.

## Setting up the hardware inputs

- **MIDI** works over WebMIDI in Chromium-family browsers — plug in a
  controller and its CCs resolve automatically as `midi.ccN`.
- **Leap Motion** needs the Leap service running locally; the runtime connects
  to its websocket and exposes hand position and pinch/grab.
- **Art-Net** brings DMX into the browser through a small local bridge —
  run `npm run artnet-bridge` and channels arrive as `artnet.chN`. This is how a
  lighting desk can drive the visuals, or the visuals can be programmed from the
  same console as the rig.
- **Accelerometer / tilt** works on phones and tablets after the one-time motion
  permission prompt; on a desktop it quietly falls back to mouse position so
  mappings still do something.

Because inputs are just named sources, a sketch never cares *which* one you
pick — you can map a MIDI knob to the same parameter a beat was driving without
touching the sketch.
