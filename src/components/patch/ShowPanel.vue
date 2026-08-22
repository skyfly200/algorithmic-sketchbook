<script setup>
/**
 * ShowPanel — the bottom-sheet show sequencer for Patch: a cue list you step
 * through manually (Cues) or run on a scrubbable timeline with param ramps
 * (Timeline). Presentational: it binds to the useShow() instance passed as
 * `show` (its reactive `state` + control methods).
 */
defineProps({
  show: { type: Object, required: true }, // useShow() return
})
</script>

<template>
  <div v-if="show.state.open" class="show-panel" @pointerdown.stop @wheel.stop>
    <div class="show-head">
      <span class="show-title">Show</span>
      <div class="show-modes">
        <button :class="{ on: show.state.mode === 'cues' }" @click="show.state.mode = 'cues'">Cues</button>
        <button :class="{ on: show.state.mode === 'timeline' }" @click="show.state.mode = 'timeline'">Timeline</button>
      </div>
      <button class="show-capture" title="Capture the current patch as a new cue" @click="show.captureCue()">＋ Capture cue</button>
      <span class="show-spacer" />
      <!-- Named show files: save the current cue set to a persisted library -->
      <v-menu :close-on-content-click="false" location="bottom end">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="x-small" variant="tonal" prepend-icon="mdi-content-save-outline" class="mr-1">Shows</v-btn>
        </template>
        <v-card class="pa-2" min-width="260">
          <div class="d-flex ga-1 mb-2">
            <v-text-field v-model="show.state.newShowName" density="compact" hide-details placeholder="Name this show" @keyup.enter="show.saveShowAs()" />
            <v-btn size="small" variant="tonal" :disabled="!show.state.cues.length" prepend-icon="mdi-content-save" @click="show.saveShowAs()">Save</v-btn>
          </div>
          <v-list density="compact" max-height="300">
            <v-list-item v-for="s in show.state.savedShows" :key="s.id" :title="s.name" :subtitle="`${s.cues.length} cue${s.cues.length === 1 ? '' : 's'} · ${s.mode}`" @click="show.loadShowFile(s)">
              <template #append>
                <v-icon icon="mdi-download" size="16" class="mr-2" title="Export this show as a file" @click.stop="show.exportShow(s)" />
                <v-icon icon="mdi-delete" size="16" title="Delete" @click.stop="show.deleteShowFile(s)" />
              </template>
            </v-list-item>
            <v-list-item v-if="!show.state.savedShows.length" title="No saved shows yet" disabled />
          </v-list>
        </v-card>
      </v-menu>
      <v-btn icon="mdi-download" size="x-small" variant="text" :disabled="!show.state.cues.length" title="Export current show as a .json file" @click="show.exportShow()" />
      <v-btn icon="mdi-upload" size="x-small" variant="text" title="Import a show .json file" @click="show.importShow()" />
      <v-btn icon="mdi-close" size="x-small" variant="text" @click="show.state.open = false" />
    </div>

    <!-- transport: manual GO stack, or timeline play/scrub -->
    <div v-if="show.state.mode === 'cues'" class="show-transport">
      <v-btn icon="mdi-skip-previous" size="small" variant="text" :disabled="show.state.activeCue <= 0" title="Previous cue" @click="show.prevCue()" />
      <button class="go-btn" :disabled="!show.state.cues.length" title="Go to the next cue" @click="show.state.activeCue < 0 ? show.goCue(0) : show.nextCue()">GO</button>
      <v-btn icon="mdi-skip-next" size="small" variant="text" :disabled="show.state.activeCue >= show.state.cues.length - 1" title="Next cue" @click="show.nextCue()" />
      <span class="show-hint">Click a cue to jump to it. GO steps through in order.</span>
    </div>
    <div v-else class="show-transport show-transport--tl">
      <div class="tl-controls">
        <v-btn :icon="show.state.playing ? 'mdi-pause' : 'mdi-play'" size="small" variant="text" @click="show.state.playing ? show.pauseShow() : show.playShow()" />
        <v-btn icon="mdi-stop" size="small" variant="text" title="Stop and rewind" @click="show.stopShow()" />
        <v-btn :icon="show.state.loop ? 'mdi-repeat' : 'mdi-repeat-off'" size="small" variant="text" :color="show.state.loop ? 'primary' : undefined" title="Loop the show" @click="show.state.loop = !show.state.loop" />
        <span class="show-clock">{{ show.state.playhead.toFixed(1) }}s / {{ show.showLength().toFixed(1) }}s</span>
        <span class="tl-hint">double-click the timeline to drop a keyframe cue · drag a marker to retime it</span>
      </div>
      <!-- ruler + keyframe lane: cues are keyframes; params ramp between them -->
      <div class="tl-timeline">
        <div class="tl-ruler">
          <div v-for="tk in show.state.ticks" :key="tk.t" class="tl-tick" :style="{ left: tk.pct + '%' }"><span>{{ show.fmtTime(tk.t) }}</span></div>
        </div>
        <div class="tl-track tl-track--tall" @pointerdown="show.tlSeek($event)" @dblclick="show.tlAddCueAt($event)">
          <div v-for="tk in show.state.ticks" :key="'g' + tk.t" class="tl-grid" :style="{ left: tk.pct + '%' }" />
          <div class="tl-fill" :style="{ width: show.pct(show.state.playhead) + '%' }" />
          <div class="tl-playhead" :style="{ left: show.pct(show.state.playhead) + '%' }" />
          <div
            v-for="(c, i) in show.state.cues" :key="c.id"
            class="tl-cue tl-cue--tall" :class="{ on: show.state.activeCue === i }"
            :style="{ left: show.pct(c.time) + '%' }"
            :title="c.name + ' @ ' + c.time + 's — drag to retime'"
            @pointerdown.stop="show.tlCueDown(i, $event)"
            @dblclick.stop="show.goCue(i)"
          ><span class="tl-cue-lbl">{{ i + 1 }}</span></div>
        </div>
      </div>
    </div>

    <!-- cue list -->
    <div class="cue-list">
      <div v-if="!show.state.cues.length" class="show-empty">No cues yet. Set up the patch, then “＋ Capture cue”. Capture a few and step or time them into a show.</div>
      <div v-for="(c, i) in show.state.cues" :key="c.id" class="cue" :class="{ on: show.state.activeCue === i }" @click="show.goCue(i)">
        <span class="cue-idx">{{ i + 1 }}</span>
        <input class="cue-name" :value="c.name" @click.stop @change="c.name = $event.target.value; show.persistShow()" />
        <label v-if="show.state.mode === 'timeline'" class="cue-num" title="Start time (s)" @click.stop>
          @<input type="number" min="0" step="0.5" :value="c.time" @change="c.time = Math.max(0, +$event.target.value); show.persistShow()" />s
        </label>
        <label class="cue-num" title="Crossfade (s)" @click.stop>
          ↝<input type="number" min="0" step="0.1" :value="c.fade" @change="c.fade = Math.max(0, +$event.target.value); show.persistShow()" />s
        </label>
        <button class="cue-mini" title="Update this cue to the current patch" @click.stop="show.updateCue(i)">⟳</button>
        <button class="cue-mini" title="Move up" @click.stop="show.moveCue(i, -1)">↑</button>
        <button class="cue-mini" title="Move down" @click.stop="show.moveCue(i, 1)">↓</button>
        <button class="cue-mini" title="Delete cue" @click.stop="show.deleteCue(i)">✕</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.show-panel {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 41;
  max-height: 42vh; display: flex; flex-direction: column;
  background: rgba(12, 14, 20, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px); font: 12px system-ui, sans-serif; color: #cdd3e0;
}
.show-head { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.show-title { font-weight: 600; color: #e8ecf5; }
.show-modes { display: flex; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
.show-modes button { font: 11px system-ui; color: #9aa4c0; background: transparent; border: 0; padding: 3px 12px; cursor: pointer; }
.show-modes button.on { background: rgba(124,140,255,0.25); color: #fff; }
.show-capture { font: 11px system-ui; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.show-capture:hover { border-color: #7c8cff; }
.show-spacer { flex: 1; }
.show-transport { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.go-btn { font: 700 12px system-ui; color: #0a0b0f; background: #a0e060; border: 0; border-radius: 6px; padding: 5px 18px; cursor: pointer; letter-spacing: 0.08em; }
.go-btn:disabled { opacity: 0.4; cursor: default; }
.show-hint { font: 11px system-ui; color: #8a90a0; margin-left: 6px; }
.show-clock { font: 11px ui-monospace, monospace; color: #9aa4c0; min-width: 96px; }
.tl-track { position: relative; flex: 1; height: 22px; margin-left: 6px; border-radius: 6px; background: #1a1d28; border: 1px solid #2a2f40; cursor: pointer; overflow: hidden; }
.tl-fill { position: absolute; top: 0; bottom: 0; left: 0; background: rgba(124,140,255,0.22); }
.tl-cue { position: absolute; top: -1px; bottom: -1px; width: 3px; margin-left: -1.5px; background: #a0e060; cursor: ew-resize; }
.tl-cue.on { background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.7); }
/* Expanded timeline view: a labelled ruler over a taller keyframe lane. */
.show-transport--tl { flex-direction: column; align-items: stretch; gap: 6px; }
.tl-controls { display: flex; align-items: center; gap: 6px; }
.tl-hint { font: 10px system-ui; color: #737b93; margin-left: auto; }
.tl-timeline { position: relative; padding-top: 14px; }
.tl-ruler { position: absolute; top: 0; left: 6px; right: 0; height: 12px; }
.tl-tick { position: absolute; top: 0; transform: translateX(-50%); font: 9px ui-monospace, monospace; color: #808aa6; white-space: nowrap; }
.tl-tick::after { content: ''; position: absolute; left: 50%; top: 11px; width: 1px; height: 4px; background: #3a4055; }
.tl-track--tall { height: 40px; }
.tl-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.05); }
.tl-playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: #ffd166; box-shadow: 0 0 4px rgba(255,209,102,0.8); }
.tl-cue--tall { width: 4px; margin-left: -2px; border-radius: 2px; }
.tl-cue-lbl { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font: 9px ui-monospace, monospace; color: #0a0b0f; background: #a0e060; border-radius: 3px; padding: 0 3px; pointer-events: none; }
.tl-cue--tall.on .tl-cue-lbl { background: #fff; }
.cue-list { overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.show-empty { color: #8a90a0; font: 11px system-ui; padding: 10px 4px; line-height: 1.5; }
.cue { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; background: #14171f; border: 1px solid transparent; cursor: pointer; }
.cue:hover { border-color: #3a4056; }
.cue.on { border-color: #a0e060; background: rgba(160,224,96,0.08); }
.cue-idx { font: 11px ui-monospace, monospace; color: #7a8090; min-width: 16px; text-align: right; }
.cue-name { flex: 1; min-width: 60px; background: transparent; border: 0; color: #e8ecf5; font: 12px system-ui; padding: 2px 4px; border-radius: 4px; }
.cue-name:focus { background: #12141c; outline: 1px solid #3a4056; }
.cue-num { display: inline-flex; align-items: center; gap: 1px; font: 10px system-ui; color: #9aa4c0; }
.cue-num input { width: 42px; background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; font: 10px ui-monospace, monospace; padding: 1px 3px; }
.cue-mini { width: 20px; height: 20px; border-radius: 4px; background: #12141c; color: #cdd3e0; border: 1px solid #333; cursor: pointer; font-size: 11px; line-height: 1; }
.cue-mini:hover { border-color: #7c8cff; }
</style>
