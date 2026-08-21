// Tests for the Patch save/load library (src/lib/patch/library.js): the
// serialization, block capture/stamp id-remapping, preset filling and file
// import validation that back routings, blocks, shows and .json import/export.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadJson, saveJson, fileSlug, captureBlockData, stampBlock, fillPreset,
  buildPatchFile, buildShowFile, parsePatchImport, parseShowImport,
} from '../src/lib/patch/library.js'

const node = (id, type, params = {}, x = 0, y = 0) => ({ id, type, params, x, y, name: '', locked: false })

describe('localStorage helpers', () => {
  beforeEach(() => localStorage.clear())
  it('round-trips JSON through a key', () => {
    saveJson('k', [{ a: 1 }])
    expect(loadJson('k', [])).toEqual([{ a: 1 }])
  })
  it('returns the fallback for a missing or corrupt key', () => {
    expect(loadJson('missing', [])).toEqual([])
    localStorage.setItem('bad', '{not json')
    expect(loadJson('bad', ['fallback'])).toEqual(['fallback'])
  })
})

describe('fileSlug', () => {
  it('lowercases, collapses non-alphanumerics to dashes, trims', () => {
    expect(fileSlug('My Cool Patch!')).toBe('my-cool-patch')
    expect(fileSlug('  --Weird__Name--  ')).toBe('weird-name')
  })
  it('falls back to "untitled" and caps length', () => {
    expect(fileSlug('')).toBe('untitled')
    expect(fileSlug('!!!')).toBe('untitled')
    expect(fileSlug('x'.repeat(80))).toHaveLength(40)
  })
})

describe('block capture', () => {
  it('normalizes positions to the selection corner and deep-copies params', () => {
    const members = [node(1, 'effect', { slug: 'a' }, 100, 50), node(2, 'blend', { mix: 1 }, 340, 90)]
    const edges = [{ from: 1, to: 2, port: 0 }, { from: 9, to: 2, port: 1 }] // 2nd edge leaves the selection
    const links = [{ from: 1, srcPort: 0, node: 2, param: 'mix' }, { from: 1, srcPort: 0, node: 9, param: 'x' }]
    const b = captureBlockData(members, edges, links)
    expect(b.nodes[0]).toMatchObject({ id: 1, x: 0, y: 0 })    // corner
    expect(b.nodes[1]).toMatchObject({ id: 2, x: 240, y: 40 }) // relative
    expect(b.edges).toEqual([{ from: 1, to: 2, port: 0 }])     // only internal edges
    expect(b.links).toEqual([{ from: 1, srcPort: 0, node: 2, param: 'mix' }])
    // deep copy: mutating the source node doesn't touch the block
    members[0].params.slug = 'changed'
    expect(b.nodes[0].params.slug).toBe('a')
  })
})

describe('block stamping (id remap)', () => {
  it('assigns fresh ids from startId, offsets positions and rewires internally', () => {
    const b = {
      nodes: [node(1, 'effect', {}, 0, 0), node(2, 'blend', {}, 100, 0)],
      edges: [{ from: 1, to: 2, port: 0 }],
      links: [{ from: 1, srcPort: 0, node: 2, param: 'mix' }],
    }
    const out = stampBlock(b, 10, 90, 80)
    expect(out.nodes.map((n) => n.id)).toEqual([10, 11])
    expect(out.nextId).toBe(12)
    expect(out.ids).toEqual([10, 11])
    expect(out.nodes[0]).toMatchObject({ x: 90, y: 80 })    // offset applied
    expect(out.nodes[1]).toMatchObject({ x: 190, y: 80 })
    expect(out.edges).toEqual([{ from: 10, to: 11, port: 0 }])
    expect(out.links).toEqual([{ from: 10, srcPort: 0, node: 11, param: 'mix' }])
  })
  it('capture → stamp preserves internal wiring under new ids', () => {
    const members = [node(5, 'effect', {}, 0, 0), node(6, 'blend', {}, 200, 0)]
    const edges = [{ from: 5, to: 6, port: 1 }]
    const block = captureBlockData(members, edges, [])
    const out = stampBlock(block, 100)
    // the single edge still connects the two stamped nodes on the same port
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0].port).toBe(1)
    expect(out.edges[0].from).toBe(out.nodes[0].id)
    expect(out.edges[0].to).toBe(out.nodes[1].id)
  })
})

describe('preset filling', () => {
  const preset = {
    nodes: [{ type: 'effect', x: 0, y: 0 }, { type: 'filter', x: 1, y: 0 }, { type: 'blend', x: 2, y: 0 }, { type: 'output', x: 3, y: 0 }],
    edges: [{ from: 0, to: 2, port: 0 }],
  }
  it('fills effect/filter slugs from the pools and gives blends a mode+mix', () => {
    const out = fillPreset(preset, {
      effectPool: [{ slug: 'fx' }], filterPool: [{ slug: 'flt' }], blends: ['screen'], rng: () => 0,
    })
    expect(out.nodes[0].params.slug).toBe('fx')
    expect(out.nodes[1].params.slug).toBe('flt')
    expect(out.nodes[2].params.mode).toBe('screen')
    expect(out.nodes[2].params.mix).toBeGreaterThanOrEqual(0.5)
    expect(out.nodes[0].id).toBe(0) // index ids for stampBlock to remap
    expect(out.edges).toEqual([{ from: 0, to: 2, port: 0 }])
  })
  it('does not overwrite params a preset already specifies', () => {
    const p = { nodes: [{ type: 'effect', x: 0, y: 0, params: { slug: 'fixed' } }], edges: [] }
    const out = fillPreset(p, { effectPool: [{ slug: 'other' }], rng: () => 0 })
    expect(out.nodes[0].params.slug).toBe('fixed')
  })
  it('gives portal and polygon nodes sane defaults', () => {
    const p = { nodes: [{ type: 'portal', x: 0, y: 0 }, { type: 'polygon', x: 1, y: 0 }], edges: [] }
    const out = fillPreset(p, {})
    expect(out.nodes[0].params.srcW).toBeGreaterThan(0)
    expect(Array.isArray(out.nodes[1].params.points)).toBe(true)
  })
})

describe('file builders', () => {
  it('buildPatchFile wraps + deep-copies the graph', () => {
    const nodes = [node(1, 'effect', { hue: 0 })]
    const file = buildPatchFile({ name: 'p', resolution: '640 × 360', nodes, edges: [], links: [], effects: { 1: { values: {} } } })
    expect(file).toMatchObject({ type: 'sketchbook-patch', version: 1, name: 'p', resolution: '640 × 360' })
    expect(file.patch.nodes).toEqual(nodes)
    nodes[0].params.hue = 99 // deep copy: file is unaffected
    expect(file.patch.nodes[0].params.hue).toBe(0)
    expect(file.patch.effects).toEqual({ 1: { values: {} } })
  })
  it('buildShowFile wraps the cue list + mode', () => {
    const cues = [{ time: 0, snap: {} }]
    const file = buildShowFile({ name: 's', mode: 'timeline', cues })
    expect(file).toMatchObject({ type: 'sketchbook-show', version: 1, name: 's', mode: 'timeline' })
    expect(file.cues).toEqual(cues)
    cues.push({ time: 5 })
    expect(file.cues).toHaveLength(1) // deep copy
  })
})

describe('import validation', () => {
  it('parsePatchImport accepts the wrapped form and gates resolution', () => {
    const wrapped = { type: 'sketchbook-patch', name: 'W', resolution: '640 × 360', patch: { nodes: [node(1, 'effect')], edges: [] } }
    const ok = parsePatchImport(wrapped, ['640 × 360'])
    expect(ok).toMatchObject({ kind: 'patch', name: 'W', resolution: '640 × 360' })
    // unknown resolution is dropped
    expect(parsePatchImport({ ...wrapped, resolution: '9999' }, ['640 × 360']).resolution).toBeNull()
  })
  it('parsePatchImport accepts a bare {nodes,edges} graph', () => {
    const out = parsePatchImport({ nodes: [node(1, 'effect')], edges: [] })
    expect(out.kind).toBe('patch')
    expect(out.name).toBe('Imported patch')
  })
  it('parsePatchImport accepts a list of routings', () => {
    const out = parsePatchImport([{ nodes: [node(1, 'effect')] }, { junk: true }])
    expect(out.kind).toBe('routings')
    expect(out.routings).toHaveLength(1) // the junk entry (no nodes) is dropped
  })
  it('parsePatchImport rejects non-patches', () => {
    expect(parsePatchImport(null)).toBeNull()
    expect(parsePatchImport({ hello: 'world' })).toBeNull()
  })
  it('parseShowImport pulls cues from wrapped or bare arrays', () => {
    expect(parseShowImport({ cues: [{ time: 0 }] })).toEqual([{ time: 0 }])
    expect(parseShowImport([{ time: 1 }])).toEqual([{ time: 1 }])
    expect(parseShowImport({ nope: 1 })).toBeNull()
    expect(parseShowImport(null)).toBeNull()
  })
})
