<script setup>
// A compact Photoshop-style curve editor for the Patch effect params panel. It
// edits a { rgb, r, g, b } object of control-point arrays ([x,y] in 0..1) and
// emits the whole object on every change so the host can push it into the effect
// and save it with the patch. Click empty space to add a point, drag to move,
// double-click a middle point to delete it; the end points move vertically only.
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps({ modelValue: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'commit'])

const CH = [['rgb', 'RGB', '#f2f5fb'], ['r', 'R', '#ff6b6b'], ['g', 'G', '#5bd66b'], ['b', 'B', '#5aa0ff']]
const chan = ref('rgb')
const cv = ref(null)
let drag = null

const identity = () => [[0, 0], [1, 1]]
function curves() {
  const m = props.modelValue || {}
  return { rgb: m.rgb || identity(), r: m.r || identity(), g: m.g || identity(), b: m.b || identity() }
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// monotone cubic fit (matches the sketch) so the preview curve is faithful
function fit(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0])
  const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]), m = [], t = new Array(n)
  for (let i = 0; i < n - 1; i++) m[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0 }
    else { const a = t[i] / m[i], b = t[i + 1] / m[i], h = Math.hypot(a, b); if (h > 3) { const s = 3 / h; t[i] = s * a * m[i]; t[i + 1] = s * b * m[i] } }
  }
  return { xs, ys, t, n }
}
function evalFit(f, x) {
  const { xs, ys, t, n } = f
  if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]
  let k = 0; while (k < n - 1 && x > xs[k + 1]) k++
  const h = xs[k + 1] - xs[k], s = (x - xs[k]) / h, s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * ys[k] + (s3 - 2 * s2 + s) * h * t[k] + (-2 * s3 + 3 * s2) * ys[k + 1] + (s3 - s2) * h * t[k + 1]
}

function draw() {
  const c = cv.value; if (!c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = c.clientWidth || 200, h = c.clientHeight || 150
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0)
  x.clearRect(0, 0, w, h)
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, w, h)
  x.strokeStyle = 'rgba(255,255,255,0.1)'; x.lineWidth = 1
  for (let i = 1; i < 4; i++) { const f = i / 4; x.beginPath(); x.moveTo(f * w, 0); x.lineTo(f * w, h); x.moveTo(0, f * h); x.lineTo(w, f * h); x.stroke() }
  x.strokeStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(0, h); x.lineTo(w, 0); x.stroke()
  const cur = curves(), key = chan.value, pts = cur[key], col = CH.find((c) => c[0] === key)[2]
  const f = fit(pts)
  x.strokeStyle = col; x.lineWidth = 2; x.beginPath()
  for (let i = 0; i <= 100; i++) { const px = i / 100, py = clamp01(evalFit(f, px)); const sx = px * w, sy = (1 - py) * h; i ? x.lineTo(sx, sy) : x.moveTo(sx, sy) }
  x.stroke()
  for (const p of pts) { x.beginPath(); x.arc(p[0] * w, (1 - p[1]) * h, 4, 0, Math.PI * 2); x.fillStyle = col; x.fill(); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.5; x.stroke() }
}
watch(() => [props.modelValue, chan.value], () => nextTick(draw), { deep: true })
onMounted(() => { nextTick(draw); window.addEventListener('resize', draw) })

function pos(e) { const r = cv.value.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)] }
function emitCurves(cur) { emit('update:modelValue', { rgb: cur.rgb, r: cur.r, g: cur.g, b: cur.b }) }
function onDown(e) {
  const cur = curves(), pts = cur[chan.value].map((p) => p.slice())
  const [gx, gy] = pos(e), r = cv.value.getBoundingClientRect()
  const near = 10 / r.width
  for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i][0] - gx) < near && Math.abs(pts[i][1] - gy) < 10 / r.height + near) { drag = { i }; cur[chan.value] = pts; emitCurves(cur); return }
  let idx = pts.findIndex((p) => p[0] > gx); if (idx < 0) idx = pts.length
  pts.splice(idx, 0, [gx, gy]); drag = { i: idx }; cur[chan.value] = pts; emitCurves(cur)
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
}
function onMove(e) {
  if (!drag) return
  const cur = curves(), pts = cur[chan.value].map((p) => p.slice()), p = pts[drag.i]
  let [gx, gy] = pos(e)
  if (drag.i === 0 || drag.i === pts.length - 1) gx = p[0]
  else gx = Math.max(pts[drag.i - 1][0] + 0.005, Math.min(pts[drag.i + 1][0] - 0.005, gx))
  p[0] = gx; p[1] = gy; cur[chan.value] = pts; emitCurves(cur)
}
function onUp() { drag = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); emit('commit') }
function onDbl(e) {
  const cur = curves(), pts = cur[chan.value].map((p) => p.slice()), [gx, gy] = pos(e), r = cv.value.getBoundingClientRect()
  for (let i = 1; i < pts.length - 1; i++) if (Math.abs(pts[i][0] - gx) < 12 / r.width && Math.abs(pts[i][1] - gy) < 12 / r.height) { pts.splice(i, 1); cur[chan.value] = pts; emitCurves(cur); emit('commit'); return }
}
function reset() { const cur = curves(); cur[chan.value] = identity(); emitCurves(cur); emit('commit') }
</script>

<template>
  <div class="curve-ed" @pointerdown.stop>
    <div class="ch-tabs">
      <button v-for="c in CH" :key="c[0]" :class="{ on: chan === c[0] }" :style="{ color: chan === c[0] ? c[2] : undefined }" @click="chan = c[0]">{{ c[1] }}</button>
      <button class="rst" title="Reset this channel" @click="reset">⟲</button>
    </div>
    <canvas ref="cv" class="cv" @pointerdown="onDown" @dblclick="onDbl" />
  </div>
</template>

<style scoped>
.curve-ed { margin-top: 4px; }
.ch-tabs { display: flex; gap: 3px; margin-bottom: 3px; }
.ch-tabs button { flex: 1 1 auto; padding: 2px 0; font: 10px ui-monospace, monospace; color: #9aa3b5; background: rgba(255,255,255,0.05); border: 1px solid transparent; border-radius: 3px; cursor: pointer; }
.ch-tabs button.on { background: rgba(255,255,255,0.14); }
.ch-tabs button.rst { flex: 0 0 22px; }
.cv { width: 100%; height: 130px; display: block; border-radius: 4px; cursor: crosshair; touch-action: none; }
</style>
