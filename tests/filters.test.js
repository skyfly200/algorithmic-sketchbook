import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FILTER_SLUGS, FILTER_SLUG_SET, CHAINABLE_SLUGS, isFilterSketch } from '../src/registry/filters.js'

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

describe('chainable filters', () => {
  const read = (slug) => readFileSync(resolve(__dirname, '..', 'sketches', slug, 'sketch.js'), 'utf8')
  it('are filters with no duplicates', () => {
    expect(CHAINABLE_SLUGS.length).toBe(new Set(CHAINABLE_SLUGS).size)
    for (const s of CHAINABLE_SLUGS) expect(FILTER_SLUG_SET.has(s), s).toBe(true)
  })
  it('are single-pass createGLFilter sketches with no extra GL state', () => {
    for (const s of CHAINABLE_SLUGS) {
      const src = read(s)
      expect(src, `${s} uses createGLFilter`).toMatch(/createGLFilter\(/)
      expect(src, `${s} has no addTexture`).not.toMatch(/addTexture\(/)
      expect(src, `${s} has no glpipe`).not.toMatch(/createGLPipe/)
      expect(src, `${s} reads canvas size directly`).not.toMatch(/canvas\.(width|height)/)
    }
  })
})
