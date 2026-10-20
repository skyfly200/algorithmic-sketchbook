// Scratch: screenshots of mushroom-fruiting. Each arg is `label|query`, e.g.
//   node scripts/scratch/mushroom-shots.mjs "porcini|specimens=porcini" "logs|trees=0.5" "scene|"
// env: SP (out dir), CHROME (browser), WAIT (ms before the shot), DPR, SEED, W, H, PARAMS (json of params to set)
import fs from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const SP = process.env.SP || 'scripts/scratch/out'; fs.mkdirSync(SP, { recursive: true })
const jobs = process.argv.slice(2).map((a) => { const [label, q = ''] = a.split('|'); return { label, q } })
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined })
for (const { label, q } of jobs) {
  const page = await (await browser.newContext({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) }, deviceScaleFactor: Number(process.env.DPR || 1) })).newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:5198/sketches/mushroom-fruiting/index.html?quality=native&seed=${process.env.SEED || 11}${q ? `&${q}` : ''}`)
  if (process.env.PARAMS) {
    await page.waitForTimeout(300)
    await page.evaluate((p) => { for (const [k, v] of Object.entries(p)) window.postMessage({ type: 'sketch:set-param', name: k, value: v }, '*') }, JSON.parse(process.env.PARAMS))
  }
  await page.waitForTimeout(Number(process.env.WAIT || 1500))
  await page.screenshot({ path: `${SP}/mush-${label}.png` })
  console.log(label, errs.slice(0, 3))
  await page.close()
}
await browser.close(); await server.close()
