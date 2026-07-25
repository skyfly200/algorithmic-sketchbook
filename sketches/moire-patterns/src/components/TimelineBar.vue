<script setup>
import { ref, computed } from 'vue'
import { settings } from '../settings.js'
import {
  timeline,
  EASINGS,
  applyTimeline,
  removeTrack,
  trackLabel,
  evalTrack,
  isColorPath,
  jumpToKey,
} from '../timeline.js'

const collapsed = ref(false)

const ticks = computed(() => {
  const d = timeline.duration
  const step = [0.25, 0.5, 1, 2, 5, 10, 20, 30].find((s) => d / s <= 12) || 60
  const out = []
  for (let t = 0; t <= d + 1e-6; t += step) out.push(+t.toFixed(2))
  return out
})

function fmt(t) {
  return timeline.duration < 20 ? t.toFixed(1) : String(Math.round(t))
}

function pct(t) {
  return (t / timeline.duration) * 100 + '%'
}

function timeFromEvent(e, el) {
  const rect = el.getBoundingClientRect()
  const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return +(u * timeline.duration).toFixed(2)
}

// Scrubbing (ruler or empty lane space)
let scrubbing = false

function scrubStart(e) {
  scrubbing = true
  e.currentTarget.setPointerCapture(e.pointerId)
  scrubMove(e)
}

function scrubMove(e) {
  if (!scrubbing) return
  timeline.time = timeFromEvent(e, e.currentTarget)
  applyTimeline(timeline.time)
}

function scrubEnd() {
  scrubbing = false
}

// Keyframe dragging
let drag = null // { tr, k }

function keyDown(e, tr, k) {
  if (e.button !== 0) return
  drag = { tr, k }
  e.currentTarget.setPointerCapture(e.pointerId)
  timeline.time = k.t
  applyTimeline(k.t)
}

function keyMove(e, tr, k) {
  if (!drag || drag.k !== k) return
  const lane = e.currentTarget.closest('.lane')
  k.t = timeFromEvent(e, lane)
  tr.keys.sort((a, b) => a.t - b.t)
  timeline.time = k.t
  if (!settings.animate) applyTimeline(timeline.time)
}

function keyUp() {
  drag = null
}

function keyRemove(tr, k) {
  const i = tr.keys.indexOf(k)
  if (i >= 0) tr.keys.splice(i, 1)
  if (!tr.keys.length) removeTrack(tr.path)
}

function clampDuration() {
  timeline.duration = Math.min(120, Math.max(1, timeline.duration || 8))
  timeline.time = Math.min(timeline.time, timeline.duration)
}

// Curve visualization: sample the track across the timeline, normalized to
// the track's own value range.
function curvePoints(tr) {
  const vals = tr.keys.map((k) => k.v)
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (max - min < 1e-9) {
    min -= 1
    max += 1
  }
  const n = 64
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * timeline.duration
    const v = evalTrack(tr, t)
    const x = (i / (n - 1)) * 100
    const y = 25 - ((v - min) / (max - min)) * 22
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

function gradientStyle(tr) {
  const n = 24
  const stops = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * timeline.duration
    stops.push(`${evalTrack(tr, t)} ${((i / (n - 1)) * 100).toFixed(1)}%`)
  }
  return { background: `linear-gradient(90deg, ${stops.join(',')})` }
}
</script>

<template>
  <div class="tbar">
    <div class="toolbar">
      <button class="jump" title="Jump to previous keyframe (,)" :disabled="!timeline.tracks.length"
        @click="jumpToKey(-1)">|◀</button>
      <button class="play" :title="settings.animate ? 'Pause (space)' : 'Play (space)'"
        @click="settings.animate = !settings.animate">
        {{ settings.animate ? '❚❚' : '▶' }}
      </button>
      <button class="jump" title="Jump to next keyframe (.)" :disabled="!timeline.tracks.length"
        @click="jumpToKey(1)">▶|</button>
      <span class="clock">
        {{ timeline.time.toFixed(2) }}s
        <em>/</em>
        <input
          class="dur" type="number" min="1" max="120" step="0.5"
          v-model.number="timeline.duration" @change="clampDuration"
          title="Timeline length (seconds)"
        />s
      </span>
      <label class="loop" title="Blend from the last keyframe back into the first so the loop has no jump">
        <input type="checkbox" v-model="timeline.smoothLoop" />
        smooth loop
      </label>
      <span v-if="!timeline.tracks.length" class="tip">
        keyframe any control with its ◆ button — tracks appear here
      </span>
      <span v-else class="tip">
        drag ◆ to retime · right-click ◆ to delete · click a lane to scrub
      </span>
      <span class="spacer" />
      <button class="collapse" :title="collapsed ? 'Expand timeline' : 'Collapse timeline'"
        @click="collapsed = !collapsed">
        {{ collapsed ? '▴' : '▾' }}
      </button>
    </div>

    <template v-if="!collapsed">
      <div class="row ruler-row">
        <div class="label"></div>
        <div
          class="lane ruler"
          @pointerdown="scrubStart" @pointermove="scrubMove"
          @pointerup="scrubEnd" @pointercancel="scrubEnd"
        >
          <span v-for="t in ticks" :key="t" class="tick" :style="{ left: pct(t) }">
            {{ fmt(t) }}
          </span>
          <div class="playhead" :style="{ left: pct(timeline.time) }" />
        </div>
      </div>

      <div v-for="tr in timeline.tracks" :key="tr.path" class="row">
        <div class="label">
          <span class="tname" :title="trackLabel(tr.path)">{{ trackLabel(tr.path) }}</span>
          <select v-model="tr.easing" title="Easing curve between keyframes">
            <option v-for="e in EASINGS" :key="e" :value="e">{{ e }}</option>
          </select>
          <button class="del" title="Delete track" @click="removeTrack(tr.path)">✕</button>
        </div>
        <div
          class="lane"
          @pointerdown="scrubStart" @pointermove="scrubMove"
          @pointerup="scrubEnd" @pointercancel="scrubEnd"
        >
          <svg v-if="!isColorPath(tr.path)" class="curve" viewBox="0 0 100 28" preserveAspectRatio="none">
            <polyline :points="curvePoints(tr)" />
          </svg>
          <div v-else class="gradient" :style="gradientStyle(tr)" />
          <button
            v-for="(k, ki) in tr.keys"
            :key="ki"
            class="kf"
            :class="{ on: Math.abs(k.t - timeline.time) < 0.051 }"
            :style="{ left: pct(k.t) }"
            :title="`${k.t.toFixed(2)}s — drag to move, right-click to delete`"
            @pointerdown.stop="keyDown($event, tr, k)"
            @pointermove="keyMove($event, tr, k)"
            @pointerup="keyUp"
            @pointercancel="keyUp"
            @dblclick="keyRemove(tr, k)"
            @contextmenu.prevent="keyRemove(tr, k)"
          >◆</button>
          <div class="playhead" :style="{ left: pct(timeline.time) }" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tbar {
  flex: none;
  max-height: 40vh;
  overflow-y: auto;
  background: #101014;
  border-top: 1px solid #212129;
  user-select: none;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  position: sticky;
  top: 0;
  background: #101014;
  z-index: 2;
}
.jump {
  padding: 3px 8px;
  font-size: 10px;
  color: #b6b6c0;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 6px;
  cursor: pointer;
}
.jump:hover:not(:disabled) {
  background: #23232c;
  border-color: #3a3a48;
}
.jump:disabled {
  opacity: 0.4;
  cursor: default;
}
.play {
  width: 30px;
  height: 24px;
  font-size: 11px;
  color: #e9e6ff;
  background: #342e6e;
  border: 1px solid #4c42a3;
  border-radius: 6px;
  cursor: pointer;
}
.play:hover {
  background: #3e3784;
}
.clock {
  font-size: 12px;
  color: #d7d7de;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 5px;
}
.clock em {
  color: #6f6f7a;
  font-style: normal;
}
.dur {
  width: 52px;
  padding: 2px 5px;
  font-size: 12px;
  color: #e4e4e9;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.tip {
  font-size: 11px;
  color: #6f6f7a;
}
.loop {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #9a9aa5;
  cursor: pointer;
}
.loop input {
  accent-color: #7c6cf0;
}
.spacer {
  flex: 1;
}
.collapse {
  padding: 2px 10px;
  font-size: 11px;
  color: #9a9aa5;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 6px;
  cursor: pointer;
}
.row {
  display: flex;
  align-items: stretch;
  padding: 0 12px;
}
.label {
  width: 210px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 0;
}
.tname {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: #c9c9d1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.label select {
  padding: 1px 3px;
  font-size: 10.5px;
  color: #b6b6c0;
  background: #1a1a21;
  border: 1px solid #2c2c36;
  border-radius: 4px;
}
.del {
  padding: 0 5px;
  font-size: 10.5px;
  color: #9a9aa5;
  background: none;
  border: 1px solid #2c2c36;
  border-radius: 4px;
  cursor: pointer;
}
.del:hover {
  color: #ff8a8a;
  border-color: rgba(255, 92, 92, 0.5);
}
.lane {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 2px 0;
  background: #16161c;
  border: 1px solid #24242d;
  border-radius: 5px;
  overflow: hidden;
  cursor: ew-resize;
  touch-action: none;
}
.ruler-row .lane {
  height: 20px;
  background: #131318;
  cursor: ew-resize;
}
.tick {
  position: absolute;
  top: 2px;
  transform: translateX(2px);
  font-size: 9.5px;
  color: #5c5c68;
  border-left: 1px solid #2c2c36;
  padding-left: 3px;
  height: 100%;
  pointer-events: none;
}
.curve {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.curve polyline {
  fill: none;
  stroke: #7c6cf0;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  opacity: 0.85;
}
.gradient {
  position: absolute;
  inset: 3px;
  border-radius: 3px;
  opacity: 0.85;
  pointer-events: none;
}
.kf {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 2px 3px;
  font-size: 12px;
  line-height: 1;
  color: #cfc8ff;
  background: none;
  border: none;
  cursor: grab;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
  touch-action: none;
  z-index: 1;
}
.kf:active {
  cursor: grabbing;
}
.kf:hover {
  color: #ffffff;
}
.kf.on {
  color: #ffd166;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: #ffd166;
  opacity: 0.9;
  pointer-events: none;
}
</style>
