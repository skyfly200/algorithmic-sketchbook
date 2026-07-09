# Algorithmic Sketchbook — agent guide

Static Vue 3 + Vite + Pinia + Vuetify gallery of interactive graphics
experiments. No server, no Nuxt. `npm run dev` to run, `npm run build` to
verify a change compiles.

## The one thing to understand

`src/registry/index.js` merges two sources into the gallery:

- **Embedded sketches**: every `sketches/<slug>/` folder containing a
  `sketch.json` is auto-discovered via `import.meta.glob`. Each folder is a
  self-contained page (`index.html` + JS) that the viewer iframes. Vite builds
  each one as its own page (see `sketchInputs()` in `vite.config.js`).
- **External projects**: entries in `src/registry/external.json` pointing at
  other repos / live demos.

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

- Link an external repo: add an entry to `src/registry/external.json`
  (fields documented in README.md). Set `embed: false` if the site blocks
  iframes.
- New template: add a folder in `templates/`; `__TITLE__` is replaced by the
  sketch title. Update `techByTemplate` in `scripts/new-sketch.mjs`.
- Gallery/app changes: Vue SFCs in `src/`; Vuetify components, Pinia store in
  `src/stores/sketches.js`, hash-based routing in `src/router/index.js`.
