---
name: run-algorithmic-sketchbook
description: Build, run, start, screenshot and drive the Algorithmic Sketchbook (Vue/Vite gallery of WebGL/canvas sketches, Patch, Mixer) in headless Chromium to confirm a sketch or UI change works in the real app.
---

Static Vue 3 + Vite site; no server. The agent path is `driver.mjs`, which serves `dist/` with `vite preview` and drives it with Playwright, writing a PNG. Paths are relative to the repo root.

## Prerequisites and build

```bash
npm ci --no-audit --no-fund
npm run build        # ~20 s; the driver serves dist/, so rebuild after every change
npm test             # vitest, 720 tests, ~2 s
```

Chromium is pre-installed at `/opt/pw-browsers/chromium`. Do not run `npx playwright install`: the repo's Playwright is newer than that browser, and the driver passes `executablePath` for you (override with `PW_CHROMIUM`).

## Run (agent path)

```bash
D=.claude/skills/run-algorithmic-sketchbook/driver.mjs
node $D gallery out.png                 # gallery home
node $D viewer plasma-shader out.png    # viewer page: sketch + controls toolbar (/#/sketch/<slug>)
node $D sketch plasma-shader out.png    # the bare sketch page, as iframed by the viewer
node $D patch out.png                   # Patch compositor
```

Add `--ms 3000` to let animation run longer before the shot (default 1500). It prints the screenshot path, page title and any page/console errors, and exits 1 if there are errors. Then open the PNG and look at it. Slugs are the folder names under `sketches/`.

## Gotchas

- The first-run welcome tour covers the gallery. The driver pre-seeds `localStorage['sketchbook-settings'] = {"tutorials":false}` to suppress it.
- WebGL runs on swiftshader (software), so shader sketches draw but FPS numbers are meaningless; use `npm run bench` on a real GPU for perf.
- 404s on `/remote-hub/send` and `/remote-hub/events` are normal under `vite preview` (that is the optional `npm run remote` server); the driver ignores them.
- A wrong slug does not error in `viewer` mode (you just get an empty viewer); look at the screenshot. In `sketch` mode the page title is the sketch's own, and a bad slug 404s.
- Not tried: `npm run dev` (HMR server); the driver covers the production build only.
