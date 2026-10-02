# Temporary verification scripts

Throwaway Playwright scripts used while building shared filter chains and porting
filters to shaders. They are committed so the next session can reuse them, and they
can be deleted once the chain path is covered by a real benchmark. Delete the whole
`scripts/scratch/` folder, plus the `.gitignore` line for `scripts/scratch/out/`.

Run everything from the repo root. They drive Microsoft Edge with the SwiftShader
software renderer (`channel: 'msedge'`), so frame rates mean nothing. They check
that things work and look right. Screenshots go to `scripts/scratch/out/`
(override with `SP=<dir>`).

| Script | What it checks |
|---|---|
| `chain-fuzz.mjs <rounds> <len> [slug ...]` | Builds random chains (or the slugs you name) from `CHAINABLE_SLUGS` inside Patch on a dev server. Reports console errors, declined filters, uniform and draw counts, parked canvas sizes, and whether the stage is lit. Set `WAIT=40000` for heavy shaders (kuwahara plus halftone) on a software renderer. |
| `chain-draws.mjs` | Needs `npm run build` first. An animated effect into three filters. Shows the shared context makes the draw calls, the stage moves, and the member iframes stay frozen. Compares with `patch.filterChain = 'off'`. |
| `chain-diff.mjs [slug ...]` | Needs `npm run build` first. Static text through three filters (or the slugs you name), chained against unchained, and prints the mean pixel difference. Animated or random filters (feedback, camera-lens scratches) differ by design: look at the screenshots. |
| `shoot.mjs <tag> <slug> ...` | Screenshots standalone sketch pages (`?demo=landscape&seed=7`) to `out/<tag>-<slug>.png`. Run once with tag `before` on the old code, then `after`. |
| `montage.mjs <slug> ...` | Joins `before-<slug>.png` and `after-<slug>.png` side by side. |

| `neural-spike.mjs [model] [tile]` | Loads a Swin2SR model in a bare page and times one tile on WASM. Needs internet. |
| `neural-e2e.mjs [model] [w] [h]` | Runs `src/lib/upscale/neural.js` (worker, tiling, alpha) in the dev server. Slow on a software renderer. |
| `wizard-upscale.mjs` | Needs `npm run build`. Drives Import wizard → AI upscale in Patch on a 40 px image and checks a Media node appears. |
| `upscale-shader.mjs [scale]` | Runs the detail-upscale shader on a picture enlarged by `scale`; writes before / after to `out/upscale-shader.png`. |

| `taau-compare.mjs [scale] [spin] [frames] [w] [h] [query]` | Temporal upscaling prototype: renders a sketch (SLUG=mandelbulb by default) native, low-res, and temporal on a synthetic clock and prints PSNR against a 2x supersampled reference plus median frame cost (software renderer: ratios only). |
| `idle-check.mjs` | Real Patch on the dev server: a static fractal freezes after ~1 s (iframe paused through the deck path, badge shown) and wakes on a param change. |
| `bake-check.mjs [slug]` | Real Patch: bakes an effect to a loop, checks playback moves, the live iframe is paused, and a param change drops the bake. About a minute. |
| `autobake-check.mjs [slug]` | Real Patch: a heavy sketch (mandelbulb) is detected as not real time and baked with no clicks. Several minutes on a software renderer. |
| `problems-check.mjs` | Real Patch on the dev server with a deliberately broken patch (no Output, unwired filter, unknown sketch, wire to a missing node): checks the Problems panel lists them with a fix, the node badges appear, "Add an Output node" clears its issue, a sketch that throws and a blocked camera are reported. |
| `taau-montage.mjs` | Joins the last compare run's ref / native / low-res / temporal frames into `out/taau-montage.png`. |

`chain-diff.mjs` and `chain-draws.mjs` start `vite preview` on port 4399.
`chain-fuzz.mjs` and `shoot.mjs` start the dev server on port 5199.
