# Effects vs filters

Every sketch is one of two kinds, and the distinction shapes where it shows up.

## Effects (generators)

An **effect** is a standalone generator — it draws its own picture from nothing
but its parameters, the seed and live inputs. Most of the gallery is effects:
fractals, simulations, shader fields, 3D scenes, and so on. In [Patch](#/docs/patch)
an effect is an **Effect node**; in the [Mixer](#/docs/mixer) it's a layer.

## Filters (source processors)

A **filter** takes an upstream *image* and processes it. It doesn't invent
content; it transforms whatever feed it's given — the composite below it in the
Mixer, or its input in a Patch **Filter node**. Filters are built on
`sketches/_lib/source.js`, which lets them accept a camera, dropped files, a
built-in demo scene, or the live Mixer/Patch feed, and then apply their effect.

The current filters include:

- **Optical / lens** — camera lens (focus, focal plane, dirt), lens flare,
  diffraction-style looks, polarization, **funhouse mirror** (wavy / bulge /
  pinch / carnival warps), and **birefringence** (calcite double refraction: the
  upstream image splits into an ordinary and a sheared extraordinary copy, with
  optional spectral interference bands).
- **Texture / print** — pointillism, halftone, **painterly** (watercolour, oil,
  charcoal, ink, pastel and **spray paint**), **stained glass** (a leaded
  Voronoi mosaic), interlacing.
- **Colour / signal** — channel offset, colour filter, CRT, VHS defects,
  rolling shutter.
- **Atmosphere** — fog, mist, glow, nebula gasses, **light through leaves**
  (with a colour-temperature control and focal-plane interference ripple).
- **Motion / time** — delay, feedback, motion extraction, warp, and the
  **FPS limiter** (sample-and-hold any source to a chosen frame rate for a
  stop-motion / on-twos stutter, with step-blend and motion echo).
- **Kaleidoscope** and **strobe / UV** stylings.

## Filter chains

In Patch, a run of two or more filters wired one into the next runs as a **filter
chain**: one shared GL pipeline draws every pass, instead of each filter being a
separate page that receives an image transfer each frame. The filters stay
ordinary nodes. You still edit their parameters, map inputs and save scenes
exactly as before.

- A chain forms when each filter feeds only the next one. A branch, a Blend or
  the Output taking an in-between picture ends the chain there.
- Only filters that are pure single-pass shaders join. Blur, glow, mist, warp,
  kaleidoscope, funhouse mirror, birefringence, edge detect, halftone, pointillism,
  CRT and most colour and distortion filters do. Filters that keep history or baked
  textures (delay, feedback, tiling, strobe, interlace, fog, shaky film, painterly
  and others) stay separate pages.
- Preview thumbnails of the middle filters refresh a few times a second, or live
  while you select one.
- To compare with the old path, set `localStorage['patch.filterChain'] = 'off'`
  and reload.

The list of chainable filters is `CHAINABLE_SLUGS` in `src/registry/filters.js`.
See [Authoring](#/docs/authoring) to make your own filter chainable.

## Why the split matters

- The gallery's **Effects / Filters** toggle uses it, so you can browse just
  the generators or just the processors.
- **Autopilot** and the Patch **Randomize** draw generators from the effect
  pool and cap a stack with at most one filter fed the live composite — which is
  why filters read the image beneath them.
- In the [Mixer](#/docs/mixer), a filter layer processes the composite of the
  layers below it.

The canonical list of which sketches are filters lives in one place
(`src/registry/filters.js`), shared by the gallery, Patch, Autopilot and
Settings, so the split is defined exactly once.
