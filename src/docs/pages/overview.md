# Overview

**Bright Waves** is an algorithmic sketchbook — a curated gallery of interactive
computer-graphics experiments, each a self-contained page the site embeds live.
What you see in a gallery card is the real sketch running, not a screenshot.

This guide is split into pages (see the sidebar). If you just want to *play*,
open the gallery and click a card. If you want to *perform* with the work, head
to the [Mixer](#/docs/mixer), [Patch](#/docs/patch) or [Autopilot](#/docs/autopilot).
If you want to *build* your own experiment, jump to
[Authoring experiments](#/docs/authoring).

## The big picture

Everything is a **static site** — Vue 3 + Vite on the outside, and a folder of
standalone sketches on the inside. There is no server. Each sketch under
`sketches/<slug>/` is its own tiny web page (an `index.html` plus a
`sketch.js`), and the gallery discovers it automatically from a `sketch.json`
manifest. The app iframes that page to show it live, which is why a sketch can
use whatever it likes internally (Canvas 2D, WebGL, three.js, p5.js) while still
plugging into shared features like the controls panel, input mappings and
scenes.

Two ideas make all of that hang together:

- **The runtime.** Every sketch imports `sketches/_lib/runtime.js`. It supplies
  the seeded RNG, the graphics-quality settings, beat detection, and the
  parameter/mapping system. Declaring parameters is all it takes to get a
  controls panel, live input modulation and scene support everywhere.
- **The messaging bridge.** The host app and the sketch talk over `postMessage`,
  so the same sketch works identically in the solo viewer, stacked in the Mixer,
  wired into a Patch graph, or dealt by Autopilot.

## What you can do

| Area | What it's for |
| --- | --- |
| [Gallery & Viewer](#/docs/viewer) | Browse, search, sort and open a single experiment; tweak its parameters; re-roll its seed. |
| [Inputs & mappings](#/docs/inputs) | Drive any parameter from audio, mouse, touch, the device tilt sensor, MIDI, hand tracking or Art-Net. |
| [Scenes & Library](#/docs/scenes) | Save named snapshots of a look and deep-link them; collect saved patches and mixes. |
| [Mixer](#/docs/mixer) | Stack sketches as blended layers, like a VJ deck. |
| [Patch](#/docs/patch) | Wire sketches, filters and control signals into a node graph. |
| [Autopilot](#/docs/autopilot) | Hands-free, ever-evolving mixes with perf-aware routing. |
| [Effects vs filters](#/docs/effects-filters) | The two kinds of sketch and how filters consume a feed. |
| [Offline & installing](#/docs/offline) | Install it as an app and run the whole thing with no network. |

## Getting around

The top navigation switches between the gallery, the studio views (Mixer, Patch,
Autopilot), the Library, Docs and Settings. Deep links use the URL hash
(`/#/sketch/<slug>`, `/#/docs/patch`, …) so every route is bookmarkable and works
on any static host — and now, [fully offline](#/docs/offline).
