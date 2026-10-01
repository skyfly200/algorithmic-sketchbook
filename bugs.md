# Known issues and things to verify

Notes from the filter / performance work. "Unverified" means it was written and compiles
but has not been looked at on real hardware or in the real UI.

## Fixed in this branch
- **glpipe target leak.** New `pipe.release(target)` deletes the texture and framebuffer and
  drops the target from the list. ink-bleed and vhs-defects call it before re-creating targets.
- **glfilter animated check.** A shader is animated if `u_time` appears anywhere outside its
  declaration, so a single read no longer counts as static.
- **Refresh estimate.** Patch now accepts a 30/50 Hz reading, but only while at most 3 nodes are
  live, so load-stretched frames are not mistaken for a slow display. *Unverified on a slow display.*
- **Mixer filter layers got no input.** `MixerView.vue` only fed the layers-below composite to
  `motion-extraction`; every other filter saw its demo scene. Now all filters are fed.
  *Unverified in the Mixer UI — only built and unit-tested.*

## Open / to verify

### Behaviour differences from the old implementations
- **painterly** — strokes are now a fixed function of position (stable between frames) instead
  of re-randomised on each repaint; watercolour may read paler; spray no longer draws drips.
  Only the default (Watercolour) medium was viewed; Oil, Charcoal, Ink, Pastel, Spray compile
  but were not looked at.
- **pointillism** — looked equivalent on the demo; not compared on a camera feed.
- **polaroid, uv-light, camera-lens, crt** — bloom/blur are sampled gathers in the shader, not
  the old canvas `filter: blur()`; radii were matched by eye/maths, not pixel-compared.
- **camera-lens** — average brightness now comes from the top mip level (no readback); the
  dirt layer is baked once per size.
- **wind** — streak colour is the max of decayed seeds rather than "most recent seed".
- **fish-scales** — the glint is a low-res alpha field revealing a baked rim layer, so it is
  smoother / less per-scale than before.
- **curves** — editor and histogram moved to a DOM overlay canvas above the WebGL canvas (so
  captures no longer include the editor). The histogram is sampled from a 128×72 copy ~4×/s.
- **Native pixel ratio** now capped at 2 (was 3) for every sketch.

### Performance — all unmeasured on real hardware
- Heavy shaders benchmarked one at a time (headed Chrome, real GPU, 1280x720, quality high,
  landscape demo, 3 s each):

  | sketch | fps | frame ms | JS ms | note |
  |---|---|---|---|---|
  | painterly | 112 | 8.94 | 8.06 | CPU (JS) bound |
  | kuwahara | 220 | 4.55 | 1.15 | GPU |
  | camera-lens | 513 | 1.95 | 1.06 | GPU |
  | ridgeline | 969 | 1.03 | 0.20 | GPU |

  All run above 60 fps on this machine. painterly shows 8 ms of JS per frame, but that is a GPU stall.
  Timing inside `createGLFilter.render()` (Chrome, real GPU, 1280x720, landscape demo) shows:

  | sketch | source draw ms | texImage2D ms | generateMipmap ms | drawArrays ms |
  |---|---|---|---|---|
  | painterly | 0.18 | 1.66 | 0.01 | 10.55 |
  | kuwahara | 0.15 | 0.07 | 0 | 0.10 |
  | camera-lens | 0.17 | 0.12 | 0 | 0.07 |

  The draw call blocks while the GPU runs the shader. The upload stall (1.66 ms) comes from writing the
  source texture while the previous draw still reads it. Ping-pong source textures would remove that stall
  but would not raise the frame rate, because the shader sets the frame time.
  Fix applied: painterly now bakes per-cell colour, gradient, angle and jitter into a small float target
  per layer (`createGLPipe`), and the main pass reads them with `texelFetch`. The bake reruns only when the
  source picture or the cell size changes, and the draw is skipped when nothing changed.
  Measured with the same harness (alternating old and new builds, 7 runs each, landscape demo, 1280x720):
  median about 35 fps before and about 47 fps after. Single runs vary widely on this machine, so repeat on
  your own hardware. Output differs from the old shader by under 0.3 of 255 on average across all 6
  styles and 2 demo scenes (half-float rounding of the baked jitter).
  Integrated GPUs are still untested.
- `src/registry/perf.json` grades are static complexity estimates, not timings. Regenerate with
  `npm run perf` (no browser or dev server needed).

### Patch scheduler (`PatchView.vue`, `src/lib/patch/scheduler.js`)
- Only exercised with a seeded 6-node graph in headless Chromium (culled nodes dropped to
  ~2-3 fps as intended, no console errors) — re-checked after merging main's two-deck compositor.
  Not tested: two decks live at once / crossfading, output-only mode (culled nodes go to 1 fps),
  selection protection, occluded-blend culling in the live UI, cycles, Input/XY/Tracker control links.
- Culled nodes show their last frame (or blank if never rendered) in thumbnails.
- `show.drawXfade` (cue crossfade) and the pop-out window redraw every pass; only the node
  evaluation is skipped when unchanged.
- Mixer and Autopilot do not use the scheduler yet.
- `deckCost()` in `src/lib/patch/budget.js` accepts an optional `rateOf(node)` for throttled
  rates, but Patch does not pass it. The planner stays at full rate on purpose: feeding throttled
  rates back into the tier decision would let throttling admit more load, then throttle more.

### Shader infrastructure
- Float render targets need `EXT_color_buffer_float` / `EXT_color_buffer_half_float`; there is
  an RGBA8 fallback but ink-bleed's slow decays will stall at 8 bits.
- WebGL canvases are captured by Patch via `drawImage` of the iframe's first `<canvas>`; this
  relies on `?capture=1` (preserveDrawingBuffer). Sketches that skip draws on unchanged frames
  keep the last frame on screen, which is fine with that flag but was not tested with capture
  on every ported sketch.

### Misc
- `led-pixels` logs `ERR_CONNECTION_REFUSED` (Art-Net input) in headless runs — unrelated to this
  work.
- `.claude/worktrees/` (a locked profiling-agent worktree, ~400 MB) was excluded locally via
  `.git/info/exclude`; it is not in the repo and may still exist on the original machine.
- The repo tracks both `CLAUDE.md` and `claude.md` as separate files. Only `CLAUDE.md` was edited
  (new sections on filter helpers, demo scenes and Patch scheduling), so the two now differ.
  Decide which is canonical and sync or remove the other.
