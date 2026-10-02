import fs from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const [tag, ...slugs] = process.argv.slice(2)
const SP = (process.env.SP || 'scripts/scratch/out'); fs.mkdirSync(SP, { recursive: true })
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const slug of slugs) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:5199/sketches/${slug}/index.html?demo=landscape&quality=high&seed=7`)
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${SP}/${tag}-${slug}.png` })
  console.log(slug, errs.filter((e) => !/404|Failed to load resource/.test(e)).slice(0, 3))
  await page.close()
}
await browser.close(); await server.close()
