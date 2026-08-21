import { describe, it, expect } from 'vitest'
import { nlHas, hueHex, parseDesignerIntent } from '../src/lib/nlDesigner.js'

// A tiny stand-in catalog mirroring the shape the designer matches against.
const EFFECTS = [
  { slug: 'kaleidoscope', title: 'Kaleidoscope', description: 'mirror symmetry wedges', tags: ['geometric'] },
  { slug: 'microbes', title: 'Microbes', description: 'diatoms algae bacteria slide', tags: ['organic'] },
  { slug: 'fireflies', title: 'Fireflies', description: 'glowing insects at night', tags: ['nature'] },
]
const FILTERS = [
  { slug: 'glow', title: 'Glow', description: 'soft bloom halo', tags: [] },
  { slug: 'channel-offset', title: 'Channel Offset', description: 'rgb split chromatic', tags: [] },
]

describe('nlHas', () => {
  it('matches on word boundaries only', () => {
    expect(nlHas('a swirly glow', 'glow')).toBeGreaterThanOrEqual(0)
    expect(nlHas('glowing embers', 'glow')).toBe(-1) // "glowing" is not "glow"
    expect(nlHas('x', 'x')).toBe(-1) // too short
  })
})

describe('hueHex', () => {
  it('produces expected primaries', () => {
    expect(hueHex(0, 100, 100)).toBe('#ff0000')
    expect(hueHex(120, 100, 100)).toBe('#00ff00')
    expect(hueHex(240, 100, 100)).toBe('#0000ff')
  })
  it('wraps negative/large hues', () => {
    expect(hueHex(360, 100, 100)).toBe('#ff0000')
    expect(hueHex(-120, 100, 100)).toBe('#0000ff')
  })
})

describe('parseDesignerIntent', () => {
  it('matches an effect by name', () => {
    const it2 = parseDesignerIntent('a kaleidoscope', EFFECTS, FILTERS)
    expect(it2.effects.map((e) => e.slug)).toContain('kaleidoscope')
  })
  it('finds a sketch through a synonym', () => {
    const it2 = parseDesignerIntent('lots of diatoms under the microscope', EFFECTS, FILTERS)
    expect(it2.effects.map((e) => e.slug)).toContain('microbes')
  })
  it('extracts quoted caption text and does not leak its words into matching', () => {
    const it2 = parseDesignerIntent('the text "GLOW UP" over a kaleidoscope', EFFECTS, FILTERS)
    expect(it2.text.on).toBe(true)
    expect(it2.text.content).toBe('GLOW UP')
    // "GLOW" inside the caption must not pull in the glow filter
    expect(it2.filters.map((f) => f.slug)).not.toContain('glow')
  })
  it('detects camera, audio and blend requests', () => {
    const it2 = parseDesignerIntent('kaleidoscope on my webcam, react to the beat, additive', EFFECTS, FILTERS)
    expect(it2.camera).toBe(true)
    expect(it2.audio).toBe(true)
    expect(it2.blend).toBe('add')
  })
  it('reads adjective mods and a colour', () => {
    const it2 = parseDesignerIntent('a fast intense blue kaleidoscope', EFFECTS, FILTERS)
    expect(it2.mods.speed).toBe(1)
    expect(it2.mods.amount).toBe(1)
    expect(it2.color?.name).toBe('blue')
  })
  it('matches vibe-only prompts through mood keywords', () => {
    const it2 = parseDesignerIntent('something dreamy and soft', EFFECTS, FILTERS)
    expect(it2.filters.map((f) => f.slug)).toContain('glow')
  })
  it('is deterministic', () => {
    const a = parseDesignerIntent('fast blue kaleidoscope', EFFECTS, FILTERS)
    const b = parseDesignerIntent('fast blue kaleidoscope', EFFECTS, FILTERS)
    expect(a).toEqual(b)
  })
})

// --- AI smart-mode helpers --------------------------------------------------
import { nlNum, specNodeParams, callDesignerAI, NL_SYSTEM_PROMPT } from '../src/lib/nlDesigner.js'

const CTX = {
  effectSlugs: new Set(['kaleidoscope', 'microbes']),
  filterSlugs: new Set(['glow']),
  inputSlugs: new Set(['audio.pulse', 'audio.volume']),
  blends: ['screen', 'add', 'multiply'],
  polyShapes: { Triangle: [[0.5, 0.1], [0.9, 0.9], [0.1, 0.9]] },
  fallbackEffect: 'kaleidoscope', fallbackFilter: 'glow',
  seed: () => 'SEED', nodeW: 190, thumbH: 107,
}

describe('nlNum', () => {
  it('clamps finite numbers and falls back for non-numbers', () => {
    expect(nlNum(5, 0, 0, 10)).toBe(5)
    expect(nlNum(-3, 0, 0, 10)).toBe(0)
    expect(nlNum(99, 0, 0, 10)).toBe(10)
    expect(nlNum('x', 7)).toBe(7)
    expect(nlNum(NaN, 7)).toBe(7)
    expect(nlNum(undefined, 7)).toBe(7)
  })
})

describe('specNodeParams (sanitize AI output)', () => {
  it('keeps a known effect/filter slug, falls back on an unknown one', () => {
    expect(specNodeParams({ type: 'effect', slug: 'microbes' }, CTX)).toEqual({ slug: 'microbes', seed: 'SEED' })
    expect(specNodeParams({ type: 'effect', slug: 'not-real' }, CTX).slug).toBe('kaleidoscope')
    expect(specNodeParams({ type: 'filter', slug: 'nope' }, CTX).slug).toBe('glow')
  })
  it('clamps blend mix and validates the mode', () => {
    expect(specNodeParams({ type: 'blend', mode: 'screen', mix: 5 }, CTX)).toEqual({ mode: 'screen', mix: 1 })
    expect(specNodeParams({ type: 'blend', mode: 'bogus' }, CTX).mode).toBe('screen')
  })
  it('clamps text fields into their ranges and coerces the string', () => {
    const p = specNodeParams({ type: 'text', text: 42, size: 9, weight: 50, hue: 400 }, CTX)
    expect(p.text).toBe('42')
    expect(p.size).toBe(0.6)   // clamped to max
    expect(p.weight).toBe(100) // clamped to min
    expect(p.hue).toBe(360)
  })
  it('falls back an unknown input source', () => {
    expect(specNodeParams({ type: 'input', source: 'audio.volume' }, CTX).source).toBe('audio.volume')
    expect(specNodeParams({ type: 'input', source: 'ghost' }, CTX).source).toBe('audio.pulse')
  })
  it('looks a polygon shape up by capitalized name, else a default box', () => {
    expect(specNodeParams({ type: 'polygon', shape: 'triangle' }, CTX).points).toHaveLength(3)
    expect(specNodeParams({ type: 'polygon', shape: 'weird' }, CTX).points).toHaveLength(4)
  })
  it('honours the mask invert flag and returns {} for unknown types', () => {
    expect(specNodeParams({ type: 'mask', invert: true }, CTX).invert).toBe(true)
    expect(specNodeParams({ type: 'nonsense' }, CTX)).toEqual({})
  })
})

describe('callDesignerAI', () => {
  const catalog = { effects: [{ slug: 'a', title: 'A' }], filters: [{ slug: 'b', title: 'B' }], inputs: ['audio.pulse'] }
  it('sends the key/model/system and parses the JSON out of the reply', async () => {
    let seen = null
    const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ content: [{ text: 'here you go {"nodes":[{"type":"effect"}]} done' }] }) } }
    const spec = await callDesignerAI({ prompt: 'glow', apiKey: 'K', model: 'M', ...catalog, fetchImpl })
    expect(spec).toEqual({ nodes: [{ type: 'effect' }] })
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages')
    expect(seen.opts.headers['x-api-key']).toBe('K')
    const body = JSON.parse(seen.opts.body)
    expect(body.model).toBe('M')
    expect(body.system).toBe(NL_SYSTEM_PROMPT)
    expect(body.messages[0].content).toContain('a: A') // catalog embedded
  })
  it('throws the API error message on a non-ok response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) })
    await expect(callDesignerAI({ prompt: 'x', apiKey: 'K', model: 'M', ...catalog, fetchImpl })).rejects.toThrow('bad key')
  })
  it('throws when the reply has no JSON object', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ text: 'sorry, no' }] }) })
    await expect(callDesignerAI({ prompt: 'x', apiKey: 'K', model: 'M', ...catalog, fetchImpl })).rejects.toThrow('no JSON')
  })
})

import { resolveEffectMods } from '../src/lib/nlDesigner.js'
describe('resolveEffectMods (adjective/colour → effect params)', () => {
  it('pushes a matching numeric param toward its high end for a positive mod', () => {
    const schema = { speed: { min: 0, max: 10, label: 'Speed' } }
    const out = resolveEffectMods(schema, { speed: 1 }, null)
    expect(out).toEqual([['speed', 8]]) // min + 0.8*span
  })
  it('pushes toward the low end for a negative mod', () => {
    const out = resolveEffectMods({ speed: { min: 0, max: 10, label: 'Speed' } }, { speed: -1 }, null)
    expect(out).toEqual([['speed', 2]])
  })
  it('fills a colour-type param from the colour', () => {
    const out = resolveEffectMods({ tint: { type: 'color' } }, {}, { hue: 200, sat: 80, val: 90 })
    expect(out).toHaveLength(1)
    expect(out[0][0]).toBe('tint')
    expect(out[0][1]).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('sets an obvious hue param from a colour when no adjective claimed it', () => {
    // a degrees hue param (max ≤ 361) receives the raw hue…
    expect(resolveEffectMods({ hue: { min: 0, max: 360, label: 'Hue' } }, {}, { hue: 120, sat: 80, val: 90 })).toEqual([['hue', 120]])
    // …while a param whose range exceeds 361 is treated as a 0..1 turn fraction
    expect(resolveEffectMods({ hue: { min: 0, max: 720, label: 'Hue' } }, {}, { hue: 180, sat: 80, val: 90 })).toEqual([['hue', 0.5]])
  })
  it('ignores non-numeric params and empty schema', () => {
    expect(resolveEffectMods({ mode: { min: undefined } }, { speed: 1 }, null)).toEqual([])
    expect(resolveEffectMods(null, {}, null)).toEqual([])
  })
})
