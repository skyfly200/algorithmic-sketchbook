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

## Motion extraction feedback

A **Motion Extraction** layer is special: it automatically ingests the
*composite of the layers below it* as its source. Stack it on top and it pulls
motion out of everything underneath — a self-referential feedback that reacts to
the whole mix, not just a camera.

## Saving a mix

A mix can be saved and later reopened. Under the hood a mix is stored the same
way as a Patch routing, which is why they share a home in the
[Library](#/docs/scenes) and why the [Patch](#/docs/patch) board can open a mix
as a graph.
