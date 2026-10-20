<script setup>
// A slider with an editable numeric readout: the value shows to the right of
// the track; click it to type an exact number (the box expands), Enter/blur
// commits. Used across the Patch node controls.
//
// Bipolar sliders (min < 0 < max, e.g. -1..1) read as "centred on zero": they
// draw a centre tick, snap to 0 within a small dead-zone as you drag, and
// double-clicking the track recentres them to 0.
//
// `scale="log"` makes it a log taper (sketches/_lib/paramScale.js): the native
// range runs over the 0..1 slider position and is converted to and from the value.
import { ref, nextTick, computed } from 'vue'
import { isLog, toPos, fromPos, tidy } from '../../sketches/_lib/paramScale.js'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.01 },
  scale: { type: String, default: 'linear' },
  logRange: { type: Number, default: undefined },
})
const emit = defineEmits(['update:modelValue', 'commit'])

const editing = ref(false)
const buf = ref('')
const box = ref(null)

// A slider is "bipolar" when zero sits inside its range — those get the
// centre tick, zero-snap and double-click-to-recentre affordances.
const bipolar = computed(() => props.min < 0 && props.max > 0)
const spec = computed(() => ({ min: props.min, max: props.max, step: props.step, scale: props.scale, logRange: props.logRange }))
const log = computed(() => isLog(spec.value))
// Where 0 falls along the track, as a 0..100% offset, for the centre tick.
const zeroPct = computed(() => ((0 - props.min) / (props.max - props.min)) * 100)

function decimals() {
  const s = String(props.step)
  return s.includes('.') ? s.split('.')[1].length : 0
}
function round(v) { return log.value ? tidy(Number(v), spec.value) : +Number(v).toFixed(decimals()) }
function onRange(e) {
  let v = log.value ? tidy(fromPos(+e.target.value, spec.value), spec.value) : +e.target.value
  // snap to 0 within a small dead-zone (5% of the range) so bipolar sliders
  // land cleanly on centre instead of ±0.01
  if (bipolar.value) {
    const dead = (props.max - props.min) * 0.05
    if (Math.abs(v) < dead) v = 0
  }
  emit('update:modelValue', v)
}
function recenter() {
  if (!bipolar.value) return
  emit('update:modelValue', 0)
  emit('commit')
}
async function startEdit() {
  buf.value = String(round(props.modelValue))
  editing.value = true
  await nextTick()
  box.value?.focus()
  box.value?.select()
}
function commit() {
  if (!editing.value) return
  let v = parseFloat(buf.value)
  if (!Number.isNaN(v)) { v = Math.min(props.max, Math.max(props.min, v)); emit('update:modelValue', v); emit('commit') }
  editing.value = false
}
</script>

<template>
  <span class="numsl" @pointerdown.stop>
    <span class="track" :class="{ bip: bipolar }">
      <span v-if="bipolar" class="zero" :style="{ left: zeroPct + '%' }" />
      <input
        class="rng"
        :class="{ bip: bipolar }"
        type="range"
        :min="log ? 0 : min"
        :max="log ? 1 : max"
        :step="log ? 0.001 : step"
        :value="log ? toPos(modelValue, spec) : modelValue"
        @input="onRange"
        @change="emit('commit')"
        @dblclick="recenter"
        :title="bipolar ? 'double-click to recentre at 0' : ''"
      />
    </span>
    <input
      v-if="editing"
      ref="box"
      class="num"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      v-model="buf"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="editing = false"
      @blur="commit"
    />
    <button v-else class="val" type="button" title="click to type a value" @click="startEdit">{{ round(modelValue) }}</button>
  </span>
</template>

<style scoped>
.numsl { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; max-width: 100%; }
.track { position: relative; flex: 1 1 auto; min-width: 0; max-width: 100%; max-height: 28px; overflow: hidden; display: flex; align-items: center; }
/* Keep the native slider horizontal and inside its track on every browser — some
   render a range input vertical/oversized, which used to spill out of the node. */
.rng {
  width: 100%; min-width: 0; max-width: 100%; max-height: 26px; box-sizing: border-box;
  writing-mode: horizontal-tb; -webkit-appearance: auto; appearance: auto;
}
/* centre tick for bipolar sliders — a subtle notch marking 0 */
.zero {
  position: absolute; top: 50%; width: 2px; height: 11px; margin-left: -1px;
  transform: translateY(-50%); background: rgba(255, 255, 255, 0.35);
  border-radius: 1px; pointer-events: none; z-index: 0;
}
.rng.bip { position: relative; z-index: 1; background: transparent; }
.val {
  flex: 0 0 auto; min-width: 34px; padding: 1px 4px; border: 1px solid transparent; border-radius: 4px;
  background: rgba(255, 255, 255, 0.06); color: #e6ebf5; font: 11px ui-monospace, monospace;
  cursor: text; text-align: right;
}
.val:hover { border-color: rgba(255, 255, 255, 0.2); }
.num {
  flex: 0 0 auto; width: 62px; padding: 1px 4px; border: 1px solid #5a7cff; border-radius: 4px;
  background: #12141c; color: #e6ebf5; font: 11px ui-monospace, monospace; text-align: right;
}
</style>
