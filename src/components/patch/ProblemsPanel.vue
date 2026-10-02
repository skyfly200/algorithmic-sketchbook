<script setup>
/**
 * ProblemsPanel — the list of what is wrong with the patch, each with a plain-language message, how to
 * fix it, and a one-click fix where there is a safe one. Purely presentational: the host owns the
 * diagnostics (lib/patch/diagnostics.js) and performs the actions. Controlled via v-model.
 */
import { computed, ref } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  issues: { type: Array, default: () => [] }, // sorted: errors, warnings, then info
  editIdx: { type: Number, default: 0 }, // the deck being edited: fixes only apply there
  deckNames: { type: Array, default: () => [] }, // shown when decks are on
  showDecks: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'fix', 'focus', 'dismiss'])

const showNotes = ref(false)
const problems = computed(() => props.issues.filter((i) => i.severity !== 'info'))
const notes = computed(() => props.issues.filter((i) => i.severity === 'info'))
const counts = computed(() => ({
  error: props.issues.filter((i) => i.severity === 'error').length,
  warning: props.issues.filter((i) => i.severity === 'warning').length,
}))
const ICON = { error: 'mdi-alert-circle', warning: 'mdi-alert', info: 'mdi-information-outline' }
const canFix = (i) => !!i.action && !(i.deck != null && props.showDecks && i.deck !== props.editIdx && i.action.type !== 'toggleMic' && i.action.type !== 'toggleCamera' && i.action.type !== 'import')
const deckLabel = (i) => (props.showDecks && i.deck != null ? `Deck ${props.deckNames[i.deck] ?? i.deck + 1}` : '')
</script>

<template>
  <aside v-if="modelValue" class="prob" role="dialog" aria-label="Problems" @pointerdown.stop>
    <div class="prob-head">
      <v-icon icon="mdi-alert-circle-outline" size="18" class="mr-2" />
      <span class="prob-title">Problems</span>
      <span v-if="counts.error" class="prob-count prob-count--error">{{ counts.error }} error{{ counts.error === 1 ? '' : 's' }}</span>
      <span v-if="counts.warning" class="prob-count prob-count--warning">{{ counts.warning }} warning{{ counts.warning === 1 ? '' : 's' }}</span>
      <span class="prob-spacer" />
      <v-btn icon="mdi-close" size="x-small" variant="text" title="Close" @click="emit('update:modelValue', false)" />
    </div>

    <div class="prob-body">
      <div v-if="!problems.length" class="prob-ok">
        <v-icon icon="mdi-check-circle-outline" size="22" />
        <div><b>No problems found.</b><small>Everything wired into the Output looks right.</small></div>
      </div>

      <article v-for="i in problems" :key="i.key + i.deck" class="prob-item" :class="'prob-item--' + i.severity" :data-code="i.code">
        <div class="prob-line">
          <v-icon :icon="ICON[i.severity]" size="16" class="prob-ico" />
          <b class="prob-name">{{ i.title }}</b>
          <span v-if="deckLabel(i)" class="prob-deck">{{ deckLabel(i) }}</span>
        </div>
        <p class="prob-msg">{{ i.message }}</p>
        <p class="prob-fix"><b>How to fix:</b> {{ i.fix }}</p>
        <div class="prob-actions">
          <v-btn v-if="canFix(i)" size="x-small" color="primary" variant="flat" @click="emit('fix', i)">{{ i.action.label }}</v-btn>
          <span v-else-if="i.action" class="prob-hint">Switch to deck {{ deckNames[i.deck] ?? i.deck + 1 }} to fix this.</span>
          <v-btn v-if="i.nodeId != null && i.action?.type !== 'focus'" size="x-small" variant="text" @click="emit('focus', i)">Show node</v-btn>
          <v-btn size="x-small" variant="text" @click="emit('dismiss', i)">Dismiss</v-btn>
        </div>
      </article>

      <button v-if="notes.length" class="prob-notes-toggle" @click="showNotes = !showNotes">
        <v-icon :icon="showNotes ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="16" />
        {{ notes.length }} note{{ notes.length === 1 ? '' : 's' }} (not problems)
      </button>
      <template v-if="showNotes">
        <article v-for="i in notes" :key="i.key + i.deck" class="prob-item prob-item--info" :data-code="i.code">
          <div class="prob-line">
            <v-icon :icon="ICON.info" size="16" class="prob-ico" />
            <b class="prob-name">{{ i.title }}</b>
            <span v-if="deckLabel(i)" class="prob-deck">{{ deckLabel(i) }}</span>
          </div>
          <p class="prob-msg">{{ i.message }}</p>
          <p class="prob-fix"><b>How to fix:</b> {{ i.fix }}</p>
          <div class="prob-actions">
            <v-btn v-if="i.nodeId != null" size="x-small" variant="text" @click="emit('focus', i)">Show node</v-btn>
            <v-btn size="x-small" variant="text" @click="emit('dismiss', i)">Dismiss</v-btn>
          </div>
        </article>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.prob { position: fixed; top: 58px; right: 12px; z-index: 3500; width: min(400px, calc(100vw - 24px)); max-height: calc(100vh - 80px); display: flex; flex-direction: column; background: #14161e; border: 1px solid #2a2f40; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.55); color: #cdd3e6; overflow: hidden; }
.prob-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.prob-title { font-weight: 600; font-size: 0.9rem; }
.prob-spacer { flex: 1; }
.prob-count { font-size: 0.66rem; padding: 1px 7px; border-radius: 999px; }
.prob-count--error { background: rgba(255,92,92,0.18); color: #ff8a8a; }
.prob-count--warning { background: rgba(255,210,63,0.16); color: #ffd23f; }
.prob-body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.prob-ok { display: flex; gap: 10px; align-items: center; padding: 10px; color: #9be37a; }
.prob-ok small { display: block; color: #8a90a0; font-size: 0.7rem; }
.prob-item { padding: 9px 10px; border-radius: 9px; background: #1a1d28; border: 1px solid #2a2f40; border-left-width: 3px; }
.prob-item--error { border-left-color: #ff5c5c; }
.prob-item--warning { border-left-color: #ffd23f; }
.prob-item--info { border-left-color: #5b8ff0; }
.prob-line { display: flex; align-items: center; gap: 6px; }
.prob-item--error .prob-ico { color: #ff5c5c; }
.prob-item--warning .prob-ico { color: #ffd23f; }
.prob-item--info .prob-ico { color: #5b8ff0; }
.prob-name { font-size: 0.8rem; }
.prob-deck { margin-left: auto; font-size: 0.62rem; color: #8a90a0; border: 1px solid #2a2f40; border-radius: 999px; padding: 0 6px; }
.prob-msg { margin: 5px 0 4px; font-size: 0.74rem; line-height: 1.4; color: #b9bfd2; }
.prob-fix { margin: 0 0 6px; font-size: 0.72rem; line-height: 1.4; color: #98a0b8; }
.prob-fix b { color: #cdd3e6; }
.prob-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.prob-hint { font-size: 0.66rem; color: #8a90a0; }
.prob-notes-toggle { display: flex; align-items: center; gap: 4px; background: none; border: 0; color: #8a90a0; font-size: 0.72rem; cursor: pointer; padding: 2px 0; text-align: left; }
.prob-notes-toggle:hover { color: #cdd3e6; }
</style>
