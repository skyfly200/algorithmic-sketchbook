// Show vs design mode: frame pacing of the Patch page and where its main-thread time goes.
// Needs `npm run build`. Software renderer, so absolute ms mean little: compare runs on one machine.
// Usage: node scripts/scratch/mode-perf.mjs [label]   (OUT=<file.json> to save the numbers)
import { chromium } from 'playwright'
import { preview } from 'vite'
import { writeFileSync } from 'node:fs'
const label = process.argv[2] || 'run'
const PORT = 4398
const server = await preview({ root: process.cwd(), preview: { port: PORT, strictPort: true } })
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
// two effects, a 3-filter chain, a blend, an output, plus a few extra (culled) effects so the board has some nodes
const N = (id, type, x, y, params = {}) => ({ id, type, x, y, params })
const graph = {
  nodes: [
    N(2, 'effect', 40, 60, { slug: 'plasma-shader', seed: 'a' }),
    N(3, 'filter', 300, 60, { slug: 'invert' }), N(4, 'filter', 540, 60, { slug: 'vignette' }), N(5, 'filter', 780, 60, { slug: 'pixelate' }),
    N(6, 'effect', 40, 330, { slug: 'infinite-zoom', seed: 'b' }),
    N(7, 'blend', 1020, 200, { mode: 'screen', mix: 0.5 }),
    N(8, 'output', 1260, 200),
    N(9, 'effect', 300, 330, { slug: 'spirograph', seed: 'c' }), N(10, 'effect', 540, 330, { slug: 'oscilloscope', seed: 'd' }),
  ],
  edges: [{ from: 2, to: 3, port: 0 }, { from: 3, to: 4, port: 0 }, { from: 4, to: 5, port: 0 }, { from: 5, to: 7, port: 0 }, { from: 6, to: 7, port: 1 }, { from: 7, to: 8, port: 0 }],
  links: [], effects: {},
}
await page.addInitScript(([g, noBake]) => {
  localStorage.setItem('sketchbook-patch', JSON.stringify(g))
  if (noBake) localStorage.setItem('patch.autoBake', '0')
  try { const s = JSON.parse(localStorage.getItem('sketchbook-settings') || '{}'); localStorage.setItem('sketchbook-settings', JSON.stringify({ ...s, tutorials: false })) } catch {}
  // frame recorder: rAF timestamps + long tasks of the top page
  window.__fr = { t: [], long: [], on: false }
  const tick = (ts) => { if (window.__fr.on) window.__fr.t.push(ts); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  new PerformanceObserver((l) => { if (window.__fr.on) for (const e of l.getEntries()) window.__fr.long.push(e.duration) }).observe({ type: 'longtask', buffered: false })
}, [graph, process.env.AUTOBAKE === '0'])
await page.goto(`http://localhost:${PORT}/#/patch`)
await page.waitForTimeout(2000)
for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(400) }
await page.waitForFunction(() => document.querySelectorAll('iframe').length >= 5, null, { timeout: 60000 })
await page.waitForTimeout(8000) // everything loaded, chains formed, rate controller settled
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

function stats(t, long) {
  const d = []
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1])
  const s = [...d].sort((a, b) => a - b)
  const q = (p) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(1)
  const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1)
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length || 1))
  return { frames: d.length, fps: +(1000 / mean).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), jitterSd: +sd.toFixed(1), over33: d.filter((x) => x > 33.4).length, longTasks: long.length, longMs: Math.round(long.reduce((a, b) => a + b, 0)) }
}
function topFns(profile, n = 14) {
  const self = new Map()
  const byId = new Map(profile.nodes.map((x) => [x.id, x]))
  const dt = profile.timeDeltas
  const parentOf = new Map()
  for (const x of profile.nodes) for (const c of x.children || []) parentOf.set(c, x.id)
  const cnt = new Map()
  profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)))
  let total = 0
  for (const [id, us] of cnt) {
    const f = byId.get(id).callFrame
    if (['(idle)', '(program)', '(root)'].includes(f.functionName)) continue
    let key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`
    if (!f.url && parentOf.has(id)) { const pf = byId.get(parentOf.get(id)).callFrame; key += ` <- ${pf.functionName || '(anon)'} ${(pf.url || '').split('/').pop()}:${pf.lineNumber + 1}` }
    self.set(key, (self.get(key) || 0) + us)
    total += us
  }
  return { busyMs: Math.round(total / 1000), top: [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(5)} ms  ${k}`) }
}
async function measure(name, ms, during) {
  await page.evaluate(() => { window.__fr.t = []; window.__fr.long = []; window.__fr.on = true })
  await cdp.send('Profiler.start')
  if (during) await during(ms); else await page.waitForTimeout(ms)
  const { profile } = await cdp.send('Profiler.stop')
  const fr = await page.evaluate(() => { window.__fr.on = false; return window.__fr })
  return { name, ...stats(fr.t, fr.long), cpu: topFns(profile) }
}
const res = []
// design: board visible, idle
res.push(await measure('design idle', 6000))
// design: drag a culled node around the board for the whole window
res.push(await measure('design drag', 6000, async (ms) => {
  const h = page.locator('.node-head').nth(7)
  const b = await h.boundingBox()
  await page.mouse.move(b.x + 30, b.y + 8); await page.mouse.down()
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < ms) { i++; await page.mouse.move(b.x + 30 + 120 * Math.sin(i / 10), b.y + 8 + 80 * Math.cos(i / 13)); await page.waitForTimeout(8) }
  await page.mouse.up()
}))
// show: output-only
await page.locator('[data-tour="patch-output"]').click()
await page.waitForTimeout(3000)
res.push(await measure('show (output only)', 8000))
for (const r of res) {
  console.log(`\n== ${label}: ${r.name} ==`)
  const { cpu, name, ...rest } = r
  console.log(JSON.stringify(rest))
  console.log(`main-thread busy ${cpu.busyMs} ms (incl. same-process iframes)`); for (const l of cpu.top) console.log('  ' + l)
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ label, res }, null, 1))
if (errs.length) console.log('errors', errs.slice(0, 5))
await browser.close(); await server.close()
