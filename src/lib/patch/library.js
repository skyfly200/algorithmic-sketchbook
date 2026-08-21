// The Patch save/load library — the framework-free core of routings, reusable
// blocks, named shows and .json import/export. Everything here works on plain
// data and returns plain data (or performs a browser file op); the reactive
// orchestration — swapping the live graph, bumping node ids, restoring effect
// params — stays in PatchView, which calls into these. That keeps the
// serialization, block id-remapping and file validation testable in isolation.

const clone = (v) => JSON.parse(JSON.stringify(v))

// --- localStorage helpers ---------------------------------------------------
export function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback }
}
export function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)) }

// A filesystem-safe slug for a download name.
export function fileSlug(s) { return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled' }

// Trigger a browser download of `obj` as pretty-printed JSON.
export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
// Prompt for a .json file and resolve its parsed contents (or null on cancel/bad).
export function pickJsonFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json,.json'
    inp.onchange = () => {
      const f = inp.files?.[0]
      if (!f) return resolve(null)
      const r = new FileReader()
      r.onload = () => { try { resolve(JSON.parse(r.result)) } catch { resolve(null) } }
      r.onerror = () => resolve(null)
      r.readAsText(f)
    }
    inp.click()
  })
}

// --- reusable blocks --------------------------------------------------------
// Capture a set of live nodes (+ the wiring/links between them) as a portable
// block: positions are normalized to the selection's top-left and params are
// deep-copied so later edits don't mutate the saved block.
export function captureBlockData(members, edges, links) {
  const set = new Set(members.map((n) => n.id))
  const minX = Math.min(...members.map((n) => n.x))
  const minY = Math.min(...members.map((n) => n.y))
  const nodes = members.map((n) => ({
    id: n.id, type: n.type, x: n.x - minX, y: n.y - minY, name: n.name,
    locked: n.locked, params: clone(n.params),
  }))
  const bedges = edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => ({ ...e }))
  const blinks = links.filter((l) => set.has(l.from) && set.has(l.node)).map((l) => ({ ...l }))
  return { nodes, edges: bedges, links: blinks }
}
// Stamp a block into the graph: assign fresh ids from `startId`, offset the
// positions, and remap the internal edges/links onto the new ids. Returns plain
// node descriptors (the caller wraps them reactive + wires runtime state) plus
// the new id watermark.
export function stampBlock(b, startId, ox = 90, oy = 80) {
  const idMap = new Map()
  let id = startId
  const nodes = b.nodes.map((mn) => {
    const nid = id++
    idMap.set(mn.id, nid)
    return { id: nid, type: mn.type, x: mn.x + ox, y: mn.y + oy, name: mn.name, locked: mn.locked, params: clone(mn.params) }
  })
  const edges = b.edges.map((e) => ({ from: idMap.get(e.from), to: idMap.get(e.to), port: e.port }))
  const links = (b.links || []).map((l) => ({ from: idMap.get(l.from), srcPort: l.srcPort, node: idMap.get(l.node), param: l.param }))
  return { nodes, edges, links, ids: [...idMap.values()], nextId: id }
}
// Fill a structural preset's effect/filter slugs (and blend/portal/polygon
// defaults) from the current pools, yielding block data ready for stampBlock.
// `rng` is injectable so the choice is deterministic under test.
export function fillPreset(p, { effectPool = [], filterPool = [], blends = [], rng = Math.random } = {}) {
  const pk = (a) => a[Math.floor(rng() * a.length)]
  const nodes = p.nodes.map((mn, i) => {
    const params = { ...(mn.params || {}) }
    if (mn.type === 'effect' && !params.slug) params.slug = pk(effectPool)?.slug ?? ''
    if (mn.type === 'filter' && !params.slug) params.slug = pk(filterPool)?.slug ?? ''
    if (mn.type === 'blend' && !params.mode) { params.mode = pk(blends); params.mix = +(0.5 + rng() * 0.5).toFixed(2) }
    if (mn.type === 'portal' && !params.srcW) Object.assign(params, { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' })
    if (mn.type === 'polygon' && !params.points) Object.assign(params, { points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], feather: 0 })
    return { id: i, type: mn.type, x: mn.x, y: mn.y, params, locked: !!mn.locked }
  })
  return { nodes, edges: (p.edges || []).map((e) => ({ ...e })), links: (p.links || []).map((l) => ({ ...l })) }
}

// --- file import / export ---------------------------------------------------
// A self-describing patch file: the graph + effect params + a little metadata.
// The graph is deep-copied so a later live edit can't mutate the exported object.
export function buildPatchFile({ name, resolution, nodes, edges, links, effects }) {
  return {
    type: 'sketchbook-patch', version: 1, name, resolution,
    patch: { nodes: clone(nodes), edges: clone(edges), links: clone(links || []), effects: effects || {} },
  }
}
// A show file: the cue list + which show mode it was authored in.
export function buildShowFile({ name, mode, cues }) {
  return { type: 'sketchbook-show', version: 1, name, mode, cues: clone(cues) }
}
// Normalize whatever a .json import gave us into a known shape, or null if it's
// not a patch. Accepts the wrapped form, a bare {nodes,edges,links}, or a list
// of routings. `validResolutions` gates whether an embedded resolution is honored.
export function parsePatchImport(data, validResolutions = []) {
  if (!data) return null
  if (Array.isArray(data)) return { kind: 'routings', routings: data.filter((r) => r?.nodes) }
  const patch = data.patch || (data.nodes ? data : null)
  if (!patch?.nodes) return null
  const resolution = data.resolution && validResolutions.includes(data.resolution) ? data.resolution : null
  return { kind: 'patch', patch, resolution, name: data.name || 'Imported patch' }
}
// Pull the cue list out of a show import (wrapped or a bare cue array), or null.
export function parseShowImport(data) {
  const arr = Array.isArray(data) ? data : data?.cues
  return Array.isArray(arr) ? arr : null
}
