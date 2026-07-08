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

## Other tasks

- Link an external repo: add an entry to `src/registry/external.json`
  (fields documented in README.md). Set `embed: false` if the site blocks
  iframes.
- New template: add a folder in `templates/`; `__TITLE__` is replaced by the
  sketch title. Update `techByTemplate` in `scripts/new-sketch.mjs`.
- Gallery/app changes: Vue SFCs in `src/`; Vuetify components, Pinia store in
  `src/stores/sketches.js`, hash-based routing in `src/router/index.js`.
