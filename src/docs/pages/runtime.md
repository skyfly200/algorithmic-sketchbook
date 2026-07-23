# Runtime API

Everything a sketch needs comes from `sketches/_lib/runtime.js`:

```js
import { createRuntime } from '../_lib/runtime.js'
const rt = createRuntime()
```

`createRuntime()` reads the URL for quality/seed/preview flags, sets up the beat
detector and input system, and returns the object documented below.

## Quality & timing

| Member | Description |
| --- | --- |
| `rt.pixelRatio` | Canvas pixels per CSS pixel for the current quality. Use it instead of `devicePixelRatio` when sizing the canvas. |
| `rt.detail` | A `0..1` workload factor. Multiply particle counts, iteration limits, grid sizes by it so quality settings scale the load. |
| `rt.tick(now)` | Call **once per frame** with the `requestAnimationFrame` timestamp. Advances the FPS meter, the beat detector and input modulation. |

## Parameters

```js
const params = rt.params({
  speed:  { value: 1, min: 0.2, max: 4, step: 0.1, label: 'Speed' },
  mode:   { value: 'A', type: 'select', options: ['A', 'B'], label: 'Mode' },
  glow:   { value: true, type: 'bool', label: 'Glow' },
  reseed: { type: 'action', label: 'New pattern' },
})
```

`rt.params(def)` returns a live view object: read `params.speed` in your loop and
you get the base value **plus any input modulation**, already applied. Spec
fields:

- Numeric: `value`, `min`, `max`, `step`, `label`.
- `type: 'bool'` → a switch. `type: 'select'` with `options: [...]` → a
  dropdown. `type: 'action'` → a button (no stored value).
- Register a button's handler with `rt.onAction('reseed', () => …)`.

Declaring params is what gives the sketch a controls panel and makes those
values part of a [scene](#/docs/scenes). Numeric params are also mappable.

## Input mappings

```js
rt.mapInput('audio.pulse', 'speed', 0.4)   // source, param, amount, [smooth]
```

Adds a default mapping: `source × amount × (max − min)` is added to the param's
base each frame. Users can add, edit or remove mappings in the controls panel;
your defaults are just a starting point (and power the *Auto-map* button). The
full list of sources is on the [Inputs](#/docs/inputs) page. `INPUT_SOURCES` is
also exported from the runtime if you need it programmatically.

Besides the audio/hardware sources, the runtime provides free automation:
`time.sin` (a slow oscillation) and an `osc.*` family (sine and sample-and-hold
random) that need no hardware at all.

## Beats & audio

```js
rt.onBeat(({ energy }) => { /* trigger something on each beat */ })
```

- `rt.onBeat(cb)` — fires on detected beats and mounts the 🎤 mic button.
- `rt.beat.state` — `{ active, pulse, level, low, mid, high, volume, centroid,
  flux }`. `pulse` decays `1 → 0` after each beat, so `rt.beat.state.pulse` is a
  ready-made per-frame flash.
- `rt.beat.trigger(energy)` — fire a beat manually (a keyboard/click fallback).
- `rt.beat.getSpectrum()` — the raw FFT bins, for resonant pieces that want the
  spectrum directly (cymatics, Rubens' tube).

In the Mixer, Patch and Autopilot the parent runs one shared mic and feeds beat
state into every sketch, so `rt.beat.state` is populated even without the
sketch's own microphone.

## Seeded randomness

| Member | Description |
| --- | --- |
| `rt.seed` | The numeric seed for this run (from `?seed=` or freshly rolled). |
| `rt.rng()` | Deterministic `0..1` stream (mulberry32) seeded by `rt.seed`. |
| `rt.random(min, max)` | Convenience uniform in a range. |
| `rt.pick(arr)` | Pick a random element. |

Derive anything generative from these and the 🎲 button reproduces a look, while
`?seed=<base36>` deep-links an exact one.

## Motion sensors

`rt.enableMotion()` opts into the accelerometer/gyro without needing a mapping
(and triggers the mobile motion-permission prompt where required). `rt.motion`
exposes the current tilt / shake state.

## The messaging bridge

Under the hood the host and sketch talk over `postMessage`, which is what lets
the same sketch run identically solo, in the Mixer, in Patch and in Autopilot:

- The sketch **announces** its `{ schema, values, mappings }` when ready.
- The host posts `sketch:set-param`, `sketch:set-mappings`, `sketch:action`,
  `sketch:pause`, and `sketch:announce` (re-request the announce).
- A parent compositor feeds `input:beat` so shared audio reaches every layer.

You never write this by hand — it all falls out of `rt.params()`, `rt.mapInput()`
and `rt.tick()`.
