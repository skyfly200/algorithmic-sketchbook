<script setup>
// A compact HSV colour control: a swatch that opens the OS colour picker plus
// hue / saturation / value sliders. Colour nodes store H (0-360) and S/V
// (0-100) separately so a hue can still be modulated by an input wire while the
// user tunes saturation and brightness. Used across the Patch node controls.
import { computed } from 'vue'
import { usePaletteStore } from '../stores/palette'

const props = defineProps({
  h: { type: Number, default: 0 },
  s: { type: Number, default: 72 },
  v: { type: Number, default: 90 },
})
const emit = defineEmits(['update:h', 'update:s', 'update:v', 'change'])
// The active palette's swatches, so you can reuse favourite colours here.
const palettes = usePaletteStore()
const swatches = computed(() => palettes.swatches)
function applyHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  const [nh, ns, nv] = rgbToHsv(r, g, b)
  if (ns > 0.5) emit('update:h', Math.round(nh))
  emit('update:s', Math.round(ns))
  emit('update:v', Math.round(nv))
  emit('change')
}

const hh = computed(() => props.h ?? 0)
const ss = computed(() => props.s ?? 72)
const vv = computed(() => props.v ?? 90)

// HSV → hex for the native swatch.
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360; s /= 100; v /= 100
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255))
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  return [h, mx === 0 ? 0 : (d / mx) * 100, mx * 100]
}
const hex = computed(() => {
  const [r, g, b] = hsvToRgb(hh.value, ss.value, vv.value)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
})
function onSwatch(e) {
  const v = e.target.value
  const r = parseInt(v.slice(1, 3), 16), g = parseInt(v.slice(3, 5), 16), b = parseInt(v.slice(5, 7), 16)
  const [nh, ns, nv] = rgbToHsv(r, g, b)
  // keep the existing hue when the pick is greyscale so the H slider stays put
  if (ns > 0.5) emit('update:h', Math.round(nh))
  emit('update:s', Math.round(ns))
  emit('update:v', Math.round(nv))
  emit('change')
}
// slider background so each track previews the colour it produces
const hueGrad = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
const satGrad = computed(() => {
  const g0 = hsvToRgb(hh.value, 0, vv.value), g1 = hsvToRgb(hh.value, 100, vv.value)
  return `linear-gradient(90deg,rgb(${g0.join(',')}),rgb(${g1.join(',')}))`
})
const valGrad = computed(() => {
  const g1 = hsvToRgb(hh.value, ss.value, 100)
  return `linear-gradient(90deg,#000,rgb(${g1.join(',')}))`
})
</script>

<template>
  <span class="cf" @pointerdown.stop>
    <label class="sw" :style="{ background: hex }" title="pick a colour">
      <input type="color" :value="hex" @input="onSwatch" />
    </label>
    <span class="rows">
      <input class="cf-rng" type="range" min="0" max="360" step="1" :value="hh" :style="{ backgroundImage: hueGrad }" title="hue"
        @input="emit('update:h', +$event.target.value)" @change="emit('change')" />
      <input class="cf-rng" type="range" min="0" max="100" step="1" :value="ss" :style="{ backgroundImage: satGrad }" title="saturation"
        @input="emit('update:s', +$event.target.value)" @change="emit('change')" />
      <input class="cf-rng" type="range" min="0" max="100" step="1" :value="vv" :style="{ backgroundImage: valGrad }" title="brightness"
        @input="emit('update:v', +$event.target.value)" @change="emit('change')" />
      <span v-if="swatches.length" class="cf-pal" title="Palette (Settings → Colour palettes)">
        <button v-for="(c, i) in swatches" :key="i" class="cf-sw" :style="{ background: c }" :title="c" @click="applyHex(c)" />
      </span>
    </span>
  </span>
</template>

<style scoped>
.cf { display: flex; align-items: stretch; gap: 6px; width: 100%; }
.sw {
  flex: 0 0 auto; width: 26px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: pointer; overflow: hidden; position: relative;
}
.sw input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.rows { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cf-rng {
  -webkit-appearance: none; appearance: none; width: 100%; height: 9px; border-radius: 5px;
  background-size: 100% 100%; background-repeat: no-repeat; border: 1px solid rgba(0, 0, 0, 0.4); cursor: pointer;
}
.cf-rng::-webkit-slider-thumb {
  -webkit-appearance: none; width: 11px; height: 11px; border-radius: 50%;
  background: #fff; border: 1px solid #333; box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
.cf-rng::-moz-range-thumb {
  width: 11px; height: 11px; border-radius: 50%; background: #fff; border: 1px solid #333;
}
.cf-pal { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 1px; }
.cf-sw { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.4); padding: 0; cursor: pointer; }
.cf-sw:hover { outline: 1px solid #fff; }
</style>
