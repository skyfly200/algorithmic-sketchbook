import { describe, it, expect } from 'vitest'
import { FILTER_SLUGS, FILTER_SLUG_SET, isFilterSketch } from '../src/registry/filters.js'

describe('filter registry', () => {
  it('the slug list and set agree', () => {
    expect(FILTER_SLUG_SET.size).toBe(new Set(FILTER_SLUGS).size)
    for (const s of FILTER_SLUGS) expect(FILTER_SLUG_SET.has(s)).toBe(true)
  })
  it('has no duplicate slugs', () => {
    expect(FILTER_SLUGS.length).toBe(new Set(FILTER_SLUGS).size)
  })
  it('classifies a known filter and a non-filter', () => {
    expect(isFilterSketch({ slug: 'blur' })).toBe(true)
    expect(isFilterSketch({ slug: 'microbes' })).toBe(false)
    expect(isFilterSketch(null)).toBe(false)
  })
})
