// Tier 1 in the real Patch (dev server, for the window.__patchPerf test hook): a static fractal should
// freeze after ~1 s, stay frozen, and wake the moment a parameter changes.
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 160)) })
const graph = { nodes: [{ id: 2, type: 'effect', x: 60, y: 90, params: { slug: 'fractal-explorer', seed: 'a' } }, { id: 3, type: 'output', x: 400, y: 90, params: {} }], edges: [{ from: 2, to: 3, port: 0 }], links: [], effects: {} }
await page.addInitScript((g) => localStorage.setItem('sketchbook-patch', JSON.stringify(g)), graph)
await page.goto('http://localhost:5199/')
await page.waitForTimeout(1500)
for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(500) }
await page.evaluate(() => { location.hash = '#/patch' })
await page.waitForTimeout(3000)
const sig = () => page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const t = document.createElement('canvas'); t.width = 64; t.height = 36; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h })
const frozen = () => page.evaluate(() => window.__patchPerf.idle.isFrozen(2))
const badge = () => page.evaluate(() => !!window.__patchPerf.frozenUi[2])
await page.waitForFunction(() => document.querySelector('iframe') && document.querySelector('iframe').contentDocument?.querySelector('canvas')?.width, null, { timeout: 120000 })
await page.waitForTimeout(3000)
await page.evaluate(() => window.__patchPerf.postToEffect(2, { type: 'sketch:set-param', name: 'colorCycle', value: 0 })) // palette stops cycling: a static picture
const t0 = Date.now(); let freezeAt = null
while (Date.now() - t0 < 40000) { if (await frozen()) { freezeAt = Date.now() - t0; break } await page.waitForTimeout(250) }
console.log('frozen after', freezeAt, 'ms')
console.log('tracker', JSON.stringify(await page.evaluate(() => [...window.__patchPerf.idle.s.entries()])), 'sigs', await sig(), await sig())
const h1 = await sig(); await page.waitForTimeout(1500); const h2 = await sig()
console.log('picture identical while frozen:', h1 === h2, 'still frozen:', await frozen(), 'badge:', await badge(), 'iframe paused:', await page.evaluate(() => window.__patchPerf.framePaused(2)))
await page.evaluate(() => window.__patchPerf.postToEffect(2, { type: 'sketch:set-param', name: 'colorCycle', value: 2 }))
await page.waitForTimeout(150)
console.log('woke on param change:', !(await frozen()), 'iframe resumed:', !(await page.evaluate(() => window.__patchPerf.framePaused(2))))
await page.waitForTimeout(500)
console.log('badge cleared:', !(await badge()))
await page.waitForTimeout(2500)
const h3 = await sig(); await page.waitForTimeout(700); const h4 = await sig()
console.log('picture moves again:', h3 !== h4 || h2 !== h4, 'errors', JSON.stringify(errs))
await browser.close(); await server.close()
