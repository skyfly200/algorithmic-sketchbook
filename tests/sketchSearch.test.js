import { describe, it, expect } from 'vitest'
import { scoreSketch, searchSketches } from '../src/lib/sketchSearch.js'

const S = [
  { slug: 'blur', title: 'Blur', tags: ['optical'], tech: ['webgl'], description: 'Gaussian softening' },
  { slug: 'glow', title: 'Glow', tags: ['atmosphere'], tech: ['webgl'], description: 'Bloom around bright areas, a soft blur' },
  { slug: 'motion-blur', title: 'Motion Blur', tags: ['time'], tech: ['webgl'], description: '' },
  { slug: 'crt', title: 'CRT', tags: ['retro', 'stylize'], tech: ['webgl'], description: 'Old televisión screen' },
]

describe('sketch search', () => {
  it('returns everything for an empty query', () => {
    expect(searchSketches(S, '  ')).toEqual(S)
  })
  it('ranks title hits above description hits', () => {
    expect(searchSketches(S, 'blur').map((s) => s.slug)).toEqual(['blur', 'motion-blur', 'glow'])
  })
  it('requires every word to match', () => {
    expect(searchSketches(S, 'motion blur').map((s) => s.slug)).toEqual(['motion-blur'])
    expect(scoreSketch(S[0], 'blur retro')).toBe(0)
  })
  it('matches tags, slugs and accents, case-insensitively', () => {
    expect(searchSketches(S, 'RETRO').map((s) => s.slug)).toEqual(['crt'])
    expect(searchSketches(S, 'television').map((s) => s.slug)).toEqual(['crt'])
    expect(searchSketches(S, 'motion-').map((s) => s.slug)).toEqual(['motion-blur'])
  })
})
