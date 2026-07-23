# Offline & installing

Bright Waves is a **Progressive Web App**. Once you've loaded it online once, the
whole thing — the gallery, the viewer, every studio view and **every single
experiment** — runs with no network at all.

## Installing

In a supported browser you'll get an **install** affordance (an icon in the
address bar, or "Add to Home Screen" on mobile). Installing gives it its own
window, an app icon, and a standalone, chrome-free launch. It's the same site
either way — installing just makes it feel native.

## How offline works

At build time a service worker is generated that **precaches every built file**:
the app shell, all the sketch pages and their JavaScript and CSS, the icon font,
the manifest and the icons. On your first visit those are stored in the browser's
cache, so afterward the app is served cache-first and works with the network
switched off — on a plane, on a wall with no Wi-Fi, wherever.

- The cache is **versioned** and busts whenever any asset changes, so you always
  get a coherent set of files.
- A new build **waits** rather than swapping files out mid-session; it takes over
  on the next load, so nothing breaks while you're using it.
- There are **no external dependencies** at runtime — no CDNs, no web fonts to
  fetch — which is what makes true offline possible.

The service worker only runs in a production build served over HTTPS (or
`localhost`); it's inactive during development.

## Your data is local too

Everything you save lives in your browser, not on a server:

- **Scenes**, **saved patch routings**, **blocks** and **mixes** are in
  `localStorage` (see [Scenes & Library](#/docs/scenes)).
- The studio also remembers your **current working state** — the open Patch
  graph, the Mixer's layers, the Autopilot mix — so a refresh puts you back where
  you were.

## Settings → Session & memory

You control that working-state persistence:

- **Remember editor state across refreshes** — on by default. Turn it off to
  start each editor fresh every visit.
- **Clear session memory** — wipes the current Patch / Mixer / Autopilot working
  state and reloads. Your **saved** routings, blocks and scenes are deliberately
  left untouched, so clearing the session never throws away named work.

## Performance data

The gauges on each gallery card come from a performance audit
(`npm run perf`) that scores each sketch against a 60fps target. That baseline is
then **overridden by live measurements on your own machine** as you run pieces,
so the numbers reflect *your* hardware rather than the machine that built the
site.
