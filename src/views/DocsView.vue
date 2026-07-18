<script setup>
/**
 * Docs — a single-page guide to the sketchbook: the gallery and viewer, the
 * input/mapping system, scenes, the Mixer and Patch compositors, and how to
 * add a new experiment. Static content; everything it describes lives in the
 * viewer's controls panel, the Mixer, and the Patch board.
 */
const inputRows = [
  ['audio.*', 'Mic (or Mixer/Patch feed) — pulse (beats), level/low/mid/high bands, volume, centroid (brightness), flux (transients)'],
  ['mouse.x / mouse.y', 'Pointer position across the window (y up)'],
  ['touch.x / touch.y / touch.down', 'First finger position + a held flag on touchscreens'],
  ['tilt.x / tilt.y · shake', 'Device accelerometer/gyro (falls back to the mouse on machines with no sensor)'],
  ['time.sin', 'A slow 10-second oscillation — free automation with no hardware'],
  ['midi.ccN · midi.note / velocity', 'Any MIDI controller (WebMIDI); every CC number resolves'],
  ['leap.x / y / z · pinch / grab', 'Leap Motion hand tracking'],
  ['artnet.chN', 'DMX channels over Art-Net via `npm run artnet-bridge`'],
]
const patchNodes = [
  ['Effect', 'A generator sketch rendering live in a hidden iframe; its canvas is the node output. Open ⚙ for its params and input mappings.'],
  ['Filter', 'A source-filter sketch (pointillism, camera lens, rain on a window, halftone, channel offset, delay, lens flare, VHS, motion extraction). Its video input is piped in as the filter\'s source each frame.'],
  ['Camera', 'Your webcam as a source.'],
  ['Mask', 'Multiplies a content stream by a matte.'],
  ['Blend', 'Composites two streams with any blend mode and a mix amount.'],
  ['Input', 'Emits a 0..1 control value from any input source (audio, MIDI, …) with scale/offset. Wire its amber ▣ into any param jack.'],
  ['XY Pad', 'A touch surface — drag on its thumbnail; x and y are separate control outputs.'],
  ['Tracker', 'Watches a video input and tracks the brightest region: x, y and size (apparent depth) control outputs.'],
  ['Output', 'Blits its input to the fullscreen stage behind the board.'],
]
</script>

<template>
  <v-container class="docs" max-width="880">
    <h1 class="text-h4 mb-2">How this sketchbook works</h1>
    <p class="lead">
      A gallery of interactive graphics experiments. Every experiment is a
      self-contained page the site embeds live — what you see in a card is the
      real sketch running. Click one to open the viewer.
    </p>

    <h2 class="text-h5 mt-8 mb-2">The viewer</h2>
    <p>
      The toolbar sets <strong>graphics quality</strong> (rendering resolution +
      workload), toggles an <strong>FPS meter</strong>, and re-rolls the
      <strong>🎲 seed</strong> — most sketches derive part of their look from a
      seeded random stream, so each seed is a reproducible variation and the
      URL captures it.
    </p>
    <p>
      The <strong>controls panel</strong> lists the sketch's parameters —
      sliders, switches and selects declared by the sketch itself. Anything
      numeric can also be driven by a live input (see below). A
      <strong>🎤 mic button</strong> appears on audio-reactive sketches;
      grant it and beats/loudness start driving their default mappings.
    </p>

    <h2 class="text-h5 mt-8 mb-2">Inputs &amp; mappings</h2>
    <p>
      A <em>mapping</em> routes an input source into a parameter:
      <code>source × amount</code> is added to the slider's base value every
      frame (with optional smoothing). Mappings are edited in the controls
      panel and saved with scenes. Sources:
    </p>
    <v-table density="compact" class="mb-4">
      <tbody>
        <tr v-for="[src, desc] in inputRows" :key="src">
          <td class="mono">{{ src }}</td>
          <td>{{ desc }}</td>
        </tr>
      </tbody>
    </v-table>

    <h2 class="text-h5 mt-8 mb-2">Scenes</h2>
    <p>
      A <strong>scene</strong> is a named snapshot of a sketch's parameter
      values, its input mappings, and the display settings — saved from the
      viewer, listed on the gallery page, applied with one click, and
      deep-linkable (<code>/#/sketch/&lt;slug&gt;?scene=…</code>). Scenes live
      in your browser's localStorage.
    </p>

    <h2 class="text-h5 mt-8 mb-2">Display mode</h2>
    <p>
      A chrome-free fullscreen projection view for installations and
      screens — pick a sketch (or let it rotate) and put it on a wall.
    </p>

    <h2 class="text-h5 mt-8 mb-2">Autopilot</h2>
    <p>
      A hands-free tour: one effect plays fullscreen at a time (fresh random
      seed each visit), crossfading to a random next one when the dwell timer
      runs out — and skipping ahead early if the frame rate stays below the
      floor for five seconds. The current effect's params and input mappings
      are editable live in a side drawer, and a shared mic drives its audio
      reactivity, just like the solo viewer.
    </p>

    <h2 class="text-h5 mt-8 mb-2">Mixer</h2>
    <p>
      Stacks several sketches as layers, each with a blend mode (screen, add,
      soft-light, hue, … the full compositing set), opacity, and zoom — like a
      VJ deck. One shared mic drives every layer's audio mappings in sync. A
      layer can be granted the mouse to play with its interactions live, and a
      Motion Extraction layer automatically ingests the composite of the
      layers below it.
    </p>

    <h2 class="text-h5 mt-8 mb-2">Patch</h2>
    <p>
      A TouchDesigner-style node graph. Drag from a node's right port to
      another's left port to pipe video; drag an amber ▣ control output onto
      the ▣ jack beside any parameter to modulate it. Wires stay visible when
      a node's settings are collapsed (they land on dots along the node's left
      edge). Undo/redo with Ctrl/Cmd+Z / Shift+Z. The compositor resolution —
      up to 1080p or native — sets how many pixels actually flow through the
      graph. Cycles are allowed: an upstream node holds its last frame, which
      is how you build video feedback. The board works on touch screens — drag
      nodes and wires with a finger, pinch to zoom — and the monitor button
      pops the composite out into its own window: drag it onto a projector or
      second display (double-click it for fullscreen) and keep adjusting the
      graph here without disturbing the show.
    </p>
    <v-table density="compact" class="mb-4">
      <tbody>
        <tr v-for="[name, desc] in patchNodes" :key="name">
          <td class="mono">{{ name }}</td>
          <td>{{ desc }}</td>
        </tr>
      </tbody>
    </v-table>

    <h2 class="text-h5 mt-8 mb-2">Adding an experiment</h2>
    <p>
      Each sketch is a folder under <code>sketches/&lt;slug&gt;/</code> with an
      <code>index.html</code>, a <code>sketch.js</code>, and a
      <code>sketch.json</code> (title, description, tags). The gallery
      discovers folders automatically — no registration.
    </p>
    <pre class="code">npm run new my-sketch -- --template canvas2d --title "My Sketch"</pre>
    <p>
      Inside a sketch, the shared runtime provides the quality settings, the
      seeded RNG, beat detection, and the params/mappings system:
    </p>
    <pre class="code">import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  speed: { value: 1, min: 0.2, max: 4, step: 0.1, label: 'Speed' },
})
rt.mapInput('audio.pulse', 'speed', 0.4) // default music reactivity

function frame(now) {
  rt.tick(now)              // FPS meter, beat detector, input modulation
  // … draw, reading params.speed (includes live modulation) …
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)</pre>
    <p class="mb-10">
      Declaring params is all it takes to get a controls panel, input
      mappings, and scene support in the viewer, the Mixer, and Patch. Source
      filters can build on <code>sketches/_lib/source.js</code> to accept a
      camera, dropped files, a demo scene, or the Mixer/Patch feed.
    </p>
  </v-container>
</template>

<style scoped>
.docs { padding-top: 32px; }
.lead { font-size: 1.06rem; opacity: 0.9; }
.docs p { margin-bottom: 10px; line-height: 1.65; opacity: 0.88; }
.mono { font-family: ui-monospace, monospace; white-space: nowrap; font-size: 0.85rem; }
.code {
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto;
  font: 0.85rem/1.5 ui-monospace, monospace; margin: 8px 0 14px;
}
code {
  background: rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 1px 5px;
  font-size: 0.85em;
}
</style>
