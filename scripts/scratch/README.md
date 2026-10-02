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
| `chain-diff.mjs` | Needs `npm run build` first. Static text through three filters, chained against unchained, and prints the mean pixel difference. |
| `shoot.mjs <tag> <slug> ...` | Screenshots standalone sketch pages (`?demo=landscape&seed=7`) to `out/<tag>-<slug>.png`. Run once with tag `before` on the old code, then `after`. |
| `montage.mjs <slug> ...` | Joins `before-<slug>.png` and `after-<slug>.png` side by side. |

`chain-diff.mjs` and `chain-draws.mjs` start `vite preview` on port 4399.
`chain-fuzz.mjs` and `shoot.mjs` start the dev server on port 5199.
