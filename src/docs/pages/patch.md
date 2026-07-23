# Patch

**Patch** is a TouchDesigner-style node graph. Instead of a fixed stack of
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
| **Filter** | A source-[filter](#/docs/effects-filters) sketch. Its video input is piped in as the filter's source each frame. |
| **Media** | Your webcam, dropped files, recorded clips, or a library item as a source. |
| **Text** | Rendered text with a mappable font — size, weight, tracking and colour can all be modulated. |
| **Mask** | Multiplies a content stream by a matte (luma or a second stream). |
| **Polygon Mask** | A projection-mapping mask whose points you drag directly on the output. |
| **Portal** | Remaps a rectangular (or shaped) region of the frame elsewhere, with recursion for infinity-mirror looks. |
| **Blend** | Composites two streams with any blend mode and a mix amount. |
| **Input** | Emits a 0..1 control value from any input source with scale/offset. Wire its ▣ into any param jack. |
| **XY Pad** | A touch surface — drag on its thumbnail; x and y are separate control outputs. |
| **Tracker** | Watches a video input and follows the brightest region: x, y and size (apparent depth) as control outputs. |
| **Output** | Blits its input to the fullscreen stage behind the board. |

## Building faster

- **Randomize (🎲)** deals a whole fresh patch you can then tweak — undoable.
- **Blocks** are reusable named subgraphs. Save a selection as a block, then
  stamp it into the graph as many times as you like. There are also built-in
  **common patterns** (blended pair, filtered effect, layered trio, portal echo,
  audio-reactive blend, …) that fill themselves in from your enabled effect
  pool.
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

## Touch

The board works on touch screens — drag nodes and wires with a finger, pinch to
zoom, and use the multi-row toolbar. XY Pad and Polygon Mask are built for
direct-touch performance.
