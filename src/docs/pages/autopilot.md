# Autopilot

**Autopilot** runs the show for you. Rather than dealing whole new scenes, it
keeps a persistent stack of blend-composited layers and *evolves* it one move at
a time — replace a layer, add one, drop one, swap the capping filter, restyle a
blend — so the picture is always changing but never cuts to black.

## How a change lands

Every incoming sketch **warms up invisibly** first: it loads, announces its
controls, and renders a few frames off-screen. Only once it's genuinely ready
does it **crossfade in** while just its counterpart fades out — the rest of the
network never stops. That's why transitions stay smooth even when a heavy piece
is coming in.

## Evolution modes

Pick how the show develops over time:

| Mode | Feel |
| --- | --- |
| **Evolve** | One move at a time — the original steady, ever-changing drift. |
| **Curated** | Strings together effects that share an element for a coherent look. |
| **Energy arc** | Builds to a busy, energetic peak, then releases back to calm. |
| **Calm ambient** | Few layers, gentle effects, slow changes. |
| **Beat-synced** | Changes land on the music (needs the mic on). |
| **Chaos** | Fast, dense, high-churn — throws everything at the wall. |

## Perf-aware routing

Routing watches performance. Each sketch's measured score becomes a **cost**, the
stack keeps its total under a **budget**, and an FPS **watchdog** degrades
gracefully when the frame rate drops — first thinning the most expensive layer,
then swapping in cheaper sketches — instead of stuttering or cutting out. New
sketches are preloaded *before* anything is cleared, so there's never a blank
gap.

## Learned interest

Autopilot quietly learns what you like from what you keep versus skip: a layer
you let play accrues weight; one you skip past quickly loses it. The router then
favours the higher-weighted sketches. This taste is remembered across sessions
(and can be wiped from [Settings](#/docs/offline)).

## Live control

Open the side drawer to steer without stopping the show:

- **Every layer's parameters and input mappings are editable live** — tweak a
  running layer in place.
- **Lock** a layer to keep it while everything around it changes; **target** or
  **skip** the next move.
- **Options evolution** slowly drifts each layer's own parameters over time, so
  even a held layer keeps breathing.
- **Branch ops** can replace a whole effect subtree with a fresh one built from a
  structural block (single, blended pair, filtered trio, …).
- A shared mic drives the whole mix's audio reactivity.

You can **save the current mix as a patch** and open it in [Patch](#/docs/patch)
to keep building by hand, or save it to the [Library](#/docs/scenes).
