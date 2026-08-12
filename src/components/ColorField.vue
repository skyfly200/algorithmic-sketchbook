<script setup>
// A swatch-first colour control. The row shows the active palette's swatches
// (click to apply) plus the current colour, which opens a pop-out picker: HSV
// sliders + the OS picker, and add / edit / delete of the palette swatches.
// Colour nodes store H (0-360) and S/V (0-100) separately so a hue can still be
// modulated by an input wire while saturation/brightness are tuned by hand.
import { ref, computed } from 'vue'
import { usePaletteStore } from '../stores/palette'

const props = defineProps({
  h: { type: Number, default: 0 },
  s: { type: Number, default: 72 },
  v: { type: Number, default: 90 },
})
const emit = defineEmits(['update:h', 'update:s', 'update:v', 'change'])

const palettes = usePaletteStore()
const swatches = computed(() => palettes.swatches)
const activeId = computed(() => palettes.active?.id ?? null)

const open = ref(false)   // pop-out picker visibility
const selIdx = ref(-1)    // swatch selected for editing (-1 = none)

const hh = computed(() => props.h ?? 0)
const ss = computed(() => props.s ?? 72)
const vv = computed(() => props.v ?? 90)

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
// Push a hex into the h/s/v model (keeps the hue when the pick is greyscale so
// the H slider — and any hue modulation — stays put).
function setHex(hexStr) {
  const r = parseInt(hexStr.slice(1, 3), 16), g = parseInt(hexStr.slice(3, 5), 16), b = parseInt(hexStr.slice(5, 7), 16)
  const [nh, ns, nv] = rgbToHsv(r, g, b)
  if (ns > 0.5) emit('update:h', Math.round(nh))
  emit('update:s', Math.round(ns))
  emit('update:v', Math.round(nv))
  emit('change')
}
function applyHex(c) { setHex(c) }                 // click a swatch → apply it
function onNative(e) { setHex(e.target.value) }    // OS colour picker
function selectSwatch(i, c) { selIdx.value = i; setHex(c) } // load into the sliders for editing
function addCurrent() { if (activeId.value) { palettes.addColor(activeId.value, hex.value); selIdx.value = swatches.value.length - 1 } }
function updateSwatch() { if (activeId.value && selIdx.value >= 0) palettes.updateColor(activeId.value, selIdx.value, hex.value) }
function delSwatch(i) {
  if (!activeId.value) return
  palettes.removeColor(activeId.value, i)
  if (selIdx.value === i) selIdx.value = -1
  else if (selIdx.value > i) selIdx.value--
}

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
    <!-- current colour — click to open the picker -->
    <button class="cf-cur" :class="{ on: open }" :style="{ background: hex }" :title="`${hex} — click to edit`" @click.stop="open = !open" />
    <!-- inline swatch row: click applies -->
    <span class="cf-row">
      <button v-for="(c, i) in swatches" :key="i" class="cf-sw" :style="{ background: c }" :title="c" @click="applyHex(c)" />
      <button class="cf-sw cf-add" title="Add the current colour as a swatch" @click.stop="addCurrent">＋</button>
    </span>

    <!-- pop-out picker -->
    <div v-if="open" class="cf-pop" @pointerdown.stop>
      <div class="cf-pop-head">
        <label class="cf-native" :style="{ background: hex }" title="OS colour picker"><input type="color" :value="hex" @input="onNative" /></label>
        <span class="cf-hex">{{ hex }}</span>
        <button class="cf-close" title="Close" @click="open = false">✕</button>
      </div>
      <input class="cf-rng" type="range" min="0" max="360" step="1" :value="hh" :style="{ backgroundImage: hueGrad }" title="hue"
        @input="emit('update:h', +$event.target.value)" @change="emit('change')" />
      <input class="cf-rng" type="range" min="0" max="100" step="1" :value="ss" :style="{ backgroundImage: satGrad }" title="saturation"
        @input="emit('update:s', +$event.target.value)" @change="emit('change')" />
      <input class="cf-rng" type="range" min="0" max="100" step="1" :value="vv" :style="{ backgroundImage: valGrad }" title="brightness"
        @input="emit('update:v', +$event.target.value)" @change="emit('change')" />
      <div class="cf-pop-sw">
        <span v-for="(c, i) in swatches" :key="i" class="cf-cell" :class="{ sel: selIdx === i }">
          <button class="cf-sw" :style="{ background: c }" :title="c" @click="selectSwatch(i, c)" />
          <button class="cf-del" title="Delete swatch" @click.stop="delSwatch(i)">×</button>
        </span>
        <button class="cf-sw cf-add" title="Add the current colour" @click.stop="addCurrent">＋</button>
      </div>
      <div class="cf-pop-actions">
        <button class="cf-btn" @click="addCurrent">Add as new</button>
        <button class="cf-btn" :disabled="selIdx < 0" title="Overwrite the selected swatch with the current colour" @click="updateSwatch">Update selected</button>
      </div>
      <div class="cf-pop-note">Editing the active palette (Settings → Colour palettes).</div>
    </div>
  </span>
</template>

<style scoped>
.cf { display: flex; align-items: center; gap: 6px; width: 100%; position: relative; }
.cf-cur {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 5px; padding: 0; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
.cf-cur.on { outline: 2px solid #7c8cff; }
.cf-row { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.cf-sw {
  width: 15px; height: 15px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.4);
  padding: 0; cursor: pointer; box-sizing: border-box;
}
.cf-sw:hover { outline: 1px solid #fff; }
.cf-add {
  display: inline-flex; align-items: center; justify-content: center;
  background: #12141c; color: #9aa4c0; font-size: 11px; line-height: 1; border-color: #444;
}
.cf-pop {
  position: absolute; top: 28px; left: 0; z-index: 60; width: 200px;
  background: #14161e; border: 1px solid #333; border-radius: 8px; padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 6px;
}
.cf-pop-head { display: flex; align-items: center; gap: 6px; }
.cf-native {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 5px; overflow: hidden; position: relative;
  border: 1px solid rgba(255, 255, 255, 0.25); cursor: pointer;
}
.cf-native input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.cf-hex { flex: 1 1 auto; font: 11px ui-monospace, monospace; color: #cdd3e0; }
.cf-close { background: none; border: none; color: #9aa4c0; cursor: pointer; font-size: 12px; }
.cf-rng {
  -webkit-appearance: none; appearance: none; width: 100%; height: 10px; border-radius: 5px;
  background-size: 100% 100%; background-repeat: no-repeat; border: 1px solid rgba(0, 0, 0, 0.4); cursor: pointer;
}
.cf-rng::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; border: 1px solid #333; box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
.cf-rng::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 1px solid #333; }
.cf-pop-sw { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 2px; }
.cf-cell { position: relative; display: inline-flex; }
.cf-cell.sel .cf-sw { outline: 2px solid #7c8cff; }
.cf-cell .cf-sw { width: 18px; height: 18px; }
.cf-del {
  position: absolute; top: -5px; right: -5px; width: 13px; height: 13px; border-radius: 50%;
  background: #1a1d28; color: #ff8a8a; border: 1px solid #444; font-size: 9px; line-height: 1;
  padding: 0; cursor: pointer; display: none;
}
.cf-cell:hover .cf-del { display: block; }
.cf-pop-actions { display: flex; gap: 4px; }
.cf-btn {
  flex: 1 1 0; font-size: 10px; padding: 4px 4px; border-radius: 4px; cursor: pointer;
  background: #1a1d28; color: #cdd3e0; border: 1px solid #333;
}
.cf-btn:disabled { opacity: 0.45; cursor: default; }
.cf-pop-note { font-size: 9px; color: #737b93; }
</style>
