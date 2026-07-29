<script setup>
// A slider with an editable numeric readout: the value shows to the right of
// the track; click it to type an exact number (the box expands), Enter/blur
// commits. Used across the Patch node controls.
import { ref, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.01 },
})
const emit = defineEmits(['update:modelValue', 'commit'])

const editing = ref(false)
const buf = ref('')
const box = ref(null)

function decimals() {
  const s = String(props.step)
  return s.includes('.') ? s.split('.')[1].length : 0
}
function round(v) { return +Number(v).toFixed(decimals()) }
function onRange(e) { emit('update:modelValue', +e.target.value) }
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
    <input class="rng" type="range" :min="min" :max="max" :step="step" :value="modelValue" @input="onRange" @change="emit('commit')" />
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
.numsl { display: flex; align-items: center; gap: 6px; width: 100%; }
.rng { flex: 1 1 auto; min-width: 0; }
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
