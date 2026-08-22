<script setup>
/**
 * AutopilotBar — the floating transport + options panel for Patch autopilot.
 * Presentational: it binds to the useAutopilot() instance passed as `ap` (its
 * reactive `state` + control methods) and shows the live fps / undo depth from
 * the host. "Open the full Autopilot view" is emitted for the host to route.
 */
defineProps({
  ap: { type: Object, required: true },       // useAutopilot() return
  fps: { type: Number, default: 0 },
  undoDepth: { type: Number, default: 0 },
})
defineEmits(['open-full'])
</script>

<template>
  <div v-if="ap.state.panelOpen" class="auto-panel" @pointerdown.stop @wheel.stop>
    <div class="show-head">
      <span class="show-title">Autopilot</span>
      <div class="show-modes">
        <button :class="{ on: ap.state.on }" @click="!ap.state.on && ap.toggle()">Auto</button>
        <button :class="{ on: !ap.state.on }" @click="ap.state.on && ap.toggle()">Manual</button>
      </div>
      <span class="show-spacer" />
      <span class="auto-fps" :class="{ low: fps > 0 && fps < ap.state.fpsFloor }">{{ fps }} fps</span>
      <v-btn icon="mdi-close" size="x-small" variant="text" @click="ap.state.panelOpen = false" />
    </div>

    <!-- transport: previous · play/pause · next-now · countdown ring · reroll -->
    <div class="show-transport">
      <v-btn icon="mdi-skip-previous" size="small" variant="text" :disabled="!undoDepth" title="Step back (undo the last change)" @click="ap.prev()" />
      <v-btn :icon="ap.state.on && !ap.state.paused ? 'mdi-pause' : 'mdi-play'" size="small" variant="text" :title="!ap.state.on ? 'Engage autopilot' : ap.state.paused ? 'Resume' : 'Pause (holds autopilot)'" @click="ap.state.on ? ap.playPause() : ap.toggle()" />
      <v-btn icon="mdi-skip-next" size="small" variant="text" :disabled="!ap.state.on" title="Next move now" @click="ap.nextNow()" />
      <span class="countdown-ring" :title="ap.state.on ? (ap.state.paused ? 'Paused' : 'Time until the next change') : 'Autopilot is off'">
        <svg viewBox="0 0 36 36">
          <circle class="ring-bg" cx="18" cy="18" r="15.5" />
          <circle class="ring-fg" cx="18" cy="18" r="15.5" :stroke-dasharray="97.4" :stroke-dashoffset="97.4 * (1 - ap.state.progress)" />
        </svg>
        <span class="ring-num">{{ ap.state.on ? (ap.state.paused ? '‖' : ap.state.left) : '–' }}</span>
      </span>
      <v-btn icon="mdi-dice-5-outline" size="small" variant="text" title="Full reroll — deal a fresh graph" @click="ap.reroll()" />
      <span class="show-spacer" />
      <v-btn icon="mdi-robot-outline" size="small" variant="text" title="Open the full Autopilot view" @click="$emit('open-full')" />
    </div>

    <!-- options -->
    <div class="auto-opts">
      <div class="auto-row">Change every {{ ap.state.everySec }}s</div>
      <v-slider v-model="ap.state.everySec" :min="3" :max="60" :step="1" hide-details density="compact" class="mb-1" @pointerdown.stop />
      <div class="auto-row">Perf budget: {{ ap.state.budget }} — bigger is richer &amp; heavier</div>
      <v-slider v-model="ap.state.budget" :min="4" :max="30" :step="1" hide-details density="compact" class="mb-1" @pointerdown.stop />
      <div class="auto-row">FPS floor: {{ ap.state.fpsFloor }} — cheapen the graph below this</div>
      <v-slider v-model="ap.state.fpsFloor" :min="10" :max="50" :step="1" hide-details density="compact" @pointerdown.stop />
      <p class="auto-hint">Autopilot swaps effects, restyles blends and regrows branches on the clock. Locked nodes are never touched — lock anything you want to keep, and keep adding nodes from the toolbar while it runs.</p>
    </div>
  </div>
</template>

<style scoped>
.auto-panel {
  position: absolute; right: 12px; top: 96px; z-index: 42; width: 280px;
  display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
  background: rgba(12, 14, 20, 0.97); border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px);
  font: 12px system-ui, sans-serif; color: #cdd3e0;
}
.show-head { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.show-title { font-weight: 600; color: #e8ecf5; }
.show-modes { display: flex; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
.show-modes button { font: 11px system-ui; color: #9aa4c0; background: transparent; border: 0; padding: 3px 12px; cursor: pointer; }
.show-modes button.on { background: rgba(124,140,255,0.25); color: #fff; }
.show-spacer { flex: 1; }
.show-transport { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.auto-fps { font: 11px ui-monospace, monospace; color: #9aa4c0; }
.auto-fps.low { color: #ff8a6a; }
.auto-opts { padding: 8px 12px 10px; }
.auto-row { font: 11px system-ui; color: #9aa4c0; margin-top: 4px; }
.auto-hint { font: 10px system-ui; color: #8a90a0; line-height: 1.4; margin: 8px 0 0; }
.countdown-ring { display: inline-grid; place-items: center; width: 34px; height: 34px; }
.countdown-ring svg { grid-area: 1 / 1; width: 34px; height: 34px; transform: rotate(-90deg); }
.countdown-ring .ring-bg { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 3; }
.countdown-ring .ring-fg { fill: none; stroke: #7c8cff; stroke-width: 3; stroke-linecap: round; transition: stroke-dashoffset 0.9s linear; }
.countdown-ring .ring-num { grid-area: 1 / 1; font: 600 10px/1 ui-monospace, monospace; color: #cdd3e0; }
</style>
