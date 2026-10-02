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

A [filter](#/docs/effects-filters) is a sketch that processes an upstream image
instead of generating its own. Build it on `sketches/_lib/source.js`:
`createSource()` gives you a source that can be a camera, dropped files, a demo
scene, or the live Mixer/Patch feed. Then add the slug to `FILTER_SLUGS` in
`src/registry/filters.js` so the app treats it as a filter.

### Write per-pixel filters as shaders

A loop over `getImageData` pixels is the usual reason a filter runs slowly. Put
per-pixel work in a fragment shader with `sketches/_lib/glfilter.js`:

```js
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  amount: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Amount' },
  radius: { value: 4, min: 1, max: 20, step: 1, label: 'Radius (px)' },
})

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;               // 0..1, y up
uniform sampler2D u_tex;    // the source
uniform vec2 u_res;         // output size in pixels
uniform float u_time;       // seconds
uniform float u_amount;
uniform float u_radius;
out vec4 outColor;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  // sample neighbours at v_uv + offset * u_radius / u_res
  outColor = vec4(mix(c, 1.0 - c, u_amount), 1.0);
}`

const gf = createGLFilter({ rt, src: createSource(), canvas: document.getElementById('canvas'), frag: FRAG })

function frame(now) {
  rt.tick(now)
  gf.render({ time: now * 0.001 }, (u) => {
    u.f('u_amount', params.amount)
    u.f('u_radius', params.radius * rt.pixelRatio) // pixel sizes: multiply by rt.pixelRatio
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

- `gf.render` skips the frame when the source picture, the uniforms and the size
  are unchanged and the shader does not read `u_time`. A still image with static
  params costs almost nothing.
- Pass `mipmaps: true` to `createGLFilter` to read a pre-blurred source with
  `textureLod(u_tex, uv, lod)`. Use it for blurs, glows and averages instead of
  reading pixels back.
- Uniform setters on `u`: `f`, `i`, `v2`, `v3`, `v3arr`. Extra samplers (a LUT,
  a baked overlay) come from `gf.addTexture(name, unit)`.
- For several passes (separable blurs, ping-pong simulation state) use
  `sketches/_lib/glpipe.js`. See `wind`, `ink-bleed` and `vhs-defects`.
- Press **D** in the viewer (or add `?demo=night-city`) to cycle the built-in demo
  scenes while you tune the look.

### Make it chainable

Patch runs consecutive shader filters as one shared GL pipeline instead of one
iframe plus one image transfer each (see [Filter chains](#/docs/effects-filters)).
A filter joins by being listed in `CHAINABLE_SLUGS` in `src/registry/filters.js`.
It qualifies when:

- `createGLFilter` is the only thing it draws,
- it does not call `addTexture` or use `glpipe`,
- it keeps no GL state between frames (no frame history, feedback or baked noise
  textures): the output is a pure function of the input picture, the uniforms and
  `u_time`,
- it never reads `canvas.width` or `canvas.height`.

Two rules keep a chained filter looking the same as the unchained one:

- **Read sizes every frame.** In a chain, `rt.pixelRatio`, `gf.width` and
  `gf.height` report the chain's render size, not the iframe's. Multiply pixel
  radii by `rt.pixelRatio` and derive sizes from `gf.width` inside the render
  callback. Do not cache them at load.
- **Use `u_time` for time.** Declare `uniform float u_time` and let the host set
  it. A custom time uniform changes every frame and floods the chain with updates.

`tests/filters.test.js` checks these rules for every slug in the list.

### Filters that stay outside a chain

Filters that keep history (delay, feedback, tiling, strobe, interlace,
motion extraction, rolling shutter, FPS limiter) or bake noise and overlay
textures (fog, shaky film) work fine as filters. They run in their own iframe
and are simply not in `CHAINABLE_SLUGS`.

## Templates & the build

Each template is a folder in `templates/`; `__TITLE__` is replaced with the
sketch title on scaffold. Vite builds every `sketches/<slug>/index.html` as its
own page (see `sketchInputs()` in `vite.config.js`), which is what keeps each
sketch a self-contained app — and lets the [offline](#/docs/offline) service
worker precache every one of them.
