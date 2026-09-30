# Mixer

The **Mixer** stacks several sketches as blended layers, like a VJ deck. Each
layer picks a sketch and composites over the ones below it.

## Layers

For every layer you control:

- **Sketch** — which experiment renders on this layer.
- **Blend mode** — the full compositing set: *normal, screen, lighten, add,
  overlay, soft-light, hard-light, color-dodge, difference, exclusion, hue,
  saturation, color, luminosity*.
- **Opacity** — how strongly the layer contributes.
- **Zoom** — scale the layer's content up (handy to fill the frame with a piece
  that leaves margins, or to punch into detail).
- **On / off** — mute a layer without deleting it.

Reorder, add and remove layers freely; the stack composites bottom-to-top.

## One shared mic

A single microphone drives **every layer's audio mappings at once**, so a whole
stack pulses in sync to the same beat rather than each layer listening
separately. Grant the mic once and the entire mix becomes audio-reactive. The
same input sources from [Inputs & mappings](#/docs/inputs) are available per
layer.

## Live interaction

You can grant **the mouse to one layer** so its pointer interactions play live
while the rest keep running — good for a piece that blooms or steers under the
cursor sitting on top of a calmer bed.

## Filter layers

A **filter** layer (Blur, CRT, Halftone, Motion Extraction, …) does not draw a
picture of its own — it processes whatever is underneath. Every filter layer
automatically takes the *composite of the layers below it* as its source, so a
filter near the top of the stack treats the whole mix beneath it, and a filter
low in the stack only sees what is under it. Put a **Motion Extraction** layer on
top and it pulls motion out of everything beneath — a self-referential feedback
that reacts to the whole mix, not just a camera.

With nothing under it, a filter falls back to the camera, a dropped file or its
built-in demo scene.
