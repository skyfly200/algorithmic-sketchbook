#!/usr/bin/env node
/**
 * Performance audit: runs every embedded sketch headless for a few seconds,
 * measures its real requestAnimationFrame rate at high quality, and scores
 * it 1-100 against a 60fps target. Results land in src/registry/perf.json,
 * which the gallery reads to show the grade bubble on each card.
 *
 * Scores are relative to the machine that ran the audit — re-run
 * `npm run perf` (dev server up) to regenerate on your own hardware.
 */
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// playwright as a project devDependency if present, else a global install
let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  const require = createRequire(import.meta.url)
  const globalRoot = `${process.execPath.replace(/\/bin\/node$/, '')}/lib/node_modules`
  ;({ chromium } = require(require.resolve('playwright', { paths: [globalRoot] })))
}

const BASE = process.env.PERF_BASE ?? 'http://localhost:5173'
const WARMUP_MS = 5000
const MEASURE_MS = 4000

const slugs = readdirSync('sketches', { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(`sketches/${d.name}/sketch.json`))
  .map((d) => d.name)
  .sort()

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

const scores = {}
for (const slug of slugs) {
  try {
    await page.goto(`${BASE}/sketches/${slug}/?quality=high`, { timeout: 15000 })
    await page.waitForTimeout(WARMUP_MS)
    const fps = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let frames = 0
          const t0 = performance.now()
          function tick() {
            frames++
            if (performance.now() - t0 < ms) requestAnimationFrame(tick)
            else resolve((frames * 1000) / (performance.now() - t0))
          }
          requestAnimationFrame(tick)
        }),
      MEASURE_MS,
    )
    scores[slug] = Math.max(1, Math.min(100, Math.round((fps / 60) * 100)))
    console.log(`${slug.padEnd(24)} ${fps.toFixed(1).padStart(6)} fps  → ${scores[slug]}`)
  } catch (e) {
    console.log(`${slug.padEnd(24)} FAILED: ${e.message.split('\n')[0]}`)
  }
}
await browser.close()

writeFileSync('src/registry/perf.json', JSON.stringify(scores, null, 2) + '\n')
console.log(`\nwrote src/registry/perf.json (${Object.keys(scores).length} sketches)`)
