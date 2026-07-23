// Convert a Mixer-style layer stack into a Patch node graph, and hand a graph
// off to the Patch view. Shared by the Mixer ("Open in Patch") and Autopilot
// ("Edit in Patch") so a running mix can be dropped onto the node board and
// edited by hand — the reverse of Patch's own auto-evolve mode.

// localStorage handoff: a writer stashes a { nodes, edges, links } graph here,
// then navigates to Patch, which loads and clears it on mount.
export const PATCH_HANDOFF_KEY = 'sketchbook-patch-handoff'

// The Patch Blend node feeds its mode straight to the canvas compositor, so a
// Mixer "normal" layer becomes "source-over".
export function blendForPatch(name) {
  return !name || name === 'normal' ? 'source-over' : name
}

// layers: bottom → top, each { slug, blend, opacity, on }. Produces the same
// { nodes, edges, links } shape Patch loads: an Effect per layer, folded
// together with Blend nodes (base = port 0, this layer = port 1, opacity = mix),
// then an Output.
export function mixToPatch(layers) {
  const active = (layers || []).filter((l) => l && l.slug && l.on !== false)
  const nodes = []
  const edges = []
  const links = []
  let id = 1
  const mk = (type, params, x, y) => { const n = { id: id++, type, x, y, params }; nodes.push(n); return n }
  if (!active.length) return { nodes, edges, links }

  const eff = active.map((l, i) => mk('effect', { slug: l.slug }, 40, 40 + i * 180))
  let composite = eff[0]
  for (let i = 1; i < active.length; i++) {
    const b = mk('blend', { mode: blendForPatch(active[i].blend), mix: active[i].opacity ?? 1 }, 280 + i * 60, 40 + i * 96)
    edges.push({ from: composite.id, to: b.id, port: 0 }) // composite below
    edges.push({ from: eff[i].id, to: b.id, port: 1 }) // this layer on top
    composite = b
  }
  const out = mk('output', {}, 320 + active.length * 60, 60)
  edges.push({ from: composite.id, to: out.id, port: 0 })
  return { nodes, edges, links }
}

// Stash a graph for Patch to pick up, so the caller can then navigate to Patch.
export function handOffToPatch(graph) {
  try { localStorage.setItem(PATCH_HANDOFF_KEY, JSON.stringify(graph)) } catch { /* quota */ }
}
