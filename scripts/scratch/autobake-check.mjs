// Auto-detection in the real Patch: a heavy sketch that cannot keep up should be noticed (sketch:fps vs the rate it
// was given) and baked without anyone clicking. On a software renderer mandelbulb is slow enough to trigger it.
import { chromium } from 'playwright'
import { createServer } from 'vite'
const slug = process.argv[2] || 'mandelbulb'
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 160)) })
const graph = { nodes: [{ id: 2, type: 'effect', x: 60, y: 90, params: { slug, seed: 'a' } }, { id: 3, type: 'output', x: 400, y: 90, params: {} }], edges: [{ from: 2, to: 3, port: 0 }], links: [], effects: {} }
await page.addInitScript((g) => { localStorage.setItem('sketchbook-patch', JSON.stringify(g)); localStorage.setItem('patch.freezeStatic', '0') }, graph)
await page.goto('http://localhost:5199/')
await page.waitForTimeout(1500)
for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(500) }
await page.evaluate(() => { location.hash = '#/patch' })
const t0 = Date.now(); let seen = []
for (let i = 0; i < 80; i++) {
  const st = await page.evaluate(() => ({ phase: window.__patchPerf.bakeUi[2]?.phase ?? null, p: +(window.__patchPerf.bakeUi[2]?.progress ?? 0).toFixed(2), slow: window.__patchPerf.advisor.slow(2), fpsRatio: window.__patchPerf.advisor.m.get(2)?.fpsRatio?.toFixed(2) ?? null }))
  if (i % 4 === 0) console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(st))
  if (st.phase === 'ready') { console.log('auto-baked after', Math.round((Date.now() - t0) / 1000), 's; iframe paused:', await page.evaluate(() => window.__patchPerf.framePaused(2))); break }
  await page.waitForTimeout(5000)
}
console.log('errors', JSON.stringify(errs))
await browser.close(); await server.close()
