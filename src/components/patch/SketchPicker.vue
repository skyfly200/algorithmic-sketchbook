<script setup>
/**
 * SketchPicker — the effect / filter selector on a Patch node. A button showing the current
 * sketch opens a popover with a search box over the grouped list (favorites, themed sections).
 * Typing filters by title, tags, tech and description (lib/sketchSearch.js) into one ranked list;
 * ↑ ↓ move, Enter picks, Esc closes. Controlled via v-model (a slug); emits `change` after a pick.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { searchSketches } from '../../lib/sketchSearch.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  groups: { type: Array, default: () => [] }, // [{ label, items: [sketch] }]
  kind: { type: String, default: 'effect' }, // 'effect' | 'filter', for the placeholder
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref(null)
const listEl = ref(null)

const all = computed(() => {
  const seen = new Set()
  const out = []
  for (const g of props.groups) for (const s of g.items) if (!seen.has(s.slug)) { seen.add(s.slug); out.push(s) }
  return out
})
const current = computed(() => all.value.find((s) => s.slug === props.modelValue))
// Rows to show: the groups as they are, or one ranked list while searching.
const sections = computed(() => {
  if (!query.value.trim()) return props.groups
  const hits = searchSketches(all.value, query.value)
  return hits.length ? [{ label: `${hits.length} match${hits.length === 1 ? '' : 'es'}`, items: hits }] : []
})
const flat = computed(() => sections.value.flatMap((g) => g.items))

watch(open, async (v) => {
  if (!v) return
  query.value = ''
  active.value = Math.max(0, flat.value.findIndex((s) => s.slug === props.modelValue))
  await nextTick()
  focusSearch()
})
watch(query, () => { active.value = 0; scrollActive() })

// The menu moves focus around as it opens, so keep claiming it until the box has it.
function focusSearch() {
  const t0 = performance.now()
  const tryFocus = () => {
    const el = input.value
    if (!open.value || !el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (document.activeElement !== el && performance.now() - t0 < 500) requestAnimationFrame(tryFocus)
  }
  tryFocus()
  scrollActive()
}
function scrollActive() {
  nextTick(() => listEl.value?.querySelector('.sp-item--active')?.scrollIntoView({ block: 'nearest' }))
}
function pick(s) {
  open.value = false
  if (!s || s.slug === props.modelValue) return
  emit('update:modelValue', s.slug)
  emit('change', s.slug)
}
function onKey(e) {
  const n = flat.value.length
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) active.value = (active.value + 1) % n; scrollActive() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) active.value = (active.value - 1 + n) % n; scrollActive() }
  else if (e.key === 'Enter') { e.preventDefault(); pick(flat.value[active.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); open.value = false }
}
const indexOf = (s) => flat.value.indexOf(s)
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom start" max-height="420" @after-enter="focusSearch">
    <template #activator="{ props: act }">
      <button
        v-bind="act"
        type="button"
        class="sp-btn"
        :title="current ? `${current.title} — click to change or search` : 'Choose a sketch'"
        @pointerdown.stop
      >
        <span class="sp-btn-label">{{ current?.title || modelValue || '—' }}</span>
        <span class="sp-caret">▾</span>
      </button>
    </template>
    <div class="sp" @pointerdown.stop @wheel.stop @keydown.stop="onKey">
      <input
        ref="input"
        v-model="query"
        class="sp-search"
        type="search"
        :placeholder="`Search ${all.length} ${kind === 'filter' ? 'filters' : 'effects'}…`"
        spellcheck="false"
        autocomplete="off"
      >
      <div ref="listEl" class="sp-list">
        <template v-for="g in sections" :key="g.label">
          <div class="sp-group">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="g.label + s.slug"
            class="sp-item"
            :class="{ 'sp-item--active': indexOf(s) === active, 'sp-item--current': s.slug === modelValue }"
            :title="s.description"
            @mouseenter="active = indexOf(s)"
            @click="pick(s)"
          >
            <span class="sp-title">{{ s.title }}</span>
            <span v-if="s.tags?.length" class="sp-tags">{{ s.tags.slice(0, 3).join(' · ') }}</span>
          </div>
        </template>
        <div v-if="!flat.length" class="sp-empty">Nothing matches “{{ query }}”.</div>
      </div>
    </div>
  </v-menu>
</template>

<style scoped>
.sp-btn {
  display: flex; align-items: center; gap: 4px; flex: 1 1 auto; min-width: 0; width: 100%;
  font: 11px system-ui, sans-serif; color: #cdd3e0; background: #12141c;
  border: 1px solid #333; border-radius: 4px; padding: 1px 4px; text-align: left; cursor: pointer;
}
.sp-btn:hover { border-color: #555; }
.sp-btn-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-caret { opacity: 0.6; }
.sp {
  width: 280px; max-height: 420px; display: flex; flex-direction: column;
  background: #171a24; color: #cdd3e0; border: 1px solid #333; border-radius: 6px;
  font: 12px system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.sp-search {
  margin: 6px; padding: 4px 6px; background: #0f1118; color: #e6e9f2;
  border: 1px solid #3a3f52; border-radius: 4px; outline: none; font: inherit;
}
.sp-search:focus { border-color: #6f86ff; }
.sp-list { overflow-y: auto; padding-bottom: 4px; }
.sp-group { padding: 6px 8px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.55; }
.sp-item { display: flex; align-items: baseline; gap: 6px; padding: 3px 10px; cursor: pointer; }
.sp-item--active { background: #2a3150; }
.sp-item--current .sp-title { color: #9fb0ff; font-weight: 600; }
.sp-title { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-tags { flex: 1 1 auto; text-align: right; font-size: 10px; opacity: 0.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-empty { padding: 8px 10px; opacity: 0.6; }
</style>
