import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Every sketches/<slug>/index.html becomes its own page in the build,
// so each sketch stays a self-contained app the gallery loads in an iframe.
function sketchInputs() {
  const root = resolve(__dirname, 'sketches')
  const inputs = { main: resolve(__dirname, 'index.html') }
  if (!existsSync(root)) return inputs
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const page = resolve(root, dir.name, 'index.html')
    if (existsSync(page)) inputs[`sketch-${dir.name}`] = page
  }
  return inputs
}

export default defineConfig({
  // Relative base so the built site works from any subpath (e.g. GitHub Pages).
  base: './',
  plugins: [vue(), vuetify({ autoImport: true })],
  build: {
    rollupOptions: {
      input: sketchInputs(),
    },
  },
})
