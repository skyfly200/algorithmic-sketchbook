import { defineStore } from 'pinia'

const STORAGE_KEY = 'sketchbook-viewer-settings'

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

// Display settings for embedded sketches, persisted across visits and passed
// to each sketch via query params (read by sketches/_lib/runtime.js).
export const useViewerStore = defineStore('viewer', {
  state: () => ({
    showFps: load().showFps ?? false,
    quality: load().quality ?? 'native',
  }),

  getters: {
    // Query string appended to local sketch URLs.
    sketchParams(state) {
      const params = new URLSearchParams()
      if (state.showFps) params.set('fps', '1')
      if (state.quality !== 'native') params.set('quality', state.quality)
      const qs = params.toString()
      return qs ? `?${qs}` : ''
    },
  },

  actions: {
    update(patch) {
      Object.assign(this, patch)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ showFps: this.showFps, quality: this.quality }),
      )
    },
  },
})

export const QUALITY_OPTIONS = [
  { value: 'low', title: 'Low — ½ resolution', subtitle: 'Smoothest' },
  { value: 'medium', title: 'Medium — ¾ resolution', subtitle: '' },
  { value: 'high', title: 'High — 1× resolution', subtitle: '' },
  { value: 'native', title: 'Native — device pixel ratio', subtitle: 'Sharpest' },
]
