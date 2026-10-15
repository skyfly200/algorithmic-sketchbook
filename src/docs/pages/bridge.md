# Sketchbook Bridge

Browsers can't receive network messages sent over UDP, which is how lighting desks
(Art-Net) and control apps like TouchOSC talk. The **Sketchbook Bridge** is a small
program you run on the computer that shows the visuals. It receives those messages
for the browser and also serves the app itself, so a phone on the same network can
control it.

| What | Port | Arrives as |
| --- | --- | --- |
| Art-Net (DMX) from a lighting desk or software | UDP 6454 | `artnet.ch1`, `artnet.ch2`, … |
| OSC from TouchOSC or any OSC app | UDP 8000 | `remote.<name>` |
| The phone controller (a web page, nothing to install) | TCP 7777, `/remote` | `remote.x`, `remote.y`, `remote.p1` … |
| The app itself | TCP 7777 | open `http://localhost:7777` |

You only need it for Art-Net, OSC or the phone controller. Audio, MIDI, the mouse,
touch, tilt and Leap Motion all work without it.

## Download

Get the zip for your computer from the
[releases page](https://github.com/skyfly200/algorithmic-sketchbook/releases):

- **Windows**: `sketchbook-bridge-…-win-x64.zip`
- **Mac with Apple silicon (M1 and later)**: `…-darwin-arm64.zip`
- **Intel Mac**: `…-darwin-x64.zip`
- **Linux PC / Raspberry Pi 4 or 5 (64-bit)**: `…-linux-x64.zip` / `…-linux-arm64.zip`

Each zip is about 40 MB and includes everything it needs, so you don't need to
install Node.js or anything else.

## Run it or install it

Unzip it, then open one of the launchers in the folder:

| Launcher | What it does |
| --- | --- |
| **Start Bridge** | Runs the bridge in a window and opens the app. Close the window to stop it. |
| **Install** | Copies the bridge to your user folder and starts it now and every time you log in. It doesn't need admin rights. |
| **Uninstall** | Stops it, removes the login item and deletes the installed copy. |

On macOS the launchers end in `.command`, on Windows in `.cmd`, and on Linux they
are `start-bridge.sh`, `install.sh` and `uninstall.sh`.

**The first time you open one.** The launchers aren't code-signed, so the system
warns you:

- **Windows** says "Windows protected your PC": choose *More info*, then *Run anyway*.
  When Windows Firewall asks about Node.js, allow it on **private networks** so your
  phone and lighting desk can reach it.
- **macOS** says it can't verify the developer: Control-click the launcher, choose
  *Open*, then *Open* again (or allow it under *System Settings › Privacy & Security*).
  Allow incoming connections if macOS asks.
- **Linux**: if a firewall is on, allow TCP 7777 and UDP 6454 / 8000 from your network.

Once it's installed, **Settings › Apps** on Windows also lists *Sketchbook Bridge*,
and you can uninstall it from there.

## Use it

**Art-Net.** Point your desk or lighting software at this computer's IP address
(or broadcast). Send one universe: the bridge passes on whichever universe arrived
last, so several at once would overwrite each other. In Patch, add an **Input** node and pick an
`artnet.chN` source: the node says *Receiving Art-Net* once frames arrive. In the
viewer or on an effect node, map `artnet.chN` to any parameter like any other
[input](#/docs/inputs).

**Phone controller.** Open the app from the address the bridge prints
(`http://<this computer's address>:7777`, not the website), then scan the QR code
in the bridge window with your phone, or type the `/remote` address. Its *Sketch*
tab follows whatever sketch is open (in Patch, pick which effect node to drive), and
its *Pad* tab sends `remote.*` sources you can map.

**OSC.** Send to this computer on UDP 8000. `/remote/fader1` (or just `/fader1`)
arrives as `remote.fader1`; a message with several values arrives as
`remote.<name>.1`, `.2`, …

The phone and OSC controls only reach an app that was opened from the bridge's own
address, because the website runs on `https://`, which can't talk to an `http://`
program on your network. Art-Net works from either.

## Troubleshooting

- **"port 7777 is already in use"**: a bridge is already running (maybe the installed
  one). Use that one, or uninstall it first.
- **No Art-Net arriving**: check that the desk sends to this computer's address, and
  that no other program (another Art-Net tool) already holds UDP 6454.
- **Phone can't open the page**: the phone must be on the same Wi-Fi, and the firewall
  must allow the bridge on private networks.
- **Where's the log?** The installed bridge writes `bridge.log` in its folder: on
  Windows `%LOCALAPPDATA%\Sketchbook Bridge`, on macOS
  `~/Library/Application Support/Sketchbook Bridge`, on Linux
  `~/.local/share/sketchbook-bridge` (or `journalctl --user -u sketchbook-bridge`).

## From a checkout

Developers can skip the download: `npm run build && npm run bridge` runs the same
thing from the repo, and `npm run bridge:package` builds the zips into `release/`.
The code lives in `bridge/`.
