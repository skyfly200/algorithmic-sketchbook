// Shared filter chains. Framework-free, so it can be tested on its own.
//
// Consecutive shader filters in a deck (A -> B -> C, each feeding only the next)
// can run as one GL pipeline in the compositor instead of one iframe plus one
// bitmap transfer each. This module only finds the runs; chainRunner.js draws them.
//
// A node joins a chain when `isChainable(node)` says so. An interior link a -> b
// must be the only edge leaving a and the only edge entering b, so no other node
// (Output, a Blend, a second filter) needs a's intermediate picture.

/**
 * @returns Array of chains, each an array of node ids from head to tail, length >= 2.
 */
export function findChains({ nodes, edges, isChainable }) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outs = new Map()
  const ins = new Map()
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    ;(outs.get(e.from) ?? outs.set(e.from, []).get(e.from)).push(e)
    ;(ins.get(e.to) ?? ins.set(e.to, []).get(e.to)).push(e)
  }
  const can = (id) => !!byId.get(id) && isChainable(byId.get(id))
  // The node that follows `id` in a chain, or null.
  const nextOf = (id) => {
    const o = outs.get(id)
    if (!o || o.length !== 1) return null
    const e = o[0]
    if (e.port !== 0 || e.to === id || !can(e.to) || ins.get(e.to).length !== 1) return null
    return e.to
  }
  const hasPrev = new Set()
  for (const n of nodes) if (can(n.id)) { const nx = nextOf(n.id); if (nx != null) hasPrev.add(nx) }

  const chains = []
  const seen = new Set()
  for (const n of nodes) {
    if (!can(n.id) || hasPrev.has(n.id) || seen.has(n.id)) continue
    const chain = [n.id]
    seen.add(n.id)
    for (let nx = nextOf(n.id); nx != null && !seen.has(nx); nx = nextOf(nx)) { chain.push(nx); seen.add(nx) }
    if (chain.length >= 2) chains.push(chain)
  }
  return chains
}

/** Map of node id -> { chain, index } for every node that sits in a chain. */
export function chainIndex(chains) {
  const m = new Map()
  for (const chain of chains) chain.forEach((id, index) => m.set(id, { chain, index }))
  return m
}

/**
 * Memoised findChains + chainIndex, one per deck. Like the topo-order cache it
 * keys on a cheap O(V + E) signature, so chains are recomputed only when the
 * wiring (or a node's chainability) changes.
 */
export function makeChainCache() {
  let sig = ''
  let value = { chains: [], index: new Map() }
  return (nodes, edges, isChainable) => {
    let s = ''
    for (const n of nodes) s += n.id + (isChainable(n) ? '+' : '-') + ','
    s += '|'
    for (const e of edges) s += e.from + '>' + e.to + ':' + e.port + ','
    if (s !== sig) {
      sig = s
      const chains = findChains({ nodes, edges, isChainable })
      value = { chains, index: chainIndex(chains) }
    }
    return value
  }
}

/** Ids of every chain member, and of just the heads, for the cost model. */
export function chainSets(index) {
  const members = new Set(index.keys())
  const heads = new Set()
  for (const [id, c] of index) if (c.index === 0) heads.add(id)
  return { members, heads }
}

/**
 * Scheduler hooks that treat a chain as one unit. Only the tail's rate gates the
 * chain (interior members just stream uniforms), so stepping an interior member
 * down saves no GPU time and only makes its params stutter. The tail is charged
 * the whole chain's cost so it is stepped down at the right priority.
 */
export function chainSchedule(index, { costOf = () => 1, throttleable = () => true } = {}) {
  const isTail = (c) => c.index === c.chain.length - 1
  return {
    costOf: (id) => {
      const c = index.get(id)
      return c && isTail(c) ? c.chain.reduce((sum, m) => sum + costOf(m), 0) : costOf(id)
    },
    throttleable: (id) => {
      const c = index.get(id)
      return (!c || isTail(c)) && throttleable(id)
    },
  }
}
