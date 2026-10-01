<script setup>
/**
 * DeckBar — the two-deck console for Patch. Each deck is a full patch graph; a
 * master crossfader blends them onto the stage. Edit one deck while the other
 * is on air, fork the patch across to experiment, cue a new effect on the
 * off-air deck, then CUT or AUTO-fade it in. Presentational: state and actions
 * come from PatchView (see composables/useDecks.js for the model).
 */
import { ref, computed, onMounted } from 'vue'
import { MASTER_BLENDS } from '../../composables/useDecks.js'

const props = defineProps({
  mix: { type: Object, required: true },          // { enabled, pos, blend, fadeSecs, fading }
  editIdx: { type: Number, default: 0 },
  weights: { type: Array, default: () => [1, 0] }, // how much of each deck reaches the master
  names: { type: Array, default: () => ['A', 'B'] },
  counts: { type: Array, default: () => [0, 0] },  // nodes per deck
  effects: { type: Array, default: () => [] },     // cue-able effects [{ slug, title }]
  backups: { type: Array, default: () => [false, false] },
  plan: { type: Object, required: true },          // planDecks() result
  tier: { type: String, default: 'baseline' },
  tierPref: { type: String, default: 'auto' },
  tiers: { type: Object, default: () => ({}) },
  lift: { type: String, default: '0px' },          // raise above the show panel
})
const emit = defineEmits(['toggle', 'select', 'pos', 'blend', 'secs', 'cut', 'auto', 'fork', 'cue', 'restore', 'tier', 'pvw'])

const pvw = ref(null)
onMounted(() => emit('pvw', pvw.value))
// Re-emit when the canvas (re)appears (it's inside a v-if).
const setPvw = (el) => { pvw.value = el; emit('pvw', el) }

const onAir = computed(() => (props.mix.pos >= 0.5 ? 1 : 0))
const other = computed(() => 1 - onAir.value)
const loadPct = computed(() => Math.round((props.plan.shownLoad ?? props.plan.load) * 100))
const loadCls = computed(() => (props.plan.load > 1 ? 'bad' : props.plan.load > 0.75 ? 'warn' : ''))

const q = ref('')
const hits = computed(() => {
  const t = q.value.trim().toLowerCase()
  const list = t ? props.effects.filter((e) => e.title.toLowerCase().includes(t) || e.slug.includes(t)) : props.effects
  return list.slice(0, 60)
})
</script>

<template>
  <div class="deckbar" :style="{ bottom: `calc(12px + ${lift})` }" @pointerdown.stop @wheel.stop>
    <!-- collapsed: just the switch -->
    <button v-if="!mix.enabled" class="db-toggle" title="Turn on the two-deck console: edit one patch while the other is on air" @click="emit('toggle', true)">
      <v-icon size="14">mdi-set-center</v-icon> Decks
    </button>

    <template v-else>
      <div class="db-row">
        <button class="db-toggle on" title="Turn the decks off (back to a single patch)" @click="emit('toggle', false)">
          <v-icon size="14">mdi-set-center</v-icon> Decks
        </button>

        <!-- deck selectors: which graph the editor shows; the bar under each is its on-air level -->
        <div v-for="i in [0, 1]" :key="i" class="deck" :class="{ edit: editIdx === i, air: weights[i] > 0.001 }" :title="`Edit deck ${names[i]}`" @click="emit('select', i)">
          <span class="deck-name">{{ names[i] }}</span>
          <span class="deck-tag">{{ weights[i] > 0.001 ? 'ON AIR' : counts[i] ? 'CUED' : 'EMPTY' }}</span>
          <span class="deck-meter"><i :style="{ width: Math.round(weights[i] * 100) + '%' }" /></span>
        </div>

        <!-- master crossfader -->
        <div class="fader">
          <span>{{ names[0] }}</span>
          <input type="range" min="0" max="1" step="0.001" :value="mix.pos" :title="`Crossfader — ${Math.round(mix.pos * 100)}% ${names[1]}`" @input="emit('pos', +$event.target.value)" />
          <span>{{ names[1] }}</span>
        </div>
        <select class="db-select" :value="mix.blend" title="How the decks combine" @change="emit('blend', $event.target.value)">
          <option v-for="b in MASTER_BLENDS" :key="b" :value="b">{{ b }}</option>
        </select>
        <button class="db-btn" :disabled="!counts[other]" :title="`Cut straight to deck ${names[other]}`" @click="emit('cut', other)">CUT</button>
        <button class="db-btn go" :disabled="!counts[other]" :title="`Fade to deck ${names[other]} over ${mix.fadeSecs}s`" @click="emit('auto', other)">
          AUTO → {{ names[other] }}
        </button>
        <label class="db-secs" title="Fade time (seconds)">
          <input type="number" min="0.1" max="120" step="0.5" :value="mix.fadeSecs" @change="emit('secs', Math.max(0.1, +$event.target.value))" />s
        </label>
      </div>

      <div class="db-row">
        <button class="db-btn" :disabled="!counts[editIdx]" :title="`Copy deck ${names[editIdx]} into deck ${names[1 - editIdx]} to experiment on the side`" @click="emit('fork')">
          <v-icon size="14">mdi-source-fork</v-icon> Fork {{ names[editIdx] }} → {{ names[1 - editIdx] }}
        </button>

        <!-- cue an effect onto the off-air deck -->
        <v-menu :close-on-content-click="true" location="top">
          <template #activator="{ props: mp }">
            <button v-bind="mp" class="db-btn" :title="`Load a new effect onto the off-air deck (${names[other]}) and preview it`">
              <v-icon size="14">mdi-headphones</v-icon> Cue effect…
            </button>
          </template>
          <div class="cue-menu" @pointerdown.stop>
            <input v-model="q" class="cue-search" placeholder="Search effects…" />
            <div class="cue-list">
              <button v-for="e in hits" :key="e.slug" class="cue-item" @click="emit('cue', e.slug)">{{ e.title }}</button>
              <div v-if="!hits.length" class="cue-none">No match</div>
            </div>
          </div>
        </v-menu>

        <button v-for="i in [0, 1]" v-show="backups[i]" :key="'r' + i" class="db-btn" :title="`Restore what deck ${names[i]} held before the last fork/cue`" @click="emit('restore', i)">
          <v-icon size="14">mdi-undo-variant</v-icon> Restore {{ names[i] }}
        </button>

        <span class="db-spacer" />

        <!-- capacity: from the cost model (budget.js), not a timing run -->
        <v-menu location="top end" :close-on-content-click="false">
          <template #activator="{ props: mp }">
            <button v-bind="mp" class="db-load" :class="loadCls" title="Estimated load of the on-air deck vs this machine's budget">
              {{ tiers[tier]?.label }} · {{ loadPct }}%
            </button>
          </template>
          <div class="cue-menu plan" @pointerdown.stop>
            <div class="plan-h">Capacity (modelled)</div>
            <div class="plan-row">Off-air deck: <b>{{ plan.offAirMode }}</b> · live fade: <b>{{ plan.liveFade ? 'yes' : 'no' }}</b> · standby frames: <b>{{ plan.standby }}</b></div>
            <ul v-if="plan.warnings.length" class="plan-warn"><li v-for="w in plan.warnings" :key="w">{{ w }}</li></ul>
            <div v-else class="plan-ok">Fits this machine's budget.</div>
            <label class="plan-row">Device class
              <select class="db-select" :value="tierPref" @change="emit('tier', $event.target.value)">
                <option value="auto">Auto ({{ tiers[tier]?.label }})</option>
                <option v-for="(t, k) in tiers" :key="k" :value="k">{{ t.label }}</option>
              </select>
            </label>
            <div class="plan-note">Limits come from a cost model over pixels, effect weights and memory — not a benchmark of this machine. See Docs → Performance.</div>
          </div>
        </v-menu>

        <div class="pvw" :title="`Preview — deck ${names[editIdx]} (the one you're editing)`">
          <canvas :ref="setPvw" width="128" height="72" />
          <span>PVW · {{ names[editIdx] }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.deckbar {
  position: absolute; right: 12px; z-index: 42; display: flex; flex-direction: column; gap: 6px;
  padding: 6px 8px; border-radius: 10px; max-width: calc(100vw - 24px);
  background: rgba(12, 14, 20, 0.92); border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px); font: 12px system-ui, sans-serif; color: #cdd3e0;
}
.db-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-spacer { flex: 1; }
.db-toggle, .db-btn { display: inline-flex; align-items: center; gap: 4px; font: 11px system-ui; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 4px 9px; cursor: pointer; white-space: nowrap; }
.db-toggle:hover, .db-btn:hover:not(:disabled) { border-color: #7c8cff; }
.db-toggle.on { background: rgba(124, 140, 255, 0.22); color: #fff; border-color: #7c8cff; }
.db-btn:disabled { opacity: 0.4; cursor: default; }
.db-btn.go { background: #a0e060; color: #0a0b0f; border-color: #a0e060; font-weight: 700; letter-spacing: 0.04em; }
.deck { position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 70px; padding: 4px 8px 6px; border-radius: 8px; background: #151823; border: 1px solid #2a2f40; cursor: pointer; }
.deck.edit { border-color: #7c8cff; box-shadow: 0 0 0 1px rgba(124, 140, 255, 0.45) inset; }
.deck-name { font: 700 14px system-ui; color: #e8ecf5; line-height: 1; }
.deck-tag { font: 9px system-ui; letter-spacing: 0.1em; color: #6d7590; }
.deck.air .deck-tag { color: #ff7a7a; }
.deck-meter { height: 3px; border-radius: 2px; background: #262b3d; overflow: hidden; }
.deck-meter i { display: block; height: 100%; background: #ff7a7a; }
.fader { display: flex; align-items: center; gap: 6px; font: 700 11px system-ui; color: #9aa4c0; }
.fader input[type="range"] { width: 150px; accent-color: #7c8cff; }
.db-select { font: 11px system-ui; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 3px 6px; }
.db-secs { display: inline-flex; align-items: center; gap: 2px; font: 11px system-ui; color: #9aa4c0; }
.db-secs input { width: 46px; font: 11px system-ui; color: #cdd3e0; background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; padding: 3px 4px; }
.db-load { font: 11px ui-monospace, monospace; color: #9aa4c0; background: #151823; border: 1px solid #2a2f40; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
.db-load.warn { color: #ffd479; border-color: #6b5a2a; }
.db-load.bad { color: #ff8a8a; border-color: #7a3030; }
.pvw { position: relative; width: 128px; height: 72px; border-radius: 6px; overflow: hidden; border: 1px solid #2a2f40; background: #000; }
.pvw canvas { width: 100%; height: 100%; display: block; }
.pvw span { position: absolute; left: 4px; top: 2px; font: 700 9px system-ui; letter-spacing: 0.08em; color: #fff; text-shadow: 0 0 3px #000; }
.cue-menu { width: 260px; padding: 8px; border-radius: 10px; background: rgba(16, 18, 26, 0.98); border: 1px solid #2a2f40; color: #cdd3e0; font: 12px system-ui, sans-serif; }
.cue-menu.plan { width: 330px; display: flex; flex-direction: column; gap: 8px; }
.cue-search { width: 100%; font: 12px system-ui; color: #e8ecf5; background: #0d0f16; border: 1px solid #3a4056; border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; }
.cue-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; }
.cue-item { text-align: left; font: 12px system-ui; color: #cdd3e0; background: transparent; border: 0; border-radius: 5px; padding: 5px 8px; cursor: pointer; }
.cue-item:hover { background: rgba(124, 140, 255, 0.2); color: #fff; }
.cue-none { padding: 8px; color: #6d7590; }
.plan-h { font-weight: 700; color: #e8ecf5; }
.plan-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #9aa4c0; }
.plan-row b { color: #e8ecf5; font-weight: 600; }
.plan-warn { margin: 0; padding-left: 16px; color: #ffd479; }
.plan-ok { color: #a0e060; }
.plan-note { font-size: 11px; color: #6d7590; }
</style>
