<script setup>
/**
 * NlDesigner — the natural-language patch designer, as a self-contained add-in.
 * It owns the popover panel and its presentational state (the prompt, the
 * editable parse preview, the AI plan, voice input, smart toggle) and leans on
 * the pure library (parseDesignerIntent + callDesignerAI) for the actual
 * language work. It never touches the graph itself: when the user commits it
 * emits `build-intent` (offline parse) or `build-spec` (AI plan) and the host
 * builds the nodes, then calls close() on success.
 */
import { ref, computed } from 'vue'
import { parseDesignerIntent, callDesignerAI } from '../../lib/nlDesigner.js'
import { INPUT_SOURCES } from '../../../sketches/_lib/runtime.js'

const props = defineProps({
  effects: { type: Array, default: () => [] },   // effect catalogue for parsing/AI
  filters: { type: Array, default: () => [] },   // filter catalogue
  types: { type: Object, default: () => ({}) },  // node TYPES table (AI chip labels)
  examples: { type: Array, default: () => [] },  // prompt-chip examples
  aiKey: { type: String, default: '' },
  aiModel: { type: String, default: 'claude-sonnet-5' },
  smart: { type: Boolean, default: false },
  last: { type: String, default: '' },           // "Last: …" summary from the host
})
const emit = defineEmits(['build-intent', 'build-spec', 'open-settings', 'update:smart', 'toast'])

const open = ref(false)
const text = ref('')
const intent = ref(null) // editable offline parse
const aiSpec = ref(null) // Claude's returned plan
const busy = ref(false)
const listening = ref(false)
const modKeys = computed(() => Object.keys(intent.value?.mods || {}))
let recog = null

function toggleSmart() {
  if (props.aiKey) emit('update:smart', !props.smart)
  else emit('open-settings')
}
// Parse the prompt into an editable intent (does NOT build yet).
function parseIntent(raw) {
  const prompt = (raw ?? text.value ?? '').trim()
  if (!prompt) { intent.value = null; emit('toast', 'Describe the look you want'); return }
  text.value = prompt
  aiSpec.value = null
  intent.value = parseDesignerIntent(prompt, props.effects, props.filters)
}
async function smartInterpret() {
  const prompt = (text.value || '').trim()
  if (!prompt) { emit('toast', 'Describe the look you want'); return }
  if (!props.aiKey) { emit('toast', 'Add a Claude API key in Settings for smart mode'); return }
  busy.value = true; aiSpec.value = null; intent.value = null
  try {
    const spec = await callDesignerAI({ prompt, apiKey: props.aiKey, model: props.aiModel, effects: props.effects, filters: props.filters, inputs: INPUT_SOURCES })
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) throw new Error('empty patch')
    aiSpec.value = spec
  } catch (e) {
    emit('toast', 'Smart mode failed: ' + (e.message || e))
  } finally {
    busy.value = false
  }
}
function dropMod(k) { if (intent.value) delete intent.value.mods[k] }
// spoken input via the Web Speech API (Chromium); falls back with a toast
function voice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { emit('toast', 'Voice input needs a Chromium browser'); return }
  if (listening.value) { recog?.stop(); return }
  recog = new SR()
  recog.lang = 'en-US'; recog.interimResults = true; recog.continuous = false
  let finalTxt = ''
  recog.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalTxt += r[0].transcript
      else interim += r[0].transcript
    }
    text.value = (finalTxt + ' ' + interim).trim()
  }
  recog.onerror = () => { listening.value = false }
  recog.onend = () => { listening.value = false }
  listening.value = true
  try { recog.start() } catch { listening.value = false }
}
// The host calls this after a successful build to dismiss the panel.
function close() { open.value = false; intent.value = null; aiSpec.value = null }
defineExpose({ close })
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom">
    <template #activator="{ props: act }">
      <v-btn v-bind="act" icon="mdi-message-text-outline" variant="text" size="small" title="Describe a patch in words (or speak it) and wire it up" />
    </template>
    <v-card width="360" class="nl-card">
      <div class="nl-title">
        Describe a patch
        <span class="nl-spacer" />
        <button
          class="nl-smart-toggle" :class="{ on: smart }"
          :title="aiKey ? (smart ? 'Smart mode on (Claude API) — click for the offline parser' : 'Use Claude to build free-form descriptions') : 'Add a Claude API key in Settings to enable smart mode'"
          @click="toggleSmart"
        >✨ Smart</button>
      </div>
      <v-textarea
        v-model="text"
        rows="3" auto-grow variant="outlined" density="compact" hide-details autofocus
        :placeholder="smart ? 'e.g. my camera inside a spinning heart, over a slow plasma, glitchy' : 'e.g. dreamy underwater scene, slow, deep blue'"
        @keydown.enter.exact.prevent="smart ? smartInterpret() : parseIntent(text)"
      />
      <div class="nl-row">
        <v-btn
          :icon="listening ? 'mdi-microphone' : 'mdi-microphone-outline'"
          :color="listening ? 'primary' : undefined"
          variant="text" size="small" :title="listening ? 'Stop listening' : 'Speak your description'"
          @click="voice"
        />
        <div class="nl-spacer" />
        <v-btn v-if="smart" size="small" variant="tonal" color="primary" :loading="busy" prepend-icon="mdi-creation" @click="smartInterpret">Smart build</v-btn>
        <v-btn v-else size="small" variant="tonal" color="primary" prepend-icon="mdi-text-search-variant" @click="parseIntent(text)">Interpret</v-btn>
      </div>

      <!-- AI plan preview (smart mode) -->
      <div v-if="aiSpec" class="nl-preview">
        <div class="nl-pv-hint">✨ Claude's plan:</div>
        <div class="nl-ai-notes">{{ aiSpec.notes || 'A patch' }}</div>
        <div class="nl-pv-row">
          <span class="nl-pv-key">nodes</span>
          <span v-for="(n, i) in aiSpec.nodes" :key="i" class="nl-chip nl-chip--dim">{{ types[n.type] ? (n.slug || types[n.type].title) : ('?' + n.type) }}</span>
        </div>
        <v-btn size="small" variant="flat" color="primary" block prepend-icon="mdi-auto-fix" class="mt-2" @click="emit('build-spec', aiSpec)">Build this patch</v-btn>
      </div>

      <!-- editable interpretation: drop anything it got wrong, then build -->
      <div v-if="intent" class="nl-preview">
        <div class="nl-pv-hint">Here's what I understood — click a chip to drop it, then build:</div>
        <div v-if="intent.camera || intent.effects.length || (intent.text.on && !intent.mask)" class="nl-pv-row">
          <span class="nl-pv-key">sources</span>
          <button v-if="intent.camera" class="nl-chip" @click="intent.camera = false">📷 Camera ✕</button>
          <button v-for="(e, i) in intent.effects" :key="e.slug" class="nl-chip" @click="intent.effects.splice(i, 1)">{{ e.title }} ✕</button>
          <button v-if="intent.text.on && !intent.mask" class="nl-chip" @click="intent.text.on = false">T {{ intent.text.content ? ('“' + intent.text.content + '”') : 'Text' }} ✕</button>
        </div>
        <div v-if="intent.filters.length" class="nl-pv-row">
          <span class="nl-pv-key">filters</span>
          <button v-for="(f, i) in intent.filters" :key="f.slug" class="nl-chip nl-chip--f" @click="intent.filters.splice(i, 1)">{{ f.title }} ✕</button>
        </div>
        <div v-if="intent.mask || intent.audio || intent.mouse || modKeys.length || intent.color || (intent.effects.length + (intent.camera ? 1 : 0) + (intent.text.on && !intent.mask ? 1 : 0)) > 1" class="nl-pv-row">
          <span class="nl-pv-key">also</span>
          <button v-if="(intent.effects.length + (intent.camera ? 1 : 0) + (intent.text.on && !intent.mask ? 1 : 0)) > 1" class="nl-chip nl-chip--dim">{{ intent.blend }} blend</button>
          <button v-if="intent.mask" class="nl-chip" @click="intent.mask = false">mask ✕</button>
          <button v-if="intent.audio" class="nl-chip" @click="intent.audio = false">audio→mix ✕</button>
          <button v-if="intent.mouse" class="nl-chip" @click="intent.mouse = false">mouse→mix ✕</button>
          <button v-for="k in modKeys" :key="k" class="nl-chip nl-chip--dim" @click="dropMod(k)">{{ k }} {{ intent.mods[k] > 0 ? '▲' : '▼' }} ✕</button>
          <button v-if="intent.color" class="nl-chip nl-chip--dim" @click="intent.color = null">colour: {{ intent.color.name }} ✕</button>
        </div>
        <div v-if="intent.ignored.length" class="nl-ignored" title="Words I couldn't map to anything — try renaming them to an effect/filter or a mood word">didn't use: {{ intent.ignored.join(', ') }}</div>
        <v-btn size="small" variant="flat" color="primary" block prepend-icon="mdi-auto-fix" class="mt-2" @click="emit('build-intent', intent)">Build this patch</v-btn>
      </div>

      <div class="nl-examples">
        <span class="nl-ex-label">Try:</span>
        <button v-for="ex in examples" :key="ex" class="nl-ex" @click="text = ex; parseIntent(ex)">{{ ex }}</button>
      </div>
      <div v-if="last" class="nl-last">Last: {{ last }}</div>
    </v-card>
  </v-menu>
</template>

<style scoped>
.nl-card { padding: 12px; background: #14161e; }
.nl-title { font-size: 0.82rem; font-weight: 600; color: #cdd3e6; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.nl-smart-toggle {
  font-size: 0.66rem; color: #9aa4c0; background: #1c1f2b; border: 1px solid #333;
  border-radius: 10px; padding: 2px 9px; cursor: pointer;
}
.nl-smart-toggle.on { background: rgba(124,140,255,0.18); border-color: #7c8cff; color: #b7c1ff; }
.nl-ai-notes { font-size: 0.74rem; color: #cdd3e6; margin: 2px 0 8px; font-style: italic; }
.nl-row { display: flex; align-items: center; margin-top: 8px; }
.nl-spacer { flex: 1; }
.nl-preview { margin-top: 10px; padding: 8px; border: 1px solid rgba(124,140,255,0.2); border-radius: 8px; background: rgba(124,140,255,0.05); }
.nl-pv-hint { font-size: 0.68rem; color: #9aa4c0; margin-bottom: 6px; }
.nl-pv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 5px; }
.nl-pv-key { font-size: 0.6rem; color: #737b93; flex: 0 0 auto; min-width: 46px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.02em; }
.nl-chip {
  font-size: 0.7rem; color: #cdd3e6; background: #2a2f42; border: 1px solid #3a4055;
  border-radius: 10px; padding: 2px 8px; cursor: pointer;
}
.nl-chip:hover { border-color: #ff8a8a; color: #fff; }
.nl-chip--f { background: rgba(201,140,255,0.16); }
.nl-chip--dim { background: #1c1f2b; color: #9aa4c0; cursor: default; }
.nl-chip--dim:hover { border-color: #3a4055; color: #cdd3e6; }
.nl-ignored { font-size: 0.66rem; color: #b08a5a; margin-top: 4px; }
.nl-examples { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.nl-ex-label { font-size: 0.68rem; color: #7f879c; }
.nl-ex {
  text-align: left; font-size: 0.72rem; color: #9db0ff; background: rgba(124,140,255,0.08);
  border: 1px solid rgba(124,140,255,0.18); border-radius: 6px; padding: 4px 7px; cursor: pointer;
}
.nl-ex:hover { background: rgba(124,140,255,0.16); }
.nl-last { margin-top: 10px; font-size: 0.7rem; color: #7f879c; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
</style>
