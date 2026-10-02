# Algorithmic Sketchbook — agent guide

Static Vue 3 + Vite + Pinia + Vuetify gallery of interactive graphics
experiments. No server, no Nuxt. `npm run dev` to run, `npm run build` to
verify a change compiles.

## The one thing to understand

`src/registry/index.js` builds the gallery from one source: every
`sketches/<slug>/` folder containing a `sketch.json` is auto-discovered via
`import.meta.glob`. Each folder is a self-contained page (`index.html` + JS)
that the viewer iframes. Vite builds each one as its own page (see
`sketchInputs()` in `vite.config.js`). There is no local-vs-external split —
everything lives in the project.

A manifest may set `"standalone": true` to mark a fully self-contained imported
app (it brings its own UI, e.g. `caustics-art`, `moire-patterns`). Standalone
sketches show in the gallery like anything else but get no runtime param panel
and are excluded from the Autopilot / Patch / Mixer compositor pools.

## Adding a new experiment (the common task)

1. `npm run new <kebab-slug> -- --template <canvas2d|webgl-shader|three> --title "Title"`
2. Write the experiment in `sketches/<slug>/sketch.js`. It's a plain
   standalone page — Vite processes it, so npm imports work (three.js is
   installed; add other deps to package.json as needed).
3. Fill in `description`, `tags`, `tech` in `sketches/<slug>/sketch.json`.
4. Verify with `npm run build` (and `npm run dev` if you can look at it).

No registration step — the gallery picks it up from the folder.

Conventions for sketches: fill the viewport, dark background, handle window
resize, no scrollbars (`overflow: hidden`), animate with
`requestAnimationFrame` / `setAnimationLoop`.

## The sketch runtime (sketches/_lib/runtime.js)

All templates import it. In a sketch:

- `const rt = createRuntime()` then use `rt.pixelRatio` (not
  devicePixelRatio), scale workloads by `rt.detail`, and call `rt.tick(now)`
  once per frame. This is what makes the viewer's FPS counter and graphics
  quality options work.
- Beat detection: `rt.onBeat(({ energy }) => ...)`, `rt.beat.state.pulse`
  (decays 1→0 after each beat), `rt.beat.trigger()` for manual beats.
- Tweakable params: `const params = rt.params({ name: { value, min, max,
  step, label } })` (`type: 'bool'` for switches); read `params.name` in the
  loop — it includes input modulation. `rt.mapInput('beat.pulse', 'name',
  0.3)` adds a default input mapping. Declaring params gives the sketch a
  controls panel in the viewer (sliders, mapping editor, saveable scenes) via
  postMessage — no extra wiring needed.

When adding a sketch, prefer declaring its interesting constants as params.

## Scenes

Named snapshots of param values + input mappings + display settings, stored
in localStorage (`src/stores/scenes.js`), saved/applied from the viewer's
controls panel, listed on the gallery page, deep-linked as
`/#/sketch/<slug>?scene=<id>`.

## Other tasks

- Import a standalone app: drop its self-contained page into
  `sketches/<slug>/` (an `index.html` entry + its JS/assets) with a
  `sketch.json` that sets `"standalone": true`. Reference runtime-loaded assets
  via `?url` imports so Vite emits them (see `sketches/caustics-art`).
- New template: add a folder in `templates/`; `__TITLE__` is replaced by the
  sketch title. Update `techByTemplate` in `scripts/new-sketch.mjs`.
- Gallery/app changes: Vue SFCs in `src/`; Vuetify components, Pinia store in
  `src/stores/sketches.js`, hash-based routing in `src/router/index.js`.

## Writing filters that stay fast

Per-pixel filters belong on the GPU — `getImageData` + a JS loop + `putImageData`
every frame is the most common way a sketch ends up slow.

- `sketches/_lib/glfilter.js` — single-pass WebGL2 filter over the shared source
  (`createGLFilter({ rt, src, canvas, frag, mipmaps })`, then `gf.render({ mirror,
  time }, (u) => u.f('u_x', v))`). It skips frames where the source picture, the
  uniforms and the size are unchanged (and the shader doesn't read `u_time`).
  `gf.addTexture(name, unit)` adds a LUT / baked overlay sampler.
- `sketches/_lib/glpipe.js` — multipass sibling (separable blurs, prefix scans,
  ping-pong simulation state in float targets). See `wind`, `ink-bleed`,
  `vhs-defects`.
- `src.version` (from `createSource()`) bumps whenever the picture changes; use it
  to skip work on still images. `mipmaps: true` gives cheap pre-blurred reads via
  `textureLod`, so effects need no readback to get an average brightness.
- Canvas2D sketches: bake static layers once, blur at quarter resolution and scale
  up, cache gradients as sprites, never create canvases inside the frame loop.
- `npm run build && npm run bench -- --filters --headed` measures frame / JS time
  per sketch on *your* GPU (`npm run perf` regenerates the gallery's grades).

## Demo scenes

`sketches/_lib/demos.js` holds the built-in demo sources (Landscape, Test chart,
Night city). Press **D** in a sketch (or `?demo=night-city`) to cycle them; a
sketch can still pass its own `createSource({ demo })`.

## Upscaling

Two separate tools; neither is a general "make it bigger" node, because every Patch node
canvas is the compositor's W×H, so a filter node cannot add pixels.

- `detail-upscale` (a chainable filter): edge push + contrast-adaptive sharpen for a picture
  that was already enlarged. `Source scale` is how many times it was stretched. Plain
  reconstruction, not a neural net; described as such in its manifest.
- AI upscale (Import wizard → "AI upscale", `UpscaleDialog.vue`): images only. A Swin2SR model
  (Hugging Face `Xenova/swin2SR-*`, see `MODELS` in `src/lib/upscale/neural.js`) runs in a module
  worker (`worker.js`) through Transformers.js loaded from a *pinned jsDelivr URL*, not npm (the
  package pulls in Node-only deps). Weights download on first use and are cached by the library.
  `tiles.js` (pure, tested) cuts the picture into 64 px tiles with 8 px overlap and a keep-region
  stitch, and caps the output at 4096 px. WebGPU is used when an adapter exists, with a fresh
  WASM worker as the fallback; alpha is resampled separately. Cancel = abort, which terminates
  the worker. Results go to the media library as PNGs and the first also gets a Media node.
  Video is deliberately unsupported (per-frame inference is far too slow).
- Cost on a slow CPU with single-threaded WASM: about 0.8 ms per input pixel for the fast ×2
  model, about 4 ms for the ×4 one. Scratch checks: `scripts/scratch/neural-spike.mjs`,
  `neural-e2e.mjs`, `wizard-upscale.mjs`, `upscale-shader.mjs`.

## Temporal upscaling (prototype)

`sketches/_lib/gltaau.js` is an FSR2 / TAAU-style temporal upscaler for heavy, ray-based shader
sketches (not DLSS: no network, no engine motion vectors). The sketch renders its scene at a fraction
of the canvas size into a low-res target (colour + ray depth) with a sub-pixel Halton jitter; a
resolve pass reprojects the previous full-size frame through the previous camera (exact: from ray + depth
for a pinhole camera, or an affine map for a flat 2D pan / zoom scene), clamps it to the local colour distribution (variance clipping in YCoCg), and blends.
`mandelbulb` (pinhole camera) and `fractal-explorer` (2D `{ center, scale }`) are wired up (Render mode:
Native / Temporal 0.75x / 0.5x / 0.33x, default Native). To adopt it a sketch must: add `u_jitter` to the
pixel position, write `layout(location=1) out float` ray distance (any value for a flat scene), report its
camera each frame (`{ ro, uu, vv, ww, f }` or `{ center, scale }`), and call `taau.reset()` when the scene
itself changes. Content that moves without the camera (animated waves, plasma) cannot be
reprojected and does not benefit: ocean-surface was tried and got slower and softer, so it was reverted.
Cheap shaders (infinite-zoom, plasma) lose to the resolve pass's own cost; use it on expensive ones.
Not wired into Patch yet. Check with `scripts/scratch/taau-compare.mjs` (PSNR against a 2x supersampled
reference, plus per-frame cost) and `taau-montage.mjs`.

## Patch scheduling

Two layers, both in `PatchView`:

- **Between decks** (`deckMode()`, see below): which deck is live, cued, paused or
  pulsing. Decides whether a deck is evaluated at all.
- **Within an evaluated deck** (`src/lib/patch/scheduler.js`): culls nodes that can't
  reach the deck's Output (including layers hidden behind an opaque Normal blend),
  ticks culled nodes over at a few fps in rotation, and steps low-priority live
  nodes down through `FPS_STEPS` when the compositor can't hold the display rate.
  There is one plan and one `RateController` per deck. It only ever *throttles*
  (`sketch:throttle`, handled in `sketches/_lib/runtime.js`) — it never pauses an
  iframe, because pausing belongs to the deck policy and the two would fight.

## Shared filter chains

Runs of 2+ single-pass shader filters in a Patch deck (each feeding only the next)
run in one GL context instead of one iframe + bitmap transfer each.

- `src/lib/patch/filterChain.js` finds the runs (pure, tested). `chainRunner.js`
  draws them (ping-pong RGBA8 targets at compositor size). Hook-up is
  `refreshChains` / `runChain` in `PatchView.vue`.
- A filter opts in by being listed in `CHAINABLE_SLUGS` (`src/registry/filters.js`;
  `tests/filters.test.js` checks the rules): `createGLFilter` is all it draws, no
  glpipe, and no raw GL of its own. Write new filters as a pure function of the input,
  uniforms, `u_time`, uploaded textures and (optionally) frame history, and they can
  chain. The iframe stays the param host: in chain mode
  `glfilter.js` sends its shader once (`filter:program`) and uniforms on change
  (`filter:uniforms`), parks its canvases at 1x1 and draws nothing. `u_res` / `u_time`
  belong to the parent. In chain mode `rt.pixelRatio` and `gf.width/height` report the
  chain's render size, so pixel-valued uniforms (radii, cell sizes) need no special
  casing; read them every frame, never cache them at load. A window `resize` also
  fires when a filter joins or leaves a chain, so bakes that depend on the size rebuild.
- Extra textures (`gf.addTexture`: LUTs, baked overlays; `curves`, `camera-lens`,
  `polaroid`) are shared too: each `upload()` is sent as `filter:texture` (an
  ImageBitmap with the flip baked in, or raw bytes), bound on units 1+ in the runner, and
  resent when the filter joins. A chain does not run until every declared texture has
  arrived. Bake into a 2D canvas / typed array and `upload()` it; never use raw GL.
- Stateful filters (`feedback`, `interlace`): a shader that samples `u_prev` (its own
  previous output) and/or `u_prevIn` (the picture that fed it last draw) gets a per-member
  history (`sketches/_lib/glhistory.js`, shared by `glfilter.js` and `chainRunner.js`; units
  6 and 7). Such a filter is `animated` (redraws every frame) and its history restarts
  from black on a resize. `u_prev` is the *displayed* output, so anything the shader adds
  at the end (a mirror) feeds back into its own loop. Needs one slot per kind of state,
  so filters that hold a frame apart from their output (strobe, fps-limiter) or a ring of
  past frames (delay, tiling, rolling-shutter, motion-extraction) are not chainable yet.
- Members fall back to normal iframe rendering until every program has arrived or if
  the chain cannot run. A/B test with `localStorage['patch.filterChain'] = 'off'`.
- Interior node previews refresh about every 0.4 s (live for a selected member).
- `scripts/scratch/` holds temporary Playwright checks for chains (random-chain fuzzer,
  chained-vs-unchained diff, before/after screenshots). See its README; delete when no longer needed.
- The scheduler treats a chain as one unit (`chainSchedule`): only the tail is
  throttled, charged the whole chain. `deckCost` takes `chain` (`chainSets`) to drop
  the upload for members and the frame buffers of parked iframes; the head-upload
  figure (`CHAIN_HEAD_UPLOAD`) is provisional until benchmarked.

## Patch decks (two-graph compositor)

`src/views/PatchView.vue` runs two patch graphs ("decks" A/B) behind a master
crossfader; logic lives in `src/composables/useDecks.js`. Things to know before
editing it:

- `nodes` / `edges` / `links` are **scoped arrays** (`src/lib/patch/scoped.js`)
  that point at the deck in scope — the edited deck, or the one the render loop is
  evaluating inside `D.withDeck(deck, fn)`. Existing code that reads them works
  per deck unchanged; don't capture the underlying arrays across a deck switch.
- **Node ids are unique across both decks** (runtime maps — `rtState`,
  `effectControls`, `frameList` — are keyed by id). Anything that loads graph data
  into a deck must go through `installGraph()` / `planIdMap()` / `applyIdMap()`
  (`src/lib/patch/graph.js`) so colliding ids get renumbered.
- Effect/filter iframes live in one `frameList` (live + standby). A standby frame
  is promoted to a node in place (`adoptStandby`) — never move an iframe in the
  DOM, it reloads.
- Limits come from the cost model (`src/lib/patch/budget.js`, tested in
  `tests/patchBudget.test.js`), not from timing a machine. Keep new per-frame work
  O(V+E); the topo order is memoised per deck.

