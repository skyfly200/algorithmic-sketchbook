<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { vertexShader, makeFragmentShader } from '../shaders/moire.js'
import { settings, shaderState, MAX_LAYERS } from '../settings.js'
import { recState } from '../recorder.js'
import { timeline, applyTimeline } from '../timeline.js'
import { applyModulation } from '../modulation.js'

const container = ref(null)
const canvas = ref(null)

let renderer, scene, camera, material, rafId, resizeObserver
let animTime = 0
let lastFrame = 0

const colorA = new THREE.Color()
const colorB = new THREE.Color()

function makeUniforms() {
  return {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAnimTime: { value: 0 },
    uZoom: { value: 1 },
    uLayerCount: { value: 2 },
    uAAMode: { value: 0 },
    uColorMode: { value: 0 },
    uThickness: { value: 0.5 },
    uColorA: { value: new THREE.Color('#0b0b0f') },
    uColorB: { value: new THREE.Color('#f5f5f0') },
    uColorC: { value: new THREE.Color('#ff4d6d') },
    uLayerColor: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Color()) },
    uLayerAlpha: { value: new Array(MAX_LAYERS).fill(1) },
    uOffset: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector2()) },
    uFreq: { value: new Array(MAX_LAYERS).fill(140) },
    uRot: { value: new Array(MAX_LAYERS).fill(0) },
    uPattern: { value: new Array(MAX_LAYERS).fill(0) },
    uOp: { value: new Array(MAX_LAYERS).fill(0) },
  }
}

function syncUniforms() {
  const u = material.uniforms
  u.uZoom.value = settings.zoom
  u.uLayerCount.value = settings.layerCount
  u.uAAMode.value = settings.aaMode
  u.uColorMode.value = settings.colorMode
  u.uThickness.value = settings.thickness
  u.uColorA.value.copy(colorA.set(settings.colorA))
  u.uColorB.value.copy(colorB.set(settings.colorB))
  u.uColorC.value.set(settings.colorC)
  for (let i = 0; i < MAX_LAYERS; i++) {
    const l = settings.layers[i]
    u.uOffset.value[i].set(l.x, l.y)
    u.uFreq.value[i] = l.freq
    u.uRot.value[i] = l.rot
    u.uLayerColor.value[i].set(l.color)
    u.uLayerAlpha.value[i] = l.alpha ?? 1
    u.uPattern.value[i] = l.pattern
    u.uOp.value[i] = l.op
  }
}

function resize() {
  const w = container.value.clientWidth
  const h = container.value.clientHeight
  // resScale: 0 = auto (device pixel ratio), ≤4 = multiplier of CSS pixels,
  // >4 = fixed backing-store pixel height.
  const rs = +settings.resScale
  const scale = rs === 0
    ? Math.min(window.devicePixelRatio || 1, 2)
    : rs <= 4
      ? rs
      : Math.min(rs / Math.max(h, 1), 4)
  renderer.setPixelRatio(scale)
  renderer.setSize(w, h, false)
  material.uniforms.uResolution.value.set(w * scale, h * scale)
}

const fps = ref(0)
let fpsFrames = 0
let fpsWindowStart = 0

function frame(now) {
  rafId = requestAnimationFrame(frame)
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now
  fpsFrames++
  if (now - fpsWindowStart >= 500) {
    fps.value = Math.round((fpsFrames * 1000) / (now - fpsWindowStart))
    fpsFrames = 0
    fpsWindowStart = now
  }
  if (settings.animate) {
    if (settings.drift) animTime += dt * settings.animSpeed * 0.25
    if (timeline.tracks.length) {
      timeline.time = (timeline.time + dt) % timeline.duration
      applyTimeline(timeline.time)
    }
  }
  material.uniforms.uAnimTime.value = animTime
  applyModulation()
  syncUniforms()
  renderer.render(scene, camera)
}

// Drag on the canvas to move the active layer's center. Two fingers on
// touch pinch-to-zoom (there is no scroll wheel on a phone).
let dragging = false
let dragStart = null
const activePointers = new Map()
let pinchStart = null

function planeDelta(e) {
  const rect = canvas.value.getBoundingClientRect()
  // Same mapping as toPlane(): y spans [-zoom, zoom] over the canvas height.
  const scale = (2 * settings.zoom) / rect.height
  return { x: e.clientX * scale, y: -e.clientY * scale }
}

function pinchDistance() {
  const pts = [...activePointers.values()]
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
}

function onPointerDown(e) {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePointers.size === 2) {
    // Second finger down: start a pinch, cancel any in-progress drag.
    dragging = false
    pinchStart = { dist: pinchDistance(), zoom: settings.zoom }
    return
  }
  const l = settings.layers[settings.activeLayer]
  const p = planeDelta(e)
  dragging = true
  dragStart = { px: p.x, py: p.y, lx: l.x, ly: l.y }
  canvas.value.setPointerCapture(e.pointerId)
}

function onPointerMove(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  if (pinchStart && activePointers.size === 2) {
    const ratio = pinchDistance() / (pinchStart.dist || 1)
    settings.zoom = Math.min(4, Math.max(0.25, pinchStart.zoom / ratio))
    return
  }
  if (!dragging) return
  const l = settings.layers[settings.activeLayer]
  const p = planeDelta(e)
  l.x = +(dragStart.lx + p.x - dragStart.px).toFixed(4)
  l.y = +(dragStart.ly + p.y - dragStart.py).toFixed(4)
}

function onPointerUp(e) {
  if (e && activePointers.has(e.pointerId)) activePointers.delete(e.pointerId)
  if (activePointers.size < 2) pinchStart = null
  dragging = false
}

function onWheel(e) {
  e.preventDefault()
  const factor = Math.exp(e.deltaY * 0.001)
  settings.zoom = Math.min(4, Math.max(0.25, settings.zoom * factor))
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportPNG() {
  renderer.render(scene, camera)
  canvas.value.toBlob((blob) => download(blob, 'moire-pattern.png'))
}

function captureThumb(w = 160, h = 100) {
  renderer.render(scene, camera)
  const src = canvas.value
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  // Cover-crop the canvas into the thumbnail.
  const scale = Math.max(w / src.width, h / src.height)
  const sw = w / scale
  const sh = h / scale
  c.getContext('2d').drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.8)
}

// Video capture of the canvas via MediaRecorder (WebM).
let mediaRecorder = null
let recChunks = []
let recTimer = null
let restoreAnimate = false

function toggleRecording() {
  if (recState.active) {
    mediaRecorder?.stop()
    return
  }
  const stream = canvas.value.captureStream(60)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 })
  recChunks = []
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) recChunks.push(e.data)
  }
  mediaRecorder.onstop = () => {
    clearInterval(recTimer)
    recState.active = false
    if (restoreAnimate) {
      settings.animate = false
      restoreAnimate = false
    }
    stream.getTracks().forEach((t) => t.stop())
    download(new Blob(recChunks, { type: 'video/webm' }), 'moire-pattern.webm')
    recChunks = []
  }
  // A recording of a frozen pattern is rarely what anyone wants — turn
  // animation on for the take and restore the previous state afterwards.
  if (!settings.animate) {
    settings.animate = true
    restoreAnimate = true
  }
  recState.active = true
  recState.seconds = 0
  recTimer = setInterval(() => recState.seconds++, 1000)
  mediaRecorder.start()
}

defineExpose({ exportPNG, captureThumb, toggleRecording })

// Validate a rebuilt fragment shader before swapping it in, so a bad custom
// expression reports an error instead of breaking rendering.
function validateFragment(src) {
  const gl = renderer.getContext()
  const prefix =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'layout(location = 0) out highp vec4 pc_fragColor;\n' +
    '#define gl_FragColor pc_fragColor\n'
  const sh = gl.createShader(gl.FRAGMENT_SHADER)
  gl.shaderSource(sh, prefix + src.replace('precision highp float;', ''))
  gl.compileShader(sh)
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS)
  const log = ok ? '' : gl.getShaderInfoLog(sh)
  gl.deleteShader(sh)
  return { ok, log }
}

let exprTimer = null

function rebuildShader() {
  const src = makeFragmentShader(settings.customExpr || '0.0', settings.customShapeExpr || '1.0')
  const { ok, log } = validateFragment(src)
  if (!ok) {
    shaderState.error = (log || 'shader compile error').trim().split('\n')[0]
    return
  }
  shaderState.error = ''
  material.fragmentShader = src
  material.needsUpdate = true
}

onMounted(() => {
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: false })
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: makeFragmentShader(settings.customExpr, settings.customShapeExpr),
    uniforms: makeUniforms(),
  })
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))

  watch(
    () => [settings.customExpr, settings.customShapeExpr],
    () => {
      clearTimeout(exprTimer)
      exprTimer = setTimeout(rebuildShader, 350)
    },
  )
  watch(() => settings.resScale, resize)

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container.value)
  resize()
  lastFrame = performance.now()
  rafId = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  clearTimeout(exprTimer)
  if (recState.active) mediaRecorder?.stop()
  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  material?.dispose()
  renderer?.dispose()
})
</script>

<template>
  <div ref="container" class="canvas-wrap">
    <canvas
      ref="canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    />
    <div class="hint">
      drag: move layer {{ settings.activeLayer + 1 }} · scroll: zoom · space: play/pause ·
      ↑↓: speed · R: randomize · G: gallery · M: mode · 1-9: load mode ·
      S: display view (Esc exits) · H: hide UI · F: fullscreen
    </div>
    <div v-if="recState.active" class="rec-badge">● REC</div>
    <div v-if="settings.showFps" class="fps">{{ fps }} fps</div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}
canvas:active {
  cursor: grabbing;
}
.fps {
  position: absolute;
  left: 12px;
  top: 10px;
  padding: 3px 9px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #9ee493;
  background: rgba(12, 12, 16, 0.65);
  border: 1px solid #26262e;
  border-radius: 999px;
  pointer-events: none;
}
.rec-badge {
  position: absolute;
  right: 12px;
  bottom: 10px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #ff5c5c;
  background: rgba(12, 12, 16, 0.65);
  border: 1px solid rgba(255, 92, 92, 0.4);
  border-radius: 999px;
  pointer-events: none;
  animation: rec-pulse 1.2s ease-in-out infinite;
}
@keyframes rec-pulse {
  50% {
    opacity: 0.45;
  }
}
.hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  padding: 4px 10px;
  font-size: 11px;
  color: #9a9aa5;
  background: rgba(12, 12, 16, 0.65);
  border: 1px solid #26262e;
  border-radius: 999px;
  pointer-events: none;
  backdrop-filter: blur(4px);
}
</style>
