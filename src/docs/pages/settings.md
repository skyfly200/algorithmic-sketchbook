# Settings

The **Settings** page (gear icon in the top bar) holds app-wide preferences that
outlive any single sketch or session. Everything here is stored in your browser
(`localStorage`) and can be exported as a backup file.

## Inputs

Set up the physical inputs the sketches read:

- **Audio device** — pick which microphone / line-in feeds beat detection and
  the audio input sources. "Detect devices" grants mic access and lists them;
  the choice is threaded into every sketch (as `?aud=<id>`), so the viewer, the
  Mixer, Patch and Autopilot all listen to the same input.
- **MIDI** — until you set MIDI up it stays hidden from the input lists. Once
  enabled it appears as a single **MIDI** entry with a channel selector (all
  channels, or 1–16), threaded in as `?midich=<n>`.

## Graphics

- **High performance GPU** — asks the browser to run WebGL sketches on the
  dedicated graphics card rather than the integrated one (via the
  `powerPreference: 'high-performance'` context hint). Smoother, but uses more
  power — on laptops it can spin up the discrete GPU. It takes effect the next
  time a sketch loads.

## Colour palettes

A shared library of favourite colours and gradients you can reuse anywhere a
colour picker appears — the active palette's swatches show as a clickable row
under every picker (in Patch node controls, the viewer, and so on).

- **Generate from colour theory.** Pick a base colour and a harmony
  (complementary, analogous, triadic, tetradic, split-complementary or
  monochromatic) and the app derives a balanced palette by rotating the base
  around the colour wheel in HSL. The starter palettes are generated this way.
- **Manage.** Make a palette active, delete palettes and gradients, turn the
  active palette into a gradient in one click, or reset to the theory-generated
  defaults.

## Effects in rotation

The pool of effects the **Randomize** and **Autopilot** features draw from is a
disabled-set: everything is on unless you untick it, so newly added effects
always join the pool. The list is shared with the Patch and Autopilot pickers.
Stale entries for effects that no longer exist are pruned automatically.

## Tutorials, session & backup

- **Tutorials** — toggle the guided walkthroughs and replay them.
- **Session & memory** — whether the Patch / Mixer / Autopilot working state is
  remembered across refreshes, and a button to wipe just that working state
  (your saved routings, blocks and scenes are always kept).
- **Backup & restore** — export everything in this browser (settings,
  favourites, saved routings and blocks, scenes, editor state, palettes and
  on-device performance data) to one file you can move to another machine, and
  restore it later.

## Google Photos

Media nodes can import from Google Photos through the Photos Picker API. The app
ships without credentials, so set it up once:

1. Enable the **Photos Picker API** in Google Cloud.
2. Create an **OAuth 2.0 Client ID** (type: Web application). Add this app's
   origin to the authorized JavaScript origins.
3. Put the id in a `.env` file: `VITE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com`.
4. Rebuild.

Click **Google Photos** on a Media node. Sign in, pick items in the Google
window, and the files download into the media library. Without a client id the
button reports that the setup is missing.
