// Integration-style tests for the Patch graph engine (src/lib/patch/graph.js) —
// the algorithms behind save/load, render order, the show crossfade and the
// Autopilot cost model. These exercise whole subsystems end to end (load a
// legacy save → migrate → order it; crossfade a real cue pair) so they can act
// as a safety net while the stateful parts of PatchView are refactored out.
import { describe, it, expect } from 'vitest'
import {
  normalizeNodes, migrateGraph, evalOrder, ancestorsOf, freeSpot, layoutByDepth,
  slugCost, graphCost, topoMatch, applyRamp, applyCurve, usedInGraph,
} from '../src/lib/patch/graph.js'

// tiny helpers to keep the graph fixtures readable
const node = (id, type, params = {}, x = 0, y = 0) => ({ id, type, params, x, y })
const edge = (from, to, port = 0) => ({ from, to, port })

describe('save-file migration pipeline', () => {
  it('folds legacy node types (motion/camera/shape) into modern ones', () => {
    const list = normalizeNodes([
      node(1, 'motion', { foo: 1 }),
      node(2, 'camera', {}),
      node(3, 'shape', { invert: true, points: [[0, 0]] }),
      node(4, 'effect', { slug: 'x' }),
    ])
    expect(list[0]).toMatchObject({ type: 'filter', params: { slug: 'motion-extraction' } })
    expect(list[1]).toMatchObject({ type: 'media', params: { mode: 'camera', mediaId: null } })
    expect(list[2].type).toBe('polygon')
    expect(list[2].params.invert).toBeUndefined() // Mask owns invert now
    expect(list[2].params.points).toBeTruthy() // other params preserved
    expect(list[3].type).toBe('effect') // untouched
  })

  it('reconnects a legacy Polygon-Mask so it keeps clipping through a new Mask', () => {
    // old graph: effect(1) → shape(2, clipping) → output(3)
    const nodes = normalizeNodes([
      node(1, 'effect', { slug: 'x' }, 0, 0),
      node(2, 'shape', { invert: false }, 100, 0),
      node(3, 'output', {}, 200, 0),
    ])
    const edges = [edge(1, 2, 0), edge(2, 3, 0)]
    migrateGraph(nodes, edges)

    const mask = nodes.find((n) => n.type === 'mask')
    expect(mask, 'a Mask node was inserted').toBeTruthy()
    // content (effect) now feeds Mask.content (port 0)
    expect(edges).toContainEqual({ from: 1, to: mask.id, port: 0 })
    // the polygon feeds Mask.matte (port 1)
    expect(edges).toContainEqual({ from: 2, to: mask.id, port: 1 })
    // the Mask drives what the shape used to drive (the output)
    expect(edges).toContainEqual({ from: mask.id, to: 3, port: 0 })
    // and nothing still points straight at the bare polygon as content
    expect(edges.some((e) => e.to === 2)).toBe(false)
  })

  it('leaves a fresh Polygon source (no content wire) alone', () => {
    const nodes = normalizeNodes([node(1, 'polygon', {}, 0, 0), node(2, 'mask', {}, 100, 0)])
    const edges = [edge(1, 2, 1)]
    migrateGraph(nodes, edges)
    expect(nodes.filter((n) => n.type === 'mask')).toHaveLength(1) // no extra mask
    expect(edges).toHaveLength(1)
  })
})

describe('evalOrder (render order)', () => {
  it('orders a linear chain source → filter → output', () => {
    const nodes = [node(3, 'output'), node(1, 'effect'), node(2, 'filter')]
    const edges = [edge(1, 2), edge(2, 3)]
    const order = evalOrder(nodes, edges).map((n) => n.id)
    expect(order).toEqual([1, 2, 3])
  })
  it('puts every source before a blend that consumes them', () => {
    // A(1), B(2) → blend(3) → output(4)
    const nodes = [node(4, 'output'), node(3, 'blend'), node(1, 'effect'), node(2, 'effect')]
    const edges = [edge(1, 3, 0), edge(2, 3, 1), edge(3, 4)]
    const order = evalOrder(nodes, edges).map((n) => n.id)
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(3))
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3))
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(4))
  })
  it('still returns every node when there is a feedback cycle', () => {
    const nodes = [node(1, 'filter'), node(2, 'filter'), node(3, 'output')]
    const edges = [edge(1, 2), edge(2, 1), edge(2, 3)] // 1↔2 loop
    const order = evalOrder(nodes, edges)
    expect(order).toHaveLength(3)
    expect(new Set(order.map((n) => n.id))).toEqual(new Set([1, 2, 3]))
  })
  it('includes disconnected nodes', () => {
    const nodes = [node(1, 'effect'), node(2, 'effect')]
    const order = evalOrder(nodes, [])
    expect(order).toHaveLength(2)
  })
})

describe('ancestorsOf', () => {
  it('collects the whole upstream branch transitively', () => {
    const edges = [edge(1, 2), edge(2, 4), edge(3, 4)] // 1→2→4, 3→4
    expect(ancestorsOf(4, edges)).toEqual(new Set([2, 1, 3]))
    expect(ancestorsOf(2, edges)).toEqual(new Set([1]))
    expect(ancestorsOf(1, edges)).toEqual(new Set())
  })
})

describe('layout helpers', () => {
  it('freeSpot pushes a box down off an overlapping node, leaves a clear spot', () => {
    const nodes = [{ id: 1, x: 100, y: 100 }]
    const dims = { nodeW: 190, nodeH: 161 }
    const clear = freeSpot(500, 500, nodes, dims)
    expect(clear).toEqual({ x: 500, y: 500 })
    const bumped = freeSpot(100, 100, nodes, dims)
    expect(bumped.x).toBe(100)
    expect(bumped.y).toBeGreaterThan(100) // slid below node 1
  })
  it('layoutByDepth columns nodes by longest-path depth', () => {
    const nodes = [node(1, 'effect'), node(2, 'filter'), node(3, 'output'), node(4, 'effect')]
    const edges = [edge(1, 2), edge(2, 3)] // chain 1→2→3, node 4 is loose
    layoutByDepth([1, 2, 3, 4], nodes, edges, { colW: 240, x0: 60, y0: 70 })
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId[1].x).toBe(60)         // depth 0
    expect(byId[2].x).toBe(300)        // depth 1
    expect(byId[3].x).toBe(540)        // depth 2
    expect(byId[4].x).toBe(60)         // loose → depth 0, same column as 1
    expect(byId[4].y).not.toBe(byId[1].y) // stacked, not overlapping
  })
})

describe('Autopilot cost model', () => {
  const perf = { cheap: 100, heavy: 10 }
  it('cheaper sketches cost less; unknown slugs get a mid cost', () => {
    expect(slugCost('cheap', perf)).toBeLessThan(slugCost('heavy', perf))
    expect(slugCost('missing', perf)).toBe(4)
    // always clamped to 1..12
    expect(slugCost('heavy', perf)).toBeLessThanOrEqual(12)
    expect(slugCost('cheap', perf)).toBeGreaterThanOrEqual(1)
  })
  it('graphCost sums only effect/filter nodes that carry a slug', () => {
    const nodes = [
      node(1, 'effect', { slug: 'cheap' }),
      node(2, 'filter', { slug: 'heavy' }),
      node(3, 'blend', {}),           // not costed
      node(4, 'effect', {}),          // no slug → not costed
    ]
    expect(graphCost(nodes, perf)).toBe(slugCost('cheap', perf) + slugCost('heavy', perf))
  })
})

describe('show crossfade', () => {
  const snap = () => ({
    nodes: [node(1, 'effect', { hue: 0, pts: [[0, 0], [1, 1]] }), node(2, 'blend', { mix: 0 })],
    edges: [edge(1, 2)],
    links: [],
  })
  it('topoMatch is true for identical shapes, false when wiring/types differ', () => {
    expect(topoMatch(snap(), snap())).toBe(true)
    const diffEdge = snap(); diffEdge.edges = [edge(1, 2, 1)]
    expect(topoMatch(snap(), diffEdge)).toBe(false)
    const diffType = snap(); diffType.nodes[1].type = 'mask'
    expect(topoMatch(snap(), diffType)).toBe(false)
    const diffLinks = snap(); diffLinks.links = [{ from: 1, node: 2, param: 'mix' }]
    expect(topoMatch(snap(), diffLinks)).toBe(false)
    expect(topoMatch(snap(), { nodes: [], edges: [], links: [] })).toBe(false)
  })
  it('applyRamp interpolates numeric params and nested point arrays', () => {
    const a = { nodes: [node(1, 'effect', { hue: 0, pts: [[0, 0], [0, 0]] }), node(2, 'blend', { mix: 0 })] }
    const b = { nodes: [node(1, 'effect', { hue: 100, pts: [[2, 4], [6, 8]] }), node(2, 'blend', { mix: 1 })] }
    const live = [node(1, 'effect', { hue: 0, pts: [[0, 0], [0, 0]] }), node(2, 'blend', { mix: 0 })]
    applyRamp(live, a, b, 0.5)
    expect(live[0].params.hue).toBe(50)
    expect(live[0].params.pts).toEqual([[1, 2], [3, 4]])
    expect(live[1].params.mix).toBe(0.5)
    // endpoints
    applyRamp(live, a, b, 0); expect(live[0].params.hue).toBe(0)
    applyRamp(live, a, b, 1); expect(live[0].params.hue).toBe(100)
  })
  it('applyRamp leaves non-numeric / mismatched params untouched', () => {
    const a = { nodes: [node(1, 'text', { text: 'a', size: 10 })] }
    const b = { nodes: [node(1, 'text', { text: 'b', size: 20 })] }
    const live = [node(1, 'text', { text: 'a', size: 10 })]
    applyRamp(live, a, b, 0.5)
    expect(live[0].params.text).toBe('a') // strings don't ramp
    expect(live[0].params.size).toBe(15)
  })
})

describe('applyCurve (input response)', () => {
  it('reshapes a 0..1 value per curve type', () => {
    expect(applyCurve(0.5, 'linear')).toBe(0.5)
    expect(applyCurve(0.5, 'exp')).toBe(0.25)
    expect(applyCurve(0.25, 'log')).toBe(0.5)
    expect(applyCurve(0.5, 's-curve')).toBeCloseTo(0.5, 6)
    expect(applyCurve(0.4, 'step')).toBe(0)
    expect(applyCurve(0.6, 'step')).toBe(1)
    expect(applyCurve(0.7, 'unknown')).toBe(0.7) // default passthrough
  })
})

describe('usedInGraph (reroll orphan guard)', () => {
  const edges = [edge(1, 2), edge(2, 3)]
  const links = [{ from: 4, srcPort: 0, node: 2, param: 'mix' }]
  it('is true for nodes touched by an edge or a link', () => {
    expect(usedInGraph(1, edges, links)).toBe(true)  // edge source
    expect(usedInGraph(3, edges, links)).toBe(true)  // edge target
    expect(usedInGraph(4, edges, links)).toBe(true)  // link source
    expect(usedInGraph(2, edges, links)).toBe(true)  // link target + edges
  })
  it('is false for a disconnected orphan', () => {
    expect(usedInGraph(9, edges, links)).toBe(false)
    expect(usedInGraph(9, [], [])).toBe(false)
  })
})
