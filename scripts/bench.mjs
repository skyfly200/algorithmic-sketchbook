#!/usr/bin/env node
// Sketch benchmark: load each sketch page in a real browser, let it run, and
// report frame rate, per-frame main-thread JS time and how much of the frame is
// left for the GPU / compositor. Run it on the machine whose GPU you care about:
//
//   npm run build
//   npm run bench -- --filters --headed          # every filter, visible window
//   npm run bench -- blur crt halftone           # just these sketches
//   npm run bench -- --all --demo night-city --ms 4000 --out bench.json
//
// Options
//   <slug> ...        sketches to test (default: a representative set)
//   --all             every sketch in the gallery
//   --filters         every filter sketch (src/registry/filters.js)
//   --demo <name>     demo scene: landscape | test-chart | night-city (default landscape)
//   --ms <n>          measuring time per sketch (default 3000)
//   --size <WxH>      viewport (default 1280x720)
//   --quality <q>     low | medium | high | native (default high, like Patch)
//   --headed          show the browser (uses the real GPU path; recommended)
//   --chrome          drive the installed Google Chrome instead of Playwright's Chromium
//   --exe <path>      use this browser binary (or set PW_CHROMIUM); otherwise Playwright's own
//                     Chromium — install it once with `npx playwright install chromium`
//   --out <file>      also write the results as JSON
//
// "JS ms" is the page's main-thread script time per frame (what a CPU-bound
// sketch is paying). "Frame ms" is wall-clock time per animation frame; when it
// is much larger than JS ms the sketch is waiting on the GPU (fill-rate bound).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : dflt
}
const flag = (name) => args.includes('--' + name)
const valueFlags = new Set(['demo', 'ms', 'size', 'quality', 'out', 'exe'])
const slugsArg = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has((args[i - 1] || '').replace(/^--/, '')))

const DEFAULT_SET = [
  'blur', 'brightness-contrast', 'channel-offset', 'crt', 'halftone', 'kuwahara', 'pointillism', 'painterly',
  'vhs-defects', 'wind', 'ink-bleed', 'camera-lens', 'glow', 'ridgeline', 'fish-scales', 'glowing-coals',
]

function allSlugs() {
  return fs.readdirSync(path.join(root, 'sketches'))
    .filter((d) => fs.existsSync(path.join(root, 'sketches', d, 'sketch.json')))
    .filter((d) => !JSON.parse(fs.readFileSync(path.join(root, 'sketches', d, 'sketch.json'), 'utf8')).standalone)
}
async function filterSlugs() {
  const src = fs.readFileSync(path.join(root, 'src/registry/filters.js'), 'utf8')
  const body = src.slice(src.indexOf('['), src.indexOf(']'))
  return [...body.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
}

const slugs = slugsArg.length ? slugsArg : flag('all') ? allSlugs() : flag('filters') ? await filterSlugs() : DEFAULT_SET
const demo = opt('demo', 'landscape')
const ms = Number(opt('ms', 3000))
const [vw, vh] = opt('size', '1280x720').split('x').map(Number)
const quality = opt('quality', 'high')

if (!fs.existsSync(path.join(root, 'dist'))) {
  console.error('No dist/ folder — run `npm run build` first.')
  process.exit(1)
}

const server = await preview({ root, preview: { port: 0, open: false }, logLevel: 'silent' })
const base = server.resolvedUrls.local[0].replace(/\/$/, '')

const browser = await chromium.launch({
  headless: !flag('headed'),
  channel: flag('chrome') ? 'chrome' : undefined,
  executablePath: opt('exe', process.env.PW_CHROMIUM) || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
})

const results = []
for (const slug of slugs) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  try {
    await page.goto(`${base}/sketches/${slug}/index.html?demo=${demo}&quality=${quality}&preview=1&nomap=1`, { timeout: 20000 })
    await page.waitForTimeout(1200) // warm-up: shader compile, first frames
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    const m0 = await metrics()
    const frames = await page.evaluate((ms) => new Promise((res) => {
      let n = 0
      const t0 = performance.now()
      const f = () => { n++; if (performance.now() - t0 >= ms) res({ n, dt: performance.now() - t0 }); else requestAnimationFrame(f) }
      requestAnimationFrame(f)
    }), ms)
    const m1 = await metrics()
    const jsMs = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames.n
    const taskMs = ((m1.TaskDuration - m0.TaskDuration) * 1000) / frames.n
    results.push({ slug, fps: +(frames.n / (frames.dt / 1000)).toFixed(1), frameMs: +(frames.dt / frames.n).toFixed(2), jsMs: +jsMs.toFixed(2), taskMs: +taskMs.toFixed(2), errors: errors.length ? errors : undefined })
  } catch (e) {
    results.push({ slug, error: String(e).slice(0, 100) })
  }
  await page.close()
}
await browser.close()
await server.close()

const ok = results.filter((r) => r.frameMs != null).sort((a, b) => b.frameMs - a.frameMs)
const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${pad('sketch', 24)}${pad('fps', 8)}${pad('frame ms', 10)}${pad('JS ms', 8)}${pad('task ms', 9)}note`)
for (const r of ok) {
  const gpuBound = r.frameMs > 12 && r.taskMs < r.frameMs * 0.4 ? 'GPU / raster bound' : r.jsMs > r.frameMs * 0.6 ? 'CPU (JS) bound' : ''
  console.log(`${pad(r.slug, 24)}${pad(r.fps, 8)}${pad(r.frameMs, 10)}${pad(r.jsMs, 8)}${pad(r.taskMs, 9)}${r.errors ? 'ERRORS ' : ''}${gpuBound}`)
}
for (const r of results.filter((r) => r.error)) console.log(`${pad(r.slug, 24)}FAILED ${r.error}`)
console.log(`\n${ok.length} sketches · demo=${demo} · ${vw}x${vh} · quality=${quality} · ${ms} ms each · ${flag('headed') ? 'headed' : 'headless'}`)
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(results, null, 2))
process.exit(0)
