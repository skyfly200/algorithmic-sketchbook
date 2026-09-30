// Patch Autopilot's crossfade path (src/composables/useAutopilot.js): with the
// two-deck console on, a move is built on the off-air deck and faded in live
// instead of editing the on-air graph in place.
import { describe, it, expect, vi } from 'vitest'
import { useAutopilot } from '../src/composables/useAutopilot.js'

function setup({ decksOn = false, busy = false } = {}) {
  const nodes = [
    { id: 1, type: 'effect', params: { slug: 'a' } },
    { id: 2, type: 'output', params: {} },
  ]
  const calls = { cross: 0, fadeBack: 0, undo: 0, random: 0 }
  const flags = { decksOn, busy, canBack: true }
  const ctx = {
    nodes, edges: [{ from: 1, to: 2, port: 0 }],
    TYPES: { effect: { ins: 0 }, output: { ins: 1 } }, BLENDS: [],
    fps: () => 60,
    slugPool: () => [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }],
    slugCost: () => 1, graphCost: () => 1, persist: () => {},
    randomPatch: () => { calls.random++ }, rerollUpstream: () => {},
    undo: () => { calls.undo++ },
    decksOn: () => flags.decksOn,
    busy: () => flags.busy,
    crossfadeMove: vi.fn(async (move) => { calls.cross++; move(); return true }),
    canFadeBack: () => flags.canBack,
    fadeBack: () => { calls.fadeBack++ },
  }
  const ap = useAutopilot(ctx)
  ap.state.on = true
  return { ap, ctx, nodes, calls, flags }
}

describe('autopilot crossfaded moves', () => {
  it('edits the graph in place when the decks are off', async () => {
    const { ap, ctx, nodes } = setup({ decksOn: false })
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5) // → the 'swap' move, pool[1] = 'b'
    await ap.step()
    rnd.mockRestore()
    expect(ctx.crossfadeMove).not.toHaveBeenCalled()
    expect(nodes[0].params.slug).toBe('b') // swapped directly, on the graph in scope
  })
  it('hands the move to the off-air deck when the decks are on', async () => {
    const { ap, ctx } = setup({ decksOn: true })
    await ap.step()
    expect(ctx.crossfadeMove).toHaveBeenCalledTimes(1)
    const [move, secs] = ctx.crossfadeMove.mock.calls[0]
    expect(typeof move).toBe('function')
    expect(secs).toBe(ap.state.fadeSecs)
  })
  it('skips a tick while a fade or a move is still in flight (no stacking)', async () => {
    const { ap, ctx } = setup({ decksOn: true, busy: true })
    await ap.step()
    expect(ctx.crossfadeMove).not.toHaveBeenCalled()
  })
  it('falls back to in-place moves when crossfade is switched off', async () => {
    const { ap, ctx } = setup({ decksOn: true })
    ap.state.crossfade = false
    await ap.step()
    expect(ctx.crossfadeMove).not.toHaveBeenCalled()
  })
  it('does nothing while autopilot is off', async () => {
    const { ap, ctx } = setup({ decksOn: true })
    ap.state.on = false
    await ap.step()
    expect(ctx.crossfadeMove).not.toHaveBeenCalled()
  })
  it('previous fades back to the prior look with decks, else undoes', () => {
    const a = setup({ decksOn: true })
    a.ap.prev()
    expect(a.calls.fadeBack).toBe(1); expect(a.calls.undo).toBe(0)
    const b = setup({ decksOn: true }); b.flags.canBack = false
    b.ap.prev()
    expect(b.calls.undo).toBe(1)
    const c = setup({ decksOn: false })
    c.ap.prev()
    expect(c.calls.undo).toBe(1)
  })
  it('a full reroll is also a crossfade with decks on', () => {
    const { ap, ctx, calls } = setup({ decksOn: true })
    ap.reroll()
    expect(ctx.crossfadeMove).toHaveBeenCalledTimes(1)
    expect(calls.random).toBe(1) // the reroll runs inside the move
  })
})
