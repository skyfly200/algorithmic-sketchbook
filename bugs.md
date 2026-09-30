# Known issues and things to verify

Notes from the filter / performance work. "Unverified" means it was written and compiles
but has not been looked at on real hardware or in the real UI.

## Fixed in this branch
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
- **kuwahara** samples up to 289 texels per pixel at max radius; **painterly** ~2 layers × 25
  stroke cells per pixel; **camera-lens** 20-tap variable blur + bloom. Expect these to be the
  heaviest new shaders, especially at high resolutions / integrated GPUs.
- **ridgeline** (WebGL) measured ~510 ms/frame under a *software* renderer (down from ~600 before
  the front-to-back fix). Real-GPU cost unknown; overdraw is ~1x now but MSAA is on.
- `src/registry/perf.json` grades are stale/inaccurate (generated headless). Regenerate with
  `npm run perf` on a real machine.

### Patch scheduler (`PatchView.vue`, `src/lib/patch/scheduler.js`)
- Only exercised with a seeded 6-node graph in headless Chromium (culled nodes dropped to
  ~2-3 fps as intended, no console errors). Not tested: output-only mode pausing, selection
  protection, occluded-blend culling in the live UI, cycles, Input/XY/Tracker control links.
- The display-refresh estimate never goes below 60 Hz, so on a 30/50 Hz display the controller
  will think it is always behind and over-throttle.
- Culled nodes show their last frame (or blank if never rendered) in thumbnails.
- `show.drawXfade` (cue crossfade) and the pop-out window redraw every pass; only the node
  evaluation is skipped when unchanged.
- Mixer and Autopilot do not use the scheduler yet.

### Shader infrastructure
- `glpipe.js` keeps every `target()` it ever created in an internal list (fixed-size targets
  from ink-bleed / vhs-defects are re-created on resize but old ones are not removed from the
  list). Minor leak on repeated resizes; textures are deleted only when re-made.
- Float render targets need `EXT_color_buffer_float` / `EXT_color_buffer_half_float`; there is
  an RGBA8 fallback but ink-bleed's slow decays will stall at 8 bits.
- `glfilter` decides a shader is "animated" by counting `u_time` occurrences in the source — a
  shader that uses time *only* through a uniform set in JS animates via the changing uniform
  signature instead, which is fine, but a shader that reads `u_time` exactly once would be
  treated as static.
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
