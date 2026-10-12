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
  0.3)` adds a default input mapping. Mappings only *add* source × amount ×
  range to the base; for a pointer/tilt param centred on its middle, pass
  `{ center: true }` as the 4th arg (source 0.5 = no change) and keep the base
  at the centre — Patch loads sketches with default mappings off. Declaring params gives the sketch a
  controls panel in the viewer (sliders, mapping editor, saveable scenes) via
  postMessage — no extra wiring needed.
- Animating with a param as a rate: use `rt.phase('key', params.speed)` (∫ speed dt,
  advanced once per `rt.tick`), never `t * params.speed`. A mapped or dragged param
  otherwise jumps the phase by t × Δspeed, which strobes after a few minutes.
  Mapping amounts are a fraction of the range (-1..1), not values in the param's units.
  `tests/mapping.test.js` checks both for every default mapping.

When adding a sketch, prefer declaring its interesting constants as params.

## Icons

Icons are written `mdi-foo` as before, but resolved to `@mdi/js` SVG paths by `src/lib/mdiIcons.js` (no webfont). After using a new `mdi-*` name run `npm run icons` to regenerate it; an unlisted name renders blank.

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

## Idle optimisations: freeze and bake

Two ways to stop paying for effect nodes (iframes) whose work is wasted. Both are on by default
(toolbar toggles, `patch.freezeStatic` / `patch.autoBake` in localStorage) and both stay out of the way of anything that
could react to the outside: they apply only to effect nodes with **no control links, no mappings, and the mic off**.

- **Freeze static nodes** (`lib/patch/idle.js`, `StaticTracker`): a 128x72 hash of the node's output is sampled every
  250 ms; identical for ~1 s freezes it. `shouldEval` returns false (no copy, no `s.ver` bump, so downstream blends and
  filters skip too) and the iframe is paused through **`applyDeckPause`** (`want = deckWant || frozen || baked`): never post
  `sketch:pause` for these yourself, the deck policy resets `f.paused` every pass. A frozen node is re-probed every ~2 s.
  Anything that can change a picture calls `idle.wake` / `wakeAll`: `postToEffect` of a param / mapping / scene / state /
  action message, `persist()`, a beat, the mic starting, a resize, a reloaded frame.
- **Bake slow time-only nodes to a loop** (`lib/patch/bake.js` pure + tested, `baker.js` DOM): the trigger is the sketch's own
  `sketch:fps` report (once a second) staying under 75% of the rate the scheduler asked for, three reports in a row, on a node
  unchanged for 3 s (`BakeAdvisor`). `bakeNode` loads the sketch in a **hidden iframe outside `frameList`** with `?clock=manual`,
  which the runtime turns into a manual clock (`sketch:step { now, id }` runs queued animation frames with that time; `performance.now`
  and `Date.now` follow it), steps 1.5 s of warm-up + 6 s of loop + a 0.75 s seam at 30 fps as fast as it renders, and keeps each frame
  as a WebP blob; the seam cross-fades the continuation over the loop's start. `createLoopPlayer` decodes a few frames ahead. A baked
  node's `evalNode` plays the recording and its iframe is paused. `bakeKey` (slug, seed, params, state, mapping and link counts, W x H)
  is checked on every edit and ~3x a second; any change drops the recording and the node goes live. Recordings live in memory only, capped at 400 MB (LRU).
  Caveats: the seam is a visible dissolve on fast motion; a recording never reacts to audio or inputs (hence the gates above); filters are not baked (their input is live).
- Dev-only test hook `window.__patchPerf`; checks in `scripts/scratch/idle-check.mjs`, `bake-check.mjs`, `autobake-check.mjs`.

## Patch error checking

`src/lib/patch/diagnostics.js` (pure, tested in `tests/patchDiagnostics.test.js`) turns a deck's graph into issues: `{ key, code, severity,
nodeId, deck, title, message, fix, action }`. Every issue says what the user sees and **how to fix it in the real UI** (the Output is the
monitor button, "Add Output"), and may carry a one-click `action` (addOutput, connect, removeNode, removeLink, toggleMic, toggleCamera,
import, focus). Severity: **error** = blank or wrong picture, **warning** = probably unintended, **info** = a note (an unconnected node is
only info, so building is not nagged at). The toolbar badge counts errors + warnings only.

- `diagnoseDeck(deck, ctx)` checks: unknown node type, no / empty / multiple Output, filter / portal / mask / blend / camera inputs, geometry
  not in a camera, effect or filter with a missing, empty or wrong-kind sketch, media with no clip or a clip gone from the library, camera /
  screen source off, sprite with no image, audio Input with the mic off, control wires to a parameter that no longer exists. A branch that
  does not reach the Output (`NOT_CONNECTED`) is told apart from one hidden behind an opaque Normal blend (`HIDDEN_BEHIND`) using `liveNodes`.
  Deliberately not flagged: feedback cycles (a feature), and wires to missing nodes / ports (`pruneOrphans(true)` removes those on load and raises one
  `PRUNED_WIRES` notice with the count; deleting a node does not).
- Two checks wait for data that arrives late, so they never fire at load: `mediaState.hydrated` (the library fills from IndexedDB) and a sketch's
  param schema (`effectControls`, announced with `sketch:ready`).
- `runtimeIssue(code, detail)` is the same shape for what only the running app sees: `SKETCH_ERROR` (the runtime posts `sketch:error` on an uncaught
  error / rejection, at most 3 per load), `SKETCH_LOAD_FAILED` (not ready after 25 s, only for running decks), `CAMERA_DENIED`, `MIC_DENIED`,
  `VIDEO_PLAYBACK` (media element `onerror`), `BAKE_FAILED`. They live in `runtimeIssues` and are cleared when the cause is retried or the frame reloads.
- `lint()` in `PatchView.vue` runs about once a second from the loop's publish block and soon after any edit; `issues` is replaced only when its
  signature changed. Quick fixes run inside `D.withDeck(issue's deck)` and through `persist()` so undo works; the panel
  (`components/patch/ProblemsPanel.vue`, presentational) disables a fix for the other deck and says to switch to it. Dismissals last the session.
- Test hook `window.__patchProblems` (dev only); `scripts/scratch/problems-check.mjs` drives a deliberately broken patch end to end.

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

