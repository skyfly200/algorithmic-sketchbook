import { defineConfig } from 'vitest/config'

// A standalone test config (not the app's vite.config.js) so the unit tests run
// in a plain Node environment without the multi-page sketch build, the Vue /
// Vuetify plugins, or the git-walking virtual-module plugins. The tests cover
// the framework-free logic extracted out of the views into src/lib + the pure
// store logic.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
})
