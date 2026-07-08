# Algorithmic Sketchbook

A curated gallery of interactive computer-graphics experiments. Vue 3 + Vite +
Pinia + Vuetify, fully static — no server required.

```bash
npm install
npm run dev      # gallery at http://localhost:5173
npm run build    # static site in dist/
```

## How it works

There are two kinds of entries, both shown in the same gallery:

| Kind | Lives where | Registered how |
| --- | --- | --- |
| **Embedded sketch** | `sketches/<slug>/` in this repo | Automatically — any folder with a `sketch.json` appears in the gallery |
| **External project** | Its own repo / deployment | Add an entry to `src/registry/external.json` |

The gallery (`/`) lists everything with search, tag, and type filters. Each
entry opens at `/#/sketch/<slug>`, where embedded sketches (and embeddable
external demos) run live in an iframe with reload/fullscreen controls, plus
links to source.

```
├── index.html            Gallery app shell
├── src/                  The Vue app (gallery + viewer)
│   ├── registry/         Merges local sketches + external.json into one list
│   ├── stores/           Pinia store (filtering/search state)
│   ├── views/            GalleryView, SketchView
│   └── components/       SketchCard, FilterBar
├── sketches/             One folder per embedded sketch
│   └── flow-field/
│       ├── index.html    Standalone page (iframed by the viewer)
│       ├── sketch.js     The experiment itself
│       ├── sketch.json   Metadata (title, description, tags, tech, created)
│       └── thumbnail.png Optional gallery-card image
├── templates/            Starters used by `npm run new`
└── scripts/new-sketch.mjs
```

Each embedded sketch is a **self-contained page**, so it can use any approach —
vanilla canvas, raw WebGL, three.js, p5, whatever. Sketches are processed by
Vite, so they can `import` any npm package in this repo's `package.json`
(three.js is already installed). Vite builds every `sketches/*/index.html` as
its own page.

## Adding an embedded sketch

```bash
npm run new my-experiment                              # canvas2d starter
npm run new my-shader -- --template webgl-shader
npm run new my-scene  -- --template three --title "My Scene"
```

Then edit `sketches/my-experiment/sketch.js`, fill in `sketch.json`, and run
`npm run dev`. No other registration needed.

To add one by hand: create `sketches/<slug>/` with an `index.html`, your code,
and a `sketch.json` like:

```json
{
  "title": "My Experiment",
  "description": "What it does and how to interact with it.",
  "tags": ["particles"],
  "tech": ["canvas2d"],
  "created": "2026-07-08"
}
```

Drop an optional `thumbnail.png` (or `.jpg`/`.webp`/`.gif`) in the folder for
the gallery card.

## Linking an external project

Add an entry to `src/registry/external.json`:

```json
{
  "slug": "my-other-project",
  "title": "My Other Project",
  "description": "Lives in its own repo.",
  "tags": ["simulation"],
  "tech": ["webgl"],
  "created": "2025-11-02",
  "url": "https://skyfly200.github.io/my-other-project/",
  "repo": "https://github.com/skyfly200/my-other-project",
  "embed": true
}
```

Set `"embed": false` if the deployed site refuses to load in an iframe
(`X-Frame-Options`/CSP) — the viewer will offer an open-in-new-tab button
instead. `url` is optional; with only a `repo` link the entry still shows in
the gallery.

## Adding a template

Add a folder under `templates/` containing at least an `index.html` (use
`__TITLE__` where the sketch title should go). It becomes available as
`npm run new <slug> -- --template <folder-name>`.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml` (enable Pages → "GitHub Actions" in the repo
settings once). The build is plain static files, so any static host works.
