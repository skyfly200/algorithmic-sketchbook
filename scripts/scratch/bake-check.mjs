// Tier 2 in the real Patch (dev server, for the window.__patchPerf test hook): bake an animated effect
// to a looping clip, check playback keeps moving, the live iframe is paused, and a param change unbakes.
import { chromium } from 'playwright'
import { createServer } from 'vite'
const slug = process.argv[2] || 'plasma-shader'
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 160)) })
const graph = { nodes: [{ id: 2, type: 'effect', x: 60, y: 90, params: { slug, seed: 'a' } }, { id: 3, type: 'output', x: 400, y: 90, params: {} }], edges: [{ from: 2, to: 3, port: 0 }], links: [], effects: {} }
await page.addInitScript((g) => { localStorage.setItem('sketchbook-patch', JSON.stringify(g)); localStorage.setItem('patch.freezeStatic', '0'); localStorage.setItem('patch.autoBake', '0') }, graph)
await page.goto('http://localhost:5199/')
await page.waitForTimeout(1500)
for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(500) }
await page.evaluate(() => { location.hash = '#/patch' })
await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('canvas')?.width, null, { timeout: 120000 })
await page.waitForTimeout(3000)
const sig = () => page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const t = document.createElement('canvas'); t.width = 64; t.height = 36; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h })
const t0 = Date.now()
const started = await page.evaluate(() => window.__patchPerf.bakeNow(2).then(() => true))
const info = await page.evaluate(() => { const b = window.__patchPerf.bakes.get(2); return { state: b?.state, frames: b?.player?.frames, fps: b?.player?.fps, mb: window.__patchPerf.bakeUi[2]?.mb } })
console.log('bake finished in', Math.round((Date.now() - t0) / 1000), 's', JSON.stringify(info), 'started', started)
await page.waitForTimeout(1500)
console.log('live iframe paused:', await page.evaluate(() => window.__patchPerf.framePaused(2)))
const sigs = new Set(); for (let i = 0; i < 6; i++) { sigs.add(await sig()); await page.waitForTimeout(250) }
console.log('baked playback keeps moving:', sigs.size > 1, 'distinct pictures', sigs.size)
await page.evaluate(() => { const ec = window.__patchPerf.effectControls.get(2); const [name, spec] = Object.entries(ec.schema).find(([, s]) => typeof s.min === 'number'); window.__patchPerf.setEffectParam(2, name, spec.max) })
await page.waitForTimeout(400)
console.log('param change dropped the bake:', await page.evaluate(() => window.__patchPerf.bakes.size === 0), 'iframe resumed:', !(await page.evaluate(() => window.__patchPerf.framePaused(2))))
console.log('errors', JSON.stringify(errs))
await browser.close(); await server.close()
