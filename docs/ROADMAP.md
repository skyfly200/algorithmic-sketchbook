# Bright Waves — architecture roadmap

Where the project has got to and where it is heading: a unified input system, a
node-based compositor, and a growing library of effects and filters. This page
was rewritten after most of the original plan shipped; the original phases are
kept below with their status so the reasoning is not lost.

Working notes from recent performance work live next to the code:
[`roadmap.md`](../roadmap.md) (what was done, next steps) and
[`bugs.md`](../bugs.md) (open issues, things still to verify).

## Status at a glance

| Area | State |
| --- | --- |
| Input → parameter bus | **Shipped.** Audio/beat, pointer, time, MIDI (with learn), Leap, Art-Net, phone/OSC remote |
| Node compositor | **Shipped as Patch.** Visual node editor, two decks with a crossfader, cost model + device tiers, show cues, Output/popout |
| Simpler stacking | **Shipped:** Mixer (layers + blend modes), Autopilot (self-driving mixes) |
| Sketch registry | **Shipped.** 178 folders auto-discovered; 59 are *filters* that process a source |
| GPU filter path | **Shipped, still growing.** `glfilter.js` / `glpipe.js`; most per-pixel filters are fragment shaders |
| Single-context renderer | **Not done** — every effect/filter is still its own iframe (see §2) |
| Output mapping for projectors | **Partial** — Polygon + Mask + Portal nodes cover manual mapping; no edge-blend / keystone yet |

---

## 1. Unified input system — shipped

One place produces named, normalised (0..1) **signals**, so any sketch param can
be driven by any input without the sketch knowing the source.

- `sketches/_lib/runtime.js` — `rt.params()`, `rt.mapInput()`, the mapping editor,
  scenes, and "learn" (map the next control you move).
- `sketches/_lib/inputs.js` — providers: **MIDI** (Web MIDI), **Leap**, **Art-Net**
  and the **remote** relay (phone control surface + OSC). `scripts/artnet-bridge.mjs`
  and `scripts/remote-server.mjs` are the small local bridges browsers need for UDP.
- `sketches/_lib/beat.js` — audio analysis and beat detection.

Left to do: more providers as needed (direct OSC without the relay), and exposing
the same signals to `glfilter`/`glpipe` shaders as uniforms without JS glue.

---

## 2. Node-based compositor — shipped as Patch, with a known ceiling

Patch is the TouchDesigner-style editor: nodes for effects, filters, media,
text, sprites, masks, blends, control inputs, a geometry/camera pair (three.js)
and geodata, wired into an **Output**. On top of that:

- **Two decks** (`src/composables/useDecks.js`) with a master crossfader; node ids
  are unique across decks.
- **Cost model and tiers** (`src/lib/patch/budget.js`, documented in the in-app
  *Performance model* page): limits come from the graph's complexity, not from
  timing one machine.
- **Show cues** with pre-warmed standby frames; an NL designer; Autopilot.
- **Per-node scheduling** (`src/lib/patch/scheduler.js`): culls nodes that can't
  reach the Output, idles them at a few fps, and steps low-priority nodes down
  when the display rate can't be held.

### The ceiling

The original plan called for a **single-context renderer**: sketches as modules
that draw into one shared WebGL context, composited by the graph, because
per-frame cross-iframe texture transfer is costly. That has *not* been built.
Today each effect/filter is an iframe and a filter is fed its input as an
`ImageBitmap` each frame. The mitigations so far — skipping unchanged frames,
throttling, culling, baking and GPU ports — reduce the cost but don't remove the
structure. The remaining options, in increasing effort:

1. A shared **filter-chain** path: consecutive shader filters in Patch run as one
   GL pipeline (`glpipe`-style) instead of one iframe + transfer each.
2. A node-module interface (`createNode({ params, inputs, render(target, textures,
   signals, t) })`) for shader sketches, so a graph of them shares a context.
3. Full single-context compositing, with Canvas2D sketches as texture sources.

### Output and projection

The compositor's Output goes fullscreen through display mode or a pop-out window.
Still open: dedicated output mapping (edge-blend, keystone) and a spanning /
multi-display option.

---

## 3. Effects and filters

### Filters
The filter set (`src/registry/filters.js`) now covers blur (Gaussian, downsample,
pyramid, bokeh), edge detection, Kuwahara, emboss, sharpen, tilt-shift, gradient
map, solarize, duotone, invert, vignette, crystallize, mosaic, pixelate, displace,
ripple, pinch, spherize, polar coordinates, glowing edges, plus the older
camera-lens, CRT, VHS, halftone, painterly, pointillism and others. Three demo
scenes (landscape, test chart, night city) make them easy to judge — press **D**.

Ideas not built yet: median and oil-paint, difference-of-Gaussians, lens blur with
highlight boost, more colour-grading tools (LUT loading, split-toning).

### Effect backlog from the original plan

| Idea | Status |
| --- | --- |
| Interference rings | done (`interference-rings`) |
| Diffraction-grating "fireworks glasses" | done (`diffraction-grating-3d`) |
| Thin-film / soap-bubble iridescence | done (`soap-film`, `opalescence`, `blowing-bubbles`) |
| Caustics through glass / water | done (`caustic-water`, `caustics-art`) |
| Boiling water / Leidenfrost bubbles | done (`rolling-boil`, `foam-cells`) |
| Droplets on a surface (hydrophobicity) | done (`hydrophobic`, `droplet-bounce`) |
| Ice structures | partial (`frost-grow`); bubbles/lensing/subsurface not done |
| Fractals (escape-time, orbit traps, deep zoom) | done (`fractal-explorer`, `mandelbulb`, `self-similar-fractals`, `voronoi-fractal`) |

New effects should declare params and use `rt.mapInput` so they are immediately
mappable, scene-saveable and projectable. See `CLAUDE.md` for the authoring
conventions, including how to keep per-pixel filters on the GPU.

### To explore: text-based sketch tagging for Autopilot

Autopilot picks sketches from hand-written tags. Tags miss mood and energy, so picks feel random.
[Laya](https://github.com/NandhaKishorM/laya) is a text-only classifier. It answers typed
questions (choice, 1-N score, yes/no probability) over text in one forward pass.

- **Idea:** Run each sketch's `title`, `description` and `tags` through questions such as
  "mood: calm / aggressive / glitchy" and "energy, 1 to 5". Store the answers in `sketch.json`.
  Autopilot then picks the next sketch by mood or energy.
- **Constraint:** The app is static. A 300-400M parameter model cannot ship in the bundle.
  Run it offline in a build-time script only.
- **Option:** A prompt-driven Autopilot ("something underwater and slow") could score every
  sketch against the prompt text.
- **Not a fit:** Beat detection (use `rt.onBeat`) and performance scheduling
  (`scheduler.js`, `budget.js`). Both are deterministic and need no model.
- **First step:** Compare Laya with a small embedding model or a one-off LLM call over the
  manifests. Pick whichever is cheapest to run and review by hand.

---

## Suggested order from here

1. **Measure on real hardware.** Run `npm run bench` and `npm run perf` on a
   machine with a real GPU; the current grades came from headless runs.
2. **Shared filter chain in Patch** (§2, option 1) — the biggest remaining win for
   patches that stack several filters.
3. Bring the **scheduler to Mixer and Autopilot**, and let Patch's cost model use
   real throttled rates instead of assuming full rate.
4. **Output mapping** (edge-blend / keystone) for projectors.
5. More filters and effects from the lists above.
6. **Explore** build-time mood and energy tagging for Autopilot (see above).
