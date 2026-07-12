<script setup>
/**
 * Patch — a TouchDesigner-style node compositor for live visuals. Drop operator
 * nodes, drag wires between their ports, and a per-frame compositor pipes each
 * node's rendered frame into the next:
 *
 *   Effect / Camera (sources) → Motion (extraction) → Mask / Blend → Output
 *
 * Every node renders into a small offscreen canvas (its thumbnail). Sources are
 * captured from same-origin sketch iframes (?capture=1) or the webcam; operators
 * run native canvas ops. The Output node blits to the fullscreen stage behind
 * the graph. Cycles are allowed — an upstream canvas simply holds last frame,
 * giving video-feedback loops. Graph persists in localStorage.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSketchStore } from '../stores/sketches'

const store = useSketchStore()
// Only local, same-origin sketches can be captured for piping.
const effectOptions = computed(() => store.sketches.filter((s) => s.type === 'local' && s.embed))

const W = 384
const H = 216
const NODE_W = 190
const HEAD_H = 30
const THUMB_H = 107

const TYPES = {
  effect: { title: 'Effect', ins: 0, color: '#7c8cff' },
  camera: { title: 'Camera', ins: 0, color: '#4dd0c4' },
  motion: { title: 'Motion Extract', ins: 1, color: '#ff7ca8' },
  mask: { title: 'Mask', ins: 2, color: '#f2ad00' },
  blend: { title: 'Blend', ins: 2, color: '#a0e060' },
  output: { title: 'Output', ins: 1, color: '#ffffff' },
}
const BLENDS = ['screen', 'add', 'lighten', 'multiply', 'difference', 'exclusion', 'overlay']

// --- persisted graph ---
const STORE_KEY = 'sketchbook-patch'
function loadGraph() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    return null
  }
}
const saved = loadGraph()
let nextId = 1
const nodes = reactive(saved?.nodes ?? [])
const edges = reactive(saved?.edges ?? [])
if (nodes.length) nextId = Math.max(...nodes.map((n) => n.id)) + 1

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ nodes, edges }))
}

// Non-reactive per-node runtime state (canvases, iframes, video, ring buffers).
const rtState = new Map()
function st(id) {
  let s = rtState.get(id)
  if (!s) {
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    s = { out, octx: out.getContext('2d'), ring: null, head: 0, iframe: null, video: null }
    rtState.set(id, s)
  }
  return s
}

function addNode(type) {
  const n = reactive({
    id: nextId++,
    type,
    x: 60 + (nodes.length % 4) * 60,
    y: 90 + (nodes.length % 4) * 40,
    params:
      type === 'motion'
        ? { delay: 6, gain: 1.4, mode: 0 }
        : type === 'blend'
          ? { mode: 'screen' }
          : type === 'effect'
            ? { slug: effectOptions.value[0]?.slug ?? '' }
            : {},
  })
  nodes.push(n)
  st(n.id) // create runtime state
  persist()
}
function removeNode(id) {
  const i = nodes.findIndex((n) => n.id === id)
  if (i >= 0) nodes.splice(i, 1)
  for (let k = edges.length - 1; k >= 0; k--)
    if (edges[k].from === id || edges[k].to === id) edges.splice(k, 1)
  rtState.delete(id)
  persist()
}
function clearAll() {
  nodes.splice(0)
  edges.splice(0)
  rtState.clear()
  persist()
}

// --- ports & wiring ---
const board = ref(null)
function outPort(n) {
  return { x: n.x + NODE_W, y: n.y + HEAD_H + THUMB_H / 2 }
}
function inPort(n, i) {
  const cnt = TYPES[n.type].ins
  return { x: n.x, y: n.y + HEAD_H + (THUMB_H * (i + 1)) / (cnt + 1) }
}
function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

// Connection data-role, so ports/wires can carry a shape per type: image
// streams are round, mattes/masks (a Motion output or a Mask's matte input)
// are diamonds. A wire is a matte if either end is a matte.
function inKind(node, port) {
  if (node.type === 'mask') return port === 1 ? 'matte' : 'image'
  return 'image'
}
function outKind(node) {
  return node.type === 'motion' ? 'matte' : 'image'
}

const wires = computed(() =>
  edges.map((e, idx) => {
    const from = nodes.find((n) => n.id === e.from)
    const to = nodes.find((n) => n.id === e.to)
    if (!from || !to) return null
    const matte = outKind(from) === 'matte' || inKind(to, e.port) === 'matte'
    return {
      idx,
      d: wirePath(outPort(from), inPort(to, e.port)),
      color: TYPES[from.type].color,
      matte,
    }
  }).filter(Boolean),
)

const drag = reactive({ node: null, dx: 0, dy: 0 })
const wire = reactive({ active: false, from: null, x: 0, y: 0 })

function boardXY(e) {
  const r = board.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function startDrag(n, e) {
  const p = boardXY(e)
  drag.node = n.id
  drag.dx = p.x - n.x
  drag.dy = p.y - n.y
}
function startWire(n, e) {
  e.stopPropagation()
  const p = outPort(n)
  wire.active = true
  wire.from = n.id
  wire.x = p.x
  wire.y = p.y
}
function endWire(n, port) {
  if (!wire.active || wire.from === n.id) return
  // one edge per input port
  for (let k = edges.length - 1; k >= 0; k--)
    if (edges[k].to === n.id && edges[k].port === port) edges.splice(k, 1)
  edges.push({ from: wire.from, to: n.id, port })
  wire.active = false
  persist()
}
function onMove(e) {
  const p = boardXY(e)
  if (drag.node != null) {
    const n = nodes.find((x) => x.id === drag.node)
    if (n) {
      n.x = p.x - drag.dx
      n.y = p.y - drag.dy
    }
  }
  if (wire.active) {
    wire.x = p.x
    wire.y = p.y
  }
}
function onUp() {
  if (drag.node != null) persist()
  drag.node = null
  wire.active = false
}
function removeEdge(idx) {
  edges.splice(idx, 1)
  persist()
}

// --- source binding (iframes / video) ---
function effectSrc(n) {
  const s = store.bySlug(n.params.slug)
  return s ? `${s.url}?capture=1&preview=1&quality=low` : ''
}
function bindFrame(id, el) {
  if (el) st(id).iframe = el
}
async function bindVideo(id, el) {
  const s = st(id)
  if (!el || s.video === el) return
  s.video = el
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } })
    el.srcObject = stream
    await el.play()
  } catch {
    /* no camera */
  }
}

// --- thumbnails: mount each node's output canvas into its card ---
function bindThumb(id, el) {
  if (el && !el.contains(st(id).out)) {
    el.innerHTML = ''
    el.appendChild(st(id).out)
  }
}

// --- compositor ---
const stage = ref(null)
const MAXD = 30

function cover(octx, src, sw, sh) {
  if (!src || !sw || !sh) return false
  const scale = Math.max(W / sw, H / sh)
  const w = sw * scale
  const h = sh * scale
  octx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h)
  return true
}
function inputCanvas(node, port) {
  const e = edges.find((e) => e.to === node.id && e.port === port)
  if (!e) return null
  return rtState.get(e.from)?.out ?? null
}

function evalNode(node) {
  const s = st(node.id)
  const octx = s.octx
  octx.globalCompositeOperation = 'source-over'
  octx.globalAlpha = 1
  octx.filter = 'none'
  octx.fillStyle = '#000'
  octx.fillRect(0, 0, W, H)

  if (node.type === 'effect') {
    try {
      const cv = s.iframe?.contentDocument?.querySelector('canvas')
      if (cv && cv.width) cover(octx, cv, cv.width, cv.height)
    } catch {
      /* cross-origin / not ready */
    }
  } else if (node.type === 'camera') {
    if (s.video && s.video.videoWidth) cover(octx, s.video, s.video.videoWidth, s.video.videoHeight)
  } else if (node.type === 'motion') {
    const input = inputCanvas(node, 0)
    if (input) {
      if (!s.ring) {
        s.ring = Array.from({ length: MAXD }, () => {
          const c = document.createElement('canvas')
          c.width = W
          c.height = H
          return c
        })
        s.head = 0
      }
      const delay = Math.min(MAXD - 1, Math.max(1, Math.round(node.params.delay)))
      const ref = s.ring[(s.head - delay + MAXD) % MAXD]
      const g = node.params.gain
      octx.filter = g !== 1 ? `brightness(${g})` : 'none'
      octx.drawImage(input, 0, 0, W, H)
      octx.globalCompositeOperation = 'difference'
      octx.drawImage(ref, 0, 0, W, H)
      octx.globalCompositeOperation = 'source-over'
      octx.filter = 'none'
      if (node.params.mode < 0.5) {
        octx.globalCompositeOperation = 'saturation'
        octx.fillStyle = 'hsl(0,0%,50%)'
        octx.fillRect(0, 0, W, H)
        octx.globalCompositeOperation = 'source-over'
      }
      const slot = s.ring[s.head].getContext('2d')
      slot.clearRect(0, 0, W, H)
      slot.drawImage(input, 0, 0, W, H)
      s.head = (s.head + 1) % MAXD
    }
  } else if (node.type === 'mask') {
    const content = inputCanvas(node, 0)
    const mask = inputCanvas(node, 1)
    if (content) octx.drawImage(content, 0, 0, W, H)
    if (mask) {
      octx.globalCompositeOperation = 'multiply'
      octx.drawImage(mask, 0, 0, W, H)
      octx.globalCompositeOperation = 'source-over'
    }
  } else if (node.type === 'blend') {
    const a = inputCanvas(node, 0)
    const b = inputCanvas(node, 1)
    if (a) octx.drawImage(a, 0, 0, W, H)
    if (b) {
      octx.globalCompositeOperation = node.params.mode === 'add' ? 'lighter' : node.params.mode
      octx.drawImage(b, 0, 0, W, H)
      octx.globalCompositeOperation = 'source-over'
    }
  } else if (node.type === 'output') {
    const input = inputCanvas(node, 0)
    if (input) octx.drawImage(input, 0, 0, W, H)
  }
}

// Topological order (cycles tolerated: leftovers appended → 1-frame feedback).
function evalOrder() {
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0)
  const order = []
  const seen = new Set()
  while (queue.length) {
    const n = queue.shift()
    if (seen.has(n.id)) continue
    seen.add(n.id)
    order.push(n)
    for (const e of edges.filter((e) => e.from === n.id)) {
      indeg.set(e.to, indeg.get(e.to) - 1)
      if (indeg.get(e.to) === 0) {
        const t = nodes.find((x) => x.id === e.to)
        if (t) queue.push(t)
      }
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n) // cyclic remainder
  return order
}

let raf = 0
function loop() {
  for (const n of evalOrder()) evalNode(n)
  // Blit the (last) Output node to the fullscreen stage.
  const out = nodes.find((n) => n.type === 'output')
  const cnv = stage.value
  if (cnv) {
    const cx = cnv.getContext('2d')
    cx.fillStyle = '#000'
    cx.fillRect(0, 0, cnv.width, cnv.height)
    if (out) {
      const s = rtState.get(out.id)
      if (s) {
        const scale = Math.max(cnv.width / W, cnv.height / H)
        const w = W * scale
        const h = H * scale
        cx.drawImage(s.out, (cnv.width - w) / 2, (cnv.height - h) / 2, w, h)
      }
    }
  }
  raf = requestAnimationFrame(loop)
}

function resizeStage() {
  const c = stage.value
  if (!c) return
  c.width = window.innerWidth
  c.height = window.innerHeight
}
function fullscreen() {
  board.value?.parentElement?.requestFullscreen?.()
}

// --- output-only view: hide the routing UI, show just the composite -------
// Sources/graph keep running (only the graph UI is hidden), so the Output
// node still composites live.
const outputOnly = ref(false)

// --- saved routings: named snapshots of the node graph in localStorage ----
const SAVED_KEY = 'sketchbook-patch-saved'
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || []
  } catch {
    return []
  }
}
const savedRoutings = ref(loadSaved())
const newName = ref('')
function persistSaved() {
  localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutings.value))
}
function saveRouting() {
  const name = newName.value.trim() || `Routing ${savedRoutings.value.length + 1}`
  savedRoutings.value.push({
    id: Date.now().toString(36),
    name,
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  })
  persistSaved()
  newName.value = ''
}
function loadRouting(r) {
  rtState.clear()
  nodes.splice(0, nodes.length, ...r.nodes.map((n) => reactive(structuredClone(n))))
  edges.splice(0, edges.length, ...structuredClone(r.edges))
  nextId = nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1
  for (const n of nodes) st(n.id)
  persist()
}
function deleteRouting(r) {
  const i = savedRoutings.value.findIndex((x) => x.id === r.id)
  if (i >= 0) {
    savedRoutings.value.splice(i, 1)
    persistSaved()
  }
}

onMounted(async () => {
  // Seed a starter graph the first time.
  if (!nodes.length) {
    addNode('effect')
    addNode('motion')
    addNode('output')
    await nextTick()
    nodes[1].x = 280
    nodes[2].x = 500
    edges.push({ from: nodes[0].id, to: nodes[1].id, port: 0 })
    edges.push({ from: nodes[1].id, to: nodes[2].id, port: 0 })
    persist()
  }
  await nextTick()
  resizeStage()
  window.addEventListener('resize', resizeStage)
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resizeStage)
  for (const s of rtState.values()) s.video?.srcObject?.getTracks?.().forEach((t) => t.stop())
})
</script>

<template>
  <div class="patch">
    <canvas ref="stage" class="stage" />

    <!-- hidden capture sources -->
    <div class="sources" aria-hidden="true">
      <template v-for="n in nodes" :key="'src' + n.id">
        <iframe
          v-if="n.type === 'effect' && n.params.slug"
          :ref="(el) => bindFrame(n.id, el)"
          :src="effectSrc(n)"
          allow="microphone; camera; accelerometer; gyroscope"
        />
        <video v-else-if="n.type === 'camera'" :ref="(el) => bindVideo(n.id, el)" muted playsinline />
      </template>
    </div>

    <!-- toolbar -->
    <div v-show="!outputOnly" class="toolbar">
      <v-btn icon="mdi-arrow-left" variant="text" size="small" :to="{ name: 'gallery' }" />
      <span class="text-subtitle-2 mr-2">Patch</span>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('effect')">Effect</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('camera')">Camera</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('motion')">Motion</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('mask')">Mask</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('blend')">Blend</v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addNode('output')">Output</v-btn>
      <v-spacer />

      <!-- save / load named routings -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-content-save-outline">Routings</v-btn>
        </template>
        <v-card class="pa-2" min-width="250">
          <div class="d-flex ga-1 mb-2">
            <v-text-field
              v-model="newName"
              density="compact"
              hide-details
              placeholder="Name this routing"
              @keyup.enter="saveRouting"
            />
            <v-btn size="small" variant="tonal" @click="saveRouting">Save</v-btn>
          </div>
          <v-list density="compact" max-height="260">
            <v-list-item
              v-for="r in savedRoutings"
              :key="r.id"
              :title="r.name"
              @click="loadRouting(r)"
            >
              <template #append>
                <v-icon icon="mdi-delete" size="16" @click.stop="deleteRouting(r)" />
              </template>
            </v-list-item>
            <v-list-item v-if="!savedRoutings.length" title="No saved routings yet" disabled />
          </v-list>
        </v-card>
      </v-menu>

      <v-btn icon="mdi-projector-screen-outline" variant="text" size="small" title="Output only (hide routing)" @click="outputOnly = true" />
      <v-btn icon="mdi-delete-sweep" variant="text" size="small" title="Clear graph" @click="clearAll" />
      <v-btn icon="mdi-fullscreen" variant="text" size="small" @click="fullscreen" />
    </div>

    <!-- output-only: floating controls to exit / go fullscreen -->
    <div v-if="outputOnly" class="output-ctrls">
      <v-btn icon="mdi-tune-variant" size="small" variant="flat" title="Show routing" @click="outputOnly = false" />
      <v-btn icon="mdi-fullscreen" size="small" variant="flat" title="Fullscreen" @click="fullscreen" />
    </div>

    <!-- node board -->
    <div v-show="!outputOnly" ref="board" class="board" @pointermove="onMove" @pointerup="onUp">
      <svg class="wires">
        <path
          v-for="w in wires"
          :key="w.idx"
          :d="w.d"
          :stroke="w.color"
          fill="none"
          stroke-width="2.5"
          :stroke-dasharray="w.matte ? '7 5' : undefined"
          class="wire"
          @click="removeEdge(w.idx)"
        />
        <path
          v-if="wire.active"
          :d="wirePath(outPort(nodes.find((n) => n.id === wire.from)), { x: wire.x, y: wire.y })"
          stroke="#fff"
          fill="none"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
      </svg>

      <div
        v-for="n in nodes"
        :key="n.id"
        class="node"
        :style="{ left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px' }"
      >
        <div
          class="node-head"
          :style="{ background: TYPES[n.type].color }"
          @pointerdown="startDrag(n, $event)"
        >
          <span>{{ TYPES[n.type].title }}</span>
          <v-icon icon="mdi-close" size="14" class="node-close" @pointerdown.stop @click="removeNode(n.id)" />
        </div>

        <div class="node-thumb" :ref="(el) => bindThumb(n.id, el)" :style="{ height: THUMB_H + 'px' }" />

        <!-- input ports (centered on the wire endpoint; diamond = matte/mask) -->
        <div
          v-for="i in TYPES[n.type].ins"
          :key="'in' + i"
          class="port"
          :class="inKind(n, i - 1) === 'matte' ? 'port--matte' : 'port--image'"
          :style="{
            left: '-7px',
            top: HEAD_H + (THUMB_H * i) / (TYPES[n.type].ins + 1) - 7 + 'px',
          }"
          :title="n.type === 'mask' ? (i === 1 ? 'content' : 'mask (matte)') : 'input'"
          @pointerup="endWire(n, i - 1)"
        />
        <!-- output port -->
        <div
          v-if="n.type !== 'output'"
          class="port"
          :class="outKind(n) === 'matte' ? 'port--matte' : 'port--image'"
          :style="{ left: NODE_W - 7 + 'px', top: HEAD_H + THUMB_H / 2 - 7 + 'px' }"
          @pointerdown="startWire(n, $event)"
        />

        <!-- per-node controls -->
        <div class="node-body">
          <select v-if="n.type === 'effect'" v-model="n.params.slug" @change="persist" @pointerdown.stop>
            <option v-for="o in effectOptions" :key="o.slug" :value="o.slug">{{ o.title }}</option>
          </select>
          <template v-if="n.type === 'motion'">
            <label>delay <input type="range" min="1" max="29" step="1" v-model.number="n.params.delay" @pointerdown.stop /></label>
            <label>gain <input type="range" min="0.5" max="4" step="0.05" v-model.number="n.params.gain" @pointerdown.stop /></label>
            <label class="chk"><input type="checkbox" :checked="n.params.mode > 0.5" @change="n.params.mode = $event.target.checked ? 1 : 0; persist()" @pointerdown.stop /> color</label>
          </template>
          <select v-if="n.type === 'blend'" v-model="n.params.mode" @change="persist" @pointerdown.stop>
            <option v-for="b in BLENDS" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
      </div>
    </div>

    <div v-show="!outputOnly" class="hint">Drag a node's right port to another node's left port to wire it. Click a wire to remove it. ◆ ports/dashed wires carry a matte or mask.</div>
  </div>
</template>

<style scoped>
.patch { position: fixed; inset: 0; background: #0a0b0f; z-index: 2000; overflow: hidden; }
.stage { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
.sources { position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none; }
.sources iframe, .sources video { width: 384px; height: 216px; border: 0; }
.toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0.1));
}
.board { position: absolute; inset: 0; z-index: 10; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 11; }
.wire { pointer-events: stroke; cursor: pointer; opacity: 0.9; }
.wire:hover { stroke-width: 4; }
.node {
  position: absolute; z-index: 12; border-radius: 8px; overflow: visible;
  background: rgba(20,22,30,0.96); border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 6px 20px rgba(0,0,0,0.4); user-select: none;
}
.node-head {
  display: flex; align-items: center; justify-content: space-between;
  height: 30px; padding: 0 8px; border-radius: 8px 8px 0 0; cursor: grab;
  color: #06070a; font: 600 12px system-ui, sans-serif;
}
.node-close { cursor: pointer; color: rgba(0,0,0,0.6); }
.node-thumb { width: 100%; background: #000; }
.node-thumb :deep(canvas) { width: 100%; height: 100%; display: block; }
.node-body { padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
.node-body select, .node-body label { font: 11px system-ui, sans-serif; color: #cdd3e0; }
.node-body select { width: 100%; background: #12141c; color: #cdd3e0; border: 1px solid #333; border-radius: 4px; }
.node-body input[type=range] { width: 100%; }
.node-body .chk { display: flex; align-items: center; gap: 4px; }
.port {
  position: absolute; box-sizing: border-box; width: 14px; height: 14px;
  background: #12141c; border: 2px solid #9aa4c0; cursor: crosshair; z-index: 13;
}
.port:hover { border-color: #fff; background: #2a2f40; }
/* image stream = round; matte / mask = diamond */
.port--image { border-radius: 50%; }
.port--matte { border-radius: 2px; transform: rotate(45deg); }
.hint {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); z-index: 30;
  color: rgba(255,255,255,0.5); font: 12px system-ui, sans-serif; pointer-events: none;
}
.output-ctrls {
  position: absolute; top: 10px; right: 10px; z-index: 40;
  display: flex; gap: 6px; opacity: 0.35; transition: opacity 0.2s;
}
.output-ctrls:hover { opacity: 1; }
</style>
