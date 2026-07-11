# Bright Waves — architecture roadmap

Notes on where this is heading: a node-based effect compositor, a unified input
system, and the effect ideas to build. Written against what already exists so
each phase is an increment, not a rewrite.

## What we already have (the foundations)

Two primitives already in the repo do most of the conceptual work:

1. **An input → parameter bus.** `sketches/_lib/runtime.js` lets a sketch
   declare `rt.params(...)` and map *sources* onto them
   (`beat.pulse/level/low/mid/high/volume`, `mouse.x/y`, `time.sin`). The
   mapping editor + scenes already are a working "signals drive parameters"
   layer. **This is the seed of the unified input system.**
2. **An effect → effect bus.** `sketches/_lib/motion-bus.js` broadcasts one
   sketch's output (the motion mask) to others over `BroadcastChannel`;
   `motion-layer` consumes it. **This is the seed of node graph edges.**

Plus: scenes (saveable state), display/projection mode, and a registry that
treats every sketch uniformly. The plan below generalizes these three.

---

## 1. Unified input system (ArtNet · MIDI · audio · Leap · OSC)

Goal: one place that produces named, normalized (0..1) **signals**, so any
sketch param can be driven by any input without the sketch knowing the source.

### Design

Introduce `sketches/_lib/inputs.js` — a small registry of **providers**. Each
provider exposes named channels and a `read(name)` (or pushes values into a
shared table). The runtime's `sourceValue()` becomes a lookup into this table
instead of a hardcoded `switch`.

```
inputs.register(provider)   // provider: { id, channels(): string[], value(name) }
inputs.value('midi.cc.74')  // 0..1
inputs.channels()           // dynamic list for the mapping dropdown
```

Providers (each is ~a file, added independently):

| Provider | Transport | Example channels | Notes |
| --- | --- | --- | --- |
| **audio** (done) | Web Audio | `beat.pulse`, `beat.low/mid/high`, `beat.volume` | already in `beat.js` |
| **pointer** (done) | DOM events | `mouse.x`, `mouse.y` | already in runtime |
| **time** (done) | clock | `time.sin`, add `time.saw`, `time.bpm` | |
| **MIDI** | Web MIDI API | `midi.cc.<n>`, `midi.note.<n>`, `midi.pitchbend` | browser-native, no bridge; iframe needs `allow="midi"` |
| **OSC / ArtNet** | WebSocket → tiny local bridge | `osc./<addr>`, `artnet.<universe>.<ch>` | browsers can't do UDP; a ~50-line Node bridge (ws↔UDP) publishes frames the page subscribes to. Lives in `tools/` like moiré's repo already does |
| **Leap Motion** | Leap WebSocket (`ws://localhost:6437`) | `leap.hand.x/y/z`, `leap.pinch`, `leap.grab` | Leap's service already speaks WebSocket JSON — connect directly |

Why this shape: the mapping UI, scenes, and every existing sketch keep working
unchanged — they just see more channel names. Sources become *dynamic* (MIDI
CCs appear as you touch a knob), so the dropdown should list
`inputs.channels()` instead of a constant.

### Phases
- **1a** Refactor `runtime.js` sources into `inputs.js` (no behavior change).
- **1b** Add the MIDI provider + `allow="midi"` on the viewer iframe; dropdown
  reads dynamic channels; add a "learn" button (map the next CC you move).
- **1c** Add the OSC/ArtNet WebSocket bridge in `tools/` + provider.
- **1d** Add the Leap provider.

---

## 2. Node-based effect compositor (TouchDesigner-style)

Goal: wire multiple effects together — output of one as input/mask of another —
on a visual signal-flow canvas, then project the result.

### The model
A **patch** is a graph: nodes are effects (existing sketches) + utility nodes
(mask, blend, feedback, transform); edges carry either **textures** (video
frames) or **signals** (the 0..1 inputs above). This is exactly the two buses
generalized:
- signal edges = the input system (§1)
- texture edges = the motion-bus generalized to "any sketch can publish/consume
  a frame on a named channel"

### Rendering reality check
Today each sketch is its own `<iframe>` — great for isolation, wrong for
compositing (per-frame cross-iframe texture transfer is too costly). So the
compositor needs a **single-context renderer**: convert sketches to modules
that draw into a shared WebGL context (render-to-texture per node), and
composite along the graph. Canvas2D/p5 sketches render to an offscreen canvas
used as a texture. This is the one real piece of new engine work.

### Phases
- **2a** Define a node module interface: `createNode({ params, inputs[], render(target, textures, signals, t) })`. Port 2–3 shader sketches to it (they already draw to a fullscreen quad — easiest).
- **2b** A minimal graph runner (no UI): a JSON patch → topologically ordered render-to-texture chain → screen. Prove `interference-rings → motion mask → blend` composites.
- **2c** Visual node editor (Vue): drag nodes, connect ports, edit params inline. Reuse the scenes store for save/load of patches.
- **2d** Projection: the patch's final node goes fullscreen via the existing
  **display mode**; add output mapping (resolution, edge-blend/keystone) for
  projectors and a spanning/second-screen option.

### Reusing what's here
- **Scenes** already serialize params+mappings → extend to serialize a patch.
- **Display mode** already does chrome-free fullscreen switching → it becomes
  the compositor's output/preview surface.
- **external.json** projects (moiré, caustics, holographic) can be nodes too,
  via an iframe-texture node when single-context porting isn't worth it.

---

## 3. Effect ideas (backlog)

Grouped by the engine they need. `*` = good next builds (self-contained shaders).

**Interference / diffraction**
- Interference Rings (done) — zone-plate moiré
- Refraction through advanced diffraction gratings — "fireworks glasses" with
  the holographic app's grating types (linear/radial/spiral/star) *
- Thin-film / soap-bubble iridescence *

**Fluids & optics (mostly shader / RTT)**
- Caustics through glass objects (refraction + environment) — pairs with the
  linked caustics project
- Boiling water / Leidenfrost bubbles — metaballs + thin-film shading
- Water droplets on a surface (aspen-leaf hydrophobicity) — SDF droplets + lensing *
- Ice structures — bubbles, internal lensing, subsurface opacity

**Systems**
- Fractals — escape-time (Mandelbrot/Julia) and orbit traps, deep-zoom * 

Each should declare params and lean on the input system so it's immediately
mappable and projectable.

---

## Suggested order
1. **1a + 1b** (inputs refactor + MIDI) — unlocks hardware control everywhere, low risk.
2. A couple of shader effects from §3 (fractals, gratings) — fast wins, exercise the params/mapping path.
3. **2a + 2b** (node interface + headless graph runner) — the core of chaining.
4. **2c/2d** (node UI + projection output) and **1c/1d** (OSC/ArtNet, Leap).
