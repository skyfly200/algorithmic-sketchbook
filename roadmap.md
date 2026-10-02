# Roadmap — filters, shaders and performance

Progress notes from the filter / performance work on branch
`claude/quirky-cori-c880h2`. (The project-wide roadmap lives in `docs/ROADMAP.md`.)

Most of the work below was done in a sandbox with a software renderer, so frame rates
there are only useful *relatively*. A first real-GPU run of the whole gallery is in
"Real-GPU benchmark" below; it turned up the next jobs.

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

## Real-GPU benchmark (2026-10-02)

`npm run bench -- --all --chrome --ms 2000` on an NVIDIA GeForce MX250 (entry-level laptop GPU, ANGLE /
D3D11), 8 cores. Headless Chrome got the real GPU (checked via `UNMASKED_RENDERER_WEBGL`). 1280x720, pixel
ratio 1, quality high, landscape demo, vsync off. On a 1.25-1.5x laptop display, fill-bound sketches cost
about 1.5-2.25x more. 13 sketches (nebula-gasses .. polarization) failed when the preview server stalled
mid-run and were re-run on their own. Playwright's bundled Chromium is not installed on that machine; pass `--chrome`.
Raw results: `bench/2026-10-02-mx250.json` (same shape as `--out`, wrapped with the run's settings).

**153 of 181 sketches hold 60 fps (`--all` skips the 2 standalone apps).** Every shader filter except
polaroid is well under budget. The 28 that don't (ms per frame):

| ms | sketches |
|---|---|
| > 100 | frost-grow 414, glowing-coals 197, concentric-rings 194, mud-cracks 159, ferrofluid 120 |
| 50-100 | mandelbulb 81, neon-fluid 78, sand-dunes 78, slime-mold 68, washboard-road 65, foam-cells 62, cable-knit 52, condensation 52, rain-window 51 |
| 17-50 | clouds 41, dither 34, microbes 32, cymatics 28, zen-garden 28, tessellation-drift 27, embers 27, lava-lamp 26, fluid 22, fibonacci-spiral 20, polaroid 18, painterly 18, orbit-knots 17, star-field 17 |

polaroid and orbit-knots are pure GPU time (0.05 ms JS); polaroid's shader is worth a look since it's
the only single-pass filter over budget.

The bench's "CPU (JS) bound" note is unreliable: a WebGL sketch waiting on the GPU counts that wait as script
time (mandelbulb), and fluid reports more JS ms than frame ms. Rank by frame ms.

### Fixes, by pattern
1. **Canvas2D pixel simulations** (the biggest group): mud-cracks, ferrofluid, sand-dunes, slime-mold,
   washboard-road, clouds, dither, zen-garden, lava-lamp, fluid, neon-fluid step a grid in JS and
   `putImageData` it every frame. The GPU ports covered filters, not these generative sketches. Port to
   glpipe ping-pong targets (like ink-bleed); stopgap: simulate at 1/2 or 1/4 resolution and scale up.
2. **Sketches that ignore `rt.detail`**, so the viewer's quality setting does nothing: frost-grow,
   mud-cracks, sand-dunes, washboard-road, clouds, microbes, tessellation-drift, lava-lamp, cable-knit,
   glowing-coals. Scale grid size / particle counts by it. The cheapest broad fix.
3. **frost-grow**: up to 6000 tips x 3 steps x 2 strokes, each with its own `beginPath`/`stroke` and a new
   `hsla()` string, so up to ~36k stroke calls a frame (`sketch.js` frame loop). Batch all segments into one
   path per pass, bucketed into a few line widths. Expect 10x+.
4. **concentric-rings**: `shadowBlur` on every ring; JS is 0.4 ms of a 194 ms frame, so it's all blur raster.
   Draw the rings sharp and add one quarter-resolution glow pass.
5. **glowing-coals**: already moved to baked sprites, yet 197 ms with only 58 ms JS. Unexplained; profile it
   (suspect the full-screen `bed` radial gradient, ~line 256). cable-knit, foam-cells and rain-window show
   the same pattern (slow frames, little JS).
6. **mandelbulb**: TAAU exists but defaults to Native. Default to Temporal 0.5x on lower tiers.

### Patch's cost model is wrong for this machine
- **Static weights don't match measured cost.** `perf.json` (code-complexity score, 100 = light):
  concentric-rings 71 (lighter than the median 69) measures 194 ms; kuwahara 38 (looks heavy) measures 3 ms;
  glowing-coals 31 vs 197 ms. Patch's budget, the scheduler's who-to-throttle-first and Autopilot's
  weighted picks all read these. Build `perf.json` from `bench.mjs --out` timings instead (or blend them in).
- **The MX250 probably lands in the Recommended tier.** `DISCRETE` in `src/lib/patch/capability.js` matches
  any `nvidia|geforce`, so the tier is Recommended (budget 64, 1080p, 8 standby frames) unless memory or
  cores pull it down. Entry-level parts (`MX\d{3}`, GT 7xx/10xx and similar) should count as integrated
  (Baseline).

### Load time (not frame rate)
- `src/main.js` imports the whole Material Design Icons webfont (~400 KB woff2 + a large CSS file) on every
  page. Switch to `@mdi/js` SVG icons so only the ones used ship.
- hex-cascade's chunk is 1 MB because it bundles p5; only that sketch pays for it.

**Implemented since (unmeasured; re-run the bench to confirm):** `capability.js` now treats MX / GT / low-end
GTX parts as integrated; `npm run perf` blends `bench/*.json` frame times in at 80%; frost-grow batches segments
into one path per width bucket; concentric-rings draws one path per ring plus a quarter-res glow pass;
mud-cracks, sand-dunes, clouds, microbes, washboard-road and glowing-coals scale grids / counts by `rt.detail`;
lava-lamp is now one fragment shader (renders correctly on a software GL, not timed). **Still open:** `rt.detail`
for tessellation-drift and cable-knit; glowing-coals profiling (per-coal clip + gradient is the suspect); GPU ports
of mud-cracks, ferrofluid, sand-dunes, slime-mold, washboard-road, clouds, dither, zen-garden, fluid, neon-fluid;
mandelbulb default render mode; the MDI icon font.

Suggested order: the two cost-model fixes (they change how every patch behaves), then frost-grow and
concentric-rings (quick wins), then `rt.detail` everywhere, then the glpipe ports.

## Next steps

1. ~~**Benchmark on a real GPU.**~~ Whole gallery done on an MX250, see "Real-GPU benchmark" above. Still
   open: a faster GPU for comparison, `--demo night-city`, a 1.5x pixel ratio run, and timing Patch graphs
   (chains, two decks) rather than single sketches.
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
6. ~~More filters.~~ Done, all chainable single-pass shaders: **Median** (3x3 exact / 5x5 row-median),
   **Oil Paint** (intensity bins), **Difference of Gaussians** (band-pass / XDoG ink / add detail),
   **Directional Sharpen** (fixed angle, or across edges), plus options on existing sketches instead of
   new ones: **Facet bevel** on Crystallize, **Bokeh highlight boost** on Blur, **Radius falloff** on
   Sharpen. Not built: a general lens blur with depth. Untested on a real GPU; the Oil Paint and Median
   loops are the heaviest (48 taps with bin arrays, 25 taps).
7. ~~Ridgeline overdraw.~~ Done: the column step is a fixed ~2.4 CSS px (it used to shrink with
   pixelRatio, so columns grew with pixelRatio squared), widened by `rt.detail`, with a floor tied to
   the noise frequency. Check on an integrated GPU that low quality still looks right.
8. Shared filter chain in Patch: done for 48 filters (CLAUDE.md, "Shared filter chains"). Since the first
   version it also shares extra textures (`curves`, `camera-lens`, `polaroid`) and runs stateful filters
   with a per-member history (`feedback`, `interlace` were ported from Canvas2D to shaders for it;
   `sketches/_lib/glhistory.js`). Open: benchmark chained vs unchained to replace the provisional
   `CHAIN_HEAD_UPLOAD`, use `KHR_parallel_shader_compile` so a slow shader compile (kuwahara + halftone on a
   software renderer stalls startup for several seconds) doesn't block the compositor, and check the ported
   filters' looks on a real GPU (the blurs approximate the old canvas blurs with mip-chain taps; warp samples
   backwards, so Pinch / Bulge are approximate inverses; feedback's kaleidoscope mirror now folds into its
   own loop).
   Still not chainable, all Canvas2D: **strobe** and **fps-limiter** (hold a frame apart from what they
   show, so they need a third history slot), **delay**, **tiling**, **rolling-shutter**, **motion-extraction**
   (a ring of past frames, which at full size is heavy: 30 frames is ~100 MB at 720p), and the baked-noise
   ones **fog**, **shaky-film**, **light-leaves**, **nebula-gasses**, **rain-window**, **lens-flare**, which
   need a GPU port first and then fit the existing texture sharing. Others (painterly, wind, ink-bleed,
   vhs-defects) are multipass glpipe filters.

Temporary verification scripts for the chain work (random chain fuzzer, chained vs unchained diff,
before/after screenshots) live in `scripts/scratch/`; see its README. Delete the folder once a real
benchmark covers the chain path.

## Upscaling

Done: **Detail Upscale** (a chainable shader filter) and **AI upscale** in the Import wizard (see CLAUDE.md,
"Upscaling"). Only the WASM path was run, on a software renderer: the **WebGPU path is untested**, and
nobody has timed it on a real GPU. Open:

- Benchmark WebGPU vs WASM, and try fp16 weights on WebGPU to halve the download.
- WASM is single-threaded (threads need cross-origin isolation, which would break the cross-origin media
  and iframes). Worth a look at a dedicated tab or window that is isolated.
- Offline use: the library and weights come from jsDelivr / Hugging Face; the service worker lets
  cross-origin requests pass, so the first run needs a network.
- Detail Upscale cannot add detail that was never captured. The one place a live upscale would add real
  pixels is the final compositor-to-stage blit (the compositor is often smaller than the screen).
- An "Auto" source scale for Detail Upscale, read from the source's native size when unchained.

## Patch error checking

Done, see CLAUDE.md "Patch error checking". Open:

- Check the messages with real users: the wording of the fixes was written from the code, not from watching someone get stuck.
- Checks not built: a link whose target is a node type with no known param table (geometry / camera / text params are not validated, to avoid false
  alarms), shader-compile failures inside a filter chain (it silently falls back to normal rendering), WebGL context loss, terrain / map tile fetch
  failures, and over-budget graphs (the cost model already exists in `budget.js`).
- Problems for the file operations (a patch JSON that does not parse, a failed import) still show as toasts; they could use the same panel.
- Persist dismissals per patch instead of per session.

## Idle optimisations (freeze + bake)

Done, see CLAUDE.md "Idle optimisations". Verified in a real Patch on a software renderer: a static fractal freezes in ~1.5 s and wakes
on a param change; a baked plasma loop is 180 frames, 1.5 MB, plays back moving, and unbakes on a change; a heavy mandelbulb was detected at
0.67x of its rate and baked itself in about 85 s. Open:

- Time a real GPU: the saving is the node's whole iframe cost, but it has not been measured, and bake time was only seen on a slow CPU.
- Persist recordings (IndexedDB) so a reload does not re-bake; encode with WebCodecs instead of per-frame WebP for ~10x smaller loops.
- Bake a filter chain's output when its source is baked (a deterministic branch), and bake audio-reactive nodes with a quantised audio-level cache.
- Better seams for fast motion (a ping-pong or optical-flow blend), and a per-node loop length in the UI.
- A global memory readout for recordings and a "bake everything eligible" command.

## Temporal upscaling (prototype)

`sketches/_lib/gltaau.js` + the Render mode of `mandelbulb` (pinhole camera) and `fractal-explorer` (2D pan / zoom). On the software renderer, against a 2x supersampled
reference at 320x180 (PSNR, higher is better):

| | native 1x | low-res, no history | temporal |
|---|---|---|---|
| scale 0.5, slow orbit | 26.1 dB, 55 ms | 26.3 dB, 28 ms | 29.5 dB, 34 ms |
| scale 0.5, fast orbit (spin 1) | 23.6 dB | 25.6 dB | 27.7 dB |
| scale 0.33, slow orbit | 26.1 dB, 54 ms | 24.0 dB, 21 ms | 27.6 dB, 25 ms |
| scale 0.5 at 640x360 | 28.4 dB, 155 ms | 27.1 dB, 104 ms | 30.5 dB, 120 ms |

`fractal-explorer`, auto-zoom, 1500 iterations (an expensive view), 320x180:

| | native 1x | low-res, no history | temporal |
|---|---|---|---|
| scale 0.5 | 23.6 dB, 74 ms | 22.9 dB, 33 ms | 26.7 dB, 35 ms |
| scale 0.5, fast zoom (2.0) | 21.7 dB, 100 ms | 21.0 dB, 41 ms | 24.6 dB, 43 ms |
| scale 0.33 | 23.6 dB, 75 ms | 21.7 dB, 27 ms | 24.4 dB, 30 ms |

At the default 260 iterations the same sketch is cheap (14 ms native) and temporal is slower (25 ms): the
saving only shows on expensive views. At 0.33x the result is smooth where the reference has fine filaments
(better than the blocky low-res frame, softer than 0.5x); a final sharpen could help.

Temporal beats the aliased native render in quality and is about 1.3-2.2x cheaper here. The software numbers
are only indicative: the resolve pass (9 fetches + a 5-tap bicubic per output pixel) costs about 10-15% of a
native frame, and a cheap shader would be slower with it than without (ocean-surface: 20 ms vs 7 ms, and lower
quality, because its waves move on their own and the history is rejected). Open:
- Check on a real GPU: the saving should approach the pixel ratio when the march is fill-rate bound.
- A camera model per sketch is the price of entry. The 2D zoom/pan reprojection is done (fractal-explorer);
  infinite-zoom is a cheap log-polar shader (a similarity transform about the centre, easy to reproject) but
  would not get faster, so it was left alone.
- Optical-flow motion vectors to extend this to sketches without a known camera. Likely ghosts on fast motion.
- Patch: a per-node render scale with the scheduler stepping it down before fps. Only useful for sources that
  can render jittered; a camera or video source gains nothing.
