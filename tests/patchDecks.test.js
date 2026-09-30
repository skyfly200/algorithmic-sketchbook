// Deck plumbing: the scoped array handle (so the view's `nodes` follows the deck
// in scope) and cross-deck id remapping.
import { describe, it, expect } from 'vitest'
import { reactive, ref, watchEffect, nextTick } from 'vue'
import { scopedArray } from '../src/lib/patch/scoped.js'
import { remapGraphIds } from '../src/lib/patch/graph.js'

describe('scopedArray', () => {
  const mk = () => {
    const a = reactive([{ id: 1 }, { id: 2 }])
    const b = reactive([{ id: 9 }])
    const edit = ref(0)
    const decks = [a, b]
    let cur = a
    const nodes = scopedArray(() => cur, () => void edit.value)
    const setEdit = (i) => { cur = decks[i]; edit.value = i }
    return { a, b, nodes, setEdit }
  }
  it('behaves like the array in scope', () => {
    const { a, nodes } = mk()
    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes.length).toBe(2)
    expect(nodes.map((n) => n.id)).toEqual([1, 2])
    expect([...nodes].length).toBe(2)
    expect(nodes.find((n) => n.id === 2)).toBe(a[1])
    expect(JSON.parse(JSON.stringify({ nodes }))).toEqual({ nodes: [{ id: 1 }, { id: 2 }] })
    expect(Object.keys(nodes)).toEqual(['0', '1'])
    expect(nodes.indexOf(a[1])).toBe(1)
  })
  it('writes land in the scoped deck, and switching scope switches data', () => {
    const { a, b, nodes, setEdit } = mk()
    nodes.push({ id: 3 })
    nodes.splice(0, 1)
    expect(a.map((n) => n.id)).toEqual([2, 3])
    setEdit(1)
    expect(nodes.map((n) => n.id)).toEqual([9])
    nodes.splice(0, nodes.length, { id: 10 }, { id: 11 })
    expect(b.map((n) => n.id)).toEqual([10, 11])
    expect(a.map((n) => n.id)).toEqual([2, 3]) // untouched
  })
  it('effects re-run on element changes and on a scope switch', async () => {
    const { nodes, setEdit, b } = mk()
    const seen = []
    watchEffect(() => seen.push(nodes.map((n) => n.id).join(',')))
    expect(seen).toEqual(['1,2'])
    nodes.push({ id: 5 }); await nextTick()
    expect(seen.at(-1)).toBe('1,2,5')
    setEdit(1); await nextTick()
    expect(seen.at(-1)).toBe('9')
    b.push({ id: 12 }); await nextTick()
    expect(seen.at(-1)).toBe('9,12')
  })
})

describe('remapGraphIds', () => {
  const data = () => ({
    nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
    edges: [{ from: 1, to: 2, port: 0 }, { from: 2, to: 3, port: 0 }],
    links: [{ from: 1, node: 3, param: 'x' }],
    effects: { 1: { values: { a: 1 } }, 3: { values: { b: 2 } } },
  })
  it('leaves ids alone when nothing collides', () => {
    const d = data()
    const r = remapGraphIds(d, new Set([7, 8]), 10)
    expect(r.map.size).toBe(0)
    expect(d.nodes.map((n) => n.id)).toEqual([1, 2, 3])
  })
  it('renumbers colliding nodes and rewires edges, links and effects', () => {
    const d = data()
    const r = remapGraphIds(d, new Set([1, 3]), 20)
    expect([...r.map]).toEqual([[1, 20], [3, 21]])
    expect(d.nodes.map((n) => n.id)).toEqual([20, 2, 21])
    expect(d.edges).toEqual([{ from: 20, to: 2, port: 0 }, { from: 2, to: 21, port: 0 }])
    expect(d.links).toEqual([{ from: 20, node: 21, param: 'x' }])
    expect(Object.keys(d.effects).sort()).toEqual(['20', '21'])
    expect(r.nextId).toBe(22)
  })
  it('never hands out an id that is already taken', () => {
    const d = data()
    remapGraphIds(d, new Set([1, 20, 21]), 20)
    expect(d.nodes.map((n) => n.id)).toEqual([22, 2, 3]) // skips the taken 20 and 21
  })
})

import { useDecks, MASTER_BLENDS } from '../src/composables/useDecks.js'

describe('useDecks crossfader', () => {
  const mk = (mix) => useDecks({ a: { nodes: [{ id: 1, type: 'output', params: {} }] }, b: { nodes: [{ id: 2, type: 'output', params: {} }] }, mix })
  it('is single-deck until enabled', () => {
    const d = mk()
    expect(d.airWeight(0)).toBe(1)
    expect(d.airWeight(1)).toBe(0)
  })
  it('weights follow the fader; Mix dissolves, other blends keep A underneath', () => {
    const d = mk({ enabled: true, pos: 0.25 })
    expect(d.airWeight(0)).toBeCloseTo(0.75)
    expect(d.airWeight(1)).toBeCloseTo(0.25)
    d.mix.blend = 'Add'
    expect(d.airWeight(0)).toBe(1)
    expect(d.onAirIdx()).toBe(0)
    d.cut(1)
    expect(d.onAirIdx()).toBe(1)
  })
  it('AUTO fades with smoothstep after the preroll, then clears itself', () => {
    const d = mk({ enabled: true, pos: 0 })
    d.fadeTo(1, 2, 1000, 500) // 2 s fade, starts at t=1500
    expect(d.tickFade(1200)).toBe(false); expect(d.mix.pos).toBe(0) // still in preroll
    d.tickFade(2500) // halfway
    expect(d.mix.pos).toBeCloseTo(0.5)
    d.tickFade(1900) // early in the fade: slower than linear (smoothstep)
    expect(d.mix.pos).toBeLessThan(0.2)
    expect(d.tickFade(3600)).toBe(true)
    expect(d.mix.pos).toBe(1)
    expect(d.mix.fading).toBe(null)
  })
  it('a reverse fade starts from wherever the fader is', () => {
    const d = mk({ enabled: true, pos: 0.8 })
    d.fadeTo(0, 1, 0)
    expect(d.mix.fading.from).toBeCloseTo(0.8)
  })
  it('withDeck scopes nodes to a deck and always restores, even on a throw', () => {
    const d = mk()
    expect(d.nodes[0].id).toBe(1)
    d.withDeck(d.decks[1], () => expect(d.nodes[0].id).toBe(2))
    expect(() => d.withDeck(d.decks[1], () => { throw new Error('x') })).toThrow()
    expect(d.nodes[0].id).toBe(1)
    expect(d.otherDeck()).toBe(d.decks[1])
    d.withDeck(d.decks[1], () => expect(d.otherDeck()).toBe(d.decks[0]))
  })
  it('allocates ids across both decks and serialises deck B + the fader', () => {
    const d = mk({ enabled: true, pos: 1, blend: 'Screen', fadeSecs: 7 })
    expect(d.maxId()).toBe(2)
    expect(d.idsOf(d.decks[1])).toEqual(new Set([2]))
    const s = d.serialize()
    expect(s.deckB.nodes).toHaveLength(1)
    expect(s.mix).toEqual({ enabled: true, pos: 1, blend: 'Screen', fadeSecs: 7 })
    expect(MASTER_BLENDS).toContain(s.mix.blend)
  })
  it('composes Mix as a weighted dissolve and other blends as B over A', () => {
    const calls = []
    const cx = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', fillRect() {}, drawImage(src) { calls.push(['draw', cx.globalAlpha, cx.globalCompositeOperation, src]) } }
    const d = mk({ enabled: true, pos: 0.25 })
    d.compose(cx, 10, 10, 'A', 'B')
    expect(calls).toEqual([['draw', 0.75, 'source-over', 'A'], ['draw', 0.25, 'lighter', 'B']])
    calls.length = 0
    d.mix.blend = 'Multiply'
    d.compose(cx, 10, 10, 'A', 'B')
    expect(calls).toEqual([['draw', 1, 'source-over', 'A'], ['draw', 0.25, 'multiply', 'B']])
  })
})

import { planMirrorIds } from '../src/lib/patch/graph.js'

describe('planMirrorIds (copy a deck, keep unchanged iframes)', () => {
  const fx = (id, slug, seed = 's') => ({ id, type: 'effect', params: { slug, seed } })
  const key = (n) => (n.type === 'effect' ? `${n.type}|${n.params.slug}|${n.params.seed}` : null)
  it('reuses target ids for unchanged effects and gives fresh ids to the rest', () => {
    const src = [fx(1, 'a'), fx(2, 'b'), { id: 3, type: 'output', params: {} }]
    const dst = [fx(10, 'a'), fx(11, 'zzz'), { id: 12, type: 'output', params: {} }]
    const { map, nextId } = planMirrorIds(src, dst, 100, key)
    expect(map.get(1)).toBe(10)   // same sketch + seed → the running iframe is kept
    expect(map.get(2)).toBe(100)  // changed → fresh
    expect(map.get(3)).toBe(101)  // non-effect nodes are never reused
    expect(nextId).toBe(102)
  })
  it('never hands the same target node to two sources', () => {
    const src = [fx(1, 'a'), fx(2, 'a')]
    const { map } = planMirrorIds(src, [fx(10, 'a')], 100, key)
    expect([map.get(1), map.get(2)]).toEqual([10, 100])
    expect(new Set(map.values()).size).toBe(2)
  })
  it('a different seed is a different look, so it is not reused', () => {
    const { map } = planMirrorIds([fx(1, 'a', 'x')], [fx(10, 'a', 'y')], 100, key)
    expect(map.get(1)).toBe(100)
  })
})
