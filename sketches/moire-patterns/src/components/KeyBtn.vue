<script setup>
import { computed } from 'vue'
import { timeline, findTrack, hasKeyNear, toggleKeyAt } from '../timeline.js'

const props = defineProps({ path: { type: String, required: true } })

const has = computed(() => !!findTrack(props.path))
const on = computed(() => hasKeyNear(props.path, timeline.time))
const title = computed(() =>
  on.value
    ? 'Remove keyframe at current time'
    : 'Add keyframe at current time' + (has.value ? '' : ' (creates track)'),
)
</script>

<template>
  <button class="keybtn" :class="{ has, on }" :title="title" @click="toggleKeyAt(path, timeline.time)">
    ◆
  </button>
</template>
