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

## The sketch runtime: FPS, quality, beat detection

`sketches/_lib/runtime.js` is a small opt-in helper every template already
uses:

```js
import { createRuntime } from '../_lib/runtime.js'
const rt = createRuntime()

rt.pixelRatio        // use instead of devicePixelRatio when sizing canvases
rt.detail            // 0..1 — scale particle counts etc. for lower quality
rt.tick(now)         // call once per frame (drives FPS meter + beat detector)

rt.onBeat(({ energy }) => { ... })  // fires on each detected beat
rt.beat.state.pulse  // 1 on beat, decays to 0 — great for driving visuals
rt.beat.state.level  // live bass energy 0..1
rt.beat.trigger()    // fire a beat manually (click fallback, testing)
```

**FPS counter & graphics quality** are controlled from the sketch viewer's
toolbar (speedometer and tune icons). Lowering quality renders at reduced
resolution (½× or ¾×) and shrinks `rt.detail`, which is usually the difference
between a stuttering and a buttery sketch on a hidpi display. Settings persist
in localStorage and are passed to sketches as query params
(`?fps=1&quality=low`), so they also work on a sketch opened directly.

**Beat detection** uses the microphone (Web Audio): calling `rt.onBeat(...)`
mounts a 🎤 toggle button in the sketch; once enabled, beats are detected as
bass-energy spikes above the rolling average. See `sketches/beat-rings` for a
complete audio-reactive example (click anywhere in it to fake beats without a
mic).

## Params, input mappings & scenes

Sketches can declare tweakable parameters:

```js
const params = rt.params({
  speed: { value: 1.4, min: 0.3, max: 4, step: 0.1, label: 'Particle speed' },
  mirror: { value: false, type: 'bool', label: 'Mirror' },
})
// read params.speed in your frame loop — it's the live, modulated value
rt.mapInput('beat.pulse', 'speed', 0.3) // default input→param mapping
```

Declaring params lights up the **controls panel** (tune icon) in the viewer:

- **Parameters** — live sliders/switches for everything declared.
- **Input mappings** — route inputs (`beat.pulse`, `beat.level`, `mouse.x`,
  `mouse.y`, `time.sin`) into any numeric parameter with an amount from −1
  to 1. Effective value = base + input × amount × (max − min). This is how
  you "trigger changes on beat" without writing code — or use `rt.onBeat`
  for full control.
- **Scenes** — save the current parameter values + input mappings + display
  settings under a name. Saved scenes appear alongside the gallery on the
  home page and deep-link as `/#/sketch/<slug>?scene=<id>`. They're stored in
  localStorage.

The viewer and sketch talk over `postMessage` (`sketch:ready`,
`sketch:set-param`, `sketch:set-mappings`, `sketch:apply-scene`) — see
`sketches/_lib/runtime.js` and `src/views/SketchView.vue`.

Example sketches: `flow-field` (params + a default beat→speed mapping),
`beat-rings` (beat callbacks), `motion-extraction` (webcam motion extraction
with delay/blend/freeze params — works without a camera via its demo source).

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
