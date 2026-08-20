import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../src/stores/settings.js'

const KEY = 'sketchbook-settings'

describe('settings effect-pool model', () => {
  beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

  it('defaults to all effects enabled', () => {
    const s = useSettingsStore()
    expect(s.isEffectEnabled('anything')).toBe(true)
    expect(s.filterToPool([{ slug: 'a' }, { slug: 'b' }])).toHaveLength(2)
  })

  it('toggling an effect disables just that one', () => {
    const s = useSettingsStore()
    s.toggleEffect('crt', ['crt', 'glow'])
    expect(s.isEffectEnabled('crt')).toBe(false)
    expect(s.isEffectEnabled('glow')).toBe(true)
    // a newly-added effect not in the disabled set stays enabled
    expect(s.isEffectEnabled('brand-new')).toBe(true)
  })

  it('never strands the pool empty', () => {
    const s = useSettingsStore()
    s.toggleEffect('a', ['a'])
    // all disabled → filterToPool returns the original list rather than nothing
    expect(s.filterToPool([{ slug: 'a' }])).toHaveLength(1)
  })

  it('migrates a legacy inclusion list into the disabled set', () => {
    localStorage.setItem(KEY, JSON.stringify({ effectPool: ['keep'] }))
    setActivePinia(createPinia())
    const s = useSettingsStore()
    s.ensureMigrated(['keep', 'drop1', 'drop2'])
    expect(s.effectOff.sort()).toEqual(['drop1', 'drop2'])
    expect(s.isEffectEnabled('keep')).toBe(true)
    expect(s.isEffectEnabled('drop1')).toBe(false)
  })

  it('prunes disabled entries for effects that no longer exist', () => {
    const s = useSettingsStore()
    s.effectOff = ['gone', 'here']
    s.pruneEffectOff(new Set(['here']))
    expect(s.effectOff).toEqual(['here'])
  })

  it('persists favorites across store instances', () => {
    const s = useSettingsStore()
    s.toggleFavorite('microbes')
    expect(s.isFavorite('microbes')).toBe(true)
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.isFavorite('microbes')).toBe(true)
  })
})
