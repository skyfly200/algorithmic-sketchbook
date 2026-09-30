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
