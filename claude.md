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
- A filter opts in by being listed in `CHAINABLE_SLUGS` (`src/registry/filters.js`):
  `createGLFilter` is all it draws, no `addTexture`, no pixel-ratio-scaled uniforms,
  no glpipe. The iframe stays the param host: in chain mode `glfilter.js` sends its
  shader once (`filter:program`) and uniforms on change (`filter:uniforms`) and draws
  nothing. `u_res` / `u_time` belong to the parent.
- Members fall back to normal iframe rendering until every program has arrived or if
  the chain cannot run. A/B test with `localStorage['patch.filterChain'] = 'off'`.
- Chained passes render at compositor size, not iframe size. Interior node previews
  refresh about every 0.4 s (live for a selected member).

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

