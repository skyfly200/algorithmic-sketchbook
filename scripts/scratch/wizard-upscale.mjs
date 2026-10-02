// Drives the real Import wizard -> AI upscale dialog in Patch on the production build (run `npm run build` first).
// Uses a 40x40 image so only one tile runs (still ~1 min on WASM/SwiftShader: the model downloads first).
import { chromium } from 'playwright'
import { preview } from 'vite'
import fs from 'node:fs'
fs.mkdirSync('scripts/scratch/out', { recursive: true })
const server = await preview({ root: process.cwd(), preview: { port: 4399, strictPort: true } })
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.addInitScript(() => localStorage.setItem('sketchbook-patch', JSON.stringify({ nodes: [{ id: 1, type: 'output', x: 400, y: 200, params: {} }], edges: [], links: [], effects: {} })))
await page.goto('http://localhost:4399/')
await page.waitForTimeout(1500)
const skip = page.getByText('Skip', { exact: true }); if (await skip.count()) await skip.first().click()
await page.evaluate(() => { location.hash = '#/patch' })
await page.waitForTimeout(2500)
for (let i = 0; i < 8 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(700) }
await page.locator('[data-tour=patch-add]').click()
await page.getByText('Import wizard', { exact: false }).first().click()
await page.getByText('AI upscale', { exact: true }).first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/scratch/out/wizard-1-dialog.png' })
// a 40x40 PNG
const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#36f'; x.fillRect(0, 0, 40, 40); x.fillStyle = '#fff'; x.fillRect(8, 18, 24, 3); return c.toDataURL('image/png').split(',')[1] })
fs.writeFileSync('scripts/scratch/out/tiny.png', Buffer.from(png, 'base64'))
await page.locator('.up input[type=file]').setInputFiles('scripts/scratch/out/tiny.png')
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/scratch/out/wizard-2-queued.png' })
await page.getByRole('button', { name: /^Upscale/ }).click()
await page.waitForTimeout(8000)
await page.screenshot({ path: 'scripts/scratch/out/wizard-3-running.png' })
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => ({ done: !!document.querySelector('.up-item.done'), err: document.querySelector('.up-item.error .up-sub')?.textContent, prog: document.querySelector('.up-progress .up-sub')?.textContent, note: document.querySelector('.up-note')?.textContent }))
  console.log(i * 10, JSON.stringify(st))
  if (st.done || st.err) break
  await page.waitForTimeout(10000)
}
await page.screenshot({ path: 'scripts/scratch/out/wizard-4-done.png' })
const info = await page.evaluate(() => ({ done: document.querySelector('.up-item.done .up-sub')?.textContent, toast: document.querySelector('.save-toast')?.textContent, nodes: [...document.querySelectorAll('.node')].length }))
console.log(JSON.stringify(info), 'errors', JSON.stringify(errs))
await browser.close(); await server.httpServer.close()
