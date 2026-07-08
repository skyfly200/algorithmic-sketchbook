import { defineStore } from 'pinia'
import { allSketches } from '../registry'

export const useSketchStore = defineStore('sketches', {
  state: () => ({
    sketches: allSketches,
    search: '',
    selectedTags: [],
    typeFilter: 'all', // 'all' | 'local' | 'external'
  }),

  getters: {
    allTags(state) {
      const tags = new Set()
      for (const s of state.sketches) {
        for (const t of [...s.tags, ...s.tech]) tags.add(t)
      }
      return [...tags].sort()
    },

    filtered(state) {
      const q = state.search.trim().toLowerCase()
      return state.sketches.filter((s) => {
        if (state.typeFilter !== 'all' && s.type !== state.typeFilter) return false
        if (
          state.selectedTags.length &&
          !state.selectedTags.every((t) => s.tags.includes(t) || s.tech.includes(t))
        )
          return false
        if (q) {
          const haystack = [s.title, s.description, ...s.tags, ...s.tech].join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      })
    },
  },

  actions: {
    bySlug(slug) {
      return this.sketches.find((s) => s.slug === slug) ?? null
    },
    toggleTag(tag) {
      const i = this.selectedTags.indexOf(tag)
      i === -1 ? this.selectedTags.push(tag) : this.selectedTags.splice(i, 1)
    },
  },
})
