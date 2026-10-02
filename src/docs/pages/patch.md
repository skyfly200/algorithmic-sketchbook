# Patch

**Patch** is a node-graph compositor. Instead of a fixed stack of
layers, you wire sketches, filters, media and control signals together into an
arbitrary network and blit the result to a fullscreen stage.

## Wiring

- **Video** flows left → right. Drag from a node's right-edge port to another
  node's left-edge port to pipe its output in.
- **Control** flows from an amber ▣ output. Drag it onto the ▣ jack beside any
  numeric parameter to modulate that parameter with a live value — the same
  mapping system as everywhere else, but as a patch cable.
- Wires stay visible even when a node's settings are collapsed; they land on
  dots along the node's left edge so the graph reads cleanly.
- **Cycles are allowed.** An upstream node holds its last frame, which is exactly
  how you build **video feedback** — route a node's output back into itself
  through a Feedback filter or a Blend.

## Node types

| Node | What it does |
| --- | --- |
| **Effect** | A generator sketch running live in a hidden iframe; its canvas is the node's output. Open ⚙ for its parameters and input mappings. |
| **Filter** | A source-[filter](#/docs/effects-filters) sketch. Its video input is piped in as the filter's source each frame. Consecutive shader filters run together as one [filter chain](#/docs/effects-filters). |
| **Media** | Your webcam, dropped files, recorded clips, or a library item as a source. |
| **Text** | Rendered text with a mappable font — size, weight, tracking and colour can all be modulated. |
| **Mask** | Cuts a content stream to a matte: the matte's brightness sets what shows through. Feed a shape (a **Polygon** or bright **Text**), not a second picture. To mix two pictures, use a **Blend**. |
| **Polygon** | A source that fills an editable polygon whose points you drag directly on the output. Wire it into a **Mask**'s matte input to projection-map, or use it as a coloured shape. |
| **Portal** | Remaps a rectangular (or shaped) region of the frame elsewhere, with recursion for infinity-mirror looks. |
| **Blend** | Composites two streams with any blend mode and a mix amount. |
| **Geometry** | A mesh living in geometry space — pick a shape and material, and its *displace* control warps every vertex along its normal (a vertex shader in miniature). Its dotted output is geometry, not pixels: it only plugs into a Camera. |
| **Camera** | A virtual camera that rasterizes the geometry wired into its three inputs down to a pixel frame — set field of view, distance, orbit and lighting. Its output is a normal image stream you can Blend, Filter or send to Output. |
| **Input** | Emits a 0..1 control value from any input source with scale/offset. Wire its ▣ into any param jack. |
| **XY Pad** | A touch surface — drag on its thumbnail; x and y are separate control outputs. |
| **Tracker** | Watches a video input and follows the brightest region: x, y and size (apparent depth) as control outputs. |
| **Output** | Blits its input to the fullscreen stage behind the board. |

## Building faster

- **Randomize (🎲)** deals a whole fresh patch you can then tweak — undoable.
- **Blocks** are reusable named subgraphs. Save a selection as a block, then
  stamp it into the graph as many times as you like. There are also built-in
  **common patterns** (blended pair, filtered effect, layered trio, portal echo,
  polygon-mapped, **shape cutout overlay**, audio-reactive blend, …) that fill
  themselves in from your enabled effect pool. The shape cutout overlay masks one
  effect to a shape and composites it over another with a plain **normal** blend.
- **Replace-branch (↺)** on a node's header retires everything feeding that node
  and grows a fresh upstream branch in its place, laid out tidily so nothing
  overlaps.
- **Box-select** and **lock** nodes; locked nodes are protected from moves and
  from randomize/replace.
- **Undo / redo** with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`.

## Save, Save as, previews

Saving a routing captures the whole graph *and* each effect's own parameters and
mappings, plus a **preview thumbnail** of the composited output. Loading a
routing enters an editing state, so **Save** overwrites it in place while **Save
as new** forks a copy. Everything you save shows up in the [Library](#/docs/scenes).
Patches also export/import as `.json` files.

## Resolution & the show

The compositor resolution — up to 1080p or your display's **native** pixels —
sets how many pixels actually flow through the graph, trading sharpness for
speed. The **monitor** button pops the composite out into its own window: drag it
onto a projector or second display, double-click for fullscreen, and keep
adjusting the graph here without disturbing the output. A timeline of **cues**
lets you snapshot the whole patch (graph + params) and crossfade between saved
looks.

**Smooth cue changes.** With the 🔥 **Pre-warm** toggle on (default), the show
panel loads the *next* cue's effects in hidden standby frames ahead of time — on
the timeline, four seconds before the cue lands; with manual GO, as soon as the
previous cue fires. When the cue changes, those already-running frames are
promoted in place, so nothing boots at the moment of the cut. If a cue isn't
warm yet, GO waits up to 1.5 s (the old patch keeps playing) rather than
stuttering. The ☁ **Preload** button also fetches every effect the show uses, so
nothing is downloaded mid-show (the installed offline build already has them).
Sketches report `sketch:loaded` once they've rendered their first frames; one
that loads assets asynchronously can delay it with `rt.holdLoad(promise)`.

## Decks — edit one patch while another is on air

Turn on **Decks** (bottom-right console) and Patch runs **two full patches, A and
B**, like a DJ's two decks. A master **crossfader** blends them onto the stage
and the projector output; the deck you click is the one the editor shows, so you
can build and tweak on the side while the other keeps playing.

- **Fork A → B** copies the deck you're editing into the other one — graph, every
  effect's settings and seeds, so it looks identical — and opens the copy.
  Experiment there; the on-air deck is untouched. (A deck that's currently on air
  can't be overwritten by a fork.)
- **Cue effect…** loads a fresh *Effect → Output* onto the off-air deck so you can
  audition it in the **PVW** preview and tune it before it goes out.
- **CUT** jumps to the other deck; **AUTO** fades over the time next to it. Both
  decks keep running through the fade, so it's a true live crossfade — nothing
  freezes and nothing boots at the moment of the change.
- **Blend** chooses how the decks combine: *Mix* (dissolve), or *Add / Screen /
  Multiply / Difference* with the fader as the opacity of deck B over A.
- **Restore** puts back what a deck held before the last fork or cue.
- With Decks on, **show cues** load onto the off-air deck and fade in over the
  cue's fade time (the deck crossfade replaces per-parameter ramping).

Each deck's effects are real pages, so two decks cost roughly twice one — see
**Performance** for how Patch decides what your machine can carry and what it
does when both decks don't fit.

## Autopilot mode

Patch can also drive itself. The **Manual / Autopilot** toggle in the run
toolbar flips between hand-editing and a hands-free mode that mutates *this*
graph on a timer — swapping effect and filter sketches, restyling blends, and
occasionally regrowing a whole upstream branch — always leaving locked nodes
alone. The cog next to it sets how often it changes and links to the full
[Autopilot](#/docs/autopilot) view. Lock the nodes you want to keep, hit
Autopilot, and let the board evolve; take over any time by switching back to
Manual.

**Crossfaded moves.** With [Decks](#decks-edit-one-patch-while-another-is-on-air)
on, Autopilot doesn't change the live graph in place (swapping a sketch there
reloads it on screen). Instead each move is built on the **off-air deck**: the
on-air deck is mirrored across — unchanged effects keep running, only what the
move changes boots — the move is applied there, and once it has warmed up it
fades in over the *Fade* time while the old look fades out, both running live.
The editor follows the live patch across each fade. **Step back** fades to the
previous look (the deck you just left still holds it). Autopilot owns the off-air
deck while it runs, so don't edit it; *Restore* brings back what it overwrote.
Untick *Crossfade each move on the decks* in the panel to go back to in-place
changes. A fade briefly runs both decks, so on a small machine (see
**Performance**) keep the fade short or the graph light.

You can hop between the two either way: **Open the Autopilot view** from Patch,
or **Edit in Patch** from Autopilot to drop its current evolving mix onto the
board as an editable graph.

## Converting a mix into a patch

A [Mixer](#/docs/mixer) stack is just a linear blend of layers, so it maps
cleanly onto nodes. The Mixer's **Open in Patch** button (and Autopilot's
**Edit in Patch**) converts the live mix into a graph — an Effect node per
layer, folded together with Blend nodes carrying each layer's blend mode and
opacity, into an Output — and hands it to the board, where you can rewire it,
add filters and controls, and save it like any routing.

## Touch

The board works on touch screens — drag nodes and wires with a finger, pinch to
zoom, and use the multi-row toolbar. XY Pad and Polygon Mask are built for
direct-touch performance.
