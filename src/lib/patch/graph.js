// The Patch graph engine, lifted out of PatchView so the algorithms that drive
// save/load, the render order, the show crossfade and Autopilot's cost model can
// be edited and tested on their own. Everything here is framework-free: it takes
// plain node/edge/link arrays (not Vue reactive refs) and either returns a value
// or mutates the arrays it's handed. PatchView keeps thin wrappers that pass its
// reactive `nodes`/`edges`/`links` in.

// --- save-file migration ----------------------------------------------------
// Legacy node types fold into their modern equivalents so old saved graphs load.
// Mutates and returns the same list.
export function normalizeNodes(list) {
  for (const n of list ?? []) {
    if (!n.params) n.params = {} // guard malformed/legacy saves
    if (n.type === 'motion') {
      // Motion Extract used to be its own node; it's now the motion-extraction
      // sketch behind a Filter node.
      n.type = 'filter'
      n.params = { slug: 'motion-extraction' }
    }
    if (n.type === 'camera') {
      n.type = 'media'
      n.params = { mode: 'camera', mediaId: null }
    }
    // Legacy "Polygon Mask" (shape) → the new Polygon matte source. Its old
    // content input is rewired to a Mask node in migrateGraph(); here we just
    // switch the type and drop the now-meaningless invert (Mask owns that).
    if (n.type === 'shape') { n.type = 'polygon'; delete n.params.invert }
  }
  return list
}
// The old Polygon Mask clipped its input to the polygon. Now Polygon is a
// source, so reconnect any legacy graph: for each converted polygon that had a
// content wire, insert a Mask (content × polygon) in its place so old routings
// keep clipping as before. Mutates both arrays in place.
export function migrateGraph(nodesArr, edgesArr) {
  let maxId = nodesArr.reduce((m, n) => Math.max(m, n.id ?? 0), 0)
  for (const poly of [...nodesArr]) {
    if (poly.type !== 'polygon') continue
    const inEdge = edgesArr.find((e) => e.to === poly.id)
    if (!inEdge) continue // a fresh Polygon source — nothing to rewire
    const m = { id: ++maxId, type: 'mask', x: poly.x, y: poly.y, params: { strength: 1, invert: false } }
    nodesArr.push(m)
    // reroute the polygon's downstream consumers to come from the new Mask
    for (const e of edgesArr) if (e.from === poly.id) e.from = m.id
    inEdge.to = m.id; inEdge.port = 0 // old content → Mask.content
    edgesArr.push({ from: poly.id, to: m.id, port: 1 }) // polygon → Mask.matte
    poly.x -= 60; poly.y += 70 // nudge the polygon out from under the mask
  }
}

// --- topology ---------------------------------------------------------------
// Kahn topological sort of the node list; nodes left in a cycle are appended in
// their original order so a feedback loop still renders (holding last frame).
export function evalOrder(nodes, edges) {
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
// Whether a node participates in any video edge or control link (i.e. it's
// actually wired into the routing, not a disconnected orphan).
export function usedInGraph(id, edges, links = []) {
  return edges.some((e) => e.from === id || e.to === id) || links.some((l) => l.from === id || l.node === id)
}
// Every node id upstream of `id` (transitively feeding it).
export function ancestorsOf(id, edges) {
  const anc = new Set()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of edges) if (e.to === cur && !anc.has(e.from)) { anc.add(e.from); stack.push(e.from) }
  }
  return anc
}

// --- layout / placement -----------------------------------------------------
// Slide a proposed node box downward until it no longer overlaps any existing
// (non-ignored) node plus a margin — keeps freshly-placed nodes from stacking.
export function freeSpot(x, y, nodes, { nodeW, nodeH, ignore = new Set(), mx = 24, my = 20 } = {}) {
  let guard = 0
  let overlap = true
  while (overlap && guard++ < 200) {
    overlap = false
    for (const o of nodes) {
      if (ignore.has(o.id)) continue
      if (Math.abs(o.x - x) < nodeW + mx && Math.abs(o.y - y) < nodeH + my) { y = o.y + nodeH + my; overlap = true; break }
    }
  }
  return { x, y }
}
// Longest-path "depth" of each new node → columns; place them left-to-right by
// depth, stacked within a column. Mutates the x/y of the listed nodes.
export function layoutByDepth(newIds, nodes, edges, { colW = 240, rowH = 200, x0 = 60, y0 = 70 } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const set = new Set(newIds)
  const depth = new Map(newIds.map((id) => [id, 0]))
  for (let iter = 0; iter <= newIds.length; iter++) {
    for (const e of edges) {
      if (!set.has(e.from) || !set.has(e.to)) continue
      const d = (depth.get(e.from) ?? 0) + 1
      if (d > (depth.get(e.to) ?? 0)) depth.set(e.to, d)
    }
  }
  const byCol = new Map()
  for (const id of newIds) { const c = depth.get(id) ?? 0; if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(id) }
  for (const [c, list] of byCol) list.forEach((id, i) => { const n = byId.get(id); if (n) { n.x = x0 + c * colW; n.y = y0 + i * rowH } })
}

// --- Autopilot cost model ---------------------------------------------------
// Cheaper (higher perf score) sketches cost less; unknown slugs get a mid cost.
export function slugCost(slug, perfScores) {
  const s = perfScores[slug]
  if (!s) return 4
  return Math.min(12, Math.max(1, Math.round(100 / Math.max(s, 8))))
}
// Total render cost of the graph = sum of its effect/filter sketch costs.
export function graphCost(nodes, perfScores) {
  return nodes.reduce((a, n) => a + ((n.type === 'effect' || n.type === 'filter') && n.params.slug ? slugCost(n.params.slug, perfScores) : 0), 0)
}

// --- show crossfade ---------------------------------------------------------
// Two graph snapshots are "the same shape" (so their params can be ramped) when
// they have identical node ids/types and identical edge + link wiring.
export function topoMatch(a, b) {
  if (!a || !b || a.nodes.length !== b.nodes.length) return false
  const bm = new Map(b.nodes.map((n) => [n.id, n]))
  for (const n of a.nodes) { const m = bm.get(n.id); if (!m || m.type !== n.type) return false }
  if (JSON.stringify(a.edges) !== JSON.stringify(b.edges)) return false
  if (JSON.stringify(a.links || []) !== JSON.stringify(b.links || [])) return false
  return true
}
// Ramp the live nodes' numeric params (and nested number arrays, e.g. polygon
// points / colours) from snapshot A→B by fraction f. Mutates `nodes`.
export function applyRamp(nodes, a, b, f) {
  const am = new Map(a.nodes.map((n) => [n.id, n]))
  const bm = new Map(b.nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    const A = am.get(n.id), B = bm.get(n.id)
    if (!A || !B || !A.params) continue
    for (const k of Object.keys(A.params)) {
      const av = A.params[k], bv = B.params?.[k]
      if (typeof av === 'number' && typeof bv === 'number') n.params[k] = av + (bv - av) * f
      else if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
        n.params[k] = av.map((p, idx) => (Array.isArray(p) && Array.isArray(bv[idx]) && p.length === bv[idx].length)
          ? p.map((c, ci) => c + (bv[idx][ci] - c) * f) : p)
      }
    }
  }
}

// --- input response curve ---------------------------------------------------
// Reshape a 0..1 control value through an Input node's response curve.
export function applyCurve(v, curve) {
  switch (curve) {
    case 'exp': return v * v
    case 'log': return Math.sqrt(v)
    case 's-curve': return v * v * (3 - 2 * v)
    case 'step': return v >= 0.5 ? 1 : 0
    default: return v
  }
}
