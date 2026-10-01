# Roadmap — filters, shaders and performance

Progress notes from the filter / performance work on branch
`claude/quirky-cori-c880h2`. (The project-wide roadmap lives in `docs/ROADMAP.md`.)

Nothing below has been measured on a real GPU yet — the work was done in a sandbox
with a software renderer, so frame rates there are only useful *relatively*.
**First job for the next session: run the benchmarks on real hardware** (see
"Next steps").

## Done

### New filters (all WebGL2 fragment shaders)
- Edge Detect (Sobel / Scharr / Prewitt / Laplacian, 5 styles)
- Kuwahara, Emboss, Sharpen, Tilt Shift, Gradient Map
- Solarize, Duotone, Invert, Vignette, Crystallize, Mosaic, Pixelate, Displace,
  Ripple, Pinch, Spherize, Polar Coordinates, Glowing Edges
- Blur gained algorithm options: Native, Fast (downsample), Smooth (pyramid), Bokeh (disc)
- All registered in `src/registry/filters.js`

### Shader infrastructure
- `sketches/_lib/glfilter.js` — single-pass filter helper; skips frames when the source
  picture, uniforms and size are unchanged (and the shader doesn't read `u_time`);
  `addTexture()` for LUTs / baked overlays; optional mipmaps.
- `sketches/_lib/glpipe.js` — multipass helper (render targets, float ping-pong state).
- `src.version` on `createSource()` — bumps when the picture changes.

### CPU → GPU ports (previously `getImageData` loops or heavy canvas draws)
- Single pass: pointillism, painterly, channel-offset, film-tone, polarization,
  color-filter, brightness-contrast, curves (editor moved to a DOM overlay), polaroid,
  uv-light, liquid-metal, twist, stained-glass, halftone, crt, camera-lens
- Multipass: wind (log-step scan), ink-bleed (ping-pong float field), vhs-defects
- ridgeline → instanced WebGL

### Canvas2D clean-ups
- Baked static layers / sprites: fish-scales, glowing-coals, hydrophobic, neon-sign
- Blurs at quarter resolution: rain-window, led-pixels, light-leaves; nebula-gasses drops a
  redundant full-screen blur
- blur skips frames when nothing changed
- `native` pixel ratio capped at 2 (was 3)

### Demo scenes
- `sketches/_lib/demos.js`: Landscape, Test chart, Night city. **D** cycles, `?demo=<name>`.
  (Sketches that pass their own `createSource({ demo })` — vhs-defects, kaleidoscope,
  motion-extraction, warp — keep theirs.)

### Patch scheduling (`src/lib/patch/scheduler.js`, 15 tests)
- One plan + rate controller per deck (merged with the two-deck compositor from main); culls nodes
  that cannot reach the Output, including a layer hidden behind an opaque Normal blend
- Culled nodes idle at 3 fps in rotation (1 fps in output-only mode); throttle only — pausing is left
  to the deck policy (`deckMode` / `applyDeckPause`)
- Under load, low-priority / expensive live nodes step down 60→30→20→15→10→6 fps and recover
  when there's headroom; selected / dragged nodes are protected
- `sketch:throttle` message handled in `sketches/_lib/runtime.js` (random phase per sketch)
- Blend / output / still-image media / filter feed skip work when inputs are unchanged

### Tooling
- `npm run bench` (`scripts/bench.mjs`) — per-sketch frame ms, JS ms, CPU-vs-GPU-bound hint
- Mixer fix: every filter layer now receives the composite below it (was motion-extraction only)

## Next steps

1. **Benchmark on a real GPU** and compare with the software numbers:
   `npm run build && npm run bench -- --filters --headed` (also `--all`, `--demo night-city`).
   Then run `npm run perf` to regenerate `src/registry/perf.json` (static complexity, no browser).
2. **Eyeball every ported filter** against its old look with the three demo scenes and a real
   camera. Only some were viewed; differences are expected where the algorithm was
   approximated (see bugs.md).
3. **Test the Patch scheduler on real graphs** — chains of 4-8 filters over video; check that
   throttling triggers sensibly, that culled thumbnails look OK, and that nothing flickers
   when a node is selected / unselected. Tune `FPS_STEPS`, `BACKGROUND_FPS`, thresholds.
4. ~~Apply the same scheduling to Mixer and Autopilot.~~ Done in `src/lib/stackScheduler.js`.
   Mixer idles layers hidden by a covering layer (normal blend, opacity near 1, zoom 1) at 3 fps,
   except layers a live filter above still reads. Mixer and Autopilot step costly, low layers down under
   load through Patch's `RateController`. Autopilot only throttles: layers under an opaque filter still
   feed it. Untested on real hardware: crossfades under load, standalone (external) layers.
5. Remaining `getImageData` callers are triaged. `curves`, `lens-flare`, `light-show` and
   `stencil-spray` read tiny or cached canvases. `dither` reads a downscaled frame and now skips the
   pass when the source and parameters are unchanged.
6. **More filters** from the Photoshop list not built yet: Median, Oil paint, Crystal/Facet
   variants, Lens blur with highlight boost, Difference of Gaussians, Unsharp with radius
   falloff, Motion-blur-aware sharpen.
7. **Ridgeline** overdraw: fills are drawn front-to-back for early-z; if it is still heavy on
   integrated GPUs, reduce column density by `rt.detail`.
8. ~~Shared filter chain in Patch.~~ Done for 38 stateless single-pass filters (CLAUDE.md, "Shared
   filter chains"); blur, glow, mist, warp, kaleidoscope, funhouse-mirror, birefringence and
   edge-detect were ported to fragment shaders for it. The scheduler treats a chain as a unit, and
   `deckCost` takes a `chain` option. Open: benchmark chained vs unchained to replace the
   provisional `CHAIN_HEAD_UPLOAD`, use `KHR_parallel_shader_compile` so a slow shader compile
   (kuwahara + halftone on a software renderer stalls startup for several seconds) doesn't block the
   compositor, and check the ported filters' looks on a real GPU (they approximate the old canvas
   blurs with mip-chain taps; warp samples backwards, so Pinch / Bulge are approximate inverses).
   Stateful filters (delay, feedback, tiling, strobe, interlace, motion-extraction,
   rolling-shutter, fps-limiter) and ones with baked textures (fog, shaky-film, light-leaves,
   nebula-gasses, rain-window, lens-flare, curves, camera-lens, polaroid) need per-program
   textures and history in the runner, or the node-module interface, to chain.
