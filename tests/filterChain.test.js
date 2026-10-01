import { describe, it, expect } from 'vitest'
import { findChains, chainIndex, makeChainCache } from '../src/lib/patch/filterChain.js'

const f = (id) => ({ id, type: 'filter', params: { slug: 'invert' } })
const x = (id, type = 'effect') => ({ id, type, params: {} })
const e = (from, to, port = 0) => ({ from, to, port })
const isChainable = (n) => n.type === 'filter'

describe('findChains', () => {
  it('finds a run of filters between an effect and the output', () => {
    const nodes = [x(1), f(2), f(3), f(4), x(5, 'output')]
    const edges = [e(1, 2), e(2, 3), e(3, 4), e(4, 5)]
    expect(findChains({ nodes, edges, isChainable })).toEqual([[2, 3, 4]])
  })

  it('ignores a lone filter', () => {
    const nodes = [x(1), f(2), x(3, 'output')]
    expect(findChains({ nodes, edges: [e(1, 2), e(2, 3)], isChainable })).toEqual([])
  })

  it('ends the chain where an intermediate picture has a second consumer', () => {
    const nodes = [x(1), f(2), f(3), f(4), x(5, 'output'), x(6, 'output')]
    const edges = [e(1, 2), e(2, 3), e(3, 4), e(3, 6), e(4, 5)] // 3 also feeds 6, so 3 is a tail
    expect(findChains({ nodes, edges, isChainable })).toEqual([[2, 3]])
  })

  it('splits at a non-chainable filter', () => {
    const nodes = [x(1), f(2), f(3), x(4, 'blend'), f(5), f(6), x(7, 'output')]
    const edges = [e(1, 2), e(2, 3), e(3, 4), e(4, 5), e(5, 6), e(6, 7)]
    expect(findChains({ nodes, edges, isChainable })).toEqual([[2, 3], [5, 6]])
  })

  it('does not chain into a second port', () => {
    const nodes = [x(1), x(2), f(3), x(4, 'blend')]
    const edges = [e(1, 3), e(3, 4, 1), e(2, 4)]
    expect(findChains({ nodes, edges, isChainable })).toEqual([])
  })

  it('refuses a node with a second input', () => {
    const nodes = [x(1), x(2), f(3), f(4)]
    const edges = [e(1, 3), e(3, 4), e(2, 4, 1)]
    expect(findChains({ nodes, edges, isChainable })).toEqual([])
  })

  it('terminates on a cycle', () => {
    const nodes = [f(1), f(2)]
    expect(() => findChains({ nodes, edges: [e(1, 2), e(2, 1)], isChainable })).not.toThrow()
    expect(findChains({ nodes: [f(1)], edges: [e(1, 1)], isChainable })).toEqual([])
  })

  it('ignores edges to nodes that are not in the deck', () => {
    const nodes = [f(1), f(2)]
    expect(findChains({ nodes, edges: [e(1, 2), e(2, 99)], isChainable })).toEqual([[1, 2]])
  })
})

describe('chainIndex', () => {
  it('maps each member to its chain and position', () => {
    const idx = chainIndex([[2, 3, 4]])
    expect(idx.get(3).index).toBe(1)
    expect(idx.get(4).chain).toEqual([2, 3, 4])
    expect(idx.has(9)).toBe(false)
  })
})

describe('makeChainCache', () => {
  it('recomputes only when wiring or chainability changes', () => {
    const cache = makeChainCache()
    const nodes = [f(1), f(2)]
    const edges = [e(1, 2)]
    const a = cache(nodes, edges, isChainable)
    expect(cache(nodes, edges, isChainable)).toBe(a)
    expect(a.chains).toEqual([[1, 2]])
    const b = cache(nodes, edges, (n) => n.id !== 2)
    expect(b).not.toBe(a)
    expect(b.chains).toEqual([])
    expect(cache(nodes, [], isChainable).chains).toEqual([])
  })
})
