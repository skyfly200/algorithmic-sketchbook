# Scenes & Library

## Scenes

A **scene** is a named snapshot of a single sketch's state:

- every parameter value,
- every input mapping (source, amount, smoothing, curve),
- and the display settings (quality, seed).

Save one from the viewer's controls panel. Scenes are listed on the gallery
page and in the [Library](#/docs/scenes), applied with a single click, and
**deep-linkable**:

```
/#/sketch/<slug>?scene=<id>
```

So a scene is a shareable preset — a specific, reproducible look you dialled in,
captured down to the seed. Scenes live in your browser's `localStorage`, which
means they persist across visits on that device and are available
[offline](#/docs/offline).

## The Library

The **Library** collects the things you save across the studio:

- **Patch routings & mixes** — node graphs saved from [Patch](#/docs/patch),
  including mixes you save out of [Autopilot](#/docs/autopilot). Each shows a
  preview thumbnail of its composited output. Open one to load it straight back
  into the Patch board for editing.
- **Scenes** — every named scene, grouped by the sketch it belongs to; click to
  jump to that sketch with the scene applied.

Delete anything you no longer want from here. Routings live under the
`sketchbook-patch-saved` key; scenes in the scenes store — both in
`localStorage`.

## Saving vs. editing a patch

When you save a routing you can either **Save** (overwrite the one you're
currently editing, refreshing its preview) or **Save as new** (fork a fresh
copy). Loading a routing puts you into an editing state so a later *Save* updates
that same entry rather than piling up duplicates. See [Patch](#/docs/patch) for
the full workflow.

## Session memory

Separately from saved scenes and routings, the studio remembers your *current*
working state — the open Patch graph, the Mixer's layer stack, the Autopilot mix
— so a refresh drops you back where you were. You can turn that off, or wipe it,
under **Settings → Session & memory**; it never touches your saved scenes,
routings or blocks. More in [Offline & installing](#/docs/offline).
