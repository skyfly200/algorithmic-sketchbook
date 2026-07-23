# Gallery & Viewer

## The gallery

The home page lists every experiment as a live card. Use the controls above the
grid to narrow it down:

- **Search** matches a sketch's title, description, tags and tech.
- **All / Embedded / External** filters by whether the sketch runs inline or
  links out to another site.
- **All / Effects / Filters** splits standalone generators from source
  [filters](#/docs/effects-filters).
- **Sort** — *Featured* (the curated default order), *A–Z*, *Newest*, or
  *Perf* (fastest first, using the on-device performance score).
- **Theme chips** (3D, Shader, Optics, Simulation, …) union together: picking
  several broadens the view rather than narrowing it to nothing.
- **Vibe filters** — *Element* (fire / water / earth / air), *Energy*
  (calm / energetic) and *Performance* (light / medium / heavy) — narrow by
  feel and by how demanding a sketch is.

Each card also shows small gauges for its measured performance so you can tell
at a glance what will run smoothly on your machine (see
[Performance](#/docs/offline) for how that number is produced).

## The viewer toolbar

Click a card to open the **viewer**, a full-window run of a single sketch with a
toolbar:

- **Graphics quality** sets both the rendering resolution (via `pixelRatio`) and
  the workload (via `detail`) the sketch scales itself by. Drop it on a heavy
  piece or a slow machine; raise it for a crisp capture.
- **FPS meter** toggles a live frame-rate readout, measured on *your* hardware.
- **🎲 Seed** re-rolls the seeded random stream. Most sketches derive part of
  their look from it, so each seed is a reproducible variation — and the seed is
  written into the URL, so a link reproduces exactly what you saw.
- **Fullscreen** hands the whole screen to the sketch.

## The controls panel

The controls panel lists the parameters the sketch declared — sliders, switches
and dropdowns. Adjust them and the sketch responds instantly; the values are
part of what a [scene](#/docs/scenes) saves.

Anything numeric can also be **driven by a live input**. Next to each numeric
parameter is a small mapping affordance: pick a source (audio, mouse, MIDI, …),
set an amount, and it modulates the value every frame. That's the same mapping
system described under [Inputs & mappings](#/docs/inputs).

A **🎤 mic button** appears on audio-reactive sketches. Grant microphone access
and their default audio mappings come alive — beats, loudness and spectral bands
start driving the motion. Nothing listens until you opt in.

## Keyboard & pointer

- **Space** pauses/resumes the sketch in the viewer.
- The pointer is passed through to the sketch, so pieces that react to the mouse
  or to touch respond directly.

## Present / display mode

**Present** is a chrome-free fullscreen projection view meant for installations
and screens: pick a sketch (or let it rotate through a set) and put it on a wall
with nothing else on screen. Deep-link a specific one with
`/#/present/<slug>`.
