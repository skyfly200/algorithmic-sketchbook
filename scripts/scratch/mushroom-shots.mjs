// Scratch: screenshots of mushroom-fruiting, default scene and one species at a time.
import fs from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const SP = process.env.SP || 'scripts/scratch/out'; fs.mkdirSync(SP, { recursive: true })
const species = (process.argv[2] || 'all').split(',')
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined })
const ALL = ['flyAgaric', 'porcini', 'inkcap', 'oyster', 'chanterelle', 'polypore', 'mycena', 'wild']
for (const sp of species) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR || 1) })).newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:5198/sketches/mushroom-fruiting/index.html?quality=native&seed=${process.env.SEED || 11}${process.env.SPEC ? `&specimens=${sp}` : ''}`)
  await page.waitForTimeout(500)
  if (process.env.VAR) await page.evaluate((v) => { window.postMessage({ type: 'sketch:set-param', name: 'variation', value: v }, '*'); setTimeout(() => window.dispatchEvent(new Event('resize')), 100) }, Number(process.env.VAR))
  if (sp !== 'all' && !process.env.SPEC) {
    await page.evaluate(({ sp, ALL }) => {
      for (const k of ALL) window.postMessage({ type: 'sketch:set-param', name: k, value: k === sp }, '*')
      window.postMessage({ type: 'sketch:set-param', name: 'growth', value: 3 }, '*')
    }, { sp, ALL })
    await page.waitForTimeout(300)
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  }
  for (const t of (process.env.TIMES || '4000').split(',').map(Number)) {
    await page.waitForTimeout(t)
    const clip = process.env.CLIP && Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(process.env.CLIP.split(',')[i])]))
    await page.screenshot({ path: `${SP}/mush-${sp}-${t}.png`, clip })
  }
  console.log(sp, errs.slice(0, 3))
  await page.close()
}
await browser.close(); await server.close()
