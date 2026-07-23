# Authoring experiments

Adding a new experiment never touches app code. Each sketch is a folder under
`sketches/<slug>/` and the gallery discovers it automatically.

## Scaffold

```
npm run new my-sketch -- --template canvas2d --title "My Sketch"
```

Templates: `canvas2d`, `webgl-shader`, `three`. That creates the folder with an
`index.html`, a `sketch.js` and a `sketch.json`. Then:

1. Write the piece in `sketches/my-sketch/sketch.js`. It's a plain standalone
   page — Vite processes it, so npm imports work (three.js and p5.js are
   installed; add other deps to `package.json` as needed).
2. Fill in `description`, `tags` and `tech` in `sketch.json`.
3. Verify with `npm run build` (and `npm run dev` to look at it).

No registration step — the gallery picks it up from the folder.

## Anatomy

```
sketches/my-sketch/
  index.html     a self-contained page (dark bg, no scrollbars, canvas fills the viewport)
  sketch.js      the experiment; imports the shared runtime
  sketch.json    { title, description, tags[], tech[], created }
```

`sketch.json` is the manifest the gallery reads. `tags` and `tech` feed the
theme chips, the vibe filters and search; a sketch that lists `audio-reactive`
gets the audio treatment, and matching keywords place it under the right
category.

## Minimal sketch

```js
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

const params = rt.params({
  speed: { value: 1, min: 0.2, max: 4, step: 0.1, label: 'Speed' },
})
rt.mapInput('audio.pulse', 'speed', 0.4) // optional default music reactivity

function frame(now) {
  rt.tick(now)                 // FPS meter, beat detector, input modulation
  // …draw, reading params.speed (which already includes live modulation)…
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

Declaring params is *all it takes* to earn a controls panel, input mappings and
scene support — in the viewer, the Mixer, Patch and Autopilot alike. See the
[Runtime API](#/docs/runtime) for the full surface.

## Conventions

- Fill the viewport; dark background; handle window resize; no scrollbars
  (`overflow: hidden`).
- Animate with `requestAnimationFrame` (or `setAnimationLoop` for three.js).
- Use `rt.pixelRatio` instead of `devicePixelRatio`, and scale heavy workloads
  (particle counts, iterations) by `rt.detail`, so the viewer's graphics-quality
  setting actually does something.
- Prefer declaring a piece's interesting constants as **params** — it makes them
  tweakable, mappable and saveable for free.
- Use the seeded RNG (`rt.rng`, `rt.random`, `rt.pick`) for any generative
  variation, so the 🎲 seed reproduces a look and `?seed=` deep-links it.

## Source filters

To build a [filter](#/docs/effects-filters) — a sketch that processes an
upstream image rather than generating its own — build on
`sketches/_lib/source.js`. `createSource()` gives you a source that can be a
camera, dropped files, a demo scene, or the live Mixer/Patch feed, with a
`draw(ctx, w, h, { mirror })` you call each frame before applying your effect.
Then add the slug to `src/registry/filters.js` so the app treats it as a filter.

## Templates & the build

Each template is a folder in `templates/`; `__TITLE__` is replaced with the
sketch title on scaffold. Vite builds every `sketches/<slug>/index.html` as its
own page (see `sketchInputs()` in `vite.config.js`), which is what keeps each
sketch a self-contained app — and lets the [offline](#/docs/offline) service
worker precache every one of them.
