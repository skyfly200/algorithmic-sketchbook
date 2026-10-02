import { chromium } from 'playwright'
import fs from 'node:fs'
const SP = (process.env.SP || 'scripts/scratch/out'); fs.mkdirSync(SP, { recursive: true })
const slugs = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1920, height: 540 * slugs.length } })
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
const html = slugs.map((s) => `<div style="display:flex;margin:0"><img width=960 src="${img(`${SP}/before-${s}.png`)}"><img width=960 src="${img(`${SP}/after-${s}.png`)}"></div>`).join('')
await page.setContent(`<body style="margin:0;background:#222">${html}</body>`)
await page.screenshot({ path: `${SP}/montage-${slugs.join('_')}.png` })
await browser.close()
