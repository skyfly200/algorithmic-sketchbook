# Algorithmic Sketchbook

A curated gallery of interactive computer-graphics experiments. Vue 3 + Vite +
Pinia + Vuetify, fully static — no server required.

```bash
npm install
npm run dev      # gallery at http://localhost:5173
npm run build    # static site in dist/
```

## How it works

Every entry lives in this repo — there's no local-vs-external split:

| Kind | Lives where | Registered how |
| --- | --- | --- |
| **Sketch** | `sketches/<slug>/` in this repo | Automatically — any folder with a `sketch.json` appears in the gallery |
| **Standalone app** | `sketches/<slug>/` with `"standalone": true` | Same auto-discovery; a self-contained imported app that brings its own UI |

The gallery (`/`) lists everything with search, tag, and role (Effects /
Filters) filters. Each entry opens at `/#/sketch/<slug>` and runs live in an
iframe with reload/fullscreen controls, plus links to source.

```
├── index.html            Gallery app shell
├── src/                  The Vue app (gallery + viewer)
│   ├── registry/         Auto-discovers every sketches/<slug> into one list
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
- **Input mappings** — route inputs into any numeric parameter with an amount
  from −1 to 1. Sources: audio (`beat.pulse`, `beat.level`/`low`/`mid`/`high`,
  `beat.volume`), pointer (`mouse.x`, `mouse.y`), device motion (`tilt.x`,
  `tilt.y`, `shake` — accelerometer/gyro; iOS shows a permission button), and
  `time.sin`. Effective value = base + input × amount × (max − min). This is
  how you "trigger changes on beat" (or tilt) without writing code — or use
  `rt.onBeat` / `rt.motion` for full control.
- **Scenes** — save the current parameter values + input mappings + display
  settings under a name. Saved scenes appear alongside the gallery on the
  home page and deep-link as `/#/sketch/<slug>?scene=<id>`. They're stored in
  localStorage.

The viewer and sketch talk over `postMessage` (`sketch:ready`,
`sketch:set-param`, `sketch:set-mappings`, `sketch:apply-scene`) — see
`sketches/_lib/runtime.js` and `src/views/SketchView.vue`.

### Phone / OSC remote control

`npm run build && npm run remote` starts a tiny relay on your laptop
(`scripts/remote-server.mjs`, node builtins only) that serves the app over plain
HTTP on your LAN, prints a QR code, and runs a message hub. Open the app on the
laptop at the printed LAN URL and the **phone controller** at `…/remote`
(scan the QR): its *Sketch* tab **auto-follows** the current sketch — a labelled
control per param, changes applied live — and its *Pad* tab is an XY pad + faders
+ buttons + tilt wired to `remote.x`, `remote.y`, `remote.p1…p6`, `remote.a/b/c`,
`remote.tiltx/y`, which you map to any param like any other input source. The
relay also listens for **OSC over UDP** (`:8000`), so TouchOSC or any OSC app
drives the same `remote.*` sources (`/remote/<name>` → `remote.<name>`; any key
resolves). HTTP-on-LAN keeps the app and phone on one origin so `EventSource`
works without the mixed-content block a deployed `https://` site would hit.

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

## Importing a standalone app

To bring a whole self-contained app in (its own UI, not a sketchbook-runtime
sketch), drop its page into `sketches/<slug>/` — an `index.html` entry plus its
JS/assets — and give it a `sketch.json` with `"standalone": true`:

```json
{
  "slug": "my-imported-app",
  "title": "My Imported App",
  "description": "A full standalone app, imported into the sketchbook.",
  "tags": ["simulation"],
  "tech": ["three.js", "webgl"],
  "created": "2025-11-02",
  "standalone": true
}
```

Standalone entries show in the gallery like anything else but skip the runtime
param panel and the Autopilot / Patch / Mixer compositor pools. Reference any
runtime-loaded assets (models, textures) via `?url` imports so Vite emits them
alongside the page — see `sketches/caustics-art`. Two worked examples live in
the repo: `caustics-art` (a Three.js app) and `moire-patterns` (a Vue app).

## Adding a template

Add a folder under `templates/` containing at least an `index.html` (use
`__TITLE__` where the sketch title should go). It becomes available as
`npm run new <slug> -- --template <folder-name>`.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml` (enable Pages → "GitHub Actions" in the repo
settings once). The build is plain static files, so any static host works.
