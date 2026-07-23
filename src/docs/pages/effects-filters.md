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
  diffraction-style looks, polarization.
- **Texture / print** — pointillism, halftone, painterly (watercolour, oil,
  charcoal, ink, pastel), interlacing.
- **Colour / signal** — channel offset, colour filter, CRT, VHS defects,
  rolling shutter.
- **Atmosphere** — fog, mist, glow, nebula gasses, light-through-leaves.
- **Motion / time** — delay, feedback, motion extraction, warp.
- **Kaleidoscope** and **strobe / UV** stylings.

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
