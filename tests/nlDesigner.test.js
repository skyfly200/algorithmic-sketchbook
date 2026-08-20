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
