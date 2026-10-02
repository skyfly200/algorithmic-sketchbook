import { describe, it, expect } from 'vitest'
import { diagnoseDeck, sortIssues, problemCount, worstByNode, issueSignature, runtimeIssue, RUNTIME_CODES } from '../src/lib/patch/diagnostics.js'

const SKETCHES = { plasma: { title: 'Plasma', isFilter: false }, blur: { title: 'Blur', isFilter: true } }
const baseCtx = (over = {}) => ({
  sketchOf: (slug) => SKETCHES[slug] ?? null,
  mediaReady: true,
  mediaExists: (id) => id === 1,
  cameraOn: true,
  screenOn: true,
  micOn: true,
  schemaOf: () => null,
  hasImage: (n) => n.params?.mediaId === 1 || !!n.params?.src,
  ...over,
})
const node = (id, type, params = {}, extra = {}) => ({ id, type, x: 0, y: 0, params, ...extra })
const edge = (from, to, port = 0) => ({ from, to, port })
const codes = (issues) => issues.map((i) => i.code).sort()
const run = (nodes, edges = [], links = [], ctx = baseCtx(), extra = {}) => diagnoseDeck({ nodes, edges, links, ...extra }, ctx)

// a healthy patch: plasma -> blur -> output
const healthy = () => ({
  nodes: [node(1, 'effect', { slug: 'plasma' }), node(2, 'filter', { slug: 'blur' }), node(3, 'output')],
  edges: [edge(1, 2), edge(2, 3)],
})

describe('a healthy patch', () => {
  it('has no problems', () => {
    const { nodes, edges } = healthy()
    expect(run(nodes, edges)).toEqual([])
  })
  it('an empty deck has none either', () => expect(run([])).toEqual([]))
  it('a feedback cycle is a feature, not a problem', () => {
    const nodes = [node(1, 'effect', { slug: 'plasma' }), node(2, 'blend', { mode: 'screen' }), node(3, 'output')]
    const edges = [edge(1, 2, 0), edge(2, 2, 1), edge(2, 3)]
    expect(codes(run(nodes, edges))).toEqual([])
  })
})

describe('the Output', () => {
  it('flags a patch with no Output, and offers the only loose node', () => {
    const r = run([node(1, 'effect', { slug: 'plasma' })])
    const i = r.find((x) => x.code === 'NO_OUTPUT')
    expect(i.severity).toBe('error')
    expect(i.fix).toMatch(/monitor button/i)
    expect(i.action).toMatchObject({ type: 'addOutput', connectFrom: 1 })
  })
  it('does not guess when several nodes are loose', () => {
    const r = run([node(1, 'effect', { slug: 'plasma' }), node(2, 'effect', { slug: 'plasma' })])
    expect(r.find((x) => x.code === 'NO_OUTPUT').action.connectFrom).toBeNull()
  })
  it('does not nag about unconnected nodes while there is no Output', () => {
    expect(codes(run([node(1, 'effect', { slug: 'plasma' })]))).toEqual(['NO_OUTPUT'])
  })
  it('flags an Output with nothing wired in, offering the one loose node', () => {
    const r = run([node(1, 'effect', { slug: 'plasma' }), node(3, 'output')])
    const i = r.find((x) => x.code === 'OUTPUT_EMPTY')
    expect(i).toMatchObject({ severity: 'error', nodeId: 3 })
    expect(i.action).toMatchObject({ type: 'connect', from: 1, to: 3, port: 0 })
  })
  it('flags a second Output as a warning', () => {
    const { nodes, edges } = healthy()
    const r = run([...nodes, node(4, 'output')], [...edges, edge(2, 4)])
    expect(r.find((x) => x.code === 'MULTIPLE_OUTPUTS')).toMatchObject({ severity: 'warning', nodeId: 4 })
  })
})

describe('reaching the Output', () => {
  it('notes a branch that does not lead anywhere as info only', () => {
    const { nodes, edges } = healthy()
    const r = run([...nodes, node(4, 'effect', { slug: 'plasma' })], edges)
    expect(r.find((x) => x.code === 'NOT_CONNECTED')).toMatchObject({ severity: 'info', nodeId: 4 })
    expect(problemCount(r)).toBe(0)
  })
  it('tells a covered layer apart from an unconnected one', () => {
    const nodes = [node(1, 'effect', { slug: 'plasma' }), node(2, 'effect', { slug: 'plasma' }), node(3, 'blend', { mode: 'normal', mix: 1 }), node(4, 'output')]
    const edges = [edge(1, 3, 0), edge(2, 3, 1), edge(3, 4)]
    const r = run(nodes, edges)
    expect(r.find((x) => x.code === 'HIDDEN_BEHIND')).toMatchObject({ severity: 'warning', nodeId: 1 })
    expect(r.some((x) => x.code === 'NOT_CONNECTED')).toBe(false)
  })
  it('does not call a control node unconnected', () => {
    const { nodes, edges } = healthy()
    const r = run([...nodes, node(5, 'input', { source: 'mouse.x' })], edges)
    expect(r.some((x) => x.nodeId === 5)).toBe(false)
  })
})

describe('required inputs', () => {
  const withOutput = (n, ins = []) => ({ nodes: [n, node(9, 'output')], edges: [...ins, edge(n.id, 9)] })
  it('filter with no input shows a demo picture', () => {
    const { nodes, edges } = withOutput(node(2, 'filter', { slug: 'blur' }))
    const i = run(nodes, edges).find((x) => x.code === 'FILTER_NO_INPUT')
    expect(i.severity).toBe('warning')
    expect(i.message).toMatch(/demo picture/)
  })
  it('portal with no input', () => {
    const { nodes, edges } = withOutput(node(2, 'portal'))
    expect(run(nodes, edges).find((x) => x.code === 'PORTAL_NO_INPUT').severity).toBe('warning')
  })
  it('mask: no content is an error, no matte a warning', () => {
    let { nodes, edges } = withOutput(node(2, 'mask'))
    expect(run(nodes, edges).find((x) => x.code === 'MASK_NO_CONTENT').severity).toBe('error')
    nodes = [...nodes, node(1, 'effect', { slug: 'plasma' })]
    edges = [...edges, edge(1, 2, 0)]
    expect(run(nodes, edges).find((x) => x.code === 'MASK_NO_MATTE').severity).toBe('warning')
  })
  it('blend: empty is a warning, one layer is info', () => {
    let { nodes, edges } = withOutput(node(2, 'blend', { mode: 'screen' }))
    expect(run(nodes, edges).find((x) => x.code === 'BLEND_EMPTY').severity).toBe('warning')
    nodes = [...nodes, node(1, 'effect', { slug: 'plasma' })]
    edges = [...edges, edge(1, 2, 0)]
    expect(run(nodes, edges).find((x) => x.code === 'BLEND_ONE_LAYER').severity).toBe('info')
  })
  it('camera with no geometry, and geometry with no camera', () => {
    let { nodes, edges } = withOutput(node(2, 'vcam'))
    expect(run(nodes, edges).find((x) => x.code === 'CAMERA_NO_GEOMETRY').severity).toBe('warning')
    nodes = [...nodes, node(1, 'geo')]
    edges = [...edges, edge(1, 2, 0)]
    expect(run(nodes, edges).some((x) => x.code === 'CAMERA_NO_GEOMETRY')).toBe(false)
    const lone = withOutput(node(2, 'effect', { slug: 'plasma' }))
    expect(run([...lone.nodes, node(7, 'geo')], lone.edges).find((x) => x.code === 'NOT_CONNECTED')).toBeTruthy()
  })
})

describe('sketches', () => {
  const alone = (n) => ({ nodes: [n, node(9, 'output')], edges: [edge(n.id, 9)] })
  it('an empty sketch slot', () => {
    const { nodes, edges } = alone(node(1, 'effect', { slug: '' }))
    expect(run(nodes, edges).find((x) => x.code === 'SKETCH_NONE').severity).toBe('error')
  })
  it('a sketch that is not in this version', () => {
    const { nodes, edges } = alone(node(1, 'effect', { slug: 'gone-sketch' }))
    const i = run(nodes, edges).find((x) => x.code === 'SKETCH_MISSING')
    expect(i.message).toMatch(/gone-sketch/)
    expect(i.fix).toMatch(/dropdown/)
  })
  it('a filter in an Effect node, and a generator in a Filter node', () => {
    let { nodes, edges } = alone(node(1, 'effect', { slug: 'blur' }))
    expect(run(nodes, edges).find((x) => x.code === 'KIND_MISMATCH').title).toMatch(/filter in an Effect/i)
    ;({ nodes, edges } = alone(node(1, 'filter', { slug: 'plasma' })))
    const r = run([...nodes, node(5, 'effect', { slug: 'plasma' })], [...edges, edge(5, 1)])
    expect(r.find((x) => x.code === 'KIND_MISMATCH').title).toMatch(/generator in a Filter/i)
  })
})

describe('media', () => {
  const alone = (n) => ({ nodes: [n, node(9, 'output')], edges: [edge(n.id, 9)] })
  it('library mode with no clip', () => {
    const { nodes, edges } = alone(node(1, 'media', { mode: 'library', mediaId: null }))
    const i = run(nodes, edges).find((x) => x.code === 'MEDIA_NOT_CHOSEN')
    expect(i).toMatchObject({ severity: 'error', action: { type: 'import' } })
  })
  it('a clip that is gone from the library', () => {
    const { nodes, edges } = alone(node(1, 'media', { mode: 'library', mediaId: 99 }))
    expect(run(nodes, edges).find((x) => x.code === 'MEDIA_MISSING').message).toMatch(/clearing site data/)
  })
  it('does not call a clip missing before the library has loaded', () => {
    const { nodes, edges } = alone(node(1, 'media', { mode: 'library', mediaId: 99 }))
    expect(run(nodes, edges, [], baseCtx({ mediaReady: false }))).toEqual([])
  })
  it('a clip that exists is fine', () => {
    const { nodes, edges } = alone(node(1, 'media', { mode: 'library', mediaId: 1 }))
    expect(run(nodes, edges)).toEqual([])
  })
  it('camera and screen sources that are off', () => {
    let { nodes, edges } = alone(node(1, 'media', { mode: 'camera' }))
    expect(run(nodes, edges, [], baseCtx({ cameraOn: false })).find((x) => x.code === 'CAMERA_OFF').action.type).toBe('toggleCamera')
    ;({ nodes, edges } = alone(node(1, 'media', { mode: 'screen' })))
    expect(run(nodes, edges, [], baseCtx({ screenOn: false })).find((x) => x.code === 'SCREEN_NOT_SHARED').severity).toBe('warning')
  })
  it('a sprite with no image', () => {
    let { nodes, edges } = alone(node(1, 'sprite', { mediaId: null }))
    expect(run(nodes, edges).find((x) => x.code === 'SPRITE_NO_IMAGE').severity).toBe('error')
    ;({ nodes, edges } = alone(node(1, 'sprite', { src: 'data:image/png;base64,AAAA' })))
    expect(run(nodes, edges)).toEqual([])
  })
})

describe('control wires', () => {
  const { nodes, edges } = healthy()
  const ctrl = node(5, 'input', { source: 'audio.volume' })
  it('a wire to a parameter the sketch no longer has', () => {
    const links = [{ from: 5, srcPort: 0, node: 1, param: 'oldParam' }]
    const ctx = baseCtx({ schemaOf: (id) => (id === 1 ? new Set(['speed']) : null) })
    const i = run([...nodes, ctrl], edges, links, ctx).find((x) => x.code === 'LINK_PARAM_GONE')
    expect(i.message).toMatch(/oldParam/)
    expect(i.action).toMatchObject({ type: 'removeLink', link: links[0] })
  })
  it('does not judge a wire before the sketch has announced its parameters', () => {
    const links = [{ from: 5, srcPort: 0, node: 1, param: 'oldParam' }]
    expect(run([...nodes, ctrl], edges, links, baseCtx({ schemaOf: () => null })).some((x) => x.code === 'LINK_PARAM_GONE')).toBe(false)
  })
  it('checks operator nodes against their known parameters', () => {
    const blend = [node(1, 'effect', { slug: 'plasma' }), node(2, 'effect', { slug: 'plasma' }), node(3, 'blend', { mode: 'screen' }), node(4, 'output')]
    const e = [edge(1, 3, 0), edge(2, 3, 1), edge(3, 4)]
    const ok = run([...blend, ctrl], e, [{ from: 5, srcPort: 0, node: 3, param: 'mix' }])
    const bad = run([...blend, ctrl], e, [{ from: 5, srcPort: 0, node: 3, param: 'nope' }])
    expect(ok.some((x) => x.code === 'LINK_PARAM_GONE')).toBe(false)
    expect(bad.some((x) => x.code === 'LINK_PARAM_GONE')).toBe(true)
  })
  it('an audio input needs the microphone, but only when it is used', () => {
    const links = [{ from: 5, srcPort: 0, node: 3, param: 'mix' }]
    const blend = [node(1, 'effect', { slug: 'plasma' }), node(2, 'effect', { slug: 'plasma' }), node(3, 'blend', { mode: 'screen' }), node(4, 'output')]
    const e = [edge(1, 3, 0), edge(2, 3, 1), edge(3, 4)]
    const off = baseCtx({ micOn: false })
    expect(run([...blend, ctrl], e, links, off).find((x) => x.code === 'INPUT_NEEDS_MIC').action.type).toBe('toggleMic')
    expect(run([...blend, ctrl], e, [], off).some((x) => x.code === 'INPUT_NEEDS_MIC')).toBe(false)
    expect(run([...blend, ctrl], e, links, baseCtx({ micOn: true })).some((x) => x.code === 'INPUT_NEEDS_MIC')).toBe(false)
  })
})

describe('unknown nodes', () => {
  it('flags a node type from another version', () => {
    const { nodes, edges } = healthy()
    const i = run([...nodes, node(8, 'hologram')], edges).find((x) => x.code === 'UNKNOWN_NODE')
    expect(i).toMatchObject({ severity: 'error', nodeId: 8, action: { type: 'removeNode', nodeId: 8 } })
  })
})

describe('deck labels', () => {
  it('names the deck when asked and records its index', () => {
    const r = run([node(1, 'effect', { slug: 'plasma' })], [], [], baseCtx(), { deckIdx: 1, deckName: 'B' })
    expect(r[0].message).toMatch(/deck B/)
    expect(r[0].deck).toBe(1)
  })
})

describe('helpers', () => {
  const sample = [
    { key: 'a', code: 'A', severity: 'info', nodeId: 5, message: 'm' },
    { key: 'b', code: 'B', severity: 'error', nodeId: 7, message: 'm' },
    { key: 'c', code: 'C', severity: 'warning', nodeId: 5, message: 'm' },
    { key: 'd', code: 'D', severity: 'error', nodeId: 5, message: 'm' },
  ]
  it('sorts errors first, then by node', () => expect(sortIssues(sample).map((i) => i.key)).toEqual(['d', 'b', 'c', 'a']))
  it('counts only errors and warnings', () => expect(problemCount(sample)).toBe(3))
  it('finds the worst severity per node', () => {
    const m = worstByNode(sample)
    expect(m.get(5)).toBe('error')
    expect(m.get(7)).toBe('error')
  })
  it('changes signature when a message changes', () => {
    expect(issueSignature(sample)).toBe(issueSignature([...sample]))
    expect(issueSignature(sample)).not.toBe(issueSignature(sample.map((i) => ({ ...i, message: 'x' }))))
  })
})

describe('runtime issues', () => {
  it('every code produces a message and a fix', () => {
    for (const code of RUNTIME_CODES) {
      const i = runtimeIssue(code, { nodeId: 4, label: 'Plasma', detail: code === 'PRUNED_WIRES' ? 2 : 'boom', seconds: 25 })
      expect(i.title.length).toBeGreaterThan(3)
      expect(i.message.length).toBeGreaterThan(20)
      expect(i.fix.length).toBeGreaterThan(20)
      expect(['error', 'warning']).toContain(i.severity)
      expect(i.runtime).toBe(true)
    }
  })
  it('keys are stable per node and code', () => {
    expect(runtimeIssue('SKETCH_ERROR', { nodeId: 4 }).key).toBe(runtimeIssue('SKETCH_ERROR', { nodeId: 4, detail: 'other' }).key)
    expect(runtimeIssue('SKETCH_ERROR', { nodeId: 4 }).key).not.toBe(runtimeIssue('SKETCH_ERROR', { nodeId: 5 }).key)
  })
  it('permission problems offer to try again', () => {
    expect(runtimeIssue('CAMERA_DENIED').action.type).toBe('toggleCamera')
    expect(runtimeIssue('MIC_DENIED').action.type).toBe('toggleMic')
  })
  it('rejects an unknown code', () => expect(() => runtimeIssue('NOPE')).toThrow())
  it('pluralises the pruned-wires notice', () => {
    expect(runtimeIssue('PRUNED_WIRES', { detail: 1 }).message).toMatch(/1 wire pointed/)
    expect(runtimeIssue('PRUNED_WIRES', { detail: 3 }).message).toMatch(/3 wires pointed/)
  })
})
