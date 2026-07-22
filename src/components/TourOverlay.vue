<script setup>
/**
 * A lightweight guided tour: a dimmed overlay with a spotlight cut around a
 * target element and a tooltip card describing it. Drives itself from a list
 * of steps ({ target?: cssSelector, title, body, pad? }); a step with no
 * target (or a missing one) centres the card. Skippable at any step (the ✕,
 * the Skip button, or Esc), and it emits `update:modelValue = false` when the
 * user finishes or skips so the host can remember it was seen.
 */
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  modelValue: { type: Boolean, default: false },
  // When true, the final step offers a "don't show tutorials again" checkbox.
  // Defaults on so every tour lets you opt out from its last step.
  allowDisableAll: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'finish'])

const idx = ref(0)
const rect = ref(null)
const disableAll = ref(false)
const cardEl = ref(null)
const cardH = ref(220) // measured card height, for clamping into view
const step = computed(() => props.steps[idx.value] || null)
const onLast = computed(() => idx.value >= props.steps.length - 1)

function measure() {
  const s = step.value
  const el = s?.target ? document.querySelector(s.target) : null
  if (!el) { rect.value = null; syncCardH(); return }
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) { rect.value = null; syncCardH(); return }
  const pad = s.pad ?? 6
  rect.value = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
  // keep the target in view (gallery can scroll)
  if (r.top < 80 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  syncCardH()
}
function syncCardH() {
  nextTick(() => { if (cardEl.value) cardH.value = cardEl.value.offsetHeight })
}

const holeStyle = computed(() => rect.value
  ? { left: rect.value.left + 'px', top: rect.value.top + 'px', width: rect.value.width + 'px', height: rect.value.height + 'px' }
  : null)

const cardStyle = computed(() => {
  const W = Math.min(320, window.innerWidth - 24)
  if (!rect.value) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: W + 'px' }
  const r = rect.value
  const h = cardH.value
  const gap = 16
  const roomBelow = window.innerHeight - (r.top + r.height + gap)
  const roomAbove = r.top - gap
  // Prefer below the target; otherwise above; then clamp fully into the
  // viewport so the card can never sit off the top or bottom edge.
  let top = roomBelow >= h + 12 || roomBelow >= roomAbove
    ? r.top + r.height + gap
    : r.top - gap - h
  top = Math.min(Math.max(12, top), Math.max(12, window.innerHeight - h - 12))
  const left = Math.min(Math.max(12, r.left), window.innerWidth - W - 12)
  return { left: left + 'px', top: top + 'px', width: W + 'px' }
})

function next() { if (onLast.value) done(); else idx.value++ }
function back() { if (idx.value > 0) idx.value-- }
function done() { emit('finish', { disableAll: disableAll.value }); emit('update:modelValue', false) }

function onKey(e) {
  if (!props.modelValue) return
  if (e.key === 'Escape') done()
  else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
  else if (e.key === 'ArrowLeft') back()
}
function onResize() { measure() }

watch(() => props.modelValue, (on) => {
  if (on) {
    idx.value = 0
    disableAll.value = false
    nextTick(measure)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('scroll', onResize, true)
    window.removeEventListener('keydown', onKey)
  }
})
watch(idx, () => nextTick(measure))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div v-if="modelValue" class="tour-root" :class="{ 'tour-root--dim': !rect }">
    <div v-if="holeStyle" class="tour-hole" :style="holeStyle" />
    <div ref="cardEl" class="tour-card" :style="cardStyle" @pointerdown.stop>
      <button v-if="!onLast" class="tour-x" title="Skip the tour (Esc)" @click="done">✕</button>
      <div class="tour-title">{{ step?.title }}</div>
      <div class="tour-body">{{ step?.body }}</div>
      <!-- Optional keyboard-shortcuts list for a step (used on the last slide). -->
      <ul v-if="step?.shortcuts?.length" class="tour-keys">
        <li v-for="k in step.shortcuts" :key="k.keys">
          <kbd>{{ k.keys }}</kbd><span>{{ k.desc }}</span>
        </li>
      </ul>
      <label v-if="allowDisableAll && onLast" class="tour-disable">
        <input type="checkbox" v-model="disableAll" />
        Don’t show tutorials again
      </label>
      <div class="tour-foot">
        <span class="tour-prog">{{ idx + 1 }} / {{ steps.length }}</span>
        <span class="tour-spacer" />
        <button v-if="!onLast" class="tour-skip" @click="done">Skip</button>
        <button v-if="idx > 0" class="tour-btn" @click="back">Back</button>
        <button class="tour-btn tour-btn--go" @click="next">{{ onLast ? 'Done' : 'Next' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour-root { position: fixed; inset: 0; z-index: 5000; }
.tour-root--dim { background: rgba(6, 7, 12, 0.72); }
.tour-hole {
  position: fixed; border-radius: 10px; pointer-events: none;
  box-shadow: 0 0 0 9999px rgba(6, 7, 12, 0.72);
  border: 2px solid rgba(242, 173, 0, 0.95);
  transition: left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease;
}
.tour-card {
  position: fixed; z-index: 1; box-sizing: border-box;
  background: #14161f; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px;
  padding: 14px 16px 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  color: #e8ecf5; font: 13px/1.5 system-ui, sans-serif;
}
.tour-x {
  position: absolute; top: 8px; right: 10px; background: transparent; border: 0;
  color: #8a90a0; font-size: 14px; cursor: pointer; line-height: 1;
}
.tour-x:hover { color: #fff; }
.tour-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; padding-right: 16px; color: #fff; }
.tour-body { color: #c2c8d6; margin-bottom: 12px; }
.tour-disable {
  display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
  font: 12px system-ui, sans-serif; color: #9aa4c0; cursor: pointer;
}
.tour-disable input { cursor: pointer; }
.tour-keys { list-style: none; margin: 0 0 12px; padding: 8px 10px; background: #10121a; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; }
.tour-keys li { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
.tour-keys kbd {
  flex: 0 0 auto; min-width: 58px; text-align: center; font: 11px ui-monospace, monospace;
  background: #232838; border: 1px solid #3a4056; border-radius: 5px; padding: 2px 6px; color: #dfe4f0;
}
.tour-keys span { color: #b6bccb; font-size: 12px; }
.tour-foot { display: flex; align-items: center; gap: 6px; }
.tour-prog { font: 11px ui-monospace, monospace; color: #7a8090; }
.tour-spacer { flex: 1; }
.tour-skip { background: transparent; border: 0; color: #8a90a0; font: 12px system-ui; cursor: pointer; padding: 4px 8px; }
.tour-skip:hover { color: #cdd3e0; }
.tour-btn {
  background: #1a1d28; border: 1px solid #3a4056; border-radius: 6px; color: #cdd3e0;
  font: 12px system-ui; padding: 5px 12px; cursor: pointer;
}
.tour-btn:hover { border-color: #7c8cff; }
.tour-btn--go { background: #7c8cff; border-color: #7c8cff; color: #0a0b0f; font-weight: 600; }
.tour-btn--go:hover { background: #96a2ff; }
</style>
