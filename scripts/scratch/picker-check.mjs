// Search in the Patch effect / filter picker: open it, type, pick with Enter, check the node's slug changed.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
const out = process.argv[2] || 'scripts/scratch/out'
fs.mkdirSync(out, { recursive: true })
const server = await createServer({ root: process.cwd(), server: { port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
const graph = { nodes: [
  { id: 2, type: 'effect', x: 60, y: 90, params: { slug: 'plasma-shader', seed: 'a' } },
  { id: 3, type: 'filter', x: 340, y: 90, params: { slug: 'blur', seed: 'a' } },
], edges: [], links: [], effects: {} }
await page.addInitScript((g) => { localStorage.setItem('sketchbook-patch', JSON.stringify(g)); localStorage.setItem('sketchbook-settings', JSON.stringify({ tutorials: false })); localStorage.setItem('patch.autoBake', '0'); localStorage.setItem('patch.freezeStatic', '0') }, graph)
await page.goto('http://localhost:5198/', { timeout: 180000, waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.evaluate(() => { location.hash = '#/patch' })
await page.waitForTimeout(3500)
const btns = page.locator('.sp-btn')
console.log('pickers:', await btns.count(), '| labels:', await btns.allInnerTexts())
await btns.nth(1).click()
await page.waitForTimeout(400)
console.log('focused search:', await page.evaluate(() => document.activeElement?.className), '| inputs:', await page.locator('.sp-search').count(), await page.locator('.sp-search').isVisible(), '| menu:', await page.locator('.sp').count())
console.log('after manual focus:', await page.evaluate(() => document.activeElement?.className))
console.log('groups:', (await page.locator('.sp-group').allInnerTexts()).join(' / '))
await page.keyboard.type('crt')
await page.waitForTimeout(200)
console.log('hits for "crt":', (await page.locator('.sp-item .sp-title').allInnerTexts()).slice(0, 6))
await page.screenshot({ path: out + '/picker-search.png' })
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchbook-patch')).nodes?.map((n) => n.params?.slug) ?? JSON.parse(localStorage.getItem('sketchbook-patch')))
console.log('nodes still present:', await page.locator('.sp-btn').count(), '| labels now:', await page.locator('.sp-btn').allInnerTexts())
console.log('saved slugs:', JSON.stringify(saved).slice(0, 300))
await btns.nth(0).click(); await page.waitForTimeout(300)
await page.keyboard.type('zzqx'); await page.waitForTimeout(150)
console.log('empty state:', await page.locator('.sp-empty').innerText())
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
console.log('menu closed:', !(await page.locator('.sp').isVisible().catch(() => false)), '| errors:', JSON.stringify(errs))
await browser.close(); await server.close()
