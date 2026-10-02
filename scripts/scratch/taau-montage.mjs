// Joins out/taau-{native,lowres,temporal}.png side by side, 2x enlarged (nearest) for inspection.
import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ channel: 'msedge' })
const p = await b.newPage()
const urls = ['ref', 'native', 'lowres', 'temporal'].map((n) => 'data:image/png;base64,' + fs.readFileSync(`scripts/scratch/out/taau-${n}.png`).toString('base64'))
const out = await p.evaluate(async (urls) => {
  const imgs = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u })))
  const w = imgs[1].width, h = imgs[1].height, z = +(location.hash.slice(1) || 2)
  const c = document.createElement('canvas'); c.width = (w * z + 6) * 4; c.height = h * z
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
  imgs.forEach((i, k) => x.drawImage(i, k * (w * z + 6), 0, w * z, h * z))
  return c.toDataURL('image/png')
}, urls)
fs.writeFileSync('scripts/scratch/out/taau-montage.png', Buffer.from(out.split(',')[1], 'base64'))
await b.close()
