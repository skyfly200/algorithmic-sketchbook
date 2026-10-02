// Error checking in the real Patch (dev server, for the window.__patchProblems test hook): a deliberately broken
// patch should list its problems with a fix for each, show badges on the nodes, and clear a problem when its
// one-click fix is used.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
fs.mkdirSync('scripts/scratch/out', { recursive: true })
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 160)) })
const graph = {
  nodes: [
    { id: 2, type: 'effect', x: 60, y: 90, params: { slug: 'plasma-shader', seed: 'a' } },
    { id: 3, type: 'filter', x: 300, y: 90, params: { slug: 'blur', seed: 'a' } },
    { id: 4, type: 'effect', x: 60, y: 330, params: { slug: 'no-such-sketch', seed: 'a' } },
  ],
  edges: [{ from: 2, to: 99, port: 0 }], // points at a node that does not exist
  links: [], effects: {},
}
await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) }) // a blocked camera
await page.addInitScript((g) => { localStorage.setItem('sketchbook-patch', JSON.stringify(g)); localStorage.setItem('sketchbook-settings', JSON.stringify({ tutorials: false })); localStorage.setItem('patch.autoBake', '0'); localStorage.setItem('patch.freezeStatic', '0') }, graph)
await page.goto('http://localhost:5199/', { timeout: 180000, waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(500) }
await page.evaluate(() => { location.hash = '#/patch' })
await page.waitForTimeout(3500)
const codes = () => page.evaluate(() => { window.__patchProblems.lint(); return window.__patchProblems.issues.map((i) => i.code + (i.nodeId != null ? '#' + i.nodeId : '')).sort() })
let first; try { first = await codes() } catch (e) { console.log('FAILED to read issues; page errors:', JSON.stringify(errs)); await browser.close(); await server.close(); process.exit(1) }
console.log('issues:', JSON.stringify(first))
await page.locator('[data-tour=patch-problems]').click()
await page.waitForTimeout(500)
const panel = await page.evaluate(() => ({ text: document.querySelector('.prob')?.innerText.slice(0, 1400), items: document.querySelectorAll('.prob-item').length, fixes: [...document.querySelectorAll('.prob-fix')].every((e) => /How to fix:/.test(e.innerText)), badges: document.querySelectorAll('.node-issue').length, errorNodes: document.querySelectorAll('.node--error').length }))
console.log('panel items', panel.items, '| every item has a how-to-fix:', panel.fixes, '| node badges', panel.badges, '| nodes outlined', panel.errorNodes)
await page.screenshot({ path: 'scripts/scratch/out/problems-1.png' })
// the one-click fix for "No Output node"
await page.locator('.prob-item[data-code=NO_OUTPUT] button', { hasText: /Add an Output/ }).click()
await page.waitForTimeout(800)
const after = await codes()
console.log('after "Add an Output node":', JSON.stringify(after))
console.log('NO_OUTPUT cleared:', !after.includes('NO_OUTPUT'), '| OUTPUT_EMPTY now reported:', after.some((c) => c.startsWith('OUTPUT_EMPTY')))
// a dismissed problem stays gone
await page.locator('.prob-item[data-code=OUTPUT_EMPTY] button', { hasText: 'Dismiss' }).click()
await page.waitForTimeout(300)
console.log('dismissed one:', !(await codes()).some((c) => c.startsWith('OUTPUT_EMPTY')))
await page.screenshot({ path: 'scripts/scratch/out/problems-2.png' })
// a sketch that throws is reported on its node
await page.evaluate(() => { for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow.eval("setTimeout(function () { throw new Error('boom test') }, 0)") } catch {} } })
await page.waitForTimeout(1500)
const boom = await page.evaluate(() => { window.__patchProblems.lint(); return window.__patchProblems.issues.filter((i) => i.code === 'SKETCH_ERROR').map((i) => i.message.slice(0, 80)) })
console.log('sketch error reported:', boom.length > 0, JSON.stringify(boom[0] ?? ''))
// a blocked camera (none exists in this browser) is explained, not swallowed
await page.locator('button[title^="Camera"]').click()
await page.waitForTimeout(6000)
console.log('camera on:', await page.evaluate(() => !!document.querySelector('.mdi-webcam')), 'runtime issues:', JSON.stringify(await page.evaluate(() => [...window.__patchProblems.runtimeIssues.keys()])))
const cam = await page.evaluate(() => { window.__patchProblems.lint(); const i = window.__patchProblems.issues.find((x) => x.code === 'CAMERA_DENIED'); return i ? i.fix.slice(0, 70) : null })
console.log('camera problem explained:', !!cam, JSON.stringify(cam))
await page.screenshot({ path: 'scripts/scratch/out/problems-3.png' })
console.log('errors', JSON.stringify(errs))
await browser.close(); await server.close()
