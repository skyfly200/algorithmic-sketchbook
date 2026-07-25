<script setup>
import { computed } from 'vue'
import {
  settings,
  shaderState,
  PRESETS,
  PATTERN_GROUPS,
  LAYER_OPS,
  AA_MODES,
  COLOR_MODES,
  applyPreset,
  randomize,
  randomizePattern,
  randomizeColors,
  randomizeOpts,
  history,
  undoRandomize,
  redoRandomize,
} from '../settings.js'
import KeyBtn from './KeyBtn.vue'
import { slideshow, SLIDESHOW_MODES } from '../slideshow.js'
import {
  modState,
  BEAT_ACTIONS,
  AUDIO_SOURCES,
  LEAP_SOURCES,
  ARTNET_SOURCES,
  MOD_TARGETS,
  addMapping,
  removeMapping,
  resetMappingRange,
  autoMap,
  startAudio,
  stopAudio,
  startMIDI,
  stopMIDI,
  startLeap,
  stopLeap,
  startArtnet,
  stopArtnet,
} from '../modulation.js'

defineEmits(['slideshow'])

function rotDeg(layer) {
  return Math.round((layer.rot * 180) / Math.PI)
}

function setRotDeg(layer, deg) {
  layer.rot = (Number(deg) * Math.PI) / 180
}

function toggleAudio(e) {
  e.target.checked ? startAudio() : stopAudio()
}
function toggleMIDI(e) {
  e.target.checked ? startMIDI() : stopMIDI()
}
function toggleLeap(e) {
  e.target.checked ? startLeap() : stopLeap()
}
function toggleArtnet(e) {
  e.target.checked ? startArtnet() : stopArtnet()
}

const knownCCs = computed(() =>
  Object.keys(modState.midi.values).map(Number).sort((a, b) => a - b),
)

function sourceLabel(source) {
  if (source.startsWith('midi.cc')) return 'MIDI · CC ' + source.slice(7)
  return source
}

const anyInputEnabled = computed(
  () =>
    modState.audio.enabled ||
    modState.midi.enabled ||
    modState.leap.enabled ||
    modState.artnet.enabled,
)

const anyCustom = computed(() =>
  settings.layers.slice(0, settings.layerCount).some((l) => l.pattern === 9),
)

const anyCustomShape = computed(() =>
  settings.layers.slice(0, settings.layerCount).some((l) => l.pattern === 15),
)

const isMorphMode = computed(
  () => slideshow.mode === 'morph' || slideshow.mode === 'shufflemorph',
)

const RANDOMIZE_OPTS = [
  ['patterns', 'patterns'],
  ['ops', 'combine'],
  ['freqs', 'freqs'],
  ['offsets', 'offsets'],
  ['layerCount', 'layers'],
  ['thickness', 'width'],
  ['colors', 'colors'],
]
</script>

<template>
  <aside class="panel">
    <header>
      <h1>Moiré Generator</h1>
      <p class="sub">Layered gratings rendered in a Three.js fragment shader</p>
    </header>

    <section>
      <h2>Presets</h2>
      <div class="preset-grid">
        <button v-for="p in PRESETS" :key="p.name" @click="applyPreset(p)">
          {{ p.name }}
        </button>
      </div>
      <div class="row rand-row">
        <button
          class="hist-btn" :disabled="!history.past.length"
          title="Go back to the pattern before the last randomize (Z)"
          @click="undoRandomize()"
        >↶</button>
        <button class="accent" @click="randomize()">Randomize</button>
        <button
          class="hist-btn" :disabled="!history.future.length"
          title="Redo (Shift+Z)"
          @click="redoRandomize()"
        >↷</button>
      </div>
      <div class="row rand-row">
        <button title="Randomize the pattern structure only" @click="randomizePattern()">🎲 Pattern</button>
        <button title="Random colors only" @click="randomizeColors()">🎨 Colors</button>
      </div>
      <div class="rand-opts" title="What Randomize (and the R key / on-beat randomize) affects">
        <label v-for="[key, label] in RANDOMIZE_OPTS" :key="key">
          <input type="checkbox" v-model="randomizeOpts[key]" />
          {{ label }}
        </label>
      </div>
      <div class="row slideshow-row">
        <button
          class="slideshow-btn"
          title="Start the display view, hiding the UI. Shortcut: S · exit with Esc"
          @click="$emit('slideshow')"
        >
          ▶ Display
        </button>
        <select
          v-model="slideshow.mode"
          title="Current: just present the current settings. Gallery: cycle saved patterns (or presets). Shuffle: jump to random settings. Morph: smoothly fade settings toward random targets. Shuffle + Morph: random pattern picks each cycle with smooth fades."
        >
          <option v-for="m in SLIDESHOW_MODES" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>
      <div v-if="slideshow.mode !== 'current'" class="row slideshow-row">
        <span class="every">every</span>
        <input type="number" min="2" max="60" step="1" v-model.number="slideshow.interval" />
        <span>seconds</span>
      </div>
      <div v-if="isMorphMode" class="row slideshow-row" title="How long each fade takes (up to the interval; shorter = snappier transitions with a hold)">
        <span class="every">fade over</span>
        <input type="number" min="0.5" max="60" step="0.5" v-model.number="slideshow.morphRate" />
        <span>seconds</span>
      </div>
    </section>

    <section>
      <h2>Pattern</h2>
      <label class="row">
        <span>Anti-alias</span>
        <select v-model.number="settings.aaMode">
          <option v-for="m in AA_MODES" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
        <KeyBtn path="aaMode" />
      </label>
      <label class="row" title="Render resolution. Lower values improve smoothness on slower GPUs, especially with supersampling.">
        <span>Resolution</span>
        <select v-model.number="settings.resScale">
          <option :value="0">Auto (sharp)</option>
          <option :value="1">100%</option>
          <option :value="0.75">75%</option>
          <option :value="0.5">50%</option>
          <option :value="2160">2160 px</option>
          <option :value="1440">1440 px</option>
          <option :value="1080">1080 px</option>
          <option :value="720">720 px</option>
          <option :value="540">540 px</option>
          <option :value="480">480 px</option>
          <option :value="360">360 px</option>
          <option :value="240">240 px</option>
        </select>
      </label>
      <label class="row">
        <span>FPS counter</span>
        <input type="checkbox" v-model="settings.showFps" />
      </label>
      <label class="row">
        <span>Layers</span>
        <input type="range" min="1" max="8" step="1" v-model.number="settings.layerCount" />
        <b>{{ settings.layerCount }}</b>
        <KeyBtn path="layerCount" />
      </label>
      <label class="row">
        <span>Zoom</span>
        <input type="range" min="0.25" max="4" step="0.01" v-model.number="settings.zoom" />
        <b>{{ settings.zoom.toFixed(2) }}</b>
        <KeyBtn path="zoom" />
      </label>
      <label class="row">
        <span>Line width</span>
        <input type="range" min="0.05" max="0.95" step="0.01" v-model.number="settings.thickness" />
        <b>{{ settings.thickness.toFixed(2) }}</b>
        <KeyBtn path="thickness" />
      </label>
      <label class="row">
        <span>Color mode</span>
        <select v-model.number="settings.colorMode">
          <option v-for="c in COLOR_MODES" :key="c.value" :value="c.value">
            {{ c.label }}
          </option>
        </select>
        <KeyBtn path="colorMode" />
      </label>
      <div class="row colors">
        <span>Colors</span>
        <input type="color" v-model="settings.colorA" title="Background" />
        <KeyBtn path="colorA" />
        <template v-if="settings.colorMode === 0 || settings.colorMode === 1">
          <input
            type="color" v-model="settings.colorB"
            :title="settings.colorMode === 1 ? 'Gradient middle' : 'Foreground'"
          />
          <KeyBtn path="colorB" />
        </template>
        <template v-if="settings.colorMode === 1">
          <input type="color" v-model="settings.colorC" title="Gradient end" />
          <KeyBtn path="colorC" />
        </template>
        <em v-if="settings.colorMode === 2" class="note">hue follows pattern</em>
        <em v-if="settings.colorMode === 3" class="note">set per layer below</em>
      </div>
      <div v-if="anyCustom" class="custom-box">
        <span class="box-label">Custom pattern</span>
        <textarea
          v-model="settings.customExpr"
          rows="3" spellcheck="false"
          placeholder="sin(d * freq + 3.0 * sin(a * 5.0))"
        />
        <p class="note">
          GLSL expression → float in [-1, 1]. Vars: <em>p</em> (vec2),
          <em>freq</em>, <em>d</em> = length(p), <em>a</em> = angle, <em>t</em> = time
        </p>
      </div>
      <div v-if="anyCustomShape" class="custom-box">
        <span class="box-label">Custom shape</span>
        <textarea
          v-model="settings.customShapeExpr"
          rows="3" spellcheck="false"
          placeholder="d - r * (0.7 + 0.3 * cos(a * 5.0))"
        />
        <p class="note">
          Signed distance → negative inside the shape. Vars: <em>p</em>,
          <em>r</em> = size from frequency, <em>freq</em>, <em>d</em>, <em>a</em>, <em>t</em>
        </p>
      </div>
      <p v-if="(anyCustom || anyCustomShape) && shaderState.error" class="err">
        {{ shaderState.error }}
      </p>
    </section>

    <section>
      <h2>Animation</h2>
      <label class="row">
        <span>Animate</span>
        <input type="checkbox" v-model="settings.animate" />
      </label>
      <label class="row" title="Built-in slow orbit and counter-rotation of layers">
        <span>Drift</span>
        <input type="checkbox" v-model="settings.drift" />
      </label>
      <label class="row">
        <span>Speed</span>
        <input type="range" min="0.1" max="4" step="0.1" v-model.number="settings.animSpeed" />
        <b>{{ settings.animSpeed.toFixed(1) }}×</b>
        <KeyBtn path="animSpeed" />
      </label>
    </section>

    <section>
      <h2>Live Input</h2>
      <label class="row">
        <span>Audio (mic)</span>
        <input type="checkbox" :checked="modState.audio.enabled" @change="toggleAudio" />
        <span v-if="modState.audio.enabled" class="meter">
          <span class="meter-fill" :style="{ width: modState.audio.level * 100 + '%' }" />
        </span>
      </label>
      <p v-if="modState.audio.error" class="err">{{ modState.audio.error }}</p>
      <div v-if="modState.audio.enabled" class="row">
        <span>Beat</span>
        <span class="beat-dot" :class="{ on: modState.audio.beat > 0.5 }" />
        <em class="note">
          {{ modState.audio.bpm ? '~' + modState.audio.bpm + ' BPM' : 'listening…' }}
        </em>
      </div>
      <label v-if="modState.audio.enabled" class="row" title="Higher = more beats detected">
        <span>Sensitivity</span>
        <input type="range" min="0.5" max="2" step="0.05" v-model.number="modState.beat.sens" />
        <b>{{ modState.beat.sens.toFixed(2) }}</b>
      </label>
      <label v-if="modState.audio.enabled" class="row">
        <span>On beat</span>
        <select v-model="modState.beat.action">
          <option v-for="a in BEAT_ACTIONS" :key="a.value" :value="a.value">
            {{ a.label }}
          </option>
        </select>
      </label>
      <label v-if="modState.audio.enabled && modState.beat.action !== 'none'" class="row">
        <span>Every</span>
        <input
          type="number" min="1" max="32" step="1" class="beat-every"
          v-model.number="modState.beat.every"
        />
        <em class="note">beat{{ modState.beat.every === 1 ? '' : 's' }}</em>
      </label>
      <label class="row">
        <span>MIDI</span>
        <input type="checkbox" :checked="modState.midi.enabled" @change="toggleMIDI" />
        <em v-if="modState.midi.enabled" class="note">
          {{ modState.midi.inputs }} device{{ modState.midi.inputs === 1 ? '' : 's' }}
        </em>
      </label>
      <p v-if="modState.midi.error" class="err">{{ modState.midi.error }}</p>
      <label class="row">
        <span>Leap Motion</span>
        <input type="checkbox" :checked="modState.leap.enabled" @change="toggleLeap" />
        <em v-if="modState.leap.connected" class="note">
          connected · {{ modState.leap.hands }} hand{{ modState.leap.hands === 1 ? '' : 's' }}
        </em>
      </label>
      <p v-if="modState.leap.error" class="err">{{ modState.leap.error }}</p>
      <label class="row" title="DMX input via the bundled bridge: node tools/artnet-bridge.mjs">
        <span>Art-Net</span>
        <input type="checkbox" :checked="modState.artnet.enabled" @change="toggleArtnet" />
        <em v-if="modState.artnet.connected" class="note">bridge connected</em>
      </label>
      <p v-if="modState.artnet.error" class="err">{{ modState.artnet.error }}</p>

      <div v-for="m in modState.mappings" :key="m.id" class="map-box">
        <div class="row">
          <select v-model="m.source" class="map-source">
            <optgroup label="Audio">
              <option v-for="s in AUDIO_SOURCES" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </optgroup>
            <optgroup label="MIDI">
              <option v-if="m.source.startsWith('midi.cc') && !knownCCs.includes(+m.source.slice(7))" :value="m.source">
                {{ sourceLabel(m.source) }}
              </option>
              <option v-for="cc in knownCCs" :key="cc" :value="'midi.cc' + cc">
                MIDI · CC {{ cc }}
              </option>
            </optgroup>
            <optgroup label="Leap Motion">
              <option v-for="s in LEAP_SOURCES" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </optgroup>
            <optgroup label="Art-Net">
              <option v-for="s in ARTNET_SOURCES" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </optgroup>
          </select>
          <span class="arrow">→</span>
          <select v-model="m.path" class="map-target" @change="resetMappingRange(m)">
            <option v-for="t in MOD_TARGETS" :key="t.path" :value="t.path">
              {{ t.label }}
            </option>
          </select>
          <button class="map-del" title="Remove mapping" @click="removeMapping(m.id)">✕</button>
        </div>
        <div class="row map-nums">
          <span>range</span>
          <input type="number" step="any" v-model.number="m.min" />
          <input type="number" step="any" v-model.number="m.max" />
          <span>smooth</span>
          <input type="range" min="0" max="0.995" step="0.005" v-model.number="m.smooth" />
          <button
            v-if="modState.midi.enabled"
            class="learn"
            :class="{ active: modState.learnId === m.id }"
            title="Click, then move a knob/fader on your MIDI controller"
            @click="modState.learnId = modState.learnId === m.id ? null : m.id"
          >
            {{ modState.learnId === m.id ? 'move a knob…' : 'learn' }}
          </button>
        </div>
      </div>
      <div class="row rand-row">
        <button class="wide" @click="addMapping()">+ Add mapping</button>
        <button
          class="wide" :disabled="!anyInputEnabled"
          title="Add sensible default mappings for every enabled input"
          @click="autoMap()"
        >
          ⚡ Auto-map
        </button>
      </div>
    </section>

    <section v-for="i in settings.layerCount" :key="i">
      <h2 class="layer-head">
        <button
          class="layer-tab"
          :class="{ active: settings.activeLayer === i - 1 }"
          @click="settings.activeLayer = i - 1"
        >
          Layer {{ i }}
        </button>
        <template v-if="settings.colorMode === 3">
          <input
            type="color" v-model="settings.layers[i - 1].color"
            class="layer-color" title="Layer color"
          />
          <KeyBtn :path="`layers.${i - 1}.color`" />
        </template>
        <span v-if="settings.activeLayer === i - 1" class="tag">drag target</span>
      </h2>
      <label class="row">
        <span>Type</span>
        <select v-model.number="settings.layers[i - 1].pattern">
          <optgroup v-for="g in PATTERN_GROUPS" :key="g.label" :label="g.label">
            <option v-for="t in g.items" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </optgroup>
        </select>
        <KeyBtn :path="`layers.${i - 1}.pattern`" />
      </label>
      <label v-if="i > 1" class="row" title="How this layer combines with the layers below it. Mask blends the layers below against the layers above using this layer's pattern.">
        <span>Combine</span>
        <select v-model.number="settings.layers[i - 1].op">
          <option v-for="o in LAYER_OPS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
        <KeyBtn :path="`layers.${i - 1}.op`" />
      </label>
      <label class="row">
        <span>Frequency</span>
        <input type="range" min="5" max="1000" step="1" v-model.number="settings.layers[i - 1].freq" />
        <b>{{ Math.round(settings.layers[i - 1].freq) }}</b>
        <KeyBtn :path="`layers.${i - 1}.freq`" />
      </label>
      <label class="row">
        <span>Rotation</span>
        <input
          type="range" min="-180" max="180" step="1"
          :value="rotDeg(settings.layers[i - 1])"
          @input="setRotDeg(settings.layers[i - 1], $event.target.value)"
        />
        <b>{{ rotDeg(settings.layers[i - 1]) }}°</b>
        <KeyBtn :path="`layers.${i - 1}.rot`" />
      </label>
      <label class="row">
        <span>Offset X</span>
        <input type="range" min="-1" max="1" step="0.005" v-model.number="settings.layers[i - 1].x" />
        <b>{{ settings.layers[i - 1].x.toFixed(2) }}</b>
        <KeyBtn :path="`layers.${i - 1}.x`" />
      </label>
      <label class="row">
        <span>Offset Y</span>
        <input type="range" min="-1" max="1" step="0.005" v-model.number="settings.layers[i - 1].y" />
        <b>{{ settings.layers[i - 1].y.toFixed(2) }}</b>
        <KeyBtn :path="`layers.${i - 1}.y`" />
      </label>
      <label class="row" title="Layer opacity: scales this layer's contribution to the composite">
        <span>Opacity</span>
        <input type="range" min="0" max="1" step="0.01" v-model.number="settings.layers[i - 1].alpha" />
        <b>{{ (settings.layers[i - 1].alpha ?? 1).toFixed(2) }}</b>
        <KeyBtn :path="`layers.${i - 1}.alpha`" />
      </label>
    </section>

    <footer>
      Moiré appears when a grating's frequency beats against another grating —
      or against the pixel grid itself. Set anti-alias to
      <em>Off</em> with a high frequency to see sampling moiré; switch to
      <em>Smooth</em> or <em>Supersample</em> to reduce it.
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  width: 300px;
  flex: none;
  overflow-y: auto;
  padding: 18px 16px 24px;
  background: #101014;
  border-right: 1px solid #212129;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
header h1 {
  font-size: 17px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: #85858f;
}
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h2 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #6f6f7a;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: #c9c9d1;
}
.row > span {
  width: 74px;
  flex: none;
  color: #9a9aa5;
}
.row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: #7c6cf0;
}
.row b {
  width: 42px;
  flex: none;
  text-align: right;
  font-size: 11.5px;
  font-weight: 500;
  color: #d7d7de;
  font-variant-numeric: tabular-nums;
}
select {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 12.5px;
  color: #e4e4e9;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 6px;
}
input[type='color'] {
  width: 34px;
  height: 26px;
  padding: 0;
  border: 1px solid #2c2c36;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
input[type='checkbox'] {
  accent-color: #7c6cf0;
  width: 15px;
  height: 15px;
}
.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
button {
  padding: 7px 8px;
  font-size: 12px;
  color: #d7d7de;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
button:hover:not(:disabled) {
  background: #23232c;
  border-color: #3a3a48;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button.accent {
  background: #342e6e;
  border-color: #4c42a3;
  color: #e9e6ff;
}
button.accent:hover {
  background: #3e3784;
}
button.wide {
  width: 100%;
  padding: 9px;
}
.rand-row {
  gap: 6px;
}
.rand-row button {
  flex: 1;
  min-width: 0;
  padding: 7px 4px;
}
.rand-row .hist-btn {
  flex: none;
  width: 36px;
  font-size: 15px;
  line-height: 1;
}
.rand-opts {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 3px 8px;
}
.rand-opts label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: #85858f;
  cursor: pointer;
}
.rand-opts input {
  width: 12px !important;
  height: 12px !important;
}
.slideshow-row {
  font-size: 11.5px;
  color: #9a9aa5;
}
.slideshow-row .slideshow-btn {
  flex: 1;
}
.slideshow-row select {
  flex: 1;
}
.slideshow-row .every {
  width: 74px;
  flex: none;
}
.slideshow-row input[type='number'] {
  width: 52px;
  padding: 3px 6px;
  font-size: 12px;
  color: #e4e4e9;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}
.keybtn {
  flex: none;
  padding: 0 2px;
  font-size: 12px;
  line-height: 1;
  color: #3f3f4c;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.12s;
}
.keybtn:hover {
  color: #a8a2d8;
  background: none;
  border: none;
}
.keybtn.has {
  color: #7c6cf0;
}
.keybtn.on {
  color: #ffd166;
}
.note {
  font-size: 11px;
  font-style: normal;
  color: #75757f;
}
.custom-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.box-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8f86d8;
}
.custom-box textarea {
  width: 100%;
  resize: vertical;
  padding: 7px 9px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  color: #d7f0d7;
  background: #14141a;
  border: 1px solid #2c2c36;
  border-radius: 7px;
}
.custom-box textarea:focus {
  outline: none;
  border-color: #4c42a3;
}
.custom-box .note em {
  color: #a8a2d8;
  font-style: normal;
}
.err {
  font-size: 11px;
  color: #ff8a8a;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.beat-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #2c2c36;
  transition: background 0.05s;
}
.beat-dot.on {
  background: #ffd166;
  box-shadow: 0 0 8px rgba(255, 209, 102, 0.8);
}
.beat-every {
  width: 52px;
  padding: 3px 6px;
  font-size: 12px;
  color: #e4e4e9;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}
.meter {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  overflow: hidden;
}
.meter-fill {
  display: block;
  height: 100%;
  background: #7c6cf0;
  transition: width 0.08s linear;
}
.map-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 8px;
  background: #16161c;
  border: 1px solid #24242d;
  border-radius: 7px;
}
.map-box .row {
  gap: 6px;
}
.map-source,
.map-target {
  flex: 1;
  min-width: 0;
  font-size: 11px !important;
  padding: 3px 4px;
}
.arrow {
  flex: none;
  color: #6f6f7a;
  font-size: 11px;
}
.map-del {
  flex: none;
  padding: 1px 6px;
  font-size: 11px;
  color: #9a9aa5;
  background: none;
  border: 1px solid #2c2c36;
  border-radius: 5px;
}
.map-del:hover {
  color: #ff8a8a;
  border-color: rgba(255, 92, 92, 0.5);
}
.map-nums {
  font-size: 10.5px;
  color: #75757f;
}
.map-nums > span {
  flex: none;
  width: auto;
}
.map-nums input[type='number'] {
  width: 56px;
  padding: 2px 5px;
  font-size: 11px;
  color: #e4e4e9;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.map-nums input[type='range'] {
  flex: 1;
  min-width: 30px;
  accent-color: #7c6cf0;
}
.learn {
  flex: none;
  padding: 2px 7px;
  font-size: 10px;
}
.learn.active {
  border-color: #ffd166;
  color: #ffd166;
}
.layer-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.layer-tab {
  padding: 4px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.layer-tab.active {
  border-color: #7c6cf0;
  color: #cfc8ff;
}
.layer-color {
  width: 26px !important;
  height: 20px !important;
}
.tag {
  font-size: 10px;
  color: #7c6cf0;
  text-transform: none;
  letter-spacing: 0.02em;
}
footer {
  font-size: 11px;
  line-height: 1.55;
  color: #75757f;
  border-top: 1px solid #212129;
  padding-top: 12px;
}
footer em {
  color: #a8a2d8;
  font-style: normal;
}
</style>
