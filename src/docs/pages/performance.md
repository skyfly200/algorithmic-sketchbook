# Performance model

Patch decides what a machine can handle from a **cost model**, not from timing
one computer. The model is a set of formulas over the graph, so the same patch
gets the same verdict on a laptop with no GPU and on a workstation — only the
*limits* change, and those come from a device **tier**.

## What a graph costs

For one deck: **P** = compositor pixels (width × height), **V** = nodes,
**F** = effect/filter nodes (each one is a live page in its own iframe).

| Resource | Formula | Grows with |
|---|---|---|
| GPU / raster work | Σ over effects of *w(sketch)* · P/P₀, plus a small constant per other node | pixels × effect weight |
| Main-thread blit | one clear + draw of P pixels per node | V · P |
| Graph ordering | O(V + E), recomputed **only when wiring changes** | V + E (not per frame) |
| Memory | per effect: ~30 MB page + 3 canvas buffers of P·4 bytes (+60 MB for three.js); per node: one P·4 output canvas | F · (30 MB + P) |

*w(sketch)* is the relative weight from the perf audit (`npm run perf`, cheap = 1,
heavy = 12). It is used as a *ratio*, never as milliseconds, so it doesn't depend
on the machine that produced it. Filters add one image upload per frame.

Two consequences worth knowing:

- **Resolution is linear.** Halving the width and height quarters the GPU and
  blit cost. It is the cheapest lever you have.
- **Memory is held, GPU time is not.** A paused or idle effect still costs its
  page and buffers. So an off-screen deck saves GPU work but not RAM.

## Tiers: minimum and recommended

The probe reads what the browser will tell it — GPU renderer string (software
renderers such as SwiftShader/llvmpipe are detected), `hardwareConcurrency` and
`deviceMemory` — and takes the **weakest** of the three, because a fast GPU can't
rescue a 2 GB machine. These are heuristics; they can be wrong (a hybrid-GPU
laptop, a browser that hides memory) so the tier is only a default.

| Tier | Typical machine | Per-deck budget* | Max resolution | Decks | Standby frames |
|---|---|---|---|---|---|
| **Minimum** | software rendering / no GPU, 2+ cores, 2+ GB | 6 | 384 × 216 | 1 | 1 |
| **Baseline** | integrated GPU, 4+ cores, 4+ GB | 24 | 1280 × 720 | 2 | 3 |
| **Recommended** | discrete or Apple-silicon GPU, 8+ cores, 8+ GB | 64 | 1920 × 1080 | 2 | 8 |

\* in the same weight units as the GPU formula, at 60 fps, for one live deck.
Running two decks live at once costs the sum of both, so the plan checks that the
**pair** fits before it allows a live crossfade.

These numbers are starting points chosen to be conservative. They are constants in
`src/lib/patch/budget.js`; adjust them there if you calibrate against real
hardware, and the unit tests in `tests/patchBudget.test.js` pin the model's shape
(linear in pixels, additive per node, decks multiply).

## Two decks

A second deck roughly doubles the GPU term and the memory term, so the plan
decides how the **off-air** deck runs:

| Mode | Used when | GPU | Memory |
|---|---|---|---|
| **live / cued** | on air, or both decks fit the tier's budget | full (its effects draw every frame); *cued* only halves the compositor's blit | held |
| **paused** | off air and the pair would exceed the budget | none — its pages are paused | held |
| **pulsed preview** | the *edited* off-air deck on a machine that can't run both | ~1/8 — resumed for a few frames every ½ s so the preview and thumbnails still move | held |

Pausing a deck saves the most, because its pages stop drawing altogether; slowing
individual nodes (see below) saves less. So Patch runs both decks together only when `on-air + off-air ≤ budget`; otherwise the
off-air deck is held and the crossfade brings it up as it fades in. The deck bar's
capacity badge shows the on-air deck's load against the budget and lists any
warnings (over budget, memory, resolution above the tier's target). The
*Device class* menu overrides the detected tier.

**Show cues** warm up in standby frames ahead of time (at most as many as the
plan allows), so a change finds its effects already running. Standby frames cost
memory like any other page, which is why the allowed number shrinks on small
devices.

## Culling and throttling inside a deck

Within a deck that is running, Patch does not treat every node alike:

- **Culling.** Only nodes that can affect the Output matter. A branch that goes
  nowhere, or a layer hidden behind a fully-mixed *Normal* blend whose top input is
  opaque, is culled. Culled nodes are not thrown away — they tick over at about
  3 fps, one or two at a time in rotation, so their thumbnails stay alive for almost
  nothing (1 fps when only the output is shown).
- **Load shedding.** If the compositor can't hold the display's refresh rate, the
  least important and most expensive live nodes are stepped down — 60 → 30 → 20 →
  15 → 10 → 6 fps — one at a time, and stepped back up once there is headroom.
  Importance comes from distance to the Output; the selected node and anything you
  are dragging are protected (never below 30 fps). Expensive sketches (by their
  perf-audit weight) are slowed first.
- **No wasted work.** Filters are only re-fed when their input picture actually
  changed, blends and the output only redraw when an input or their own settings
  changed, and still images are drawn once. Shader filters also skip frames whose
  picture and settings haven't changed.

This is separate from the deck policy above: decks decide *whether* a deck's
pages run; this decides *how fast* each node inside a running deck needs to. It
only ever slows a node's frame rate — pausing is left to the deck policy.
